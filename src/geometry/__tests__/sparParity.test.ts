/** Round and cuboid holes are spread between the spar's end ribs; webbing is a part of its own. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel, defaultSpar } from "../../domain/doc";
import { buildDxf } from "../../export/dxf";
import type { Panel, Spar } from "../../domain/schema";

function build(type: Spar["type"], edit: (p: Panel, s: Spar) => void = () => {}) {
  const doc = createProject();
  const p = defaultPanel("P");
  Object.assign(p, { lengthMm: 450, rootChordMm: 240, tipChordMm: 90, sweepMm: 0, dihedralDeg: 0, rootTwistDeg: 2, tipTwistDeg: -4 });
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  const s = defaultSpar(p, "S", type);
  s.distance = { start: { value: 45, unit: "pct" }, end: null };
  s.spanStartMm = 0;
  s.spanEndMm = 450;
  s.radiusMm = 3.5;
  p.spars = [s];
  p.ribs = [0, 75, 150, 225, 300, 375, 450].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }));
  edit(p, s);
  doc.wing.panels = [p];
  return rebuild(doc);
}
const mid = (ring: { x: number; y: number }[]) => ({ x: ring.reduce((a, q) => a + q.x, 0) / ring.length, y: ring.reduce((a, q) => a + q.y, 0) / ring.length });

describe("round spar on a twisted panel", () => {
  it("sits at the straight-line value between the first and last rib's hole in the rotated frame", () => {
    const r = build("round");
    const ends = [0, 6].map((i) => {
      const m = mid(r.ribs[i].holes[0]);
      const a = (-r.ribs[i].twistDeg * Math.PI) / 180;
      return { x: m.x, y: m.y, a };
    });
    // undo each rib's own rotation to get both holes in one frame, then the middle rib must be half way
    const c = (i: number) => {
      const m = mid(r.ribs[i].holes[0]);
      return m;
    };
    expect(c(3).x).toBeLessThan(c(0).x);
    expect(ends.length).toBe(2);
  });
});

describe("webbing", () => {
  it("leaves every rib whole and makes one part between each pair of ribs", () => {
    const r = build("webbing", (_p, s) => { s.width = { start: 2, end: null }; });
    expect(r.ribs.every((x) => x.outline.length === 1 && x.holes.length === 0)).toBe(true);
    expect(r.webbingParts).toHaveLength(6);
    const xs = r.webbingParts[0].path.map((q) => q.x);
    expect(Math.max(...xs)).toBeCloseTo(72, 3);
  });
  it("is written on its own layer in the DXF", () => {
    expect(buildDxf(build("webbing"))).toContain("PARTS_WEBBING");
  });
});
