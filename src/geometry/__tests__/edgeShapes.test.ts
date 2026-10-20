/**
 * Edge stock shapes. The block of timber glued to the front or back of the ribs is a rectangular strip or a wedge that comes
 * to a point (on the leading edge, a round rod); the thick side always faces the ribs.
 */
import { describe, expect, it } from "vitest";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject } from "../../domain/doc";
import { rebuild } from "..";
import { coverHeightMm, edgeParts, fitRodDiameterMm, isRod, rodOf, shapeFactor, wedgeAngleDeg, wedgeHeightMm } from "../edgeStock";

const area = (ring: { x: number; y: number }[]) =>
  Math.abs(ring.reduce((a, p, i) => a + (p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y), 0)) / 2;
const foil = resolveSurfaces("naca-2412", [])!;
const stock = (shape: "rectangle" | "triangle" | "round", w = 14, h = 40) => ({ enabled: true, widthMm: w, heightMm: h, shape });

describe("shapeFactor: how tall the block is across its width, 1 at the ribs to the free edge", () => {
  it("a rectangle is the same height all the way", () => {
    for (const u of [0, 0.3, 0.7, 1]) expect(shapeFactor("rectangle", u)).toBe(1);
  });
  it("a wedge tapers in a straight line from full height at the ribs to a point at the free edge", () => {
    expect(shapeFactor("triangle", 0)).toBe(1);
    expect(shapeFactor("triangle", 1)).toBeCloseTo(0, 12);
    expect(shapeFactor("triangle", 0.5)).toBeCloseTo(0.5, 12);
  });
  it("a rounded edge is full height next to the ribs, then rolls off to a quarter at the free edge", () => {
    expect(shapeFactor("round", 0)).toBe(1);
    expect(shapeFactor("round", 0.5)).toBe(1);
    expect(shapeFactor("round", 1)).toBeCloseTo(0.25, 12);
    // monotone: never taller as you move toward the free edge
    let last = 1;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const f = shapeFactor("round", Math.min(u, 1));
      expect(f).toBeLessThanOrEqual(last + 1e-12);
      last = f;
    }
  });
  it("is clamped: asking outside 0..1 gives the end values", () => {
    expect(shapeFactor("triangle", -1)).toBe(1);
    expect(shapeFactor("triangle", 2)).toBeCloseTo(0, 12);
  });
});

describe("edgeParts by shape", () => {
  for (const which of ["leadingEdge", "trailingEdge"] as const) {
    it(`${which}: carved part plus excess fill the block exactly, whatever the shape`, () => {
      // a round rod on the leading edge is not carved: its own tests are below
      for (const shape of (which === "leadingEdge" ? ["rectangle", "triangle"] : ["rectangle", "triangle", "round"]) as ("rectangle" | "triangle" | "round")[]) {
        const p = edgeParts(stock(shape), which, 230, foil)!;
        // a wedge on the nose comes to a point where the airfoil is round, so only check cover where the block can cover
        if (!(which === "leadingEdge" && shape === "triangle")) expect(p.uncoveredMm, `${shape} should be covered by a 40mm block`).toBe(0);
        const filled = area(p.shaped) + area(p.excess[0]) + area(p.excess[1]);
        // the block's own area from the profile, by the trapezoid rule on the same stations
        const xs = p.shaped.slice(0, p.shaped.length / 2).map((q) => q.x);
        let block = 0;
        for (let i = 1; i < xs.length; i++) {
          const u = (x: number) => (which === "leadingEdge" ? 1 - (x - xs[0]) / 14 : (x - xs[0]) / 14);
          const hh = (x: number) => 40 * shapeFactor(shape, u(x));
          block += ((hh(xs[i]) + hh(xs[i - 1])) / 2) * (xs[i] - xs[i - 1]);
        }
        expect(filled).toBeCloseTo(block, 4);
      }
    });
    it(`${which}: the thick side is the side that meets the ribs`, () => {
      const p = edgeParts(stock("triangle"), which, 230, foil)!;
      const top = p.excess[0];
      // the excess crescent above is bounded above by the block's top edge: its highest points are
      // at the rib side. Find the highest y among the first half (top edge points) and where it is.
      const edgePoints = top.slice(top.length / 2);
      const peak = edgePoints.reduce((a, q) => (q.y > a.y ? q : a));
      if (which === "leadingEdge") expect(peak.x).toBeGreaterThan(14 - 0.01);
      else expect(peak.x).toBeLessThan(230 - 14 + 0.01);
    });
  }

  it("a block that is a rectangle behaves exactly as before the shapes existed", () => {
    const p = edgeParts(stock("rectangle", 8, 24), "leadingEdge", 230, foil)!;
    expect(p.shaped.length).toBe(24);
    expect(p.uncoveredMm).toBe(0);
  });

  it("every ring has the same number of points whatever the shape and chord, so root and tip loft point for point", () => {
    for (const shape of ["rectangle", "triangle", "round"] as const) {
      const a = edgeParts(stock(shape), "trailingEdge", 230, foil)!;
      const b = edgeParts(stock(shape), "trailingEdge", 90, foil)!;
      expect(b.shaped.length).toBe(a.shaped.length);
      expect(b.excess[0].length).toBe(a.excess[0].length);
    }
  });

  it("a wedge or a block too low for the section is reported as too short, and a high enough one is not", () => {
    expect(edgeParts(stock("rectangle", 14, 2), "trailingEdge", 230, foil)!.uncoveredMm).toBeGreaterThan(0);
    expect(edgeParts(stock("triangle", 14, 2), "trailingEdge", 230, foil)!.uncoveredMm).toBeGreaterThan(0);
    expect(edgeParts(stock("triangle", 14, 30), "trailingEdge", 230, foil)!.uncoveredMm).toBe(0);
  });
});

describe("coverHeightMm by shape", () => {
  for (const which of ["leadingEdge", "trailingEdge"] as const) {
    it(`${which}: the fit height covers the section for every shape, and a smaller one does not`, () => {
      for (const shape of (which === "leadingEdge" ? ["rectangle"] : ["rectangle", "triangle", "round"]) as ("rectangle" | "triangle" | "round")[]) {
        const fit = coverHeightMm(stock(shape, 14, 1), which, 230, foil);
        expect(fit).toBeGreaterThan(0);
        expect(edgeParts(stock(shape, 14, fit + 0.001), which, 230, foil)!.uncoveredMm).toBe(0);
        expect(edgeParts(stock(shape, 14, fit - 0.5), which, 230, foil)!.uncoveredMm).toBeGreaterThan(0);
      }
    });
  }
  it("but it does when the section is thicker toward the free edge than at the ribs", () => {
    // an airfoil that is fat at the trailing edge: swap upper and lower surfaces' taper by hand
    const fat = { x: foil.x, yUpper: foil.x.map((x) => 0.05 + 0.1 * x), yLower: foil.x.map((x) => -0.05 - 0.1 * x) };
    const rect = coverHeightMm(stock("rectangle", 40, 1), "trailingEdge", 230, fat);
    const wedge = coverHeightMm(stock("triangle", 40, 1), "trailingEdge", 230, fat);
    expect(wedge).toBeGreaterThan(rect * 1.5);
  });

});

describe("a wedge comes to a point, set by its angle", () => {
  it("the angle and the height are two ways of saying the same thing", () => {
    expect(wedgeHeightMm(14, 30)).toBeCloseTo(2 * 14 * Math.tan((15 * Math.PI) / 180), 10);
    expect(wedgeAngleDeg(14, wedgeHeightMm(14, 24))).toBeCloseTo(24, 8);
    expect(wedgeAngleDeg(0, 5)).toBe(0);
  });
  it("on the trailing edge the block closes to nothing at the tail, on the mean line of the section", () => {
    const p = edgeParts({ ...stock("triangle", 14, wedgeHeightMm(14, 20)) }, "trailingEdge", 230, foil)!;
    const tail = p.block.filter((q) => q.x > 230 - 0.01);
    expect(tail).toHaveLength(2);
    expect(Math.abs(tail[0].y - tail[1].y)).toBeLessThan(1e-9); // the top and the bottom meet
  });
});

describe("a round rod on the leading edge", () => {
  const rod = (d: number, extra = {}) => ({ enabled: true, widthMm: d, heightMm: d, shape: "round" as const, ...extra });
  it("is a rod only on the leading edge", () => {
    expect(isRod(rod(6), "leadingEdge")).toBe(true);
    expect(isRod(rod(6), "trailingEdge")).toBe(false);
  });
  it("sits on the mean line of the section with its front at the nose, and is not carved", () => {
    const { cx, cy, r } = rodOf(rod(6), 230, foil);
    expect(r).toBe(3);
    expect(cx).toBeCloseTo(3, 10);
    expect(Math.abs(cy)).toBeLessThan(1); // the mean line near the nose of a NACA 2412 is close to zero
    const p = edgeParts(rod(6), "leadingEdge", 230, foil)!;
    expect(p.excess[0]).toHaveLength(0);
    expect(p.shaped.length).toBeGreaterThan(16);
    const xs = p.shaped.map((q) => q.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(6, 6);
  });
  it("can sit back from the nose and up or down, and the fit diameter is what touches both surfaces near the nose", () => {
    const a = rodOf(rod(6, { setbackMm: 2, offsetMm: 0.5 }), 230, foil);
    const b = rodOf(rod(6), 230, foil);
    expect(a.cx).toBeCloseTo(b.cx + 2, 10);
    expect(a.cy - b.cy).toBeGreaterThan(0.3); // the 0.5 mm up, less what the mean line does over the 2 mm
    // the rod that fits is the smallest that covers the nose: it just covers, and a little smaller does not
    const fit = fitRodDiameterMm(230, foil);
    expect(fit).toBeGreaterThan(6); // a NACA 2412 nose radius is about 3.7 mm, and a circle must be bigger than that to cover it
    expect(fit).toBeLessThan(16);
    expect(edgeParts(rod(fit + 0.01), "leadingEdge", 230, foil)!.uncoveredMm).toBeLessThan(0.02);
    expect(edgeParts(rod(fit - 1), "leadingEdge", 230, foil)!.uncoveredMm).toBeGreaterThan(0.05);
  });
  it("makes a round bite in every rib, and the rib begins at the middle of the rod", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.spars = [];
    p.trailingEdge.enabled = false;
    p.leadingEdge = { enabled: true, widthMm: 10, heightMm: 10, shape: "round" };
    const rib = rebuild(doc).ribs[2];
    const xs = rib.outline.flat().map((q) => q.x);
    expect(Math.min(...xs)).toBeCloseTo(5, 1); // not at the nose, and not a straight cut back by the full width either
    // the bite: the outline reaches further forward at the mean line than at the surfaces would a straight cut
    const rect = createProject();
    rect.wing.panels[0].spars = [];
    rect.wing.panels[0].trailingEdge.enabled = false;
    rect.wing.panels[0].leadingEdge = { enabled: true, widthMm: 10, heightMm: 24, shape: "rectangle" };
    const flat = rebuild(rect).ribs[2].outline.flat().map((q) => q.x);
    expect(Math.min(...flat)).toBeCloseTo(10, 1);
  });
});
