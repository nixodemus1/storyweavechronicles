// Utility to lighten or darken a hex color
export function shadeColor(hex, percent) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map(x => x + x).join('');
  }
  let r = parseInt(hex.substring(0,2),16);
  let g = parseInt(hex.substring(2,4),16);
  let b = parseInt(hex.substring(4,6),16);
  r = Math.min(255, Math.max(0, r + Math.round(2.55 * percent)));
  g = Math.min(255, Math.max(0, g + Math.round(2.55 * percent)));
  b = Math.min(255, Math.max(0, b + Math.round(2.55 * percent)));
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Utility to blend two hex colors
export function blendColors(hex1, hex2, ratio) {
  // ratio: 0 = hex1, 1 = hex2
  const h1 = hex1.replace('#','');
  const h2 = hex2.replace('#','');
  const r = Math.round(parseInt(h1.substring(0,2),16)*(1-ratio) + parseInt(h2.substring(0,2),16)*ratio);
  const g = Math.round(parseInt(h1.substring(2,4),16)*(1-ratio) + parseInt(h2.substring(2,4),16)*ratio);
  const b = Math.round(parseInt(h1.substring(4,6),16)*(1-ratio) + parseInt(h2.substring(4,6),16)*ratio);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// Utility to get luminance of a hex color
export function getLuminance(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0,2),16) / 255;
  const g = parseInt(hex.substring(2,4),16) / 255;
  const b = parseInt(hex.substring(4,6),16) / 255;
  return 0.299*r + 0.587*g + 0.114*b;
}

// Utility to get perceived saturation of a hex color
export function getSaturation(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0,2),16) / 255;
  const g = parseInt(hex.substring(2,4),16) / 255;
  const b = parseInt(hex.substring(4,6),16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

// Smart color stepper for containers: handles bright/saturated colors
// direction: 1 = lighter, -1 = darker
export function stepColor(hex, theme, step = 1, direction = null) {
  // direction: if null, auto (dark theme = lighter, light theme = darker)
  // For highly saturated/bright colors, blend toward gray or black/white
  const lum = getLuminance(hex);
  const sat = getSaturation(hex);
  let dir = direction;
  if (dir === null) dir = (theme === 'dark') ? 1 : -1;
  // If color is very bright and saturated, blend toward gray or black/white
  if (sat > 0.5 && lum > 0.6 && dir === 1) {
    // bright, saturated, going lighter: blend toward white
    return blendColors(hex, '#ffffff', 0.15 * step);
  }
  if (sat > 0.5 && lum < 0.4 && dir === -1) {
    // dark, saturated, going darker: blend toward black
    return blendColors(hex, '#000000', 0.15 * step);
  }
  // For other cases, just shade
  return shadeColor(hex, dir * 8 * step);
}
