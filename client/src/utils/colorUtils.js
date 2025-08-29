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
  // Normalize hex (remove spaces, handle CSS variable values)
  hex = (hex || '').trim();
  if (hex.startsWith('var(')) {
    // Fallback to white if CSS variable not resolved
    hex = '#ffffff';
  }
  // direction: if null, auto based on luminance and saturation
  const lum = getLuminance(hex);
  const sat = getSaturation(hex);
  let dir = direction;
  // For highly saturated colors, use a higher luminance threshold and channel check
  if (dir === null) {
    if (sat > 0.5) {
      // Parse RGB channels
      const hexVal = hex.replace('#', '');
      const r = parseInt(hexVal.substring(0,2),16);
      const g = parseInt(hexVal.substring(2,4),16);
      const b = parseInt(hexVal.substring(4,6),16);
      // If any channel is very bright, treat as visually bright
      if (r > 200 || g > 200 || b > 200) {
        dir = -1;
      } else {
        // Otherwise, use luminance threshold
        dir = lum >= 0.35 ? -1 : 1;
      }
    } else {
      // For less saturated colors, use normal threshold
      dir = lum >= 0.5 ? -1 : 1;
    }
  }
  // Larger step size for more visible change
  const stepSize = 16;
  // If color is very bright and saturated, blend toward gray or black/white
  if (sat > 0.5 && lum > 0.6 && dir === 1) {
    // bright, saturated, going lighter: blend toward white
    return blendColors(hex, '#ffffff', 0.25 * step);
  }
  if (sat > 0.5 && lum < 0.4 && dir === -1) {
    // dark, saturated, going darker: blend toward black
    return blendColors(hex, '#000000', 0.25 * step);
  }
  // For other cases, just shade
  return shadeColor(hex, dir * stepSize * step);
}
