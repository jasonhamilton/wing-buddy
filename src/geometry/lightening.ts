/**
 * Standard lightening holes. Each rib gets holes through its web, one run of them between the things it
 * must not weaken: the nose and tail margins, edge stock, every spar and pocket (each with a strip of
 * material beside it), and the surfaces. A free run is divided into equal holes no wider than the maximum,
 * with the minimum distance left between one and the next; a run too short for the minimum width gets none.
 */
import type { Panel } from "../domain/schema";
import { surfaceAt } from "./airfoil";
import type { Band } from "./sheeting";
import type { Path, Pt, Surfaces } from "./types";

const MIN_HEIGHT_MM = 2;
const SAMPLES = 8;

/** The free stretches of [lo, hi] once the blocked intervals are taken out. */
function freeRuns(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (b <= at) continue;
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
    if (at >= hi) break;
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([a, b]) => b > a);
}

/** A quadratic corner from the point `r` back along the incoming edge to the point `r` along the outgoing one. */
function rounded(corner: Pt, before: Pt, after: Pt, r: number, points: number): Pt[] {
  const toward = (from: Pt, to: Pt, d: number): Pt => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
  };
  const a = toward(corner, before, r);
  const b = toward(corner, after, r);
  const out: Pt[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    out.push({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * corner.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * corner.y + t * t * b.y,
    });
  }
  return out;
}

/**
 * The holes for one rib, as clockwise rings in the rib's own frame. `bands` is the sheeting at this station
 * (the edge distance is kept from the airfoil surface under the sheet) and `obstacles` is every cut the
 * rib already has, so a hole never comes close to one.
 */
export function lighteningHoles(panel: Panel, chordMm: number, surfaces: Surfaces, bands: Band[], obstacles: Path[]): Path[] {
  const cfg = panel.lighteningHoles;
  if (!cfg || cfg.type !== "standard" || chordMm <= 0) return [];

  const blocked: [number, number][] = obstacles
    .filter((p) => p.length > 0)
    .map((p) => {
      let a = Infinity;
      let b = -Infinity;
      for (const q of p) {
        a = Math.min(a, q.x);
        b = Math.max(b, q.x);
      }
      return [a - cfg.supportWidthMm, b + cfg.supportWidthMm] as [number, number];
    });

  const edge = (x: number, side: "above" | "below") => {
    const layers = bands
      .filter((b) => (side === "above" ? b.above : b.below) && x >= b.x0 && x <= b.x1)
      .reduce((sum, b) => sum + b.thicknessMm, 0);
    return cfg.distanceFromEdgeMm + layers;
  };
  const surfaceY = (x: number, side: "above" | "below") => {
    const s = surfaceAt(surfaces, Math.min(1, Math.max(0, x / chordMm)));
    return (side === "above" ? s.upper : s.lower) * chordMm;
  };
  /** the top and bottom of the free space at x, the offset measured square to the surface */
  const limits = (x: number) => {
    const e = Math.max(chordMm / 400, 0.01);
    const xa = Math.max(0, x - e);
    const xb = Math.min(chordMm, x + e);
    const stretch = (side: "above" | "below") => {
      const slope = (surfaceY(xb, side) - surfaceY(xa, side)) / (xb - xa);
      return Math.sqrt(1 + slope * slope);
    };
    return {
      top: surfaceY(x, "above") - edge(x, "above") * stretch("above"),
      bottom: surfaceY(x, "below") + edge(x, "below") * stretch("below"),
    };
  };
  const roomAt = (x: number) => {
    const l = limits(x);
    return l.top - l.bottom;
  };

  const out: Path[] = [];
  const gap = Math.max(0, cfg.minDistanceMm);
  for (const [a, b] of freeRuns(Math.max(0, cfg.minDistanceFromLEMm), chordMm - Math.max(0, cfg.minDistanceFromTEMm), blocked)) {
    if (b - a < cfg.minWidthMm) continue;
    let n = Math.max(1, Math.ceil((b - a + gap) / (cfg.maxWidthMm + gap)));
    while (n > 1 && (b - a - (n - 1) * gap) / n < cfg.minWidthMm) n--;
    const w = (b - a - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      let x0 = a + i * (w + gap);
      let x1 = x0 + w;
      // where the section is too shallow for a hole, take the ends in until it is not
      const step = 0.25;
      while (x0 < x1 && roomAt(x0) < MIN_HEIGHT_MM) x0 += step;
      while (x1 > x0 && roomAt(x1) < MIN_HEIGHT_MM) x1 -= step;
      if (x1 - x0 < cfg.minWidthMm - 1e-6) continue;

      const xs = Array.from({ length: SAMPLES + 1 }, (_, k) => x0 + ((x1 - x0) * k) / SAMPLES);
      if (xs.some((x) => roomAt(x) < MIN_HEIGHT_MM)) continue;
      const top: Pt[] = xs.map((x) => ({ x, y: limits(x).top }));
      const bottom: Pt[] = xs.map((x) => ({ x, y: limits(x).bottom })).reverse();
      // counter-clockwise: along the bottom to the right, back along the top
      let ring: Pt[] = [...bottom.reverse(), ...top.reverse()];
      ring = ring.filter((p, k) => k === 0 || Math.hypot(p.x - ring[k - 1].x, p.y - ring[k - 1].y) > 1e-9);

      if (cfg.roundCorners && cfg.roundnessPct > 0) {
        const corners = new Set([0, SAMPLES, SAMPLES + 1, 2 * SAMPLES + 1]);
        const next: Pt[] = [];
        ring.forEach((p, k) => {
          if (!corners.has(k) || ring.length < 4) {
            next.push(p);
            return;
          }
          const before = ring[(k + ring.length - 1) % ring.length];
          const after = ring[(k + 1) % ring.length];
          const reach = Math.min(Math.hypot(before.x - p.x, before.y - p.y), Math.hypot(after.x - p.x, after.y - p.y));
          const r = Math.min((cfg.roundnessPct / 100) * Math.min(w, roomAt(p.x)) * 0.5, reach * 0.9);
          if (r < 1e-6) next.push(p);
          else next.push(...rounded(p, before, after, r, Math.max(2, cfg.smoothnessPoints)));
        });
        ring = next;
      }
      out.push(ring.reverse()); // clockwise, like every other void
    }
  }
  return out;
}
