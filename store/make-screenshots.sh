#!/bin/sh
# Renders the popup and settings pages with sample data into store/screenshots/ (1280x800).
# Needs a Chromium/Chrome binary (CHROME=...) and ImageMagick's `convert`.
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
CHROME="${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Sample data shown in the screenshots.
STUB='<script>window.browser={permissions:{contains:async()=>true},runtime:{},tabs:{query:async()=>[1,2,3,4,5,6,7]},storage:{local:{get:async(k)=>k==="stats"?{stats:{total:128,days:{[new Date().toISOString().slice(0,10)]:9}}}:{settings:{greyIcons:true,defaultTimeoutMin:30,profiles:[{id:"w",name:"Docs and reference",hosts:["developer.mozilla.org","wikipedia.org"],timeoutMin:120},{id:"m",name:"Chat",hosts:["slack.com","discord.com"],timeoutMin:10,hours:{enabled:true,from:"09:00",to:"18:00",days:[1,2,3,4,5]}}]}},remove:async()=>{},set:async()=>{}}}}</script>'

page() { # page <name>  -> $TMP/<name>.html pointing at the real sources
  sed "s|<script src=\"shared.js\"></script>|$STUB<script src=\"$ROOT/src/shared.js\"></script>|; s|<script src=\"$1.js\"></script>|<script src=\"$ROOT/src/$1.js\"></script>|; s|href=\"theme.css\"|href=\"$ROOT/src/theme.css\"|; s|\.\./icons|$ROOT/icons|g" "src/$1.html" > "$TMP/$1.html"
}
shot() { # shot <html> <png> <width> <height> [scale]
  "$CHROME" --headless --no-sandbox --allow-file-access-from-files --virtual-time-budget=3000 --hide-scrollbars \
    --force-device-scale-factor="${5:-1}" --screenshot="$2" --window-size="$3,$4" "file://$1" >/dev/null 2>&1
}

page popup
page options

# 1. Popup, at 2x, centred on a soft background.
shot "$TMP/popup.html" "$TMP/popup-raw.png" 300 700 2
convert "$TMP/popup-raw.png" -crop 600x590+0+0 +repage "$TMP/popup.png"
convert "$TMP/popup.png" \( +clone -background '#2b2560' -shadow 35x18+0+10 \) +swap -background none -layers merge +repage "$TMP/popup-shadow.png"
convert -size 1280x800 gradient:'#eceafc'-'#d9d5f7' "$TMP/popup-shadow.png" -gravity center -composite -depth 8 store/screenshots/1-popup.png

# 2. Settings page, top.
shot "$TMP/options.html" "$TMP/options-raw.png" 1280 1500
convert "$TMP/options-raw.png" -crop 1280x800+0+0 +repage store/screenshots/2-settings.png

# 3. Settings page, profiles.
convert "$TMP/options-raw.png" -crop 1280x800+0+600 +repage store/screenshots/3-profiles.png
