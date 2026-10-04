(async () => {
  const $ = (id) => document.getElementById(id);
  const settings = await loadSettings();

  async function save(change) {
    const current = await loadSettings();
    const next = sanitizeSettings({ ...current, ...change(current) });
    await browser.storage.local.set({ settings: next });
  }

  $("paused").checked = settings.paused;
  $("defaultTimeoutMin").value = settings.defaultTimeoutMin;
  $("skipPinned").checked = settings.skipPinned;

  $("paused").onchange = () => save(() => ({ paused: $("paused").checked }));
  $("defaultTimeoutMin").onchange = () => save(() => ({ defaultTimeoutMin: $("defaultTimeoutMin").value }));
  $("skipPinned").onchange = () => save(() => ({ skipPinned: $("skipPinned").checked }));

  const [{ stats }, discarded] = await Promise.all([
    browser.storage.local.get("stats"),
    browser.tabs.query({ discarded: true }),
  ]);
  const s = stats || { total: 0, days: {} };
  $("now-count").textContent = discarded.length;
  $("today").textContent = s.days[new Date().toISOString().slice(0, 10)] || 0;
  $("total").textContent = s.total;

  $("now").onclick = async (e) => {
    const n = await browser.runtime.sendMessage({ type: "discard-now" });
    e.target.textContent = `Unloaded ${n} tab(s)`;
  };
  $("opts").onclick = () => {
    browser.runtime.openOptionsPage();
    window.close();
  };
})();
