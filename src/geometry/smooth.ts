/**
 * Nose smoothing. A section digitised from a drawing, or imported with few points, often has a
 * lumpy leading edge, and a rib cut from it is lumpy too. This evens the front of the section out
 * without changing its shape: a quadratic-preserving (Savitzky-Golay) filter along each surface,
 * strongest at the nose and fading to nothing at `extentPct` of the chord, so there is no step
 * where it stops. A plain average would shave the real curve of the nose as well as the noise;
 * this one passes any smooth parabola through untouched and only removes what is lumpy.
 *
 * The stations are spaced evenly in angle around the nose (cosine spacing), which is what makes a
 * filter along the station index the right smoothing for a curve that bends hardest at the front.
 */
import type { Surfaces } from "./types";

// 7-point quadratic Savitzky-Golay weights.
const KERNEL = [-2, 3, 6, 7, 6, 3, -2].map((k) => k / 21);
const HALF = 3;

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * One filter pass along one surface. Stations before the leading-edge point do not exist, but the
 * curve carries on round the nose onto the other surface, so those neighbours are the other
 * surface's own stations: that is the true continuation, whatever the camber.
 */
function pass(cur: number[], other: number[], w: number[], last: number): number[] {
  const n = cur.length;
  const next = cur.slice();
  for (let i = 1; i <= last; i++) {
    let avg = 0;
    for (let k = -HALF; k <= HALF; k++) {
      const j = i + k;
      let v: number;
      if (j < 0) v = other[-j];
      else if (j > n - 1) v = cur[2 * (n - 1) - j];
      else v = cur[j];
      avg += KERNEL[k + HALF] * v;
    }
    next[i] = (1 - w[i]) * cur[i] + w[i] * avg;
  }
  return next;
}

function smoothBoth(upper: number[], lower: number[], x: number[], extent: number, passes: number): [number[], number[]] {
  const n = upper.length;
  let last = 0;
  while (last + 1 < n && x[last + 1] <= extent) last++;
  if (last < 1) return [upper.slice(), lower.slice()];

  // Smoothing weight: full at the nose, zero at the extent. The leading-edge point and the station
  // beside it are pinned: on a cambered section the point at x = 0 is not quite the tip of the nose,
  // so the curve has a slight corner there that a filter would round off.
  const w = x.map((xi, i) => (i <= 1 || i > last ? 0 : smoothstep(1 - xi / extent)));

  let u = upper.slice();
  let l = lower.slice();
  for (let p = 0; p < passes; p++) {
    const nu = pass(u, l, w, last);
    const nl = pass(l, u, w, last);
    u = nu;
    l = nl;
  }
  return [u, l];
}

export function smoothNose(s: Surfaces, extentPct: number, passes = 2): Surfaces {
  const extent = extentPct / 100;
  if (!(extent > 0) || passes < 1) return s;
  const [up, lo] = smoothBoth(s.yUpper, s.yLower, s.x, extent, passes);
  // A section must never turn inside out, however hard it is smoothed. Only inside the smoothed
  // zone: behind it the data is passed through exactly as it came.
  const inside = (i: number) => s.x[i] <= extent;
  return {
    x: s.x,
    yUpper: up.map((u, i) => (inside(i) ? Math.max(u, lo[i]) : s.yUpper[i])),
    yLower: up.map((u, i) => (inside(i) ? Math.min(u, lo[i]) : s.yLower[i])),
  };
}
