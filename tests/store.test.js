// Guards the things addons.mozilla.org checks, so a change cannot break a submission unnoticed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const messages = JSON.parse(read("_locales/en/messages.json"));
const listing = read("store/listing.md");

test("the manifest declares exactly the reviewed permissions", () => {
  // Adding a permission means updating store/listing.md and the landing page first.
  assert.deepEqual([...manifest.permissions].sort(), ["alarms", "menus", "scripting", "storage", "tabs"]);
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.equal(manifest.host_permissions, undefined, "no host access without asking");
  for (const p of manifest.permissions) {
    assert.ok(listing.includes(`\`${p}\``), `store/listing.md explains the ${p} permission`);
  }
  assert.ok(listing.includes("`<all_urls>` (optional)"));
});

test("the manifest carries the Firefox store metadata", () => {
  const gecko = manifest.browser_specific_settings.gecko;
  assert.match(gecko.id, /^[^@\s]+@[^@\s]+$/);
  assert.ok(Number.parseInt(gecko.strict_min_version, 10) >= 140, "data_collection_permissions needs Firefox 140");
  assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(read("package.json")).version, manifest.version, "package.json and manifest.json versions match");
  assert.ok(manifest.homepage_url.startsWith("https://"));
});

test("name and description fit the store limits", () => {
  assert.equal(manifest.name, "__MSG_extName__");
  assert.ok(messages.extName.message.length <= 45);
  assert.ok(messages.extDescription.message.length <= 132);
  const summary = listing.split("## Summary (max 250 characters)")[1].split("##")[0].trim();
  assert.ok(summary.length > 0 && summary.length <= 250, `summary is ${summary.length} characters`);
});

test("icons exist at the declared sizes", () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(path.join(root, file));
    assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
  }
});

test("every file the manifest points to exists, and no page loads remote code", () => {
  const files = [
    ...manifest.background.scripts,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.action.default_icon),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`);
  for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
    assert.ok(!/<script[^>]+src=["']https?:/i.test(read(page)), `${page} loads no remote script`);
  }
  assert.ok(!/\beval\(|new Function\(|innerHTML/.test(read("src/background.js") + read("src/options.js") + read("src/popup.js")));
});

test("the store screenshots are 1280x800", () => {
  const dir = path.join(root, "store/screenshots");
  const shots = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  assert.ok(shots.length >= 3);
  for (const f of shots) {
    const png = fs.readFileSync(path.join(dir, f));
    assert.equal(png.readUInt32BE(16), 1280, `${f} width`);
    assert.equal(png.readUInt32BE(20), 800, `${f} height`);
    assert.ok(listing.includes(f), `${f} has a caption in store/listing.md`);
  }
});
