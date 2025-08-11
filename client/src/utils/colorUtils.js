// Utility to lighten or darken a hex color
export function shadeColor(hex, percent) {
  // Remove # if present
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
