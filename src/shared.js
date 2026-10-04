// Shared between background, popup and options pages.
const DEFAULT_SETTINGS = {
  paused: false,
  defaultTimeoutMin: 30, // idle minutes before a tab is unloaded
  skipAudible: true, // never unload tabs that are playing sound
  notificationPattern: "^\\(\\d+\\+?\\)|^\\[\\d+\\]|^\\d+ new", // title patterns like "(3) Inbox"
  // First matching profile wins.
  profiles: [
    {
      id: "pinned",
      name: "Pinned tabs",
      hosts: [],
      pinned: "only", // any | only | not
      never: false,
      timeoutMin: 120,
      refresh: { enabled: true, intervalMin: 15 },
    },
  ],
};

function matchHost(host, pattern) {
  const p = pattern.trim().toLowerCase().replace(/^\*\./, "");
  if (!p) return false;
  return host === p || host.endsWith("." + p);
}

function profileMatches(profile, tab) {
  if (profile.pinned === "only" && !tab.pinned) return false;
  if (profile.pinned === "not" && tab.pinned) return false;
  if (!profile.hosts || profile.hosts.length === 0) return true;
  let host;
  try {
    host = new URL(tab.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return profile.hosts.some((p) => matchHost(host, p));
}

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
