let settings;
const $ = (id) => document.getElementById(id);

function profileEl(p, i) {
  const f = document.createElement("fieldset");
  f.innerHTML = `
    <legend><input type="text" data-k="name" style="width:200px"></legend>
    <label>Hosts (comma separated)<input type="text" data-k="hosts"></label>
    <div class="row">
      <label>Pinned <select data-k="pinned"><option>any</option><option>only</option><option>not</option></select></label>
      <label>Idle minutes (empty = default, 0 = never) <input type="number" data-k="timeoutMin" min="0"></label>
      <label><input type="checkbox" data-k="never"> Never unload</label>
    </div>
    <div class="row">
      <label><input type="checkbox" data-k="refreshOn"> Periodically refresh unloaded tabs</label>
      <label>every <input type="number" data-k="interval" min="1"> min</label>
    </div>
    <button data-act="up">↑</button> <button data-act="del">Delete</button>`;
  const q = (k) => f.querySelector(`[data-k=${k}]`);
  q("name").value = p.name;
  q("hosts").value = (p.hosts || []).join(", ");
  q("pinned").value = p.pinned || "any";
  q("timeoutMin").value = p.timeoutMin ?? "";
  q("never").checked = !!p.never;
  q("refreshOn").checked = !!p.refresh?.enabled;
  q("interval").value = p.refresh?.intervalMin ?? 15;
  f.onclick = (e) => {
    const act = e.target.dataset?.act;
    if (act === "del") { settings.profiles.splice(i, 1); render(); }
    if (act === "up" && i > 0) { collect(); const [x] = settings.profiles.splice(i, 1); settings.profiles.splice(i - 1, 0, x); render(); }
  };
  f.collect = () => ({
    id: p.id || crypto.randomUUID(),
    name: q("name").value || "Profile",
    hosts: q("hosts").value.split(",").map((s) => s.trim()).filter(Boolean),
    pinned: q("pinned").value,
    never: q("never").checked,
    timeoutMin: q("timeoutMin").value === "" ? null : Number(q("timeoutMin").value),
    refresh: { enabled: q("refreshOn").checked, intervalMin: Number(q("interval").value) || 15 },
  });
  return f;
}

function collect() {
  settings.defaultTimeoutMin = Number($("defaultTimeoutMin").value) || 0;
  settings.skipAudible = $("skipAudible").checked;
  settings.notificationPattern = $("notificationPattern").value;
  settings.profiles = [...$("profiles").children].map((f) => f.collect());
}

function render() {
  $("defaultTimeoutMin").value = settings.defaultTimeoutMin;
  $("skipAudible").checked = settings.skipAudible;
  $("notificationPattern").value = settings.notificationPattern;
  $("profiles").replaceChildren(...settings.profiles.map(profileEl));
}

(async () => {
  settings = await loadSettings();
  render();
  $("add").onclick = () => { collect(); settings.profiles.push({ name: "New profile", hosts: [], pinned: "any" }); render(); };
  $("save").onclick = async () => {
    collect();
    try { new RegExp(settings.notificationPattern); } catch { $("status").textContent = "Invalid regex"; return; }
    await browser.storage.local.set({ settings });
    $("status").textContent = "Saved ✓";
  };
})();
