/**
 * Rib combs: a thin wall that runs along the span through slots cut in the ribs. The wall has slits where
 * the ribs pass, so the two lock together like a halving joint.
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject, defaultPanel } from "../../domain/doc";
import type { Panel, ProjectDoc, RibComb } from "../../domain/schema";
import { surfaceAt } from "../airfoil";
import { combStation, defaultComb } from "../combs";
import { buildMesh, meshReport } from "../../export/mesh";

const CHORD = 200;
const foil = resolveSurfaces("naca-0012", [])!;

function wing(edit: (p: Panel) => void, ribs = 4): ProjectDoc {
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
const withComb = (p: Panel, patch: Partial<RibComb> = {}) => {
  p.ribCombs.push({ ...defaultComb(p, "Comb 1", "above"), ...patch });
};
/** Material top and bottom of rib `rib` along vertical line x. */
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
const at = (pct: number): Partial<RibComb> => ({ distanceFrom: "LE", distance: { start: { unit: "pct", value: pct }, end: null } });

describe("combStation", () => {
  it("measures from the leading edge or the trailing edge, in per cent or millimetres", () => {
    const p = wing(() => {}).wing.panels[0];
    expect(combStation({ ...defaultComb(p, "c", "above"), ...at(25) } as RibComb, 200, 0)).toBeCloseTo(50, 9);
    const te = { ...defaultComb(p, "c", "above"), distanceFrom: "TE", distance: { start: { unit: "mm", value: 30 }, end: null } } as RibComb;
    expect(combStation(te, 200, 0)).toBeCloseTo(170, 9);
  });
  it("a separate end value moves the comb along the span", () => {
    const p = wing(() => {}).wing.panels[0];
    const c = { ...defaultComb(p, "c", "above"), distance: { start: { unit: "pct", value: 10 }, end: { unit: "pct", value: 30 } } } as RibComb;
    expect(combStation(c, 200, 0)).toBeCloseTo(20, 9);
    expect(combStation(c, 200, 1)).toBeCloseTo(60, 9);
  });
});

describe("slots cut into the ribs", () => {
  it("an above comb cuts a slot from the top surface, cut-into-rib per cent of the section depth", () => {
    const doc = wing((p) => withComb(p, { ...at(30), widthMm: 4, cutIntoRibPct: 50, extendMm: 0 }));
    const x = 60; // the middle of the comb
    const s = surf(x);
    const e = extent(doc, 1, x);
    expect(e.top).toBeCloseTo(s.top - 0.5 * (s.top - s.bottom), 0);
    expect(e.bottom).toBeCloseTo(s.bottom, 1);
  });
  it("a below comb cuts from the bottom surface", () => {
    const doc = wing((p) => withComb(p, { ...at(30), type: "below", widthMm: 4, cutIntoRibPct: 40 }));
    const s = surf(60);
    const e = extent(doc, 1, 60);
    expect(e.bottom).toBeCloseTo(s.bottom + 0.4 * (s.top - s.bottom), 0);
    expect(e.top).toBeCloseTo(s.top, 1);
  });
  it("the slot is as wide as the comb plus the gaps fore and aft", () => {
    const doc = wing((p) => withComb(p, { ...at(30), widthMm: 4, cutIntoRibPct: 50, gapForeMm: 1, gapAftMm: 2 }));
    const s = surf(60);
    const intact = (x: number) => Math.abs(extent(doc, 1, x).top - s.top) < 0.5;
    expect(intact(60 - 2 - 1 - 0.3)).toBe(true);
    expect(intact(60 - 2 - 1 + 0.3)).toBe(false);
    expect(intact(60 + 2 + 2 - 0.3)).toBe(false);
    expect(intact(60 + 2 + 2 + 0.3)).toBe(true);
  });
  it("needle adjustment makes the slot deeper", () => {
    const base = extent(wing((p) => withComb(p, { ...at(30), cutIntoRibPct: 50 })), 1, 60).top;
    const more = extent(wing((p) => withComb(p, { ...at(30), cutIntoRibPct: 50, needleAdjustmentMm: 1.5 })), 1, 60).top;
    expect(base - more).toBeCloseTo(1.5, 1);
  });
  it("only the ribs inside the comb's span are slotted", () => {
    const doc = wing((p) => withComb(p, { ...at(30), spanStartMm: 100, spanEndMm: 200 }));
    const s = surf(60);
    expect(extent(doc, 0, 60).top).toBeCloseTo(s.top, 1);
    expect(extent(doc, 1, 60).top).toBeLessThan(s.top - 1);
    expect(extent(doc, 2, 60).top).toBeLessThan(s.top - 1);
    expect(extent(doc, 3, 60).top).toBeCloseTo(s.top, 1);
  });
  it("leveled makes every slot as deep as the shallowest one", () => {
    const doc = wing((p) => {
      p.tipChordMm = 100;
      withComb(p, { ...at(30), cutIntoRibPct: 50, leveled: true });
    });
    const depth = (i: number, x: number) => { const e = extent(doc, i, x); return { d: surf(x).top - e.top }; };
    // the comb is at 30% of each rib's own chord, so the stations differ; the depth must not
    const root = depth(0, 60).d;
    const tipChord = rebuild(doc).ribs[3].chordMm;
    const tip = (() => { const x = 0.3 * tipChord; const s = surfaceAt(foil, 0.3); return s.upper * tipChord - extent(doc, 3, x).top; })();
    expect(root).toBeCloseTo(tip, 1);
  });
  it("a tilted comb leans: its slot no longer sits square to the chord", () => {
    const up = wing((p) => withComb(p, { ...at(30), widthMm: 4, cutIntoRibPct: 80, angleDeg: 90 }));
    const lean = wing((p) => withComb(p, { ...at(30), widthMm: 4, cutIntoRibPct: 80, angleDeg: 75 }));
    let worst = 0;
    for (let x = 48; x <= 72; x += 1) worst = Math.max(worst, Math.abs(extent(up, 1, x).top - extent(lean, 1, x).top));
    expect(worst).toBeGreaterThan(1);
  });
  it("a comb outside the chord is reported, not drawn", () => {
    const r = rebuild(wing((p) => withComb(p, { ...at(130) })));
    expect(r.warnings.some((w) => /Comb 1/.test(w.message) && /outside/.test(w.message))).toBe(true);
  });
  it("a slot that would leave no rib is reported", () => {
    const r = rebuild(wing((p) => withComb(p, { ...at(30), cutIntoRibPct: 100, needleAdjustmentMm: 5 })));
    expect(r.warnings.some((w) => /Comb 1/.test(w.message))).toBe(true);
  });
});

describe("the comb as a solid", () => {
  const solids = (patch: Partial<RibComb> = {}, ribs = 4) =>
    rebuild(wing((p) => withComb(p, { ...at(30), ...patch }), ribs)).solids.filter((s) => s.kind === "comb");
  it("is made of closed solids", () => {
    const list = solids();
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      const r = meshReport(buildMesh(s.positions));
      expect(r.closed).toBe(true);
    }
  });
  it("runs from the first rib to the last in its span", () => {
    const zs = solids({ spanStartMm: 100, spanEndMm: 200 }).flatMap((s) => s.positions.filter((_, i) => i % 3 === 2));
    expect(Math.min(...zs)).toBeGreaterThan(98);
    expect(Math.max(...zs)).toBeLessThan(202);
    expect(Math.min(...zs)).toBeLessThan(100);
  });
  it("has slits where the ribs pass: no wall material inside a rib's own thickness below the slot floor", () => {
    const list = solids({ cutIntoRibPct: 50, slitHeightMm: 3, slitAdjustMm: 0, extendMm: 0 });
    const slotFloor = surf(60).top - 0.5 * (surf(60).top - surf(60).bottom);
    // the lowest y of a piece whose z-range overlaps rib 1 (z = 100) must be the slot floor, not lower
    const low = (s: { positions: number[] }, z0: number, z1: number) => {
      let m = Infinity;
      for (let i = 0; i < s.positions.length; i += 3) if (s.positions[i + 2] >= z0 && s.positions[i + 2] <= z1) m = Math.min(m, s.positions[i + 1]);
      return m;
    };
    const atRib = list.filter((s) => { const zs = s.positions.filter((_, i) => i % 3 === 2); return Math.min(...zs) >= 98.4 && Math.max(...zs) <= 101.6; });
    const between = list.filter((s) => { const zs = s.positions.filter((_, i) => i % 3 === 2); return Math.min(...zs) >= 101 && Math.max(...zs) <= 199; });
    expect(atRib.length).toBeGreaterThan(0);
    expect(between.length).toBeGreaterThan(0);
    expect(low(atRib[0], 98, 102)).toBeCloseTo(slotFloor, 0);
    expect(low(between[0], 101, 199)).toBeCloseTo(slotFloor - 3, 0);
  });
  it("as tabs: only a tab at each rib, nothing between", () => {
    const list = solids({ asTabs: true });
    expect(list.length).toBe(4);
    for (const s of list) {
      const zs = s.positions.filter((_, i) => i % 3 === 2);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(5);
    }
  });
  it("takes its colour, or the standard colour when none is chosen", () => {
    expect(solids({ color: "#ff0000" })[0].color).toBe("#ff0000");
    expect(solids({ color: "standard" })[0].color).toBeUndefined();
  });
  it("no combs, no comb solids", () => {
    expect(rebuild(wing(() => {})).solids.filter((s) => s.kind === "comb")).toHaveLength(0);
  });
});
