const TICK_ALARM = "mtu-tick";
const MENU_ID = "mtu-never-unload";
const SETTLE_MS = 4000; // wait after load so SPA titles / badges can appear
const STALE_REFRESH_MS = 2 * 60000; // give up waiting for a background refresh after this long
const RESTORE_WINDOW_MS = 2 * 60000; // how long after startup we keep looking for restored tabs

// The background page may be suspended at any time (event page), so all
// runtime state lives in storage.session and is accessed through one queue.
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function readState() {
  const { mtu } = await browser.storage.session.get("mtu");
  return { refreshedAt: {}, refreshing: {}, notified: {}, ...(mtu || {}) };
}

function updateState(mutator) {
  return locked(async () => {
    const state = await readState();
    const result = mutator(state);
    await browser.storage.session.set({ mtu: state });
    return result;
  });
}

function recordDiscard() {
  return locked(async () => {
    const { stats } = await browser.storage.local.get("stats");
    const s = stats || { total: 0, days: {} };
    const day = new Date().toISOString().slice(0, 10);
    s.total += 1;
    s.days[day] = (s.days[day] || 0) + 1;
    const keep = Object.keys(s.days).sort().slice(-30);
    s.days = Object.fromEntries(keep.map((k) => [k, s.days[k]]));
    await browser.storage.local.set({ stats: s });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL_SITES = { origins: ["<all_urls>"] };

// Runs inside the page: replaces its favicon so the tab keeps a greyed-out icon once unloaded.
function setPageIcon(href) {
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  document.head.append(link);
}

// Best effort: any failure just leaves the original icon in place.
async function greyOutIcon(tab) {
  try {
    if (!tab.favIconUrl || !/^(https?|data):/.test(tab.favIconUrl)) return;
    if (!(await browser.permissions.contains(ALL_SITES))) return;
    const dataUrl = await makeGreyIcon(tab.favIconUrl);
    await browser.scripting.executeScript({ target: { tabId: tab.id }, func: setPageIcon, args: [dataUrl] });
    // Give Firefox a moment to pick up the new icon before the page is unloaded.
    for (let i = 0; i < 8; i++) {
      await sleep(100);
      if ((await browser.tabs.get(tab.id)).favIconUrl !== tab.favIconUrl) break;
    }
  } catch (e) {
    console.debug("grey icon failed", tab.id, e);
  }
}

async function discard(tab) {
  try {
    if ((await loadSettings()).greyIcons) {
      await greyOutIcon(tab);
      if ((await browser.tabs.get(tab.id)).active) return; // the user switched to it meanwhile
    }
    await browser.tabs.discard(tab.id);
    const after = await browser.tabs.get(tab.id);
    if (!after.discarded) return;
    await updateState((s) => {
      s.refreshedAt[tab.id] = Date.now();
    });
    await recordDiscard();
  } catch (e) {
    console.debug("discard failed", tab.id, e);
  }
}

// Remember which tabs are unloaded so they can be unloaded again after a browser restart.
// Not while a restore is still looking at the previous snapshot.
async function saveSnapshot() {
  if ((await readState()).restore) return;
  const urls = unloadedUrls(await browser.tabs.query({}));
  const { unloadedSnapshot } = await browser.storage.local.get("unloadedSnapshot");
  if (JSON.stringify(unloadedSnapshot || []) !== JSON.stringify(urls)) {
    await browser.storage.local.set({ unloadedSnapshot: urls });
  }
}

// Called at startup and whenever the browser creates a tab while the restore is pending.
async function tryRestore() {
  const { restore } = await readState();
  if (!restore) return;
  const settings = await loadSettings();
  const tabs = await browser.tabs.query({});
  const { discardIds, left } = settings.restoreUnloaded
    ? planRestore(restore.pending, tabs)
    : { discardIds: [], left: [] };
  for (const id of discardIds) await discard(tabs.find((t) => t.id === id));
  const finished = left.length === 0 || Date.now() > restore.deadline;
  await updateState((s) => {
    if (finished) delete s.restore;
    else s.restore = { ...restore, pending: left };
  });
  if (finished) await saveSnapshot();
}

async function updateBadge() {
  const { notified } = await readState();
  const n = Object.keys(notified).length;
  await browser.action.setBadgeText({ text: n ? String(n) : "" });
}

async function flagNotification(tab) {
  await updateState((s) => {
    s.notified[tab.id] = tab.title || "notification";
  });
  await updateBadge();
}

// After a background refresh: flag the tab if it has news, then unload it again.
async function finishRefresh(tabId) {
  const wasRefreshing = await updateState((s) => {
    const was = !!s.refreshing[tabId];
    delete s.refreshing[tabId];
    return was;
  });
  if (!wasRefreshing) return;
  const settings = await loadSettings();
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    return; // tab was closed
  }
  if (tab.active) return; // the user opened it meanwhile
  if (hasNotification(tab, settings.notificationPattern)) await flagNotification(tab);
  if (isDiscardable(tab, settings)) await discard(tab);
}

async function tick() {
  await tryRestore();
  const settings = await loadSettings();
  if (settings.paused) return;
  const now = Date.now();
  const tabs = await browser.tabs.query({});
  const state = await readState();

  for (const tab of tabs) {
    const startedAt = state.refreshing[tab.id];
    if (startedAt) {
      if (now - startedAt > STALE_REFRESH_MS) await finishRefresh(tab.id);
      continue;
    }
    if (tab.discarded && state.refreshedAt[tab.id] == null) {
      // Discarded by someone else: start the refresh interval from now.
      await updateState((s) => {
        s.refreshedAt[tab.id] = now;
      });
      continue;
    }
    const action = planTab(tab, settings, { now, refreshedAt: state.refreshedAt[tab.id] });
    if (action === "discard") {
      await discard(tab);
    } else if (action === "refresh") {
      await updateState((s) => {
        s.refreshedAt[tab.id] = now;
        s.refreshing[tab.id] = now;
      });
      browser.tabs.reload(tab.id).catch(() =>
        updateState((s) => {
          delete s.refreshing[tab.id];
        })
      );
    }
  }

  // Forget tabs that no longer exist.
  const alive = new Set(tabs.map((t) => String(t.id)));
  await updateState((s) => {
    for (const key of ["refreshedAt", "refreshing", "notified"]) {
      for (const id of Object.keys(s[key])) if (!alive.has(id)) delete s[key][id];
    }
  });
  await updateBadge();
  await saveSnapshot();
}

browser.runtime.onStartup.addListener(async () => {
  const settings = await loadSettings();
  const { unloadedSnapshot } = await browser.storage.local.get("unloadedSnapshot");
  if (!settings.restoreUnloaded || !unloadedSnapshot || !unloadedSnapshot.length) return;
  await updateState((s) => {
    s.restore = { pending: unloadedSnapshot, deadline: Date.now() + RESTORE_WINDOW_MS };
  });
  await tryRestore();
});

browser.tabs.onCreated.addListener(() => tryRestore());

browser.tabs.onUpdated.addListener(
  async (tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    const { refreshing } = await readState();
    if (refreshing[tabId]) setTimeout(() => finishRefresh(tabId), SETTLE_MS);
  },
  { properties: ["status"] }
);

async function clearTab(tabId) {
  await updateState((s) => {
    delete s.notified[tabId];
    delete s.refreshing[tabId];
    delete s.refreshedAt[tabId];
  });
  await updateBadge();
}

browser.tabs.onActivated.addListener(({ tabId }) => clearTab(tabId));
browser.tabs.onRemoved.addListener((tabId) => clearTab(tabId));

browser.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener((a) => a.name === TICK_ALARM && tick());

// Context menu: toggle "never unload this site".
browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: browser.i18n.getMessage("menuNever"),
    contexts: ["page", "tab"],
  });
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  const host = hostOf(tab.url);
  if (!host) return;
  const { settings } = toggleWhitelist(await loadSettings(), host);
  await browser.storage.local.set({ settings });
});

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.menuIds.includes(MENU_ID) || !tab) return;
  const host = hostOf(tab.url);
  const listed = host ? isWhitelisted(await loadSettings(), host) : false;
  await browser.menus.update(MENU_ID, {
    title: browser.i18n.getMessage(listed ? "menuAllow" : "menuNever"),
    enabled: !!host,
  });
  browser.menus.refresh();
});

// Popup: "unload idle tabs now"
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "discard-now") return;
  const settings = await loadSettings();
  const tabs = await browser.tabs.query({});
  let n = 0;
  for (const tab of tabs) {
    if (!isDiscardable(tab, settings) || findProfile(settings, tab)?.never) continue;
    await discard(tab);
    n++;
  }
  return n;
});
