// Builds a greyed-out, half-transparent copy of a favicon, matching how Firefox
// draws the icon of a tab it unloaded itself (grayscale + 50% opacity), optionally
// with a small sleeping "zZ" in the top right corner.
const iconCache = new Map(); // "<withZ>|<favicon url>" -> data URL

// A "Z" drawn as a stroked path with a light outline so it reads on any tab colour.
function drawZ(ctx, x, y, size) {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x + size, y + size);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.3 + 3;
  path();
  ctx.stroke();
  ctx.strokeStyle = "#5a49e8";
  ctx.lineWidth = size * 0.3;
  path();
  ctx.stroke();
}

async function makeGreyIcon(url, withZ = true) {
  const key = `${withZ ? 1 : 0}|${url}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const blob = await (await fetch(url)).blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.filter = "grayscale(100%)";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(img, 0, 0, size, size);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    if (withZ) {
      drawZ(ctx, 11, 17, 7); // small z
      drawZ(ctx, 19, 4, 9); // big Z
    }
    const dataUrl = canvas.toDataURL("image/png");
    if (iconCache.size >= 200) iconCache.delete(iconCache.keys().next().value);
    iconCache.set(key, dataUrl);
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
