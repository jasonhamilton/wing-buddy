import { describe, expect, it } from "vitest";
import { toSurfaces } from "../airfoil";
import { sparPocket } from "../sparPocket";
import { naca4 } from "../../data/naca";
import { area, difference } from "../clipper";
import { sectionToPath } from "../rib";

const foil = toSurfaces(naca4("2412"));
const chord = 200;
const base = { side: "upper" as const, x0: 60, x1: 70, height: 3, flat: false, verticalCut: false };

describe("rectangular spar pocket", () => {
  it("is the surface moved inward along the front edge's normal, so the walls lean with the surface", () => {
    const p = sparPocket(foil, chord, base)!;
    const rib = difference([sectionToPath(foil, chord)], [p]);
    // depth of the cut measured along the normal is the spar height: the removed area is about width * height
    const removed = area(sectionToPath(foil, chord)) - rib.reduce((s, r) => s + area(r), 0);
    expect(removed).toBeGreaterThan(10 * 3 * 0.95);
    expect(removed).toBeLessThan(10 * 3 * 1.05);
  });
  it("vertical cut leaves a level floor at the higher edge minus the height", () => {
    const p = sparPocket(foil, chord, { ...base, verticalCut: true })!;
    const ys = p.filter((q) => q.y < 1000).map((q) => q.y);
    const floor = Math.min(...ys);
    const top = Math.max(...p.filter((q) => q.x >= 60 && q.x <= 70).map((q) => q.y));
    expect(floor).toBeLessThan(top - 3 + 1e-6 + 2);
    const bottoms = p.slice(p.length / 2).map((q) => q.y);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1e-9);
  });
  it("flat straightens the floor between its ends", () => {
    const wide = { ...base, x0: 20, x1: 120, flat: true };
    const p = sparPocket(foil, chord, wide)!;
    const floor = p.slice(p.length / 2).reverse();
    const a = floor[0];
    const b = floor[floor.length - 1];
    for (const q of floor) {
      const t = (q.x - a.x) / (b.x - a.x);
      expect(q.y).toBeCloseTo(a.y + (b.y - a.y) * t, 6);
    }
  });
  it("gives nothing when the spar is off the chord", () => {
    expect(sparPocket(foil, chord, { ...base, x0: 250, x1: 260 })).toBeNull();
  });
});
