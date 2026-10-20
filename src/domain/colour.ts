/** Colour maths for the colour picker: hex, RGB and HSV, and a set of basic colours to start from. */

export type Rgb = [number, number, number];
export type Hsv = [number, number, number];

const clamp255 = (n: number) => (Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0);

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): Rgb {
  const h = parseHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** What a person types for a colour, as a lower-case "#rrggbb", or null. Three-digit shorthand is expanded. */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) return ("#" + t.split("").map((c) => c + c).join("")).toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return ("#" + t).toLowerCase();
  return null;
}

/** r, g, b in 0 to 255 to hue in degrees (0 to 360) and saturation and value in 0 to 1. */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

/** Black or white, whichever reads better on this colour. */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/** A starting set of colours, named so a screen reader can say which one it has landed on. */
export const BASIC_COLOURS: { name: string; hex: string }[] = [
  { name: "Black", hex: "#000000" },
  { name: "Dark red", hex: "#8b0000" },
  { name: "Dark green", hex: "#006400" },
  { name: "Brown", hex: "#8b4513" },
  { name: "Green", hex: "#00a000" },
  { name: "Olive", hex: "#a0a000" },
  { name: "Bright green", hex: "#00ff00" },
  { name: "Lime", hex: "#a0ff00" },
  { name: "Navy", hex: "#00008b" },
  { name: "Plum", hex: "#a000a0" },
  { name: "Teal", hex: "#006482" },
  { name: "Mauve", hex: "#a05a80" },
  { name: "Sea green", hex: "#00a078" },
  { name: "Khaki", hex: "#a0a064" },
  { name: "Spring green", hex: "#00ff96" },
  { name: "Pale green", hex: "#a0ff96" },
  { name: "Blue", hex: "#0000ff" },
  { name: "Purple", hex: "#a000ff" },
  { name: "Cornflower", hex: "#0064ff" },
  { name: "Orchid", hex: "#a064ff" },
  { name: "Sky blue", hex: "#00a0ff" },
  { name: "Lavender", hex: "#a0a0ff" },
  { name: "Aqua", hex: "#00ffff" },
  { name: "Pale aqua", hex: "#a0ffff" },
  { name: "Red", hex: "#ff0000" },
  { name: "Orange", hex: "#ff6400" },
  { name: "Amber", hex: "#ffa000" },
  { name: "Yellow", hex: "#ffff00" },
  { name: "Magenta", hex: "#ff00ff" },
  { name: "Pink", hex: "#ff64a0" },
  { name: "Peach", hex: "#ffa064" },
  { name: "White", hex: "#ffffff" },
];
