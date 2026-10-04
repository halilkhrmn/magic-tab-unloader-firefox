// Pure logic shared by the background script, popup and options page.
// Kept free of browser APIs (except loadSettings) so it can be unit tested in Node.

const WHITELIST_ID = "whitelist";
const PINNED_VALUES = ["any", "only", "not"];

const DEFAULT_SETTINGS = {
  paused: false,
  defaultTimeoutMin: 30, // idle minutes before a tab is unloaded (0 = never)
  skipAudible: true, // never unload tabs that are playing sound
  skipPinned: false, // never unload pinned tabs
  restoreUnloaded: true, // after a browser restart, unload again the tabs that were unloaded before it closed
  sleepMark: true, // draw a sleeping "zZ" on the greyed-out icon
  greyIcons: false, // grey out the favicon of tabs we unload (needs the optional all-sites permission)
  // First matching profile wins.
  profiles: [],
};

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchHost(host, pattern) {
  const p = String(pattern).trim().toLowerCase().replace(/^\*\./, "");
  if (!p) return false;
  return host === p || host.endsWith("." + p);
}

function toMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

// Is `date` inside the profile's active-hours window? Supports overnight windows
// (e.g. 22:00 -> 06:00); the early-morning part belongs to the previous day.
function inHours(hours, date = new Date()) {
  if (!hours || !hours.enabled) return true;
  const days = hours.days && hours.days.length ? hours.days : [0, 1, 2, 3, 4, 5, 6];
  const from = toMinutes(hours.from);
  const to = toMinutes(hours.to);
  if (from === null || to === null || from === to) return days.includes(date.getDay());
  const mins = date.getHours() * 60 + date.getMinutes();
  if (from < to) return days.includes(date.getDay()) && mins >= from && mins < to;
  if (mins >= from) return days.includes(date.getDay());
  if (mins < to) return days.includes((date.getDay() + 6) % 7);
  return false;
}

function profileMatches(profile, tab, date = new Date()) {
  if (!inHours(profile.hours, date)) return false;
  if (profile.pinned === "only" && !tab.pinned) return false;
  if (profile.pinned === "not" && tab.pinned) return false;
  if (!profile.hosts || profile.hosts.length === 0) return true;
  const host = hostOf(tab.url);
  return host !== null && profile.hosts.some((p) => matchHost(host, p));
}

function findProfile(settings, tab, date = new Date()) {
  return settings.profiles.find((p) => profileMatches(p, tab, date)) || null;
}

function isDiscardable(tab, settings) {
  if (tab.active || tab.discarded) return false;
  if (settings.skipPinned && tab.pinned) return false;
  if (settings.skipAudible && tab.audible) return false;
  return /^https?:/.test(tab.url || "");
}

// Decide what to do with a tab right now: "discard" or null.
// ctx: { now: ms }
function planTab(tab, settings, ctx) {
  if (tab.active || tab.discarded) return null;
  if (settings.skipPinned && tab.pinned) return null;
  const profile = findProfile(settings, tab, new Date(ctx.now));
  if (profile && profile.never) return null;
  if (!isDiscardable(tab, settings)) return null;
  const timeoutMin = profile && profile.timeoutMin != null ? profile.timeoutMin : settings.defaultTimeoutMin;
  if (!timeoutMin) return null;
  return ctx.now - tab.lastAccessed >= timeoutMin * 60000 ? "discard" : null;
}

// URLs of the tabs that are currently unloaded (remembered across a browser restart).
// A tab the user just switched to may still report itself as unloaded while it loads.
function unloadedUrls(tabs) {
  return tabs.filter((t) => t.discarded && !t.active && /^https?:/.test(t.url || "")).map((t) => t.url);
}

// Match remembered URLs against the tabs the browser restored. Returns the loaded tabs
// that should be unloaded again and the URLs that have not shown up yet. Duplicate URLs
// are matched one to one, and the active tab is never touched.
function planRestore(pendingUrls, tabs) {
  const used = new Set();
  const discardIds = [];
  const left = [];
  for (const url of pendingUrls) {
    const tab = tabs.find((t) => t.url === url && !used.has(t.id));
    if (!tab) {
      left.push(url);
      continue;
    }
    used.add(tab.id);
    if (!tab.discarded && !tab.active) discardIds.push(tab.id);
  }
  return { discardIds, left };
}

function isWhitelisted(settings, host) {
  const wl = settings.profiles.find((p) => p.id === WHITELIST_ID);
  return !!wl && wl.hosts.some((p) => matchHost(host, p));
}

// Adds the host to (or removes it from) the "never unload" profile, creating it first in the list.
function toggleWhitelist(settings, host) {
  const next = { ...settings, profiles: settings.profiles.map((p) => ({ ...p, hosts: [...p.hosts] })) };
  let wl = next.profiles.find((p) => p.id === WHITELIST_ID);
  if (!wl) {
    wl = sanitizeProfile({ id: WHITELIST_ID, name: "Never unload", never: true, hosts: [] });
    next.profiles.unshift(wl);
  }
  if (wl.hosts.some((p) => matchHost(host, p))) {
    wl.hosts = wl.hosts.filter((p) => !matchHost(host, p));
    return { settings: next, whitelisted: false };
  }
  wl.hosts.push(host);
  return { settings: next, whitelisted: true };
}

function num(v, fallback, min = 0) {
  const n = Number(v);
  return v !== "" && v != null && Number.isFinite(n) && n >= min ? n : fallback;
}

function sanitizeProfile(p) {
  if (!p || typeof p !== "object") return null;
  const hours = p.hours || {};
  return {
    id: typeof p.id === "string" && p.id ? p.id : "p" + Math.random().toString(36).slice(2, 10),
    name: String(p.name || "Profile").slice(0, 60),
    hosts: Array.isArray(p.hosts) ? p.hosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean) : [],
    pinned: PINNED_VALUES.includes(p.pinned) ? p.pinned : "any",
    never: !!p.never,
    timeoutMin: num(p.timeoutMin, null),
    hours: {
      enabled: !!hours.enabled,
      from: toMinutes(hours.from) !== null ? hours.from : "09:00",
      to: toMinutes(hours.to) !== null ? hours.to : "18:00",
      days: Array.isArray(hours.days)
        ? hours.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [1, 2, 3, 4, 5],
    },
  };
}

// Validates and normalizes settings (used for storage reads and imports). Throws on invalid input.
function sanitizeSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Settings must be a JSON object");
  const d = DEFAULT_SETTINGS;
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : d.profiles;
  return {
    paused: !!raw.paused,
    defaultTimeoutMin: num(raw.defaultTimeoutMin, d.defaultTimeoutMin),
    skipAudible: raw.skipAudible === undefined ? d.skipAudible : !!raw.skipAudible,
    skipPinned: !!raw.skipPinned,
    restoreUnloaded: raw.restoreUnloaded === undefined ? d.restoreUnloaded : !!raw.restoreUnloaded,
    greyIcons: !!raw.greyIcons,
    sleepMark: raw.sleepMark === undefined ? d.sleepMark : !!raw.sleepMark,
    profiles: profiles.map(sanitizeProfile).filter(Boolean),
  };
}

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  try {
    return sanitizeSettings(settings || {});
  } catch {
    return sanitizeSettings({});
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SETTINGS, WHITELIST_ID, hostOf, matchHost, toMinutes, inHours, profileMatches, findProfile,
    isDiscardable, planTab, unloadedUrls, planRestore, isWhitelisted, toggleWhitelist, sanitizeSettings,
  };
}
