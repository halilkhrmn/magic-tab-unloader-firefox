const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MIN = 60000;

// Loads shared.js + background.js into a sandbox with a fake `browser` object.
function setup({ tabs, settings, session = {} }) {
  const store = { local: { settings }, session: { ...session } };
  const calls = { discard: [], reload: [], notify: [], badge: [], menus: [] };
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
    notifications: {
      create: async (id, opts) => calls.notify.push({ id, ...opts }),
      clear: async () => {},
      onClicked: ev("notifications.onClicked"),
    },
    menus: {
      create: (o) => calls.menus.push(o),
      update: async () => {},
      refresh() {},
      onClicked: ev("menus.onClicked"),
      onShown: ev("menus.onShown"),
    },
    runtime: { onInstalled: ev("runtime.onInstalled"), onMessage: ev("runtime.onMessage"), getURL: (p) => p },
    i18n: { getMessage: (k, sub) => (sub ? `${k}:${sub}` : k) },
  };
  const ctx = vm.createContext({
    browser, console, URL, JSON, Date, Promise,
    setTimeout: (fn) => timers.push(fn),
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
  assert.deepEqual(t.calls.notify, []);
});

test("refresh cycle with news: flags it, notifies once, unloads again", async () => {
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
  assert.equal(t.calls.notify.length, 1);
  assert.equal(t.calls.notify[0].message, "(3) Inbox");
  assert.equal(t.calls.badge.at(-1), "1");

  // Activating the tab clears the flag and the badge.
  await t.listeners["tabs.onActivated"]({ tabId: 7 });
  assert.equal(t.calls.badge.at(-1), "");
});

test("no desktop notification when notifyOnFound is off", async () => {
  const t = setup({
    settings: cfg({ notifyOnFound: false, profiles: [{ id: "p", pinned: "only", refresh: { enabled: true, intervalMin: 1 } }] }),
    tabs: [{ ...baseTab, id: 7, pinned: true, discarded: true, title: "(2) Chat", lastAccessed: 0 }],
    session: { mtu: { refreshedAt: { 7: 0 } } },
  });
  await t.listeners["alarms.onAlarm"]({ name: "mtu-tick" });
  t.tabs[0].discarded = false;
  await t.listeners["tabs.onUpdated"](7, { status: "complete" });
  await t.timers[0]();
  assert.deepEqual(t.calls.notify, []);
  assert.equal(t.calls.badge.at(-1), "1");
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
