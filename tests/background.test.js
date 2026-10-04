const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MIN = 60000;

// Loads shared.js + background.js into a sandbox with a fake `browser` object.
function setup({ tabs, settings, session = {}, granted = false, runTimers = false }) {
  const store = { local: { settings }, session: { ...session } };
  const calls = { discard: [], reload: [], badge: [], menus: [], script: [], grey: [] };
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
    runtime: { onInstalled: ev("runtime.onInstalled"), onMessage: ev("runtime.onMessage"), getURL: (p) => p },
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
    makeGreyIcon: async (url) => {
      calls.grey.push(url);
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
