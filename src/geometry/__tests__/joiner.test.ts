/** A joiner is one straight rod through the panel: the ribs find it where sweep and dihedral put it. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel, defaultSpar } from "../../domain/doc";
import type { Panel } from "../../domain/schema";

function holeCentres(edit: (p: Panel) => void) {
  const doc = createProject();
  const p = defaultPanel("P");
  Object.assign(p, { lengthMm: 600, rootChordMm: 200, tipChordMm: 120, sweepMm: 60, dihedralDeg: 0, rootTwistDeg: 0, tipTwistDeg: 0 });
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  const s = defaultSpar(p, "J", "roundJoiner");
  s.distance.start = { value: 30, unit: "pct" };
  s.spanStartMm = 0;
  s.spanEndMm = 600;
  s.radiusMm = 3;
  p.spars = [s];
  p.ribs = [0, 100, 200, 300, 400, 500, 600].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }));
  edit(p);
  doc.wing.panels = [p];
  return rebuild(doc).ribs.map((r) => {
    const h = r.holes[0];
    return h ? { x: h.reduce((a, q) => a + q.x, 0) / h.length, y: h.reduce((a, q) => a + q.y, 0) / h.length } : null;
  });
}

describe("joiner rod", () => {
  it("starts at the percentage of the first rib's chord and falls back by the sweep, ignoring the taper", () => {
    const c = holeCentres(() => {});
    expect(c[0]!.x).toBeCloseTo(60, 1);
    expect(c[3]!.x).toBeCloseTo(30, 1);
  });
  it("does not move in height with dihedral at the middle of its run, and rises towards the root with positive dihedral", () => {
    const flat = holeCentres(() => {});
    const dih = holeCentres((p) => { p.dihedralDeg = 2; });
    expect(dih[3]!.y).toBeCloseTo(flat[3]!.y, 1);
    expect(dih[1]!.y).toBeGreaterThan(flat[1]!.y);
  });
});
