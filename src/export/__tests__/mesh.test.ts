/**
 * OpenSCAD only accepts a polyhedron that is a closed surface with every face wound the same way.
 * The 3D members the viewer draws (spars, webbing, edge stock) are a soup of loose triangles with
 * no such promise, so before anything is exported they are welded, checked, and re-wound.
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "../../geometry";
import { seedProject } from "../../domain/seed";
import { buildMesh, meshReport } from "../mesh";

describe("buildMesh and meshReport", () => {
  it("a unit cube as 12 loose triangles becomes a closed, consistently wound mesh of volume 1", () => {
    const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
    const soup = f.flatMap((t) => t.flatMap((i) => v[i]));
    const m = buildMesh(soup);
    const r = meshReport(m);
    expect(r.closed).toBe(true);
    expect(r.consistent).toBe(true);
    expect(r.degenerate).toBe(0);
    expect(Math.abs(r.volume)).toBeCloseTo(1, 9);
  });
  it("scrambles the winding of half the faces and still comes out consistent", () => {
    const v = [[0,0,0],[2,0,0],[2,3,0],[0,3,0],[0,0,4],[2,0,4],[2,3,4],[0,3,4]];
    const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
    const flipped = f.map((t, i) => (i % 2 ? [t[0], t[2], t[1]] : t));
    const m = buildMesh(flipped.flatMap((t) => t.flatMap((i) => v[i])));
    const r = meshReport(m);
    expect(r.closed && r.consistent).toBe(true);
    expect(Math.abs(r.volume)).toBeCloseTo(24, 9);
  });
  it("drops zero-area triangles instead of passing them on", () => {
    const soup = [0,0,0, 1,0,0, 2,0,0, 0,0,0, 1,0,0, 0,1,0];
    expect(buildMesh(soup).faces.length).toBe(1);
  });
  it("reports a surface with a hole as not closed", () => {
    const soup = [0,0,0, 1,0,0, 0,1,0];
    expect(meshReport(buildMesh(soup)).closed).toBe(false);
  });
});

describe("every 3D member the app builds is a valid closed solid", () => {
  const result = rebuild(seedProject());
  const solids = result.solids.filter((s) => !s.kind.endsWith("Excess"));
  it("there are members to check", () => expect(solids.length).toBeGreaterThan(5));
  for (const kind of ["spar", "webbing", "leadingEdge", "trailingEdge"] as const) {
    it(`${kind}: closed, consistently wound, no degenerate faces, positive volume`, () => {
      const of = solids.filter((s) => s.kind === kind);
      if (of.length === 0) return;
      for (const s of of) {
        const r = meshReport(buildMesh(s.positions));
        expect(r.closed, `${s.id} closed`).toBe(true);
        expect(r.consistent, `${s.id} consistent`).toBe(true);
        expect(r.degenerate, `${s.id} degenerate`).toBe(0);
        expect(Math.abs(r.volume), `${s.id} volume`).toBeGreaterThan(1);
      }
    });
  }
  it("the main spar's caps have the volume of the bars they are: width x height x length, to a few percent", () => {
    const doc = seedProject();
    const main = doc.wing.panels[0].spars[0];
    const caps = rebuild(doc).solids.filter((s) => s.id.startsWith(main.id));
    const vol = caps.reduce((a, s) => a + Math.abs(meshReport(buildMesh(s.positions)).volume), 0);
    // two caps, each 8 wide x 3 high x 420 long, give or take the dihedral
    expect(vol).toBeGreaterThan(2 * 8 * 3 * 410);
    expect(vol).toBeLessThan(2 * 8 * 3 * 430);
  });
  it("the edge-stock excess is not exported: it is what gets carved away", () => {
    expect(solids.some((s) => s.kind.endsWith("Excess"))).toBe(false);
  });
});

describe("edge stock that is too short, or shaped, is still a valid solid", () => {
  for (const shape of ["rectangle", "triangle", "round"] as const) {
    for (const height of [4, 9, 40]) {
      it(`${shape}, ${height}mm tall`, () => {
        const doc = seedProject();
        for (const p of doc.wing.panels) {
          p.leadingEdge = { enabled: true, widthMm: 10, heightMm: height, shape };
          p.trailingEdge = { enabled: true, widthMm: 14, heightMm: height, shape };
        }
        const solids = rebuild(doc).solids.filter((s) => (s.kind === "leadingEdge" || s.kind === "trailingEdge"));
        expect(solids.length).toBe(4);
        for (const s of solids) {
          const r = meshReport(buildMesh(s.positions));
          expect(r.closed, `${s.id} closed`).toBe(true);
          expect(r.consistent, `${s.id} consistent`).toBe(true);
          expect(r.degenerate).toBe(0);
          expect(r.volume).toBeLessThan(0);
        }
      });
    }
  }
});
