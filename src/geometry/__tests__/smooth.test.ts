/** Nose smoothing: remove digitising noise from the front of a section without changing its shape. */
import { describe, expect, it } from "vitest";
import { resolveSurfaces } from "../../domain/airfoils";
import { smoothNose } from "../smooth";
import type { Surfaces } from "../types";

const clean = resolveSurfaces("naca-2412", [])!;

/** Deterministic pseudo-noise, so a failing run can be reproduced. */
function noisy(amp: number, upTo = 0.12): Surfaces {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const jig = (ys: number[]) => ys.map((y, i) => (i > 0 && clean.x[i] <= upTo ? y + amp * rnd() : y));
  return { x: clean.x, yUpper: jig(clean.yUpper), yLower: jig(clean.yLower) };
}

/** Sum of squared second differences over the nose: a measure of how rough the line is. */
const roughness = (ys: number[], x: number[], upTo = 0.1) => {
  let r = 0;
  for (let i = 1; i < ys.length - 1 && x[i + 1] <= upTo; i++) r += (ys[i + 1] - 2 * ys[i] + ys[i - 1]) ** 2;
  return r;
};
const maxDev = (a: number[], b: number[], x: number[], upTo = 0.12) => Math.max(...a.map((v, i) => (x[i] <= upTo ? Math.abs(v - b[i]) : 0)));

describe("smoothNose", () => {
  it("makes a noisy nose much smoother and closer to the true section", () => {
    const rough = noisy(0.0006);
    const s = smoothNose(rough, 10);
    // The section itself has real curvature at the nose, so judge the noise alone: the error against the true section.
    const err = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
    expect(roughness(err(s.yUpper, clean.yUpper), s.x)).toBeLessThan(roughness(err(rough.yUpper, clean.yUpper), s.x) * 0.3);
    expect(roughness(err(s.yLower, clean.yLower), s.x)).toBeLessThan(roughness(err(rough.yLower, clean.yLower), s.x) * 0.3);
    // within the smoothed zone the result is closer to the true section than the noisy input was
    expect(maxDev(s.yUpper, clean.yUpper, s.x, 0.1)).toBeLessThan(maxDev(rough.yUpper, clean.yUpper, s.x, 0.1));
  });
  it("changes a smooth section by almost nothing: the shape is kept (well under 0.1mm on a 230mm chord)", () => {
    const s = smoothNose(clean, 10);
    expect(maxDev(s.yUpper, clean.yUpper, s.x, 1)).toBeLessThan(4e-4);
    expect(maxDev(s.yLower, clean.yLower, s.x, 1)).toBeLessThan(4e-4);
    // and a symmetric section, which has no tilted nose, is changed by far less
    const sym = resolveSurfaces("naca-0012", [])!;
    expect(maxDev(smoothNose(sym, 10).yUpper, sym.yUpper, sym.x, 1)).toBeLessThan(2e-5);
  });
  it("leaves everything behind the extent exactly as it was", () => {
    const rough = noisy(0.0006, 0.5);
    const s = smoothNose(rough, 10);
    rough.x.forEach((x, i) => {
      if (x > 0.1) {
        expect(s.yUpper[i]).toBe(rough.yUpper[i]);
        expect(s.yLower[i]).toBe(rough.yLower[i]);
      }
    });
  });
  it("pins the leading-edge point itself", () => {
    const s = smoothNose(noisy(0.0006), 10);
    expect(s.yUpper[0]).toBe(clean.yUpper[0]);
    expect(s.yLower[0]).toBe(clean.yLower[0]);
  });
  it("fades out toward the extent, so there is no step where the smoothing stops", () => {
    const rough = noisy(0.0006, 0.5);
    const s = smoothNose(rough, 10);
    const i = rough.x.findIndex((x) => x > 0.1);
    // the smoothing weight is zero at the boundary: the last smoothed station differs by little from its raw value
    expect(Math.abs(s.yUpper[i - 1] - rough.yUpper[i - 1])).toBeLessThan(2e-4);
  });
  it("never lets a section turn inside out", () => {
    const s = smoothNose(noisy(0.002), 20);
    s.yUpper.forEach((u, i) => expect(u).toBeGreaterThanOrEqual(s.yLower[i] - 1e-12));
  });
  it("does not change the thickness at the thickest point", () => {
    const rough = noisy(0.0006);
    const s = smoothNose(rough, 10);
    const t = (c: Surfaces) => Math.max(...c.yUpper.map((u, i) => u - c.yLower[i]));
    expect(Math.abs(t(s) - t(clean))).toBeLessThan(5e-4);
  });
  it("an extent of zero, or none, changes nothing, and the input is never modified", () => {
    const rough = noisy(0.0006);
    const copy = JSON.stringify(rough);
    expect(smoothNose(rough, 0)).toEqual(rough);
    smoothNose(rough, 10);
    expect(JSON.stringify(rough)).toBe(copy);
  });
  it("more passes smooth more", () => {
    const rough = noisy(0.0006);
    const a = smoothNose(rough, 10, 1);
    const b = smoothNose(rough, 10, 4);
    const err = (c: Surfaces) => c.yUpper.map((v, i) => v - clean.yUpper[i]);
    expect(roughness(err(b), b.x)).toBeLessThan(roughness(err(a), a.x));
  });
  it("is symmetric: a symmetric section stays symmetric", () => {
    const sym = resolveSurfaces("naca-0012", [])!;
    const s = smoothNose(sym, 10);
    s.yUpper.forEach((u, i) => expect(u).toBeCloseTo(-s.yLower[i], 9));
  });
});
