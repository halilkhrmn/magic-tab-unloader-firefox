# Magic Tab Unloader

Firefox extension that automatically unloads (discards) idle tabs — the same as right-click → *Unload Tab* — with per-site profiles.

- **Profiles**: match by hostname (and pinned/not pinned); each profile has its own idle time, or "never unload".
- **Pinned/notification refresh**: an unloaded tab is periodically reloaded in the background; if the title looks like `(3) Inbox` or Firefox shows the blue attention dot, it stays loaded, otherwise it is unloaded again.
- Skips the active tab and tabs playing audio. Popup: pause, "unload idle tabs now".

Load for development: `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
