/**
 * Standard lightening holes: holes cut through the rib web between its spars, kept clear of the nose, the
 * tail, the surfaces and every spar, with a strip of material left between one hole and the next.
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject, defaultPanel, defaultSpar } from "../../domain/doc";
import type { Panel, ProjectDoc } from "../../domain/schema";
import { surfaceAt } from "../airfoil";
import { area, signedArea } from "../clipper";
import { lighteningHoles } from "../lightening";

const CHORD = 200;
const foil = resolveSurfaces("naca-0012", [])!;

function wing(edit: (p: Panel) => void): ProjectDoc {
  const doc = createProject();
  const p = defaultPanel("P");
  p.lengthMm = 200;
  p.rootChordMm = CHORD;
  p.tipChordMm = CHORD;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.rootTwistDeg = 0;
  p.tipTwistDeg = 0;
  p.rootAirfoilId = "naca-0012";
  p.tipAirfoilId = null;
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.spars = [];
  p.ribs = [0, 100, 200].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }));
  p.lighteningHoles = { ...p.lighteningHoles, type: "standard", roundCorners: false };
  edit(p);
  doc.wing.panels = [p];
  return doc;
}
const holesOf = (doc: ProjectDoc, rib = 1) => rebuild(doc).ribs[rib].holes;
const xr = (h: { x: number }[]) => ({ x0: Math.min(...h.map((p) => p.x)), x1: Math.max(...h.map((p) => p.x)) });
const yr = (h: { y: number }[]) => ({ y0: Math.min(...h.map((p) => p.y)), y1: Math.max(...h.map((p) => p.y)) });

describe("standard lightening holes", () => {
  it("none: no holes", () => {
    expect(holesOf(wing((p) => (p.lighteningHoles.type = "none")))).toHaveLength(0);
  });
  it("a rib with no spars gets holes between the nose and tail margins", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { minDistanceFromLEMm: 20, minDistanceFromTEMm: 30 })));
    expect(hs.length).toBeGreaterThan(0);
    const all = hs.flatMap((h) => h);
    expect(Math.min(...all.map((q) => q.x))).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(Math.max(...all.map((q) => q.x))).toBeLessThanOrEqual(CHORD - 30 + 1e-6);
  });
  it("holes stay the edge distance inside both surfaces", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { distanceFromEdgeMm: 3 })));
    for (const h of hs)
      for (const q of h) {
        const s = surfaceAt(foil, q.x / CHORD);
        expect(q.y).toBeLessThanOrEqual(s.upper * CHORD - 3 + 0.05);
        expect(q.y).toBeGreaterThanOrEqual(s.lower * CHORD + 3 - 0.05);
      }
  });
  it("no hole is wider than the maximum, and none narrower than the minimum", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { minWidthMm: 12, maxWidthMm: 25 })));
    expect(hs.length).toBeGreaterThan(2);
    for (const h of hs) {
      const { x0, x1 } = xr(h);
      expect(x1 - x0).toBeLessThanOrEqual(25 + 1e-6);
      expect(x1 - x0).toBeGreaterThanOrEqual(12 - 1e-6);
    }
  });
  it("adjacent holes are at least the minimum distance apart", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { minDistanceMm: 7, maxWidthMm: 20 })))
      .map(xr)
      .sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < hs.length; i++) expect(hs[i].x0 - hs[i - 1].x1).toBeGreaterThanOrEqual(7 - 1e-6);
  });
  it("keeps clear of a spar by its support width, on both sides", () => {
    const doc = wing((p) => {
      const s = defaultSpar(p, "Main", "rectangle");
      s.distanceFrom = "LE";
      s.distance = { start: { unit: "pct", value: 30 }, end: null };
      s.width = { start: 6, end: null };
      s.spanStartMm = 0;
      s.spanEndMm = 200;
      p.spars = [s];
      Object.assign(p.lighteningHoles, { supportWidthMm: 5 });
    });
    const hs = holesOf(doc).map(xr);
    expect(hs.length).toBeGreaterThan(1);
    for (const { x0, x1 } of hs) {
      const overlapsSparZone = x1 > 60 - 3 - 5 + 1e-6 && x0 < 60 + 3 + 5 - 1e-6;
      expect(overlapsSparZone).toBe(false);
    }
    expect(hs.some((h) => h.x1 <= 52 + 1e-6)).toBe(true);
    expect(hs.some((h) => h.x0 >= 68 - 1e-6)).toBe(true);
  });
  it("stays out of leading-edge and trailing-edge stock", () => {
    const doc = wing((p) => {
      p.leadingEdge.enabled = true;
      p.leadingEdge.widthMm = 15;
      p.trailingEdge.enabled = true;
      p.trailingEdge.widthMm = 20;
      Object.assign(p.lighteningHoles, { minDistanceFromLEMm: 0, minDistanceFromTEMm: 0, supportWidthMm: 2 });
    });
    const all = holesOf(doc).flatMap((h) => h);
    expect(Math.min(...all.map((q) => q.x))).toBeGreaterThanOrEqual(15 + 2 - 1e-6);
    expect(Math.max(...all.map((q) => q.x))).toBeLessThanOrEqual(CHORD - 20 - 2 + 1e-6);
  });
  it("sheeting: the edge distance is measured from the surface under the sheet", () => {
    const base = holesOf(wing((p) => Object.assign(p.lighteningHoles, { distanceFromEdgeMm: 2, minDistanceFromLEMm: 5 })));
    const sheeted = holesOf(
      wing((p) => {
        Object.assign(p.lighteningHoles, { distanceFromEdgeMm: 2, minDistanceFromLEMm: 5 });
        p.sheeting = { type: "standard", standardLength: { unit: "pct", value: 100 }, standardThicknessMm: 1.5, strips: [] };
      }),
    );
    const maxY = (hs: { y: number }[][]) => Math.max(...hs.flatMap((h) => h.map((q) => q.y)));
    expect(maxY(base) - maxY(sheeted)).toBeGreaterThan(1);
  });
  it("round corners: more points, smaller area, same footprint at most", () => {
    const sharp = holesOf(wing(() => {}));
    const round = holesOf(wing((p) => Object.assign(p.lighteningHoles, { roundCorners: true, roundnessPct: 40, smoothnessPoints: 6 })));
    expect(round.length).toBe(sharp.length);
    expect(round[0].length).toBeGreaterThan(sharp[0].length);
    expect(area(round[0])).toBeLessThan(area(sharp[0]));
    const a = xr(sharp[0]);
    const b = xr(round[0]);
    expect(b.x0).toBeGreaterThanOrEqual(a.x0 - 1e-6);
    expect(b.x1).toBeLessThanOrEqual(a.x1 + 1e-6);
  });
  it("holes are clockwise like other voids, and well formed", () => {
    for (const h of holesOf(wing(() => {}))) {
      expect(signedArea(h)).toBeLessThan(0);
      const { y0, y1 } = yr(h);
      expect(y1 - y0).toBeGreaterThan(1);
    }
  });
  it("a rib too small for any hole just gets none", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { minWidthMm: 500 })));
    expect(hs).toHaveLength(0);
  });
  it("a rib thinner than the edge margins gets none, and the tail end where it is too thin is skipped", () => {
    const hs = holesOf(wing((p) => Object.assign(p.lighteningHoles, { distanceFromEdgeMm: 8 })));
    for (const h of hs) expect(xr(h).x1).toBeLessThan(CHORD * 0.9);
  });
  it("works at the tip where the chord is smaller and the wing is twisted", () => {
    const doc = wing((p) => {
      p.tipChordMm = 120;
      p.tipTwistDeg = 3;
    });
    const r = rebuild(doc);
    expect(r.ribs[2].holes.length).toBeGreaterThan(0);
    expect(r.ribs[0].holes.length).toBeGreaterThanOrEqual(r.ribs[2].holes.length);
  });
  it("lighteningHoles on its own returns nothing for type none", () => {
    const p = wing((q) => (q.lighteningHoles.type = "none")).wing.panels[0];
    expect(lighteningHoles(p, CHORD, foil, [], [])).toEqual([]);
  });
});
