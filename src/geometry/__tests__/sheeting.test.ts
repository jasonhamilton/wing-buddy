/**
 * Sheeting: thin sheets glued over the ribs. Each strip covers a chordwise band on the top and/or the bottom
 * surface, for a run of ribs. Under it the rib is cut back by the sheet's thickness, so the finished wing is
 * the airfoil and not the airfoil plus a layer.
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject, defaultPanel } from "../../domain/doc";
import type { Panel, ProjectDoc } from "../../domain/schema";
import { surfaceAt } from "../airfoil";
import { bandRing, bandsAt, defaultStrip } from "../sheeting";
import { buildMesh, meshReport } from "../../export/mesh";

const CHORD = 200;
const foil = resolveSurfaces("naca-0012", [])!;

function wing(edit: (p: Panel) => void, ribs = 3): ProjectDoc {
  const doc = createProject();
  const p = defaultPanel("P");
  p.lengthMm = 100 * (ribs - 1);
  p.rootChordMm = CHORD;
  p.tipChordMm = CHORD;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.rootAirfoilId = "naca-0012";
  p.tipAirfoilId = null;
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.spars = [];
  p.ribs = Array.from({ length: ribs }, (_, i) => ({ id: `r${i}`, positionMm: i * 100, thicknessMm: 3 }));
  edit(p);
  doc.wing.panels = [p];
  return doc;
}
const strip = (p: Panel, patch: Partial<ReturnType<typeof defaultStrip>> = {}) => {
  p.sheeting.type = "advanced";
  p.sheeting.strips.push({ ...defaultStrip(p, "Main"), ...patch });
};
/** Vertical extent of a rib's material along x: top and bottom. */
const extent = (doc: ProjectDoc, rib: number, x: number) => {
  const ys: number[] = [];
  for (const r of rebuild(doc).ribs[rib].outline)
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  return { top: Math.max(...ys), bottom: Math.min(...ys) };
};
const surf = (x: number) => ({ top: surfaceAt(foil, x / CHORD).upper * CHORD, bottom: surfaceAt(foil, x / CHORD).lower * CHORD });

describe("bandsAt: which part of the chord a strip covers", () => {
  const p = (edit: (p: Panel) => void) => wing(edit).wing.panels[0];
  it("from the leading edge: a distance in, then a length", () => {
    const pan = p((q) => strip(q, { startingAt: "LE", distance: { start: { unit: "pct", value: 10 }, end: null }, length: { start: { unit: "pct", value: 30 }, end: null } }));
    const [b] = bandsAt(pan, CHORD, 0, 0);
    expect(b.x0).toBeCloseTo(20, 9);
    expect(b.x1).toBeCloseTo(80, 9);
  });
  it("from the trailing edge: the distance and length are measured back from the tail", () => {
    const pan = p((q) => strip(q, { startingAt: "TE", distance: { start: { unit: "pct", value: 10 }, end: null }, length: { start: { unit: "pct", value: 30 }, end: null } }));
    const [b] = bandsAt(pan, CHORD, 0, 0);
    expect(b.x1).toBeCloseTo(180, 9);
    expect(b.x0).toBeCloseTo(120, 9);
  });
  it("millimetres and percentages both work, and percentages follow the chord", () => {
    const pan = p((q) => strip(q, { distance: { start: { unit: "mm", value: 12 }, end: null }, length: { start: { unit: "pct", value: 50 }, end: null } }));
    expect(bandsAt(pan, 200, 0, 0)[0]).toMatchObject({ x0: 12, x1: 112 });
    expect(bandsAt(pan, 100, 0, 0)[0]).toMatchObject({ x0: 12, x1: 62 });
  });
  it("a separate end value moves the band along the span", () => {
    const pan = p((q) => strip(q, { distance: { start: { unit: "pct", value: 0 }, end: { unit: "pct", value: 10 } }, length: { start: { unit: "pct", value: 20 }, end: { unit: "pct", value: 40 } } }));
    const root = bandsAt(pan, 200, 0, 0)[0];
    const tip = bandsAt(pan, 200, 1, 200)[0];
    expect(root).toMatchObject({ x0: 0, x1: 40 });
    expect(tip.x0).toBeCloseTo(20, 9);
    expect(tip.x1).toBeCloseTo(100, 9);
  });
  it("only ribs inside the strip's span are covered", () => {
    const pan = p((q) => strip(q, { spanStartMm: 50, spanEndMm: 150 }));
    expect(bandsAt(pan, 200, 0, 0)).toHaveLength(0);
    expect(bandsAt(pan, 200, 0.5, 100)).toHaveLength(1);
    expect(bandsAt(pan, 200, 1, 200)).toHaveLength(0);
  });
  it("a band is clamped to the chord, and one with no length is dropped", () => {
    const pan = p((q) => strip(q, { distance: { start: { unit: "pct", value: 80 }, end: null }, length: { start: { unit: "pct", value: 50 }, end: null } }));
    expect(bandsAt(pan, 200, 0, 0)[0].x1).toBe(200);
    const none = p((q) => strip(q, { length: { start: { unit: "mm", value: 0 }, end: null } }));
    expect(bandsAt(none, 200, 0, 0)).toHaveLength(0);
  });
  it("standard sheeting is one band from the leading edge on both surfaces", () => {
    const pan = p((q) => {
      q.sheeting.type = "standard";
      q.sheeting.standardLength = { unit: "pct", value: 30 };
      q.sheeting.standardThicknessMm = 2;
    });
    const [b] = bandsAt(pan, 200, 0.3, 30);
    expect(b).toMatchObject({ x0: 0, x1: 60, above: true, below: true, thicknessMm: 2 });
  });
  it("no sheeting gives no bands, and strips are ignored unless the type is advanced", () => {
    const pan = p((q) => {
      strip(q);
      q.sheeting.type = "none";
    });
    expect(bandsAt(pan, 200, 0, 0)).toHaveLength(0);
  });
});

describe("sheeting and edge stock", () => {
  const edges = (q: Panel) => {
    q.leadingEdge.enabled = true;
    q.leadingEdge.widthMm = 15;
    q.trailingEdge.enabled = true;
    q.trailingEdge.widthMm = 20;
  };
  it("a strip is cut back to start after the leading edge stock and stop before the trailing edge stock", () => {
    const pan = wing((q) => { edges(q); strip(q, { distance: { start: { unit: "pct", value: 0 }, end: null }, length: { start: { unit: "pct", value: 100 }, end: null } }); }).wing.panels[0];
    const [b] = bandsAt(pan, CHORD, 0, 0);
    expect(b.x0).toBeCloseTo(15, 9);
    expect(b.x1).toBeCloseTo(CHORD - 20, 9);
  });
  it("standard sheeting starts after the leading edge stock", () => {
    const pan = wing((q) => { edges(q); q.sheeting.type = "standard"; q.sheeting.standardLength = { unit: "pct", value: 30 }; }).wing.panels[0];
    expect(bandsAt(pan, CHORD, 0, 0)[0].x0).toBeCloseTo(15, 9);
  });
  it("a strip lying wholly inside the stock disappears", () => {
    const pan = wing((q) => { edges(q); strip(q, { length: { start: { unit: "mm", value: 10 }, end: null } }); }).wing.panels[0];
    expect(bandsAt(pan, CHORD, 0, 0)).toHaveLength(0);
  });
  it("disabled stock does not limit the sheet", () => {
    const pan = wing((q) => { edges(q); q.leadingEdge.enabled = false; strip(q); }).wing.panels[0];
    expect(bandsAt(pan, CHORD, 0, 0)[0].x0).toBe(0);
  });
  it("the sheet solid stays out of the stock too", () => {
    const d = wing((q) => { edges(q); strip(q, { length: { start: { unit: "pct", value: 100 }, end: null } }); });
    const xs = rebuild(d).solids.filter((s) => s.kind === "sheeting").flatMap((s) => s.positions.filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(15 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(CHORD - 20 + 1e-6);
  });
});

describe("the rib under a strip", () => {
  const top = (x: number) => surf(x).top;
  it("is cut back by the sheet's thickness on the top, and only where the strip is", () => {
    const d = wing((q) => strip(q, { thicknessMm: 1.5, applyAbove: true, applyBelow: false, distance: { start: { unit: "pct", value: 20 }, end: null }, length: { start: { unit: "pct", value: 40 }, end: null } }));
    const inside = extent(d, 1, 100);
    expect(top(100) - inside.top).toBeGreaterThan(1.45);
    expect(top(100) - inside.top).toBeLessThan(1.65);
    expect(inside.bottom).toBeCloseTo(surf(100).bottom, 2); // bottom surface untouched
    const outside = extent(d, 1, 150); // beyond the band (40..120)
    expect(outside.top).toBeCloseTo(top(150), 2);
  });
  it("only on the bottom, when the strip is applied below", () => {
    const d = wing((q) => strip(q, { thicknessMm: 2, applyAbove: false, applyBelow: true }));
    const e = extent(d, 1, 30); // inside the default band, which runs 0 to 54mm
    expect(e.top).toBeCloseTo(surf(30).top, 2);
    expect(surf(30).bottom - e.bottom).toBeLessThan(-1.9); // bottom is 2mm higher than the airfoil's
  });
  it("on both surfaces, the rib is thinner by twice the thickness", () => {
    const d = wing((q) => strip(q, { thicknessMm: 1, applyAbove: true, applyBelow: true }));
    const e = extent(d, 1, 30);
    expect(e.top - e.bottom).toBeCloseTo(surf(30).top - surf(30).bottom - 2, 1);
  });
  it("ribs outside the strip's span are left whole", () => {
    const d = wing((q) => strip(q, { spanStartMm: 40, spanEndMm: 160 }), 3);
    expect(extent(d, 0, 30).top).toBeCloseTo(surf(30).top, 2);
    expect(extent(d, 2, 30).top).toBeCloseTo(surf(30).top, 2);
    expect(surf(30).top - extent(d, 1, 30).top).toBeGreaterThan(1.4);
  });
  it("a cap strip trims the rib just the same as a sheet", () => {
    const a = wing((q) => strip(q, { capStrip: false, thicknessMm: 1.5 }));
    const b = wing((q) => strip(q, { capStrip: true, thicknessMm: 1.5 }));
    expect(extent(b, 1, 100).top).toBeCloseTo(extent(a, 1, 100).top, 6);
  });
  it("two strips on the same surface stack: the rib is cut back by both", () => {
    const d = wing((q) => {
      strip(q, { thicknessMm: 1, applyBelow: false });
      strip(q, { thicknessMm: 1.5, applyBelow: false });
    });
    expect(surf(30).top - extent(d, 1, 30).top).toBeGreaterThan(2.4);
  });
  it("the sheet is part of the finished surface: rib area falls by about thickness x band length", () => {
    const area = (doc: ProjectDoc) => rebuild(doc).ribs[1].outline.reduce((s, r) => s + Math.abs(r.reduce((a, p, k) => a + (p.x * r[(k + 1) % r.length].y - r[(k + 1) % r.length].x * p.y), 0)) / 2, 0);
    const none = area(wing(() => undefined));
    const one = area(wing((q) => strip(q, { thicknessMm: 1, applyAbove: true, applyBelow: false, distance: { start: { unit: "pct", value: 30 }, end: null }, length: { start: { unit: "pct", value: 40 }, end: null } })));
    expect(none - one).toBeGreaterThan(0.9 * 80);
    expect(none - one).toBeLessThan(1.15 * 80);
  });
  it("is cut before the spar pockets, so a spar still sits in its notch", () => {
    const d = wing((q) => {
      strip(q, { thicknessMm: 1.5 });
    });
    expect(rebuild(d).ribs).toHaveLength(3);
    expect(rebuild(d).warnings.filter((w) => w.level === "error")).toEqual([]);
  });
});

describe("the sheet as a solid", () => {
  it("a continuous strip is one closed solid per surface, running the length of its span", () => {
    const d = wing((q) => strip(q, { thicknessMm: 1.5, applyAbove: true, applyBelow: true }));
    const solids = rebuild(d).solids.filter((s) => s.kind === "sheeting");
    expect(solids).toHaveLength(2);
    for (const s of solids) {
      const r = meshReport(buildMesh(s.positions));
      expect(r.closed && r.consistent).toBe(true);
      expect(r.degenerate).toBe(0);
      expect(r.volume).toBeLessThan(0);
    }
  });
  it("its volume is about thickness x band length x span", () => {
    const d = wing((q) => strip(q, { thicknessMm: 1.5, applyAbove: true, applyBelow: false, distance: { start: { unit: "pct", value: 20 }, end: null }, length: { start: { unit: "pct", value: 40 }, end: null } }));
    const [s] = rebuild(d).solids.filter((x) => x.kind === "sheeting");
    const v = Math.abs(meshReport(buildMesh(s.positions)).volume);
    expect(v).toBeGreaterThan(0.95 * 1.5 * 80 * 200);
    expect(v).toBeLessThan(1.2 * 1.5 * 80 * 200); // a curved surface is a little longer than its chord
  });
  it("a cap strip is one narrow slab per rib instead, each a little wider than its rib, and not past the panel's ends", () => {
    const d = wing((q) => strip(q, { capStrip: true, thicknessMm: 1.5, applyAbove: true, applyBelow: false }), 3);
    const solids = rebuild(d).solids.filter((s) => s.kind === "sheeting");
    expect(solids).toHaveLength(3);
    const widths = solids.map((s) => {
      const zs: number[] = [];
      for (let i = 2; i < s.positions.length; i += 3) zs.push(s.positions[i]);
      return Math.max(...zs) - Math.min(...zs);
    });
    // a 3mm rib gets a 5mm cap strip; the two at the ends of the panel are cut off at the panel's edge
    expect(widths.sort((a, b) => a - b)).toEqual([2.5, 2.5, 5].map((w) => expect.closeTo(w, 6)));
  });
  it("takes the strip's own colour when it has one", () => {
    const d = wing((q) => strip(q, { color: "#ff0000" }));
    expect(rebuild(d).solids.find((s) => s.kind === "sheeting")!.color).toBe("#ff0000");
    expect(rebuild(wing((q) => strip(q))).solids.find((s) => s.kind === "sheeting")!.color).toBeUndefined();
  });
  it("no sheeting, no sheet solids", () => {
    expect(rebuild(wing(() => undefined)).solids.filter((s) => s.kind === "sheeting")).toHaveLength(0);
  });
  it("the sheet sits on the airfoil's surface: its outer edge is the surface, its inner edge is the thickness below it", () => {
    const ring = bandRing(foil, CHORD, { x0: 40, x1: 120, above: true, below: false, thicknessMm: 1.5, cap: false, strip: null }, "above", 16);
    const outer = ring.slice(0, ring.length / 2);
    const inner = ring.slice(ring.length / 2).reverse();
    outer.forEach((p, i) => {
      expect(p.y).toBeCloseTo(surfaceAt(foil, p.x / CHORD).upper * CHORD, 6);
      expect(p.y - inner[i].y).toBeGreaterThan(1.49);
      expect(p.y - inner[i].y).toBeLessThan(1.7); // t over the cosine of the slope
    });
  });
  it("a strip that is thicker than the section is deep is reported", () => {
    const d = wing((q) => strip(q, { thicknessMm: 30 }));
    expect(rebuild(d).warnings.some((w) => /thicker than/.test(w.message))).toBe(true);
  });
});
