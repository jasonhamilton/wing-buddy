import { describe, expect, it } from "vitest";
import { airfoilPath, frontView, halfSpanMm, planform, sideView, tipValueMarginPct, W } from "../panelDrawings";

const IN = 25.4;
// The example wing the card layout was specified with, in millimetres.
const inner = { lengthMm: 16.535 * IN, rootChordMm: 9.055 * IN, tipChordMm: 9.055 * IN, dihedralDeg: 2 };
const outer = { lengthMm: 14.173 * IN, rootChordMm: 9.055 * IN, tipChordMm: 6.102 * IN, dihedralDeg: 6 };
const wing = [inner, outer];

describe("half span", () => {
  it("is the sum of length × cos(dihedral): 30.620 in for the example", () => {
    expect(halfSpanMm(wing) / IN).toBeCloseTo(30.62, 2);
  });
});

describe("front view", () => {
  const v = frontView(wing);
  it("starts at the root on the left and ends at the right edge", () => {
    expect(v.points[0]).toEqual([1, 30]);
    expect(v.points.at(-1)![0]).toBeCloseTo(W, 6);
  });
  it("a flat-ish wing keeps the standard 52-unit box with the reference line at y=30", () => {
    expect(v.height).toBe(52);
    expect(v.baseline).toBe(30);
  });
  it("angles are true: the slope of each segment is the dihedral, unexaggerated", () => {
    v.segments.forEach((s, i) => {
      const slope = Math.atan2(s.y1 - s.y2, s.x2 - s.x1) * (180 / Math.PI);
      expect(slope).toBeCloseTo(wing[i].dihedralDeg, 6);
    });
  });
  it("a steep wing grows the box instead of bending the scale", () => {
    const steep = frontView([{ ...inner, dihedralDeg: 30 }]);
    expect(steep.height).toBeGreaterThan(52);
    expect(Math.min(...steep.points.map((p) => p[1]))).toBeGreaterThanOrEqual(11 - 1e-9);
  });
  it("a drooping wing stays inside the box", () => {
    const d = frontView([{ ...inner, dihedralDeg: -20 }]);
    expect(Math.max(...d.points.map((p) => p[1]))).toBeLessThanOrEqual(d.height - 22 + 1e-9);
  });
});

describe("planform", () => {
  const maxL = Math.max(inner.lengthMm, outer.lengthMm);
  const maxC = Math.max(inner.rootChordMm, outer.rootChordMm);
  it("the longest panel draws the full width, shorter ones proportionally less", () => {
    expect(planform(inner, maxL, maxC).w).toBeCloseTo(W, 6);
    expect(planform(outer, maxL, maxC).w).toBeCloseTo((W * 14.173) / 16.535, 4);
  });
  it("the widest chord is 44 units tall, centred on y=40", () => {
    const [a, , , d] = planform(inner, maxL, maxC).polygon;
    expect(d[1] - a[1]).toBeCloseTo(44, 6);
    expect((a[1] + d[1]) / 2).toBeCloseTo(40, 6);
  });
  it("the tip chord scales with the same factor", () => {
    const [, b, c] = planform(outer, maxL, maxC).polygon;
    expect(c[1] - b[1]).toBeCloseTo(44 * (6.102 / 9.055), 4);
  });
  it("the tip value's margin puts it under the tip end", () => {
    const p = planform(outer, maxL, maxC);
    expect(tipValueMarginPct(p.w)).toBeCloseTo(((W - p.w) / W) * 100, 9);
    expect(tipValueMarginPct(W)).toBe(0);
  });
  it("a very short panel still leaves room for its length text", () => {
    const p = planform({ ...inner, lengthMm: 5 }, maxL, maxC);
    expect(p.dimGap).toBeGreaterThanOrEqual(0);
    expect(p.dimGap).toBeLessThan(32);
  });
});

describe("side view", () => {
  it("rises by length × sin(dihedral) at the shared scale, and runs length × cos", () => {
    const maxL = outer.lengthMm > inner.lengthMm ? outer.lengthMm : inner.lengthMm;
    const s = sideView(outer, maxL);
    const scale = W / maxL;
    expect(s.baseline - s.y2).toBeCloseTo(outer.lengthMm * Math.sin((6 * Math.PI) / 180) * scale, 6);
    expect(s.x2 - 1).toBeCloseTo(outer.lengthMm * Math.cos((6 * Math.PI) / 180) * scale, 6);
    expect(s.height).toBeGreaterThanOrEqual(44);
  });
});

describe("airfoil outline", () => {
  it("draws a NACA section, closed, with the chord 100 units long", () => {
    const d = airfoilPath("naca-2412", [])!;
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const xs = [...d.matchAll(/[ML]([-\d.]+) /g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(100, 1);
  });
  it("is thinner for a 0009 than a 2412", () => {
    const height = (id: string) => {
      const ys = [...airfoilPath(id, [])!.matchAll(/ ([-\d.]+)(?=[LZ])/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height("naca-0009")).toBeLessThan(height("naca-2412"));
  });
  it("is null when there is nothing to draw from", () => {
    expect(airfoilPath("nope", [])).toBeNull();
  });
});
