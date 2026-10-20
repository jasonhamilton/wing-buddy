/**
 * The maths behind the panel cards: every number a drawing needs, in the 270-unit-wide
 * space the SVGs share. Pure, so it can be tested without a browser. Root is always on
 * the left, tip on the right, and nothing is exaggerated: angles are true.
 */
import { BUILTIN_FOILS, naca4 } from "../../data/naca";
import type { Airfoil, Panel } from "../../domain/schema";

export const W = 270;
const DEG = Math.PI / 180;

/** Fixed layout constants of the three drawings. */
export const PLANFORM_H = 66;
export const PLANFORM_MID_Y = 40;
const CHORD_UNITS = 44;
const DIM_GAP = 32;

export type PanelDims = {
  lengthMm: number;
  rootChordMm: number;
  tipChordMm: number;
  dihedralDeg: number;
};

const horizontal = (p: PanelDims) => p.lengthMm * Math.cos(p.dihedralDeg * DEG);
const rise = (p: PanelDims) => p.lengthMm * Math.sin(p.dihedralDeg * DEG);

/** Sum of length × cos(dihedral): how far the wing reaches sideways, one half. */
export const halfSpanMm = (panels: PanelDims[]) => panels.reduce((s, p) => s + horizontal(p), 0);

// ------------------------------------------------------------ front view

export type FrontSegment = { x1: number; y1: number; x2: number; y2: number; labelX: number; labelY: number };
export type FrontView = { height: number; baseline: number; points: [number, number][]; segments: FrontSegment[] };

/**
 * The wing from the front, as one polyline. A flat wing keeps the standard 52-unit-tall box
 * with the reference line at y=30; a steep or drooping one makes the box taller rather than
 * clipping, because the scale is never bent to fit.
 */
export function frontView(panels: PanelDims[]): FrontView {
  const span = halfSpanMm(panels);
  const ov = span > 0 ? (W - 1) / span : 0;

  // Heights above the root along the way, to know how much room each side needs.
  const ups = [0];
  for (const p of panels) ups.push(ups[ups.length - 1] + rise(p) * ov);
  const maxUp = Math.max(...ups);
  const minUp = Math.min(...ups);
  const baseline = Math.max(30, 11 + maxUp);
  const height = Math.max(52, baseline - minUp + 22);

  let x = 1;
  const points: [number, number][] = [[1, baseline]];
  const segments: FrontSegment[] = [];
  panels.forEach((p, i) => {
    const x2 = x + horizontal(p) * ov;
    const y1 = baseline - ups[i];
    const y2 = baseline - ups[i + 1];
    segments.push({ x1: x, y1, x2, y2, labelX: (x + x2) / 2, labelY: (y1 + y2) / 2 + 16 });
    points.push([x2, y2]);
    x = x2;
  });
  return { height, baseline, points, segments };
}

// --------------------------------------------------------------- planform

export type Planform = {
  /** Width the panel is drawn at: longer panels draw longer. */
  w: number;
  /** x of the tip edge. */
  tipX: number;
  polygon: [number, number][];
  /** Centre of the length dimension, and the half-gap left in its line for the text. */
  dimMid: number;
  dimGap: number;
};

export function planform(p: PanelDims, maxLengthMm: number, maxChordMm: number): Planform {
  const w = maxLengthMm > 0 ? (W * p.lengthMm) / maxLengthMm : W;
  const k = maxChordMm > 0 ? CHORD_UNITS / maxChordMm : 0;
  const tipX = 1 + w - 2;
  const r = (p.rootChordMm * k) / 2;
  const t = (p.tipChordMm * k) / 2;
  const mid = PLANFORM_MID_Y;
  return {
    w,
    tipX,
    polygon: [
      [1, mid - r],
      [tipX, mid - t],
      [tipX, mid + t],
      [1, mid + r],
    ],
    dimMid: (1 + tipX) / 2,
    // A short panel cannot spare 32 units each side of the text; leave a sliver of line.
    dimGap: Math.max(0, Math.min(DIM_GAP, (tipX - 1) / 2 - 4)),
  };
}

/** Margin that puts the tip chord value under the real tip end, as a percentage of the row. */
export const tipValueMarginPct = (w: number) => ((W - w) / W) * 100;

// -------------------------------------------------------------- side view

export type SideView = { height: number; baseline: number; x2: number; y2: number };

export function sideView(p: PanelDims, maxLengthMm: number): SideView {
  const s = maxLengthMm > 0 ? W / maxLengthMm : 0;
  const up = rise(p) * s;
  const baseline = Math.max(36, 14 + up);
  return { height: baseline + 8, baseline, x2: 1 + horizontal(p) * s, y2: baseline - up };
}

// ---------------------------------------------------------------- airfoils

/**
 * An airfoil as an SVG path in the "-2 -10 104 20" box: chord 100 units, y flipped. NACA
 * 4-digit sections are generated (40 cosine-spaced stations); an uploaded section is drawn
 * from its own points. Anything else has no outline and the card shows its name only.
 */
export function airfoilPath(id: string, embedded: Airfoil[]): string | null {
  const builtin = BUILTIN_FOILS.find((f) => f.id === id);
  let pts: { x: number; y: number }[] | null = null;
  if (builtin) pts = naca4(builtin.code, 40);
  else {
    const custom = embedded.find((a) => a.id === id);
    if (custom?.points && custom.points.length >= 3) pts = custom.points.map(([x, y]) => ({ x, y }));
  }
  if (!pts) return null;

  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const chord = Math.max(...xs) - x0 || 1;
  const f = (v: number) => Number(v.toFixed(2));
  return (
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(((p.x - x0) / chord) * 100)} ${f((-p.y / chord) * 100)}`).join("") + "Z"
  );
}

/** The two ends of a panel, named. Equal when the section and its thickness factor match. */
export function foilEnds(p: Panel) {
  const tipId = p.tipAirfoilId ?? p.rootAirfoilId;
  const rootScale = p.rootAirfoilScale || 1;
  const tipScale = p.tipAirfoilScale || 1;
  return {
    rootId: p.rootAirfoilId,
    tipId,
    rootScale,
    tipScale,
    same: tipId === p.rootAirfoilId && tipScale === rootScale,
  };
}
