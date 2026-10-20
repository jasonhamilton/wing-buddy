/** Building tabs stand at one flat level set by the highest and lowest point of any rib, not just the root. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel } from "../../domain/doc";

describe("building tab level", () => {
  it("uses the lowest point of the whole panel when the tip twists down", () => {
    const doc = createProject();
    const p = defaultPanel("P");
    Object.assign(p, { lengthMm: 600, rootChordMm: 180, tipChordMm: 140, sweepMm: 100, dihedralDeg: 0, rootTwistDeg: -1, tipTwistDeg: 3 });
    p.leadingEdge.enabled = false;
    p.trailingEdge.enabled = false;
    p.spars = [];
    p.buildingTabs = { ...p.buildingTabs, enabled: true, above: true, below: true, fore: true, aft: true, holes: false, extendMm: 4 };
    doc.wing.panels = [p];
    const heights = rebuild(doc).ribs.map((r) => {
      const ys = r.outline.flat().map((q) => q.y);
      return Math.max(...ys) - Math.min(...ys);
    });
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 3);
    expect(heights[0]).toBeGreaterThan(25);
  });
});
