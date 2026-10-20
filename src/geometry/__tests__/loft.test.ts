/**
 * The 3D view draws ribs and lofted bars separately. If they disagree in world
 * space the spars float off their notches and the edge stock drifts from the rib.
 * These tests compare the two in wing coordinates, at a tip with twist and dihedral.
 */
import { describe, expect, it } from "vitest";
import { edgeFitHeightMm, rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { edgeParts } from "../edgeStock";
import { seedProject } from "../../domain/seed";
import type { RibGeometry, Solid } from "../types";

const TOL = 0.5; // mm. Ribs stop a fraction short of the panel end (half a rib thickness).

function worldOutline(rib: RibGeometry): [number, number, number][] {
  const c = Math.cos(rib.dihedralRad);
  const s = Math.sin(rib.dihedralRad);
  return rib.outline.flat().map((p) => [rib.origin[0] + p.x, rib.origin[1] + p.y * c, rib.origin[2] - p.y * s]);
}

function verticesAtEnd(solid: Solid, end: "min" | "max"): [number, number, number][] {
  const v: [number, number, number][] = [];
  for (let i = 0; i < solid.positions.length; i += 3) {
    v.push([solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]]);
  }
  const zs = v.map((p) => p[2]);
  const z = end === "max" ? Math.max(...zs) : Math.min(...zs);
  // the panel's own end only: z moves a little with dihedral across the section
  return v.filter((p) => Math.abs(p[2] - z) < 25 * Math.sin(0.12));
}

const nearest = (p: [number, number, number], pts: [number, number, number][]) =>
  Math.min(...pts.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));

describe("lofted members agree with the ribs in world space", () => {
  const doc = seedProject();
  const result = rebuild(doc);
  const outer = doc.wing.panels[1];
  const tipRib = result.ribs.filter((r) => r.panelId === outer.id).at(-1)!;
  const tipOutline = worldOutline(tipRib);

  it("the seed's outer panel really is twisted and tilted (guards the test itself)", () => {
    expect(outer.tipTwistDeg).not.toBe(0);
    expect(outer.dihedralDeg).toBeGreaterThan(3);
  });

  it("the trailing-edge stock meets the rib's trailing-edge cut at the tip", () => {
    const stock = result.solids.filter((s) => s.panelId === outer.id && s.kind === "trailingEdge");
    expect(stock.length).toBeGreaterThan(0);
    // the stock's forward face is the plane the rib was cut at
    const tip = stock.flatMap((s) => verticesAtEnd(s, "max"));
    const faceX = Math.min(...tip.map((p) => p[0]));
    const face = tip.filter((p) => Math.abs(p[0] - faceX) < 0.01);
    expect(face.length).toBeGreaterThan(0);
    for (const p of face) expect(nearest(p, tipOutline)).toBeLessThan(TOL);
  });

  it("the leading-edge stock meets the rib's leading-edge cut at the tip", () => {
    const stock = result.solids.filter((s) => s.panelId === outer.id && s.kind === "leadingEdge");
    expect(stock.length).toBeGreaterThan(0);
    const tip = stock.flatMap((s) => verticesAtEnd(s, "max"));
    const faceX = Math.max(...tip.map((p) => p[0]));
    const face = tip.filter((p) => Math.abs(p[0] - faceX) < 0.01);
    expect(face.length).toBeGreaterThan(0);
    for (const p of face) expect(nearest(p, tipOutline)).toBeLessThan(TOL);
  });

  it("each spar cap's corners land on the rib's notch at the tip", () => {
    const spar = outer.spars[0];
    const caps = result.solids.filter((s) => s.id.startsWith(spar.id));
    expect(caps.length).toBe(2);
    for (const cap of caps) {
      for (const p of verticesAtEnd(cap, "max")) expect(nearest(p, tipOutline)).toBeLessThan(TOL);
    }
  });

  it("the same holds at the root of the inner panel, where nothing is twisted", () => {
    const inner = doc.wing.panels[0];
    const rootRib = result.ribs.filter((r) => r.panelId === inner.id)[0];
    const outline = worldOutline(rootRib);
    const caps = result.solids.filter((s) => s.id.startsWith(inner.spars[0].id));
    for (const cap of caps) for (const p of verticesAtEnd(cap, "min")) expect(nearest(p, outline)).toBeLessThan(TOL);
  });
});

describe("edge stock is a block with a carved part and an excess", () => {
  const doc = seedProject();
  const result = rebuild(doc);

  it("makes three solids per edge: the shaped part and the excess above and below", () => {
    for (const panel of doc.wing.panels) {
      const mine = result.solids.filter((s) => s.panelId === panel.id);
      expect(mine.filter((s) => s.kind === "leadingEdge")).toHaveLength(1);
      expect(mine.filter((s) => s.kind === "leadingEdgeExcess")).toHaveLength(2);
      expect(mine.filter((s) => s.kind === "trailingEdge")).toHaveLength(1);
      expect(mine.filter((s) => s.kind === "trailingEdgeExcess")).toHaveLength(2);
    }
  });

  it("the default seed stock covers its airfoil, so there is nothing to warn about", () => {
    expect(result.warnings.filter((w) => /too low to cover/.test(w.message))).toEqual([]);
  });

  it("a block that is too short is reported, with how far short", () => {
    const d = seedProject();
    d.wing.panels[0].leadingEdge.heightMm = 4;
    const w = rebuild(d).warnings.find((x) => /leading edge stock is .* too low/.test(x.message));
    expect(w).toBeDefined();
    expect(Number(/is ([\d.]+)mm/.exec(w!.message)![1])).toBeGreaterThan(3);
  });

  it("the shaped part and the excess together fill the block exactly, with no gap and no overlap", () => {
    const surfaces = resolveSurfaces("naca-2412", [])!;
    const area = (ring: { x: number; y: number }[]) =>
      Math.abs(ring.reduce((a, p, i) => a + (p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y), 0)) / 2;
    for (const which of ["leadingEdge", "trailingEdge"] as const) {
      const edge = { enabled: true, widthMm: 10, heightMm: 30, shape: "rectangle" as const };
      const parts = edgeParts(edge, which, 230, surfaces)!;
      expect(parts.uncoveredMm).toBe(0);
      // sampled at 12 stations, the carved outline is a polyline: tight, not exact
      expect(area(parts.shaped) + area(parts.excess[0]) + area(parts.excess[1])).toBeCloseTo(10 * 30, 6);
    }
  });

  it("every ring has the same number of points at any chord, so root and tip loft point for point", () => {
    const surfaces = resolveSurfaces("naca-2412", [])!;
    const edge = { enabled: true, widthMm: 8, heightMm: 24, shape: "rectangle" as const };
    const a = edgeParts(edge, "leadingEdge", 230, surfaces)!;
    const b = edgeParts(edge, "leadingEdge", 90, surfaces)!;
    expect(b.shaped.length).toBe(a.shaped.length);
    expect(b.excess[0].length).toBe(a.excess[0].length);
    expect(b.excess[1].length).toBe(a.excess[1].length);
  });

  it("Fit to airfoil returns a height that leaves nothing uncovered, and no more", () => {
    const d = seedProject();
    const panel = d.wing.panels[0];
    const fit = edgeFitHeightMm(d, panel.id, "leadingEdge")!;
    expect(fit).toBeGreaterThan(8);
    panel.leadingEdge.heightMm = fit + 0.01;
    expect(rebuild(d).warnings.filter((w) => /too low/.test(w.message))).toEqual([]);
    panel.leadingEdge.heightMm = fit - 0.5;
    expect(rebuild(d).warnings.filter((w) => /too low/.test(w.message)).length).toBe(1);
  });
});
