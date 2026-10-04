let settings;
const $ = (id) => document.getElementById(id);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function profileEl(p, i) {
  const f = $("profile-tpl").content.firstElementChild.cloneNode(true);
  const daysBox = f.querySelector(".days");
  DAY_NAMES.forEach((d, n) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.day = n;
    label.append(box, ` ${d}`);
    daysBox.append(label);
  });
  const q = (k) => f.querySelector(`[data-k=${k}]`);
  const dayBoxes = [...f.querySelectorAll("[data-day]")];
  q("name").value = p.name;
  q("hosts").value = (p.hosts || []).join(", ");
  q("pinned").value = p.pinned || "any";
  q("timeoutMin").value = p.timeoutMin ?? "";
  q("never").checked = !!p.never;
  q("refreshOn").checked = !!p.refresh?.enabled;
  q("interval").value = p.refresh?.intervalMin ?? 15;
  q("hoursOn").checked = !!p.hours?.enabled;
  q("from").value = p.hours?.from ?? "09:00";
  q("to").value = p.hours?.to ?? "18:00";
  dayBoxes.forEach((b) => (b.checked = (p.hours?.days ?? [1, 2, 3, 4, 5]).includes(Number(b.dataset.day))));
  f.onclick = (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    collect();
    if (act === "del") settings.profiles.splice(i, 1);
    if (act === "up" && i > 0) settings.profiles.splice(i - 1, 0, ...settings.profiles.splice(i, 1));
    render();
  };
  f.collect = () => ({
    id: p.id,
    name: q("name").value,
    hosts: q("hosts").value.split(","),
    pinned: q("pinned").value,
    never: q("never").checked,
    timeoutMin: q("timeoutMin").value,
    refresh: { enabled: q("refreshOn").checked, intervalMin: q("interval").value },
    hours: {
      enabled: q("hoursOn").checked,
      from: q("from").value,
      to: q("to").value,
      days: dayBoxes.filter((b) => b.checked).map((b) => Number(b.dataset.day)),
    },
  });
  return f;
}

function collect() {
  settings = sanitizeSettings({
    ...settings,
    defaultTimeoutMin: $("defaultTimeoutMin").value,
    skipAudible: $("skipAudible").checked,
    skipPinned: $("skipPinned").checked,
    greyIcons: $("greyIcons").checked,
    sleepMark: $("sleepMark").checked,
    keepNewsLoaded: $("keepNewsLoaded").checked,
    restoreUnloaded: $("restoreUnloaded").checked,
    refresh: { enabled: $("refreshOn").checked, intervalMin: $("refreshInterval").value, pinnedOnly: $("pinnedOnly").checked },
    notificationPattern: $("notificationPattern").value,
    profiles: [...$("profiles").children].map((f) => f.collect()),
  });
}

function render() {
  $("defaultTimeoutMin").value = settings.defaultTimeoutMin;
  $("skipAudible").checked = settings.skipAudible;
  $("skipPinned").checked = settings.skipPinned;
  $("greyIcons").checked = settings.greyIcons;
  $("sleepMark").checked = settings.sleepMark;
  $("keepNewsLoaded").checked = settings.keepNewsLoaded;
  syncSleepMark();
  $("restoreUnloaded").checked = settings.restoreUnloaded;
  $("refreshOn").checked = settings.refresh.enabled;
  $("refreshInterval").value = settings.refresh.intervalMin;
  $("pinnedOnly").checked = settings.refresh.pinnedOnly;
  $("notificationPattern").value = settings.notificationPattern;
  $("profiles").replaceChildren(...settings.profiles.map(profileEl));
}

// The "zZ" only matters while the icon is greyed out.
function syncSleepMark() {
  $("sleepMark").disabled = !$("greyIcons").checked;
}

async function renderLog() {
  const { refreshLog } = await browser.storage.local.get("refreshLog");
  const rows = (refreshLog || []).map((e) => {
    const tr = document.createElement("tr");
    const cells = [new Date(e.t).toLocaleTimeString(), e.host, e.attention ? "yes" : "no", e.news ? "yes" : "no", e.kept ? "yes" : "no", e.title];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 5) {
        td.className = "title";
        td.title = text;
      }
      tr.append(td);
    });
    return tr;
  });
  $("log-body").replaceChildren(...rows);
  $("log-empty").hidden = rows.length > 0;
}

function say(msg) {
  $("status").textContent = msg;
}

(async () => {
  settings = await loadSettings();
  // The setting only counts while the optional permission is still granted.
  settings.greyIcons = settings.greyIcons && (await browser.permissions.contains({ origins: ["<all_urls>"] }));
  render();
  renderLog();
  $("log-reload").onclick = renderLog;
  $("log-clear").onclick = async () => {
    await browser.storage.local.remove("refreshLog");
    renderLog();
  };
  $("greyIcons").onchange = async () => {
    syncSleepMark();
    try {
      if ($("greyIcons").checked) {
        // permissions.request must run straight from the click, before any other await.
        const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
        if (!granted) {
          $("greyIcons").checked = false;
          syncSleepMark();
          say("Permission was not granted");
        }
      } else {
        await browser.permissions.remove({ origins: ["<all_urls>"] });
      }
    } catch (e) {
      $("greyIcons").checked = false;
      syncSleepMark();
      say("Could not change the permission: " + e.message);
    }
  };
  $("add").onclick = () => {
    collect();
    settings.profiles.push(sanitizeSettings({ profiles: [{ name: "New profile" }] }).profiles[0]);
    render();
  };
  $("save").onclick = async () => {
    try {
      collect();
    } catch (e) {
      return say(e.message);
    }
    await browser.storage.local.set({ settings });
    say("Saved");
  };
  $("export").onclick = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "magic-tab-unloader-settings.json",
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("copy-pref").onclick = async () => {
    try {
      await navigator.clipboard.writeText("browser.tabs.fadeOutUnloadedTabs");
      $("copy-status").textContent = "Copied";
    } catch {
      $("copy-status").textContent = "Copy failed, select the name above instead";
    }
  };
  $("import").onclick = () => $("file").click();
  $("file").onchange = async () => {
    try {
      settings = sanitizeSettings(JSON.parse(await $("file").files[0].text()));
      render();
      say("Imported – press Save to apply");
    } catch (e) {
      say("Import failed: " + e.message);
    }
    $("file").value = "";
  };
})();
