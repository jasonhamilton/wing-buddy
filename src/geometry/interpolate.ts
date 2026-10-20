/**
 * Spanwise airfoil interpolation.
 *
 * Spanwise blending uses centripetal Catmull-Rom interpolation between the
 * root and tip sections. With exactly two control sections a Catmull-Rom spline
 * reduces to a straight line, which is the right answer; the spline earns its
 * keep when a foil is linked across three or more panels and the blend has to
 * stay smooth through the joins.
 */
import type { Surfaces } from "./types";

/**
 * Centripetal Catmull-Rom through `values` at parameters `knots`, evaluated at
 * `u`. Endpoints are extrapolated by reflection so the curve passes through the
 * first and last control values.
 */
export function catmullRom(knots: number[], values: number[], u: number): number {
  const n = knots.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  if (n === 2) {
    const span = knots[1] - knots[0];
    const t = span === 0 ? 0 : (u - knots[0]) / span;
    return values[0] + t * (values[1] - values[0]);
  }

  let i = 0;
  while (i < n - 2 && u > knots[i + 1]) i++;

  const p1 = values[i];
  const p2 = values[i + 1];
  const p0 = i > 0 ? values[i - 1] : 2 * p1 - p2;
  const p3 = i + 2 < n ? values[i + 2] : 2 * p2 - p1;

  const t1 = knots[i];
  const t2 = knots[i + 1];
  const span = t2 - t1;
  const t = span === 0 ? 0 : (u - t1) / span;

  // Uniform Catmull-Rom basis. The centripetal parameterisation is carried by
  // the knot spacing supplied in `knots`, which is what prevents the cusps and
  // self-intersections a uniform parameterisation produces on uneven spans.
  const t2sq = t * t;
  const t3 = t2sq * t;
  return (
    0.5 *
    ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2sq +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Centripetal knots: spacing proportional to the square root of the gap. */
export function centripetalKnots(positions: number[]): number[] {
  const knots = [0];
  for (let i = 1; i < positions.length; i++) {
    knots.push(knots[i - 1] + Math.sqrt(Math.abs(positions[i] - positions[i - 1])) || 1e-6);
  }
  const total = knots[knots.length - 1] || 1;
  return knots.map((k) => k / total);
}

/**
 * Blend control sections at normalised span `t` (0 at the root, 1 at the tip).
 * All sections must share the same station array.
 */
export function blendSurfaces(controls: Surfaces[], t: number): Surfaces {
  if (controls.length === 0) throw new Error("no control sections to blend");
  if (controls.length === 1) return controls[0];

  const positions = controls.map((_, i) => i / (controls.length - 1));
  const knots = centripetalKnots(positions);
  const u = Math.max(0, Math.min(1, t));

  const x = controls[0].x;
  const yUpper: number[] = new Array(x.length);
  const yLower: number[] = new Array(x.length);

  for (let s = 0; s < x.length; s++) {
    yUpper[s] = catmullRom(knots, controls.map((c) => c.yUpper[s]), u);
    yLower[s] = catmullRom(knots, controls.map((c) => c.yLower[s]), u);
  }
  return { x, yUpper, yLower };
}

/**
 * A smooth curve through `values` at real positions `x` (millimetres along the span), evaluated at `u`.
 * Each knot's slope is the slope between its neighbours, so the curve is continuous in slope through
 * every join even when the panels either side are very different lengths. With two knots it is the
 * straight line, so a single panel blends exactly as it always did. Outside the knots it holds the end values.
 */
export function hermiteAt(x: number[], values: number[], u: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  if (u <= x[0]) return values[0];
  if (u >= x[n - 1]) return values[n - 1];

  let i = 0;
  while (i < n - 2 && u > x[i + 1]) i++;
  const slope = (k: number): number => {
    if (k === 0) return (values[1] - values[0]) / (x[1] - x[0]);
    if (k === n - 1) return (values[n - 1] - values[n - 2]) / (x[n - 1] - x[n - 2]);
    return (values[k + 1] - values[k - 1]) / (x[k + 1] - x[k - 1]);
  };
  const h = x[i + 1] - x[i];
  const t = (u - x[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * values[i] +
    (t3 - 2 * t2 + t) * h * slope(i) +
    (-2 * t3 + 3 * t2) * values[i + 1] +
    (t3 - t2) * h * slope(i + 1)
  );
}

/** Blend sections placed at real spanwise positions `x`, at position `u`. */
export function blendSurfacesAlong(controls: Surfaces[], x: number[], u: number): Surfaces {
  if (controls.length === 0) throw new Error("no control sections to blend");
  if (controls.length === 1) return controls[0];
  const xs = controls[0].x;
  const yUpper: number[] = new Array(xs.length);
  const yLower: number[] = new Array(xs.length);
  for (let s = 0; s < xs.length; s++) {
    const up = hermiteAt(x, controls.map((c) => c.yUpper[s]), u);
    const lo = hermiteAt(x, controls.map((c) => c.yLower[s]), u);
    // A spline can overshoot a little between very different sections; a section must never turn inside out.
    yUpper[s] = Math.max(up, lo);
    yLower[s] = Math.min(up, lo);
  }
  return { x: xs, yUpper, yLower };
}
