/** Display units. Everything is stored in millimetres; inches are a view. */
export type DisplayUnits = "mm" | "in";

const MM_PER_IN = 25.4;

export function toDisplay(mm: number, units: DisplayUnits): number {
  return units === "in" ? mm / MM_PER_IN : mm;
}

export function fromDisplay(value: number, units: DisplayUnits): number {
  return units === "in" ? value * MM_PER_IN : value;
}

/**
 * Inches to up to three decimals, and only the ones that are needed: 1 is "1", 1.125 is
 * "1.125", 9.0551181 is "9.055". Inch dimensions are quoted this way; "1.000in" reads as
 * a precision nobody measured.
 */
export function formatInches(inches: number): string {
  const rounded = Number(inches.toFixed(3));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * A length for display. Inches always use `formatInches`; `decimals` is for millimetres.
 */
export function formatLength(mm: number, units: DisplayUnits, decimals = 2): string {
  return units === "in" ? `${formatInches(toDisplay(mm, "in"))}in` : `${mm.toFixed(decimals)}mm`;
}

/** Decimal places a length is shown with: millimetres to hundredths, inches to thousandths. */
export const lengthDecimals = (units: DisplayUnits): number => (units === "in" ? 3 : 2);

export const unitLabel = (units: DisplayUnits): string => units;

/**
 * A typed or stepped display value to stored millimetres. Inches are rounded to ten-thousandths
 * of a millimetre so 9in is 228.6 and not 228.60000000000002; millimetres pass through untouched.
 */
export function mmFromInput(value: number, units: DisplayUnits): number {
  return units === "in" ? Number(fromDisplay(value, units).toFixed(4)) : value;
}

const INCH_STEPS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

/** An arrow-key step given in millimetres, as a step a person would pick in the display unit. */
export function lengthStep(stepMm: number, units: DisplayUnits): number {
  if (units === "mm") return stepMm;
  const raw = stepMm / MM_PER_IN;
  return INCH_STEPS.reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best), INCH_STEPS[0]);
}

/** Square decimetres in metric, square inches in imperial. */
export function formatArea(dm2: number, units: DisplayUnits): string {
  return units === "in" ? `${formatInches(dm2 * 15.5000310001)} in²` : `${dm2.toFixed(2)} dm²`;
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: MM_PER_IN, inch: MM_PER_IN, inches: MM_PER_IN, '"': MM_PER_IN, "″": MM_PER_IN };

/**
 * What a person types into a length field, as a number in the display unit. A plain number is
 * in the display unit; "25.4mm", "1in", '2"' and "3 cm" say what they mean, and inch
 * fractions work the way they are written: "3/8", "1 3/8", "1-3/8". Anything else is null.
 */
export function parseLength(text: string, units: DisplayUnits): number | null {
  const m = /^\s*(.*?)\s*(mm|cm|inches|inch|in|"|″)?\s*$/i.exec(text.replace(/,/g, "."));
  if (!m) return null;
  const body = m[1];
  const token = m[2]?.toLowerCase();

  let v: number;
  const frac = /^(-?)(?:(\d+)[\s-]+)?(\d+)\/(\d+)$/.exec(body);
  if (frac) {
    const den = Number(frac[4]);
    if (den === 0) return null;
    v = (Number(frac[2] ?? 0) + Number(frac[3]) / den) * (frac[1] ? -1 : 1);
  } else if (/^-?(\d+\.?\d*|\.\d+)$/.test(body)) {
    v = Number(body);
  } else {
    return null;
  }
  if (!Number.isFinite(v)) return null;

  if (!token) return v;
  const canon = token === "inches" || token === "inch" || token === '"' || token === "″" ? "in" : token;
  if (canon === units) return v; // already in the display unit: no float round trip
  return toDisplay(v * UNIT_MM[token], units);
}

export function formatDeg(deg: number, decimals = 2): string {
  return `${deg.toFixed(decimals)}deg`;
}

/** Accepts "12.5", "12,5" and a trailing unit, so paste from anywhere works. */
export function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, ".").replace(/[a-z%°]+$/i, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}
