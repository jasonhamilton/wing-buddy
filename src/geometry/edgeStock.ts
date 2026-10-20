/**
 * Leading and trailing edge stock, as a builder sees it: a rectangular block of
 * timber, of the given width and height, glued on and then carved to the airfoil.
 *
 * Two parts come out of that. The *shaped* part is what is left once the block has been
 * carved: it follows the airfoil. The *excess* is what is carved away: the block's
 * corners above and below the section. If the block is not tall enough, the airfoil
 * pokes out of it, and `uncoveredMm` says by how much.
 *
 * Every ring is sampled at the same chordwise stations, so a ring at the root and one at
 * the tip have the same number of points and can be lofted point for point.
 */
import type { Panel } from "../domain/schema";
import type { z } from "zod";
import type { EdgeStock as EdgeStockSchema } from "../domain/schema";

type EdgeStock = z.infer<typeof EdgeStockSchema>;
import { surfaceAt } from "./airfoil";
import type { Path, Surfaces } from "./types";

const STATIONS = 12;

export type EdgeParts = {
  shaped: Path;
  /** the whole block before it is carved, width by height, in the shape chosen */
  block: Path;
  /** crescents of stock above and below the section, in that order */
  excess: [Path, Path];
  /** how far the airfoil pokes outside the block, mm; 0 when it is fully covered */
  uncoveredMm: number;
};

function station(k: number, which: "leadingEdge" | "trailingEdge"): number {
  const u = k / (STATIONS - 1);
  // Cluster samples where the nose curves fastest.
  return which === "leadingEdge" ? 1 - Math.cos((u * Math.PI) / 2) : u;
}

/**
 * How tall the block is across its width, as a fraction of its full height: 1 where it meets
 * the ribs (u = 0) to the free edge (u = 1). A rectangle is full height throughout; a wedge tapers
 * in a straight line to a point; a rounded edge (the old shape, now only on files that have it) stays
 * full height for the half next to the ribs and then rolls off along an ellipse to a quarter.
 */
export function shapeFactor(shape: EdgeStock["shape"], u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (shape) {
    case "triangle":
      return 1 - t;
    case "round": {
      if (t <= 0.5) return 1;
      const r = (t - 0.5) / 0.5;
      return Math.max(0.25, Math.sqrt(1 - r * r));
    }
    default:
      return 1;
  }
}

/** The wedge's height from its width and the angle at its point. */
export const wedgeHeightMm = (widthMm: number, angleDeg: number) => 2 * widthMm * Math.tan((angleDeg * Math.PI) / 360);
/** The angle at a wedge's point, from its width and height. */
export const wedgeAngleDeg = (widthMm: number, heightMm: number) => (widthMm <= 0 ? 0 : (2 * Math.atan(heightMm / (2 * widthMm)) * 180) / Math.PI);

/** Is this the round rod of a leading edge? */
export const isRod = (edge: EdgeStock, which: "leadingEdge" | "trailingEdge") => which === "leadingEdge" && edge.shape === "round";

/** The rod: where its centre is and how big it is, in the rib's frame. Its front sits on the section's mean line, at the nose unless set back. */
export function rodOf(edge: EdgeStock, chordMm: number, surfaces: Surfaces): { cx: number; cy: number; r: number } {
  const r = Math.max(0.1, edge.widthMm / 2);
  const setback = edge.setbackMm ?? 0;
  const s = surfaceAt(surfaces, Math.min(1, Math.max(0, setback / (chordMm || 1))));
  return { cx: setback + r, cy: ((s.upper + s.lower) / 2) * chordMm + (edge.offsetMm ?? 0), r };
}

/** How far the airfoil stands proud of a rod, where the rod replaces it: from the front of the rod back to its middle, where the rib begins. */
function rodUncovered(edge: EdgeStock, chordMm: number, surfaces: Surfaces): number {
  const { cx, cy, r } = rodOf(edge, chordMm, surfaces);
  const from = Math.max(0.0001, edge.setbackMm ?? 0);
  let out = 0;
  for (let k = 0; k <= 16; k++) {
    const x = from + ((cx - from) * k) / 16;
    const s = surfaceAt(surfaces, Math.min(1, x / chordMm));
    const half = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
    out = Math.max(out, s.upper * chordMm - (cy + half), cy - half - s.lower * chordMm);
  }
  return Math.max(0, out);
}

/**
 * The smallest rod, at the nose and on the mean line, that covers the airfoil where it replaces it. A circle is thinner than
 * the nose of an airfoil just behind its tip, so the rod that touches at the tip is too small; this one is as snug as a rod gets.
 */
export function fitRodDiameterMm(chordMm: number, surfaces: Surfaces, setbackMm = 0, offsetMm = 0): number {
  const base = { enabled: true, widthMm: 1, heightMm: 1, shape: "round" as const, setbackMm, offsetMm };
  let lo = 0.2;
  let hi = Math.max(2, chordMm * 0.2);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rodUncovered({ ...base, widthMm: mid, heightMm: mid }, chordMm, surfaces) > 0.005) lo = mid;
    else hi = mid;
  }
  return hi;
}

const ROD_POINTS = 32;

export function edgeParts(
  edge: EdgeStock,
  which: "leadingEdge" | "trailingEdge",
  chordMm: number,
  surfaces: Surfaces,
): EdgeParts | null {
  if (!edge?.enabled || edge.widthMm <= 0 || edge.heightMm <= 0 || chordMm <= 0) return null;
  if (isRod(edge, which)) {
    // A round rod is not carved: it sits at the nose as it is. What the airfoil does outside it is what `uncovered` reports.
    const { cx, cy, r } = rodOf(edge, chordMm, surfaces);
    const ring: Path = Array.from({ length: ROD_POINTS }, (_, i) => {
      const a = (i / ROD_POINTS) * Math.PI * 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    const uncovered = rodUncovered(edge, chordMm, surfaces);
    return { shaped: ring, block: ring, excess: [[], []], uncoveredMm: uncovered };
  }
  const w = Math.min(edge.widthMm, chordMm);
  const x0 = which === "leadingEdge" ? 0 : chordMm - w;

  const xs: number[] = [];
  const up: number[] = [];
  const lo: number[] = [];
  const f: number[] = [];
  for (let k = 0; k < STATIONS; k++) {
    const frac = station(k, which);
    const x = x0 + w * frac;
    const s = surfaceAt(surfaces, x / chordMm);
    xs.push(x);
    up.push(s.upper * chordMm);
    lo.push(s.lower * chordMm);
    // The ribs are at the back of a leading-edge block and the front of a trailing-edge one.
    f.push(shapeFactor(edge.shape, which === "leadingEdge" ? 1 - frac : frac));
  }

  // A rectangle is centred on the section's mid-line at the middle of its width. A wedge follows the mean line along its length,
  // so it comes to its point where the section does.
  const mid = Math.floor(STATIONS / 2);
  const centre = (k: number) => (edge.shape === "triangle" ? (up[k] + lo[k]) / 2 : (up[mid] + lo[mid]) / 2);
  const top = f.map((fk, k) => centre(k) + (edge.heightMm / 2) * fk);
  const bottom = f.map((fk, k) => centre(k) - (edge.heightMm / 2) * fk);
  const clamp = (v: number, k: number) => Math.min(top[k], Math.max(bottom[k], v));

  const uc = up.map(clamp);
  const lc = lo.map(clamp);
  // Near a wedge's point there is nothing to measure: the section and the block both close up.
  const ok = (k: number) => f[k] > 0.12;
  const uncoveredMm = Math.max(0, ...up.map((v, k) => (ok(k) ? v - top[k] : 0)), ...lo.map((v, k) => (ok(k) ? bottom[k] - v : 0)));

  const line = (ys: number[]) => xs.map((x, i) => ({ x, y: ys[i] }));

  return {
    shaped: [...line(uc), ...line(lc).reverse()],
    block: [...line(top), ...line(bottom).reverse()],
    excess: [
      [...line(uc), ...line(top).reverse()],
      [...line(bottom), ...line(lc).reverse()],
    ],
    uncoveredMm,
  };
}

/** The smallest block height that covers the section across the stock's width, mm. */
export function coverHeightMm(
  edge: EdgeStock,
  which: "leadingEdge" | "trailingEdge",
  chordMm: number,
  surfaces: Surfaces,
): number {
  if (edge.widthMm <= 0 || chordMm <= 0) return 0;
  const w = Math.min(edge.widthMm, chordMm);
  const x0 = which === "leadingEdge" ? 0 : chordMm - w;
  const sample = (k: number) => {
    const frac = station(k, which);
    const s = surfaceAt(surfaces, (x0 + w * frac) / chordMm);
    return { up: s.upper * chordMm, lo: s.lower * chordMm, f: shapeFactor(edge.shape, which === "leadingEdge" ? 1 - frac : frac) };
  };
  const mid = sample(Math.floor(STATIONS / 2));
  const yc = (mid.up + mid.lo) / 2;
  // At each station the block reaches (h / 2) * f above and below the centre: h must be big enough everywhere. Near a wedge's
  // point the factor goes to nothing and so does the section; leave that sliver out.
  let need = 0;
  for (let k = 0; k < STATIONS; k++) {
    const { up, lo, f } = sample(k);
    if (f < 0.12) continue;
    const c = edge.shape === "triangle" ? (up + lo) / 2 : yc;
    need = Math.max(need, (2 * Math.max(up - c, c - lo)) / f);
  }
  return need;
}

/** Default heights that cover a typical section; the editor's Fit button refines them. */
export const DEFAULT_EDGE: Record<"leadingEdge" | "trailingEdge", Pick<EdgeStock, "widthMm" | "heightMm">> = {
  leadingEdge: { widthMm: 8, heightMm: 24 },
  trailingEdge: { widthMm: 14, heightMm: 8 },
};

export const edgeOf = (panel: Panel, which: "leadingEdge" | "trailingEdge") => panel[which];
