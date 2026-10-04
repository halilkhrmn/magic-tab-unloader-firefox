const TICK_ALARM = "mtu-tick";
const SETTLE_MS = 4000; // wait after load so SPA titles / badges can appear

const refreshedAt = new Map(); // tabId -> last refresh timestamp
const refreshing = new Set(); // tabIds being refreshed in the background
const notified = new Set(); // tabIds kept loaded because they have a notification

function hasNotification(tab, settings) {
  if (tab.attention) return true; // Firefox's blue "attention" dot
  try {
    return new RegExp(settings.notificationPattern).test(tab.title || "");
  } catch {
    return false;
  }
}

function isDiscardable(tab, settings) {
  if (tab.active || tab.discarded) return false;
  if (settings.skipAudible && tab.audible) return false;
  return /^https?:/.test(tab.url || "");
}

function findProfile(settings, tab) {
  return settings.profiles.find((p) => profileMatches(p, tab)) || null;
}

async function discard(tabId) {
  try {
    await browser.tabs.discard(tabId);
  } catch (e) {
    console.debug("discard failed", tabId, e);
  }
}

async function tick() {
  const settings = await loadSettings();
  if (settings.paused) return;
  const now = Date.now();
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    if (refreshing.has(tab.id) || tab.active) continue;
    const profile = findProfile(settings, tab);
    if (profile?.never) continue;

    if (tab.discarded) {
      const r = profile?.refresh;
      if (r?.enabled && now - (refreshedAt.get(tab.id) ?? 0) >= r.intervalMin * 60000) {
        refreshedAt.set(tab.id, now);
        refreshing.add(tab.id);
        browser.tabs.reload(tab.id).catch(() => refreshing.delete(tab.id));
      }
      continue;
    }

    if (notified.has(tab.id) || !isDiscardable(tab, settings)) continue;
    const timeoutMin = profile?.timeoutMin ?? settings.defaultTimeoutMin;
    if (!timeoutMin) continue;
    if (now - tab.lastAccessed >= timeoutMin * 60000) await discard(tab.id);
  }
}

// After a background refresh finishes: keep the tab loaded if it has a
// notification, otherwise unload it again.
browser.tabs.onUpdated.addListener(
  (tabId, changeInfo) => {
    if (changeInfo.status !== "complete" || !refreshing.has(tabId)) return;
    setTimeout(async () => {
      refreshing.delete(tabId);
      try {
        const [settings, tab] = await Promise.all([loadSettings(), browser.tabs.get(tabId)]);
        if (hasNotification(tab, settings)) {
          notified.add(tabId);
          browser.action.setBadgeText({ text: String(notified.size) });
        } else if (isDiscardable(tab, settings)) {
          await discard(tabId);
        }
      } catch {
        /* tab closed */
      }
    }, SETTLE_MS);
  },
  { properties: ["status"] }
);

browser.tabs.onActivated.addListener(({ tabId }) => {
  notified.delete(tabId);
  refreshing.delete(tabId);
  browser.action.setBadgeText({ text: notified.size ? String(notified.size) : "" });
});

browser.tabs.onRemoved.addListener((tabId) => {
  notified.delete(tabId);
  refreshing.delete(tabId);
  refreshedAt.delete(tabId);
});

browser.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener((a) => a.name === TICK_ALARM && tick());

// Popup: "unload all idle tabs now"
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "discard-now") return;
  const settings = await loadSettings();
  const tabs = await browser.tabs.query({});
  let n = 0;
  for (const tab of tabs) {
    if (!isDiscardable(tab, settings) || findProfile(settings, tab)?.never) continue;
    await discard(tab.id);
    n++;
  }
  return n;
});
