(async () => {
  const s = await loadSettings();
  const paused = document.getElementById("paused");
  paused.checked = s.paused;
  paused.onchange = async () =>
    browser.storage.local.set({ settings: { ...(await loadSettings()), paused: paused.checked } });
  document.getElementById("now").onclick = async (e) => {
    const n = await browser.runtime.sendMessage({ type: "discard-now" });
    e.target.textContent = `Unloaded ${n} tab(s)`;
  };
  document.getElementById("opts").onclick = () => {
    browser.runtime.openOptionsPage();
    window.close();
  };
})();
