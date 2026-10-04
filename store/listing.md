# addons.mozilla.org listing

Everything below is meant to be pasted into the AMO submission form. Keep it in sync with the extension.

## Name

Magic Tab Unloader

## Summary (max 250 characters)

Automatically unloads idle tabs to save memory. Per-site profiles, active hours, a right-click whitelist, and optional greyed-out tab icons with a sleeping zZ.

## Categories

Tabs

## Tags

tabs, unload, discard, memory, performance

## Description

Magic Tab Unloader unloads tabs you have not used for a while, the same as right-click → Unload Tab, so they stop using memory but stay in your tab bar. Click a tab and it reloads.

**Unload rules**
• Choose how many idle minutes before a tab is unloaded (or turn it off)
• Per-site profiles: match a site by hostname and give it its own idle time, or "never unload"
• Active hours: apply a profile only on certain days or hours, including overnight
• Never unload pinned tabs or tabs playing audio (both optional)
• Right-click any page or tab → "Never unload this site"
• The active tab is never touched

**Quality of life**
• Restart memory: after Firefox restarts, tabs that were unloaded before are unloaded again
• Optional: grey out the icon of tabs the extension unloads, with a small sleeping "zZ", like Firefox does for tabs unloaded from its own menu
• Toolbar popup with the basic settings: pause, idle time, pinned tabs, "unload idle tabs now", and how many tabs are unloaded
• Export and import your profiles as a JSON file

**Privacy**
The extension has no accounts, no analytics and makes no network requests. Settings and statistics stay in your browser.

Open source (GPL-3.0): https://github.com/halilkhrmn/magic-tab-unloader-firefox

## Homepage and support

- Homepage: https://halilkhrmn.github.io/magic-tab-unloader-firefox/
- Support site and issues: https://github.com/halilkhrmn/magic-tab-unloader-firefox/issues
- License: GNU General Public License v3.0

## Privacy policy

Paste the text of `PRIVACY.md`, or link to
https://github.com/halilkhrmn/magic-tab-unloader-firefox/blob/main/PRIVACY.md

## Permissions and why

| Permission | Why |
| --- | --- |
| `tabs` | Read each tab's URL and last-used time to decide when to unload it, and unload it with `tabs.discard()`. |
| `alarms` | Run the check for idle tabs once a minute. |
| `storage` | Save the settings, the unload counters and the list of unloaded tab URLs on this computer. |
| `menus` | Add the "Never unload this site" item to the page and tab context menus. |
| `scripting` | Only used when the user turns on "Grey out the icons": swaps a tab's icon for a grey copy just before it is unloaded. |
| `<all_urls>` (optional) | Requested only when the user ticks "Grey out the icons". Needed to read a tab's own favicon and to set the grey copy on that tab. Removed again when the box is unticked. |

Data collection: none (`data_collection_permissions.required = ["none"]`).

## Notes for reviewers

- There is no build step, minification or bundling. The package is the files in the repository: `manifest.json`, `src/`, `icons/`, `_locales/`. `npm ci && npm run build` runs `web-ext build` and produces the same zip.
- No remote code. `scripting.executeScript` runs a function that ships in `src/background.js` (`setPageIcon`) and only after the user has granted the optional permission.
- The optional all-sites permission is requested from a click in the settings page (`src/options.js`). Without it, the grey-out is skipped and tabs are unloaded as usual.
- `src/favicon.js` fetches the tab's favicon, draws a grey half-transparent copy on a canvas and returns a `data:` URL. It talks to no server other than the one that already hosts the favicon.
- Unit and integration tests: `npm test` (the background script runs against a fake `browser` object). `npm run lint` is `web-ext lint` and reports no errors or warnings.
- To try it: load the extension, open the popup, set "Unload tabs idle for" to 1 minute, leave a tab in the background and wait about two minutes.

## Version notes (first release)

First public release. Unloads idle tabs automatically, with per-site profiles, active hours, a right-click whitelist, restart memory and optional greyed-out tab icons.

## Screenshots

| File | Caption |
| --- | --- |
| `screenshots/1-popup.png` | Basic settings in the toolbar popup |
| `screenshots/2-settings.png` | Unload rules and tab icon options |
| `screenshots/3-profiles.png` | Per-site profiles with active hours |

The screenshots are the real popup and settings pages rendered with sample data. Replace them with screenshots from Firefox if you prefer (1280×800 px).
