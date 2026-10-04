const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/shared.js");

const MIN = 60000;
const tab = (o = {}) => ({ id: 1, url: "https://mail.example.com/inbox", title: "Inbox", lastAccessed: 0, ...o });
const settings = (o = {}) => S.sanitizeSettings({ defaultTimeoutMin: 30, profiles: [], ...o });
// Wed 2026-01-07 at the given local time
const at = (h, m = 0, day = 7) => new Date(2026, 0, day, h, m);

test("matchHost matches domain and subdomains only", () => {
  assert.ok(S.matchHost("github.com", "github.com"));
  assert.ok(S.matchHost("gist.github.com", "github.com"));
  assert.ok(S.matchHost("gist.github.com", "*.github.com"));
  assert.ok(!S.matchHost("notgithub.com", "github.com"));
  assert.ok(!S.matchHost("github.com.evil.io", "github.com"));
  assert.ok(!S.matchHost("example.com", "  "));
});

test("inHours: disabled window always applies", () => {
  assert.ok(S.inHours({ enabled: false }, at(3)));
  assert.ok(S.inHours(undefined, at(3)));
});

test("inHours: daytime window and weekdays", () => {
  const h = { enabled: true, from: "09:00", to: "18:00", days: [1, 2, 3, 4, 5] };
  assert.ok(S.inHours(h, at(9, 0)));
  assert.ok(S.inHours(h, at(17, 59)));
  assert.ok(!S.inHours(h, at(18, 0)));
  assert.ok(!S.inHours(h, at(8, 59)));
  assert.ok(!S.inHours(h, at(12, 0, 10))); // Saturday 2026-01-10
});

test("inHours: overnight window belongs to the day it started on", () => {
  const h = { enabled: true, from: "22:00", to: "06:00", days: [5] }; // Fridays
  assert.ok(S.inHours(h, at(23, 0, 9))); // Friday night
  assert.ok(S.inHours(h, at(2, 0, 10))); // Saturday 02:00 still Friday's window
  assert.ok(!S.inHours(h, at(23, 0, 8))); // Thursday night
  assert.ok(!S.inHours(h, at(2, 0, 9))); // Friday 02:00 belongs to Thursday's window
});

test("findProfile: first match wins, respects pinned and hours", () => {
  const s = settings({
    profiles: [
      { id: "night", hosts: ["example.com"], hours: { enabled: true, from: "22:00", to: "06:00", days: [0, 1, 2, 3, 4, 5, 6] }, timeoutMin: 5 },
      { id: "pin", pinned: "only", timeoutMin: 120 },
      { id: "ex", hosts: ["example.com"], timeoutMin: 60 },
    ],
  });
  assert.equal(S.findProfile(s, tab(), at(23)).id, "night");
  assert.equal(S.findProfile(s, tab(), at(12)).id, "ex");
  assert.equal(S.findProfile(s, tab({ pinned: true }), at(12)).id, "pin");
  assert.equal(S.findProfile(s, tab({ url: "https://other.org" }), at(12)), null);
});

test("hasNotification: title pattern and attention flag", () => {
  const p = S.DEFAULT_SETTINGS.notificationPattern;
  assert.ok(S.hasNotification({ title: "(3) Inbox" }, p));
  assert.ok(S.hasNotification({ title: "[12] Chat" }, p));
  assert.ok(S.hasNotification({ title: "5 new messages" }, p));
  assert.ok(S.hasNotification({ title: "Inbox", attention: true }, p));
  assert.ok(!S.hasNotification({ title: "Inbox (draft)" }, p));
  assert.ok(!S.hasNotification({ title: "x" }, "(["), "invalid regex must not throw");
});

test("planTab: discards idle tabs after the timeout", () => {
  const s = settings();
  const now = 100 * MIN;
  assert.equal(S.planTab(tab({ lastAccessed: now - 31 * MIN }), s, { now }), "discard");
  assert.equal(S.planTab(tab({ lastAccessed: now - 29 * MIN }), s, { now }), null);
});

test("planTab: never touches active, audible, non-http or whitelisted tabs", () => {
  const s = settings({ profiles: [{ id: "wl", hosts: ["safe.org"], never: true }] });
  const old = { lastAccessed: 0 };
  const now = 1000 * MIN;
  assert.equal(S.planTab(tab({ ...old, active: true }), s, { now }), null);
  assert.equal(S.planTab(tab({ ...old, audible: true }), s, { now }), null);
  assert.equal(S.planTab(tab({ ...old, url: "about:preferences" }), s, { now }), null);
  assert.equal(S.planTab(tab({ ...old, url: "https://safe.org/a" }), s, { now }), null);
  assert.equal(S.planTab(tab({ ...old, audible: true }), { ...s, skipAudible: false }, { now }), "discard");
});

test("planTab: profile timeout overrides the default; 0 means never", () => {
  const s = settings({ profiles: [{ id: "a", hosts: ["a.com"], timeoutMin: 5 }, { id: "b", hosts: ["b.com"], timeoutMin: 0 }] });
  const now = 100 * MIN;
  const idle10 = { lastAccessed: now - 10 * MIN };
  assert.equal(S.planTab(tab({ ...idle10, url: "https://a.com" }), s, { now }), "discard");
  assert.equal(S.planTab(tab({ ...idle10, url: "https://b.com" }), s, { now: 9999 * MIN }), null);
  assert.equal(S.planTab(tab({ ...idle10, url: "https://c.com" }), s, { now }), null); // default 30
});

test("planTab: refresh only for discarded tabs whose interval elapsed", () => {
  const s = settings({ profiles: [{ id: "p", pinned: "only", refresh: { enabled: true, intervalMin: 15 } }] });
  const now = 100 * MIN;
  const d = tab({ pinned: true, discarded: true });
  assert.equal(S.planTab(d, s, { now, refreshedAt: now - 16 * MIN }), "refresh");
  assert.equal(S.planTab(d, s, { now, refreshedAt: now - 5 * MIN }), null);
  assert.equal(S.planTab(tab({ discarded: true }), s, { now, refreshedAt: 0 }), null, "unpinned: no profile");
});

test("planTab: global refresh applies to unloaded tabs, pinned-only by default", () => {
  const s = settings({ refresh: { enabled: true, intervalMin: 10 } });
  const now = 100 * MIN;
  const ctx = { now, refreshedAt: now - 11 * MIN };
  assert.equal(S.planTab(tab({ pinned: true, discarded: true }), s, ctx), "refresh");
  assert.equal(S.planTab(tab({ discarded: true }), s, ctx), null, "unpinned tabs are skipped");
  const all = settings({ refresh: { enabled: true, intervalMin: 10, pinnedOnly: false } });
  assert.equal(S.planTab(tab({ discarded: true }), all, ctx), "refresh");
  assert.equal(S.planTab(tab({ pinned: true, discarded: true }), s, { now, refreshedAt: now - 2 * MIN }), null);
  assert.equal(S.planTab(tab({ pinned: true, discarded: true }), settings(), ctx), null, "off by default");
});

test("planTab: a profile's own refresh rule overrides the global one", () => {
  const s = settings({
    refresh: { enabled: true, intervalMin: 60, pinnedOnly: false },
    profiles: [{ id: "chat", hosts: ["chat.com"], refresh: { enabled: true, intervalMin: 5 } }],
  });
  const now = 100 * MIN;
  const chat = tab({ url: "https://chat.com", discarded: true });
  assert.equal(S.planTab(chat, s, { now, refreshedAt: now - 6 * MIN }), "refresh");
  assert.equal(S.planTab(tab({ discarded: true }), s, { now, refreshedAt: now - 6 * MIN }), null);
});

test("skipPinned: pinned tabs are never unloaded or refreshed", () => {
  const s = settings({ skipPinned: true, refresh: { enabled: true, intervalMin: 1 } });
  const now = 1000 * MIN;
  assert.equal(S.planTab(tab({ pinned: true, lastAccessed: 0 }), s, { now }), null);
  assert.equal(S.planTab(tab({ pinned: true, discarded: true }), s, { now, refreshedAt: 0 }), null);
  assert.equal(S.planTab(tab({ lastAccessed: 0 }), s, { now }), "discard", "other tabs still unload");
});

test("toggleWhitelist adds then removes a host without mutating the input", () => {
  const s = settings({ profiles: [{ id: "x", name: "X" }] });
  const added = S.toggleWhitelist(s, "news.site.com");
  assert.ok(added.whitelisted);
  assert.equal(added.settings.profiles[0].id, S.WHITELIST_ID);
  assert.ok(added.settings.profiles[0].never);
  assert.ok(S.isWhitelisted(added.settings, "news.site.com"));
  assert.equal(s.profiles.length, 1, "input untouched");
  const removed = S.toggleWhitelist(added.settings, "news.site.com");
  assert.ok(!removed.whitelisted);
  assert.ok(!S.isWhitelisted(removed.settings, "news.site.com"));
});

test("sanitizeSettings: defaults, coercion and validation", () => {
  const d = S.sanitizeSettings({});
  assert.equal(d.defaultTimeoutMin, 30);
  assert.deepEqual(d.profiles, []);
  assert.equal(d.skipPinned, false);
  assert.equal(d.greyIcons, false);
  assert.equal(d.sleepMark, true);
  assert.equal(d.restoreUnloaded, true);
  assert.deepEqual(d.refresh, { enabled: false, intervalMin: 15, pinnedOnly: true });
  const s = S.sanitizeSettings({
    defaultTimeoutMin: "45", refresh: { enabled: 1, intervalMin: "0" }, notifyOnFound: true, estimateMbPerTab: 99,
    profiles: [null, 5, { name: "A", hosts: [" Foo.com ", ""], pinned: "weird", timeoutMin: "", refresh: { enabled: 1, intervalMin: 0 }, hours: { from: "99:99", days: [1, 9, "x"] } }],
  });
  assert.equal(s.defaultTimeoutMin, 45);
  assert.deepEqual(s.refresh, { enabled: true, intervalMin: 1, pinnedOnly: true });
  assert.ok(!("notifyOnFound" in s) && !("estimateMbPerTab" in s), "removed options are dropped");
  assert.equal(s.profiles.length, 1);
  const p = s.profiles[0];
  assert.deepEqual(p.hosts, ["foo.com"]);
  assert.equal(p.pinned, "any");
  assert.equal(p.timeoutMin, null);
  assert.equal(p.refresh.intervalMin, 1);
  assert.equal(p.hours.from, "09:00");
  assert.deepEqual(p.hours.days, [1]);
  assert.throws(() => S.sanitizeSettings("nope"));
  assert.throws(() => S.sanitizeSettings([]));
  assert.throws(() => S.sanitizeSettings({ notificationPattern: "([" }), /regex/);
});

test("export/import round trip is stable", () => {
  const once = S.sanitizeSettings({ profiles: [{ id: "a", name: "A", hosts: ["a.com"], timeoutMin: 7 }] });
  const twice = S.sanitizeSettings(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("unloadedUrls lists only unloaded http(s) tabs", () => {
  const urls = S.unloadedUrls([
    { url: "https://a.com", discarded: true },
    { url: "https://b.com", discarded: false },
    { url: "about:blank", discarded: true },
    { url: "https://c.com", discarded: true },
    { url: "https://d.com", discarded: true, active: true },
  ]);
  assert.deepEqual(urls, ["https://a.com", "https://c.com"], "an active tab is on its way to being loaded");
});

test("planRestore unloads matching loaded tabs and keeps waiting for missing ones", () => {
  const tabs = [
    { id: 1, url: "https://a.com" },
    { id: 2, url: "https://b.com", discarded: true },
    { id: 3, url: "https://c.com" },
  ];
  const r = S.planRestore(["https://a.com", "https://b.com", "https://later.com"], tabs);
  assert.deepEqual(r.discardIds, [1], "b is already unloaded, c was not remembered");
  assert.deepEqual(r.left, ["https://later.com"]);
});

test("planRestore matches duplicate URLs one to one and never touches the active tab", () => {
  const tabs = [
    { id: 1, url: "https://a.com" },
    { id: 2, url: "https://a.com" },
    { id: 3, url: "https://b.com", active: true },
  ];
  const one = S.planRestore(["https://a.com"], tabs);
  assert.deepEqual(one.discardIds, [1]);
  const two = S.planRestore(["https://a.com", "https://a.com", "https://b.com"], tabs);
  assert.deepEqual(two.discardIds, [1, 2]);
  assert.deepEqual(two.left, []);
});
