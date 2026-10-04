// Builds a greyed-out, half-transparent copy of a favicon, matching how Firefox
// draws the icon of a tab it unloaded itself (grayscale + 50% opacity).
const iconCache = new Map(); // favicon url -> data URL

async function makeGreyIcon(url) {
  if (iconCache.has(url)) return iconCache.get(url);
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
    const dataUrl = canvas.toDataURL("image/png");
    if (iconCache.size >= 200) iconCache.delete(iconCache.keys().next().value);
    iconCache.set(url, dataUrl);
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
