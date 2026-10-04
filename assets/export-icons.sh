#!/bin/sh
# Renders assets/logo.svg to the PNG icons used by the manifest.
# Needs a Chromium/Chrome binary (CHROME=...) and ImageMagick's `convert` to crop the screenshot.
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)}"
for size in 48 96 128; do
  # Render at 4x on a larger window (headless windows are cut off at the bottom), then crop and scale down.
  big=$((size * 4))
  printf '<body style="margin:0;background:transparent"><img src="logo.svg" width="%s" height="%s" style="display:block">' "$big" "$big" > assets/.render.html
  "$CHROME" --headless --no-sandbox --hide-scrollbars --default-background-color=00000000 \
    --screenshot=assets/.render.png --window-size="$((big + 200)),$((big + 200))" "file://$PWD/assets/.render.html" >/dev/null 2>&1
  convert assets/.render.png -crop "${big}x${big}+0+0" +repage -resize "${size}x${size}" "icons/icon-$size.png"
done
rm -f assets/.render.html assets/.render.png
