const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MIN = 60000;

// Loads shared.js + background.js into a sandbox with a fake `browser` object.
function setup({ tabs, settings, session = {}, granted = false, runTimers = false, snapshot }) {
  const store = { local: { settings }, session: { ...session } };
  if (snapshot) store.local.unloadedSnapshot = snapshot;
  const calls = { discard: [], reload: [], badge: [], menus: [], script: [], grey: [], greyZ: [] };
  const timers = [];
  const listeners = {};
  const ev = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const area = (kind) => ({
    get: async (key) => (key in store[kind] ? { [key]: JSON.parse(JSON.stringify(store[kind][key])) } : {}),
    set: async (obj) => Object.assign(store[kind], JSON.parse(JSON.stringify(obj))),
  });
  const browser = {
    storage: { local: area("local"), session: area("session") },
    tabs: {
      query: async () => tabs.map((t) => ({ ...t })),
      get: async (id) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error("no tab");
        return { ...t };
      },
      discard: async (id) => {
        calls.discard.push(id);
        const t = tabs.find((x) => x.id === id);
        if (t && !t.active) t.discarded = true;
      },
      reload: async (id) => calls.reload.push(id),
      update: async (id) => tabs.find((t) => t.id === id),
      onUpdated: ev("tabs.onUpdated"),
      onActivated: ev("tabs.onActivated"),
      onRemoved: ev("tabs.onRemoved"),
      onCreated: ev("tabs.onCreated"),
    },
    windows: { update: async () => {} },
    alarms: { create() {}, onAlarm: ev("alarms.onAlarm") },
    action: { setBadgeText: async ({ text }) => calls.badge.push(text) },
    menus: {
      create: (o) => calls.menus.push(o),
      update: async () => {},
      refresh() {},
      onClicked: ev("menus.onClicked"),
      onShown: ev("menus.onShown"),
    },
    runtime: { onStartup: ev("runtime.onStartup"), onInstalled: ev("runtime.onInstalled"), onMessage: ev("runtime.onMessage"), getURL: (p) => p },
    permissions: { contains: async () => granted },
    scripting: {
      executeScript: async (opts) => {
        calls.script.push({ tabId: opts.target.tabId, args: [...opts.args], order: calls.discard.length });
      },
    },
    i18n: { getMessage: (k, sub) => (sub ? `${k}:${sub}` : k) },
  };
  const ctx = vm.createContext({
    browser, console, URL, JSON, Date, Promise,
    setTimeout: (fn) => (runTimers ? fn() : timers.push(fn)),
    makeGreyIcon: async (url, withZ) => {
      calls.grey.push(url);
      calls.greyZ.push(withZ);
      return "data:image/png;base64,GREY";
    },
  });
  for (const f of ["shared.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"), ctx, { filename: f });
  }
  return { calls, store, listeners, timers, tabs };
}

const baseTab = { url: "https://example.com", title: "Example", active: false, audible: false, pinned: false, discarded: false };
const cfg = (o = {}) => ({ defaultTimeoutMin: 30, profiles: [], ...o });

test("tick discards idle tabs and keeps active/audible/whitelisted ones", async () => {
  const old = Date.now() - 60 * MIN;
  const t = setup({
    settings: cfg({ profiles: [{ id: "wl", hosts: ["safe.org"], never: true }] }),
    tabs: [
      { ...baseTab, id: 1, lastAccessed: old },
      { ...baseTab, id: 2, lastAccessed: old, active: true },
      { ...baseTab, id: 3, lastAccessed: old, audible: true },
      { ...baseTab, id: 4, lastAccessed: old, url: "https://safe.org" },
      { ...baseTab, id: 5, lastAccessed: Date.now() },
    ],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, [1]);
  assert.equal(t.store.local.stats.total, 1, "discard is counted in the stats");
});

test("tick does nothing while paused", async () => {
  const t = setup({ settings: cfg({ paused: true }), tabs: [{ ...baseTab, id: 1, lastAccessed: 0 }] });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, []);
});

test("refresh cycle without news: reload, then unload again silently", async () => {
  const t = setup({
    settings: cfg({ profiles: [{ id: "p", pinned: "only", refresh: { enabled: true, intervalMin: 15 } }] }),
    tabs: [{ ...baseTab, id: 7, pinned: true, discarded: true, lastAccessed: 0 }],
    session: { mtu: { refreshedAt: { 7: Date.now() - 20 * MIN } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.reload, [7]);

  t.tabs[0].discarded = false; // reload loaded the tab
  await t.listeners["tabs.onUpdated"](7, { status: "complete" });
  assert.equal(t.timers.length, 1, "waits for the page to settle");
  await t.timers[0]();
  assert.deepEqual(t.calls.discard, [7]);
  assert.equal(t.calls.badge.at(-1), "", "no badge without news");
});

test("refresh cycle with news: flags it on the badge and unloads again", async () => {
  const t = setup({
    settings: cfg({ profiles: [{ id: "p", pinned: "only", refresh: { enabled: true, intervalMin: 15 } }] }),
    tabs: [{ ...baseTab, id: 7, pinned: true, discarded: true, lastAccessed: 0 }],
    session: { mtu: { refreshedAt: { 7: Date.now() - 20 * MIN } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  t.tabs[0].discarded = false;
  t.tabs[0].title = "(3) Inbox";
  await t.listeners["tabs.onUpdated"](7, { status: "complete" });
  await t.timers[0]();

  assert.deepEqual(t.calls.discard, [7], "unloaded again");
  assert.equal(t.calls.badge.at(-1), "1");

  // Activating the tab clears the flag and the badge.
  await t.listeners["tabs.onActivated"]({ tabId: 7 });
  assert.equal(t.calls.badge.at(-1), "");
});

test("global auto-refresh from the popup settings reloads unloaded pinned tabs", async () => {
  const t = setup({
    settings: cfg({ refresh: { enabled: true, intervalMin: 10 } }),
    tabs: [
      { ...baseTab, id: 1, pinned: true, discarded: true, lastAccessed: 0 },
      { ...baseTab, id: 2, discarded: true, lastAccessed: 0 },
    ],
    session: { mtu: { refreshedAt: { 1: 0, 2: 0 } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.reload, [1]);
});

test("pinned tabs are left alone when skipPinned is on", async () => {
  const t = setup({
    settings: cfg({ skipPinned: true }),
    tabs: [{ ...baseTab, id: 1, pinned: true, lastAccessed: 0 }, { ...baseTab, id: 2, lastAccessed: 0 }],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, [2]);
});

test("a stale refresh is finished by the next tick", async () => {
  const t = setup({
    settings: cfg(),
    tabs: [{ ...baseTab, id: 9, lastAccessed: Date.now() }],
    session: { mtu: { refreshing: { 9: Date.now() - 5 * MIN } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, [9]);
});

test("context menu toggles the site in the never-unload profile", async () => {
  const t = setup({ settings: cfg(), tabs: [] });
  t.listeners["runtime.onInstalled"]();
  assert.equal(t.calls.menus[0].id, "mtu-never-unload");
  const tab = { url: "https://news.site.com/a" };
  await t.listeners["menus.onClicked"]({ menuItemId: "mtu-never-unload" }, tab);
  assert.deepEqual(t.store.local.settings.profiles[0].hosts, ["news.site.com"]);
  await t.listeners["menus.onClicked"]({ menuItemId: "mtu-never-unload" }, tab);
  assert.deepEqual(t.store.local.settings.profiles[0].hosts, []);
});

test("greyIcons: swaps the favicon before the tab is unloaded", async () => {
  const t = setup({
    settings: cfg({ greyIcons: true }),
    granted: true,
    runTimers: true,
    tabs: [{ ...baseTab, id: 1, lastAccessed: 0, favIconUrl: "https://example.com/favicon.ico" }],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.grey, ["https://example.com/favicon.ico"]);
  assert.equal(t.calls.script.length, 1);
  assert.deepEqual(t.calls.script[0].args, ["data:image/png;base64,GREY"]);
  assert.equal(t.calls.script[0].order, 0, "icon is replaced before tabs.discard runs");
  assert.deepEqual(t.calls.discard, [1]);
});

test("greyIcons: tabs are still unloaded without the all-sites permission", async () => {
  const t = setup({
    settings: cfg({ greyIcons: true }),
    granted: false,
    runTimers: true,
    tabs: [{ ...baseTab, id: 1, lastAccessed: 0, favIconUrl: "https://example.com/favicon.ico" }],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.script, []);
  assert.deepEqual(t.calls.discard, [1]);
});

test("greyIcons: off by default, and tabs without a favicon are just unloaded", async () => {
  const off = setup({
    settings: cfg(),
    granted: true,
    runTimers: true,
    tabs: [{ ...baseTab, id: 1, lastAccessed: 0, favIconUrl: "https://example.com/favicon.ico" }],
  });
  await off.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(off.calls.script, []);
  assert.deepEqual(off.calls.discard, [1]);

  const none = setup({ settings: cfg({ greyIcons: true }), granted: true, runTimers: true, tabs: [{ ...baseTab, id: 2, lastAccessed: 0 }] });
  await none.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(none.calls.script, []);
  assert.deepEqual(none.calls.discard, [2]);
});

test("unloading a tab saves the unloaded set; opening or closing a tab updates it", async () => {
  const t = setup({
    settings: cfg(),
    tabs: [
      { ...baseTab, id: 1, url: "https://a.com", discarded: true, lastAccessed: Date.now() },
      { ...baseTab, id: 2, url: "https://b.com", lastAccessed: 0 },
    ],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, [2]);
  assert.deepEqual(Array.from(t.store.local.unloadedSnapshot), ["https://a.com", "https://b.com"]);

  // The user switches to b.com: it is no longer remembered as unloaded.
  t.tabs[1].active = true;
  await t.listeners["tabs.onActivated"]({ tabId: 2 });
  assert.deepEqual(Array.from(t.store.local.unloadedSnapshot), ["https://a.com"]);

  // Closing a.com empties the set.
  t.tabs.splice(0, 1);
  await t.listeners["tabs.onRemoved"](1);
  assert.deepEqual(Array.from(t.store.local.unloadedSnapshot), []);
});

test("a tick that unloads nothing does not touch the snapshot", async () => {
  const t = setup({
    settings: cfg(),
    tabs: [{ ...baseTab, id: 1, url: "https://a.com", discarded: true, lastAccessed: Date.now() }],
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.equal(t.store.local.unloadedSnapshot, undefined);
});

test("after a restart, tabs that were unloaded are unloaded again and the rest are left alone", async () => {
  const now = Date.now();
  const t = setup({
    settings: cfg(),
    snapshot: ["https://a.com", "https://b.com"],
    tabs: [
      { ...baseTab, id: 1, url: "https://a.com", lastAccessed: now },
      { ...baseTab, id: 2, url: "https://other.com", lastAccessed: now },
    ],
  });
  await t.listeners["runtime.onStartup"]();
  assert.deepEqual(t.calls.discard, [1], "only the remembered tab is unloaded");
  assert.ok(t.store.session.mtu.restore, "still waiting for https://b.com to be restored");

  // The browser restores the second remembered tab a bit later.
  t.tabs.push({ ...baseTab, id: 3, url: "https://b.com", lastAccessed: now });
  await t.listeners["tabs.onCreated"]();
  assert.deepEqual(t.calls.discard, [1, 3]);
  assert.equal(t.store.session.mtu.restore, undefined, "restore is finished");
  assert.deepEqual(Array.from(t.store.local.unloadedSnapshot).sort(), ["https://a.com", "https://b.com"]);
});

test("the old snapshot is not overwritten while a restore is pending", async () => {
  const t = setup({
    settings: cfg(),
    snapshot: ["https://a.com", "https://missing.com"],
    tabs: [{ ...baseTab, id: 1, url: "https://a.com", lastAccessed: Date.now() }],
  });
  await t.listeners["runtime.onStartup"]();
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(Array.from(t.store.local.unloadedSnapshot), ["https://a.com", "https://missing.com"]);
});

test("restore does nothing when the option is off", async () => {
  const t = setup({
    settings: cfg({ restoreUnloaded: false }),
    snapshot: ["https://a.com"],
    tabs: [{ ...baseTab, id: 1, url: "https://a.com", lastAccessed: Date.now() }],
  });
  await t.listeners["runtime.onStartup"]();
  assert.deepEqual(t.calls.discard, []);
  assert.equal(t.store.session.mtu, undefined);
});

test("greyIcons: the sleeping zZ follows the sleepMark setting (on by default)", async () => {
  const run = async (settings) => {
    const t = setup({
      settings,
      granted: true,
      runTimers: true,
      tabs: [{ ...baseTab, id: 1, lastAccessed: 0, favIconUrl: "https://example.com/favicon.ico" }],
    });
    await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
    return t.calls.greyZ;
  };
  assert.deepEqual(await run(cfg({ greyIcons: true })), [true]);
  assert.deepEqual(await run(cfg({ greyIcons: true, sleepMark: false })), [false]);
});

test("a refresh is written to the refresh log", async () => {
  const t = setup({
    settings: cfg({ refresh: { enabled: true, intervalMin: 10, pinnedOnly: false } }),
    tabs: [{ ...baseTab, id: 7, url: "https://mail.example.com/x", discarded: true, lastAccessed: 0 }],
    session: { mtu: { refreshedAt: { 7: 0 } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  t.tabs[0].discarded = false;
  t.tabs[0].title = "(3) Inbox";
  await t.listeners["tabs.onUpdated"](7, { status: "complete" });
  await t.timers[0]();
  const [entry] = Array.from(t.store.local.refreshLog);
  assert.equal(entry.host, "mail.example.com");
  assert.equal(entry.title, "(3) Inbox");
  assert.equal(entry.news, true);
  assert.equal(entry.attention, false);
  assert.equal(entry.kept, false);
});

test("keepNewsLoaded: a tab with news stays loaded and later ticks leave it alone", async () => {
  const t = setup({
    settings: cfg({ keepNewsLoaded: true, refresh: { enabled: true, intervalMin: 10, pinnedOnly: false } }),
    tabs: [{ ...baseTab, id: 7, discarded: true, lastAccessed: 0 }],
    session: { mtu: { refreshedAt: { 7: 0 } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  t.tabs[0].discarded = false;
  t.tabs[0].attention = true; // Firefox's own dot
  await t.listeners["tabs.onUpdated"](7, { status: "complete" });
  await t.timers[0]();
  assert.deepEqual(t.calls.discard, [], "kept loaded");
  assert.equal(t.store.local.refreshLog[0].kept, true);
  assert.equal(t.store.local.refreshLog[0].attention, true);

  // The tab is long idle, but it was kept on purpose.
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, []);

  // Once the user has looked at it, it is a normal idle tab again.
  await t.listeners["tabs.onActivated"]({ tabId: 7 });
  t.tabs[0].active = false;
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  assert.deepEqual(t.calls.discard, [7]);
});
