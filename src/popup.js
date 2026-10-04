(async () => {
  const [settings, { stats }, discarded] = await Promise.all([
    loadSettings(),
    browser.storage.local.get("stats"),
    browser.tabs.query({ discarded: true }),
  ]);
  const $ = (id) => document.getElementById(id);
  const s = stats || { total: 0, days: {} };
  $("now-count").textContent = discarded.length;
  $("mb").textContent = Math.round(discarded.length * settings.estimateMbPerTab);
  $("today").textContent = s.days[new Date().toISOString().slice(0, 10)] || 0;
  $("total").textContent = s.total;

  $("paused").checked = settings.paused;
  $("paused").onchange = async () =>
    browser.storage.local.set({ settings: { ...(await loadSettings()), paused: $("paused").checked } });
  $("now").onclick = async (e) => {
    const n = await browser.runtime.sendMessage({ type: "discard-now" });
    e.target.textContent = `Unloaded ${n} tab(s)`;
  };
  $("opts").onclick = () => {
    browser.runtime.openOptionsPage();
    window.close();
  };
})();
