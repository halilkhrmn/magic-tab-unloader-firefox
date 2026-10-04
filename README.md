# Magic Tab Unloader

A Firefox extension that automatically unloads (discards) idle tabs. It does the same as right-click → *Unload Tab*: the tab stays in the tab bar, greyed out, and reloads when you click it.

## Features

- **Idle unload** with a global default time. The active tab and tabs playing audio are skipped, and pinned tabs can be excluded.
- **Profiles** matched by hostname (`github.com` also covers subdomains, `*.google.com` is accepted) and pinned state. Each profile sets its own idle time or "never unload". First match wins.
- **Active hours** per profile: weekdays, time windows, overnight windows.
- **Restart memory**: the extension remembers which tabs are unloaded. After a browser restart it unloads those tabs again, matched by URL, and leaves every other tab to Firefox. Can be switched off in the settings.
- **Right-click whitelist**: "Never unload this site" on pages and tabs.
- **Popup** for the simple settings (pause, idle time, pinned tabs) and a link to the full settings page.
- **Export / import** of settings as JSON.

## Greyed-out tabs

Firefox greys out tabs unloaded from its own right-click menu, but tabs unloaded by an extension are only greyed out when `browser.tabs.fadeOutUnloadedTabs` is `true` in `about:config`. Extensions cannot set it. The tabs are really unloaded either way; only the greying differs.

As an alternative the extension can do it itself: **Settings → Tab appearance → Grey out the icons of tabs this extension unloads**. Just before a tab is unloaded, its favicon is replaced by a grey, half-transparent copy (the same look Firefox uses) and, unless switched off, a small sleeping "zZ" in the corner. This needs the optional "access all sites" permission, which Firefox asks for when the box is ticked, and is removed again when it is unticked. The icon is fetched, drawn on a canvas and set on the page locally; nothing leaves the browser.

## Development

```sh
npm install
npm test          # unit and integration tests (Node's built-in test runner)
npm run lint      # web-ext lint
npm run build     # builds web-ext-artifacts/*.zip
```

To try it, open `about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`.

Icons are rendered from `assets/logo.svg` with `npm run icons` (needs a Chromium binary).

## Releases

Push a tag that matches the version in `manifest.json` (for example `v0.2.0`). The Release workflow tests, lints and builds, then creates the GitHub release or, if it already exists, attaches the package to it. It can also be started by hand (Actions → Release → Run workflow) with an existing tag. The landing page in `docs/` is deployed by the Pages workflow (Settings → Pages → Source: GitHub Actions).

## Store submission notes

- Manifest V3, `data_collection_permissions` declares no data collection, and there is no remote code, minification or build step: the submitted source is the repository.
- Permissions and their reasons are listed on the landing page. See [PRIVACY.md](PRIVACY.md).

## License

GPL-3.0, see [LICENSE](LICENSE).
