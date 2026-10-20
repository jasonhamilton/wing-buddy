/** Airfoil loading, normalisation, resampling and measurement. */
import { cosineStations } from "../data/naca";
import type { AirfoilMetrics, Pt, Surfaces } from "./types";

export const STATIONS = 100;

/** Translate and scale so the chord runs 0..1 along x. */
export function normalise(points: Pt[]): Pt[] {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const chord = maxX - minX;
  if (!(chord > 0)) throw new Error("airfoil has no chord length");
  return points.map((p) => ({ x: (p.x - minX) / chord, y: p.y / chord }));
}

function interpAt(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  if (span === 0) return ys[lo];
  const t = (x - xs[lo]) / span;
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/**
 * Split a point list at the nose and resample both surfaces onto shared cosine
 * stations. Accepts Selig order (TE -> top -> LE -> bottom -> TE) and tolerates
 * the leading edge being a single point or a doubled one.
 */
export function toSurfaces(points: Pt[], n = STATIONS): Surfaces {
  const pts = normalise(points);

  let leIndex = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[leIndex].x) leIndex = i;

  const first = pts.slice(0, leIndex + 1);
  const second = pts.slice(leIndex);

  // Whichever half has the greater mean y is the upper surface. This survives
  // reversed files and heavily cambered sections alike.
  const meanY = (a: Pt[]) => a.reduce((s, p) => s + p.y, 0) / Math.max(a.length, 1);
  const [upRaw, loRaw] = meanY(first) >= meanY(second) ? [first, second] : [second, first];

  const asc = (a: Pt[]) => {
    const c = [...a].sort((p, q) => p.x - q.x);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of c) {
      if (xs.length && Math.abs(p.x - xs[xs.length - 1]) < 1e-9) {
        ys[ys.length - 1] = (ys[ys.length - 1] + p.y) / 2;
        continue;
      }
      xs.push(p.x);
      ys.push(p.y);
    }
    return { xs, ys };
  };

  const up = asc(upRaw);
  const lo = asc(loRaw);
  const x = cosineStations(n);

  return {
    x,
    yUpper: x.map((v) => interpAt(up.xs, up.ys, v)),
    yLower: x.map((v) => interpAt(lo.xs, lo.ys, v)),
  };
}

/** Back to a closed Selig-ordered ring, counter-clockwise in a y-up system. */
export function fromSurfaces(s: Surfaces): Pt[] {
  const out: Pt[] = [];
  for (let i = s.x.length - 1; i >= 1; i--) out.push({ x: s.x[i], y: s.yUpper[i] });
  for (let i = 0; i < s.x.length - 1; i++) out.push({ x: s.x[i], y: s.yLower[i] });
  return out;
}

/**
 * Scale a section's thickness without touching its camber.
 *
 * The factor beside each airfoil is a thickness multiplier, so
 * scaling both surfaces uniformly would be wrong: it would drag the camber line
 * with it and change the section's character, not just how deep it is. Split
 * into camber plus half-thickness, scale the half-thickness, put it back.
 */
export function scaleThickness(s: Surfaces, factor: number): Surfaces {
  if (factor === 1) return s;
  const yUpper: number[] = new Array(s.x.length);
  const yLower: number[] = new Array(s.x.length);
  for (let i = 0; i < s.x.length; i++) {
    const camber = (s.yUpper[i] + s.yLower[i]) / 2;
    const half = (s.yUpper[i] - s.yLower[i]) / 2;
    yUpper[i] = camber + half * factor;
    yLower[i] = camber - half * factor;
  }
  return { x: s.x, yUpper, yLower };
}

export function metrics(s: Surfaces): AirfoilMetrics {
  let maxT = 0;
  let maxTAt = 0;
  let maxC = 0;
  let maxCAt = 0;
  for (let i = 0; i < s.x.length; i++) {
    const t = s.yUpper[i] - s.yLower[i];
    if (t > maxT) {
      maxT = t;
      maxTAt = s.x[i];
    }
    const c = (s.yUpper[i] + s.yLower[i]) / 2;
    if (Math.abs(c) > Math.abs(maxC)) {
      maxC = c;
      maxCAt = s.x[i];
    }
  }
  return {
    thicknessPct: maxT * 100,
    maxThicknessAtPct: maxTAt * 100,
    camberPct: maxC * 100,
    maxCamberAtPct: maxCAt * 100,
  };
}

/** Upper and lower surface height at a chord fraction, in chord units. */
export function surfaceAt(s: Surfaces, xFrac: number): { upper: number; lower: number } {
  return {
    upper: interpAt(s.x, s.yUpper, xFrac),
    lower: interpAt(s.x, s.yLower, xFrac),
  };
}

export class AirfoilParseError extends Error {}

/**
 * Parse a .dat / .cor airfoil file. Handles both conventions found in the wild:
 *
 *   Selig    name line, then TE -> top -> LE -> bottom -> TE in one run
 *   Lednicer name line, then two counts, then top LE -> TE, then bottom LE -> TE
 *
 * Detection is by content, not by extension, because the extension lies often.
 */
export function parseAirfoilFile(text: string): { name: string; points: Pt[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const numbers = (l: string): number[] | null => {
    const m = l.split(/[\s,]+/).filter(Boolean).map(Number);
    return m.length === 2 && m.every((v) => Number.isFinite(v)) ? m : null;
  };

  let i = 0;
  while (i < lines.length && (lines[i] === "" || numbers(lines[i]) === null)) i++;
  const nameLine = lines.slice(0, i).find((l) => l !== "") ?? "";
  const name = nameLine.replace(/\s+/g, " ").trim() || "Imported airfoil";

  const head = numbers(lines[i]);
  if (!head) throw new AirfoilParseError("No coordinate pairs found. Is this an airfoil file?");

  // A first pair of counts, both well above 1, means Lednicer.
  const isLednicer = head[0] > 1.5 && head[1] > 1.5;

  const rows: Pt[] = [];
  const blanks: number[] = [];
  for (let j = isLednicer ? i + 1 : i; j < lines.length; j++) {
    const line = lines[j];
    if (line === "") {
      if (rows.length) blanks.push(rows.length);
      continue;
    }
    const n = numbers(line);
    if (!n) {
      throw new AirfoilParseError(
        `Line ${j + 1} has ${line.split(/[\s,]+/).filter(Boolean).length} value(s) where 2 were expected.`,
      );
    }
    rows.push({ x: n[0], y: n[1] });
  }

  if (rows.length < 20) {
    throw new AirfoilParseError(`Only ${rows.length} points. An airfoil needs at least 20.`);
  }

  if (!isLednicer) return { name, points: rows };

  // Lednicer: two LE->TE runs. Split on the blank line if there is one,
  // otherwise where x stops increasing.
  let split = blanks.find((b) => b > 2 && b < rows.length - 2);
  if (split === undefined) {
    split = rows.length;
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].x < rows[k - 1].x) {
        split = k;
        break;
      }
    }
  }
  const upper = rows.slice(0, split);
  const lower = rows.slice(split);
  if (lower.length < 5) return { name, points: rows };
  return { name, points: [...upper].reverse().concat(lower.slice(1)) };
}
