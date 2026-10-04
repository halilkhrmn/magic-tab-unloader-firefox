# Magic Tab Unloader

A Firefox extension that automatically unloads (discards) idle tabs. It does the same as right-click → *Unload Tab*: the tab stays in the tab bar, greyed out, and reloads when you click it.

## Features

- **Idle unload** with a global default time. The active tab and tabs playing audio are skipped.
- **Profiles** matched by hostname (`github.com` also covers subdomains, `*.google.com` is accepted) and pinned state. Each profile sets its own idle time, or "never unload". First match wins.
- **Active hours** per profile: weekdays, time windows, overnight windows.
- **Notification-aware refresh**: unloaded tabs are reloaded in the background at an interval. If the title matches the notification pattern (for example `(3) Inbox`) or Firefox marks the tab with its attention dot, the toolbar badge counts it, a desktop notification is shown (optional) and the tab is unloaded again.
- **Right-click whitelist**: "Never unload this site" on pages and tabs.
- **Memory estimate** in the popup (an estimate: Firefox does not expose per-tab memory to extensions).
- **Export / import** of settings as JSON.

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

Push a tag that matches the version in `manifest.json` (for example `v0.2.0`). The Release workflow tests, lints, builds and attaches the package to a GitHub release. The landing page in `docs/` is deployed by the Pages workflow (Settings → Pages → Source: GitHub Actions).

## Store submission notes

- Manifest V3, `data_collection_permissions` declares no data collection, and there is no remote code, minification or build step: the submitted source is the repository.
- Permissions and their reasons are listed on the landing page. See [PRIVACY.md](PRIVACY.md).

## License

GPL-3.0, see [LICENSE](LICENSE).
