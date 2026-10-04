// Generates the logo SVG options into assets/logos/.
const fs = require("fs");
const WIN = "M12 40a12 12 0 0 1 12-12h80a12 12 0 0 1 12 12v56a12 12 0 0 1-12 12H24A12 12 0 0 1 12 96z";
const BAR = '<path d="M12 54h104" stroke="#fff" stroke-opacity=".6" stroke-width="4"/><circle cx="27" cy="41" r="4" fill="#fff" fill-opacity=".75"/><circle cx="40" cy="41" r="4" fill="#fff" fill-opacity=".75"/>';
const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C6CFF"/><stop offset="1" stop-color="#4F3FD8"/></linearGradient></defs>';
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${inner}</svg>\n`;
const out = {
  a: svg(`${GRAD}<path d="${WIN}" fill="url(#g)"/>${BAR}<g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M40 70h22L40 94h22"/><path d="M74 66h14L74 82h14" stroke-width="5" opacity=".8"/></g>`),
  b: svg(`<path d="${WIN}" fill="#9AA0B4"/>${BAR}<path d="M28 112 84 62" stroke="#2B2560" stroke-width="8" stroke-linecap="round"/><path d="M28 112l12-11" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M98 8l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#FFC857"/><path d="M114 66l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFC857" opacity=".85"/>`),
  c: svg(`${GRAD}<clipPath id="l"><rect width="64" height="128"/></clipPath><clipPath id="r"><rect x="64" width="64" height="128"/></clipPath><g clip-path="url(#l)"><path d="${WIN}" fill="url(#g)"/></g><g clip-path="url(#r)"><path d="${WIN}" fill="#A9AEC0"/></g>${BAR}<path d="M64 58v44" stroke="#fff" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/><path d="M92 74l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" opacity=".9"/><path d="M36 76l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#fff"/>`),
  d: svg(`<rect x="6" y="6" width="116" height="116" rx="28" fill="#1E1B4B"/><path d="M74 24a36 36 0 1 0 28 56A31 31 0 0 1 74 24z" fill="#FFC857"/><rect x="70" y="72" width="40" height="30" rx="7" fill="#7C6CFF"/><path d="M70 82h40" stroke="#fff" stroke-opacity=".6" stroke-width="3"/><circle cx="30" cy="30" r="3" fill="#fff"/><circle cx="50" cy="16" r="2" fill="#fff" opacity=".7"/><circle cx="104" cy="40" r="2.5" fill="#fff" opacity=".8"/>`),
};
for (const [k, v] of Object.entries(out)) fs.writeFileSync(`${__dirname}/logos/option-${k}.svg`, v);
