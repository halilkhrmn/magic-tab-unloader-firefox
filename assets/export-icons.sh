#!/bin/sh
# Renders assets/logo.svg to the PNG icons used by the manifest (needs a Chromium/Chrome binary).
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
for size in 48 96 128; do
  printf '<body style="margin:0;background:transparent"><img src="logo.svg" width="%s" height="%s" style="display:block">' "$size" "$size" > assets/.render.html
  "$CHROME" --headless --no-sandbox --hide-scrollbars --default-background-color=00000000 \
    --screenshot="icons/icon-$size.png" --window-size="$size,$size" "file://$PWD/assets/.render.html" >/dev/null 2>&1
done
rm -f assets/.render.html
