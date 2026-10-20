/**
 * Airfoil interpolation across panels. A run of panels whose airfoils are linked blends as
 * one wing, with a spline through the sections at the joins, instead of restarting a straight
 * blend in every panel (which leaves a visible kink at each join).
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel, syncAirfoilLinks } from "../../domain/doc";
import { hermiteAt } from "../interpolate";
import type { ProjectDoc } from "../../domain/schema";

describe("hermiteAt", () => {
  it("passes exactly through every knot", () => {
    const x = [0, 300, 450, 900];
    const v = [1, 4, 2, 5];
    x.forEach((xi, i) => expect(hermiteAt(x, v, xi)).toBeCloseTo(v[i], 12));
  });
  it("with two knots it is the straight line, so a single panel is unchanged", () => {
    expect(hermiteAt([0, 10], [2, 6], 5)).toBeCloseTo(4, 12);
    expect(hermiteAt([0, 10], [2, 6], 2.5)).toBeCloseTo(3, 12);
  });
  it("constant data stays constant, with no overshoot", () => {
    for (const u of [0, 100, 299, 301, 450, 899]) expect(hermiteAt([0, 300, 600, 900], [3, 3, 3, 3], u)).toBeCloseTo(3, 12);
  });
  it("is smooth through a knot even when the spans are very unequal: no kink in the slope", () => {
    const x = [0, 100, 700];
    const v = [0, 10, 4];
    const h = 1e-3;
    const left = (hermiteAt(x, v, 100) - hermiteAt(x, v, 100 - h)) / h;
    const right = (hermiteAt(x, v, 100 + h) - hermiteAt(x, v, 100)) / h;
    expect(Math.abs(left - right)).toBeLessThan(1e-2);
  });
  it("outside the knots it holds the end values rather than running away", () => {
    expect(hermiteAt([0, 10, 20], [1, 2, 3], -5)).toBeCloseTo(1, 9);
    expect(hermiteAt([0, 10, 20], [1, 2, 3], 99)).toBeCloseTo(3, 9);
  });
});

/** Three equal flat panels, 300mm each, ribs every 10mm, no spars or stock, so a rib is just its section. */
function wing(linked: boolean, foils = ["naca-0012", "naca-0015", "naca-0009", "naca-0015"]): ProjectDoc {
  const doc = createProject();
  const panels = [0, 1, 2].map((k) => {
    const p = defaultPanel(`P${k + 1}`);
    p.lengthMm = 300;
    p.rootChordMm = 200;
    p.tipChordMm = 200;
    p.sweepMm = 0;
    p.dihedralDeg = 0;
    p.rootAirfoilId = foils[k];
    p.tipAirfoilId = foils[k + 1];
    p.spars = [];
    p.leadingEdge.enabled = false;
    p.trailingEdge.enabled = false;
    p.ribs = Array.from({ length: 31 }, (_, i) => ({ id: `r${k}-${i}`, positionMm: i * 10, thicknessMm: 3 }));
    p.ribCountTarget = 31;
    p.airfoilLinkedToPrev = linked && k > 0;
    return p;
  });
  doc.wing.panels = panels;
  syncAirfoilLinks(doc);
  return doc;
}

/** Maximum thickness of each rib as a fraction of chord, along the whole wing, root to tip. */
function thicknessAlong(doc: ProjectDoc): number[] {
  const out: number[] = [];
  for (const rib of rebuild(doc).ribs) {
    const ys = rib.outline.flat().map((p) => p.y);
    out.push((Math.max(...ys) - Math.min(...ys)) / rib.chordMm);
  }
  return out;
}

/**
 * How much the slope changes across a join. The last rib of one panel and the first rib of the next are
 * at the same place, so compare the step just before the join with the step just after it.
 */
const slopeJump = (t: number[], lastRibOfPanel: number) =>
  Math.abs((t[lastRibOfPanel + 2] - t[lastRibOfPanel + 1]) - (t[lastRibOfPanel] - t[lastRibOfPanel - 1]));

describe("a linked run of panels", () => {
  it("is exact at each join: the rib at the join has the section the join names", () => {
    const t = thicknessAlong(wing(true));
    // ribs 0..30 panel 1, 31..61 panel 2, 62..92 panel 3; the join is rib 30/31 and 61/62
    expect(t[30]).toBeCloseTo(0.15, 3); // NACA 0015 at the end of panel 1
    expect(t[31]).toBeCloseTo(0.15, 3); // and the same section starts panel 2
    expect(t[61]).toBeCloseTo(0.09, 3); // NACA 0009
    expect(t[92]).toBeCloseTo(0.15, 3);
  });
  it("is smooth through the join, where unlinked panels have a kink", () => {
    const linked = thicknessAlong(wing(true));
    const unlinked = thicknessAlong(wing(false));
    // thickness rises 12% -> 15% in panel 1 then falls 15% -> 9% in panel 2: a corner at rib 30/31
    const kink = slopeJump(unlinked, 30);
    const smooth = slopeJump(linked, 30);
    expect(kink).toBeGreaterThan(0.0025);
    expect(smooth).toBeLessThan(kink / 4);
    // and again at the second join, 15% -> 9% -> 15%
    expect(slopeJump(linked, 61)).toBeLessThan(slopeJump(unlinked, 61) / 4);
  });
  it("leaves a panel that is not linked exactly as it was", () => {
    const a = thicknessAlong(wing(true)).slice(0, 31);
    const b = thicknessAlong(wing(false)).slice(0, 31);
    // panel 1 is the start of the chain, but it now shares a spline with its neighbours, so only its far end moves
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[30]).toBeCloseTo(b[30], 9);
  });
  it("a single unlinked panel matches the previous straight blend exactly", () => {
    const doc = wing(false);
    doc.wing.panels = [doc.wing.panels[0]];
    const t = thicknessAlong(doc);
    // straight line from 12% to 15% over the span
    expect(t[15]).toBeCloseTo(0.135, 3);
  });
  it("the link flag on the first panel means nothing and must not break anything", () => {
    const doc = wing(false);
    doc.wing.panels[0].airfoilLinkedToPrev = true;
    syncAirfoilLinks(doc);
    expect(thicknessAlong(doc)).toEqual(thicknessAlong(wing(false)));
  });
  it("a missing airfoil in a run is reported, and the panels that can be built still are", () => {
    const doc = wing(true, ["naca-0012", "naca-0015", "does-not-exist", "naca-0015"]);
    const r = rebuild(doc);
    expect(r.warnings.some((w) => /airfoil could not be loaded/.test(w.message))).toBe(true);
    expect(r.ribs.length).toBeGreaterThan(0);
  });
});

describe("syncAirfoilLinks", () => {
  it("copies the previous tip into a linked panel's root, section and thickness factor", () => {
    const doc = wing(false);
    doc.wing.panels[0].tipAirfoilId = "naca-2412";
    doc.wing.panels[0].tipAirfoilScale = 0.9;
    doc.wing.panels[1].airfoilLinkedToPrev = true;
    syncAirfoilLinks(doc);
    expect(doc.wing.panels[1].rootAirfoilId).toBe("naca-2412");
    expect(doc.wing.panels[1].rootAirfoilScale).toBe(0.9);
  });
  it("follows a panel whose tip is 'same as root' back down the chain", () => {
    const doc = wing(false);
    doc.wing.panels[0].tipAirfoilId = null;
    doc.wing.panels[0].rootAirfoilId = "naca-0009";
    doc.wing.panels[1].airfoilLinkedToPrev = true;
    syncAirfoilLinks(doc);
    expect(doc.wing.panels[1].rootAirfoilId).toBe("naca-0009");
  });
  it("leaves unlinked panels alone", () => {
    const doc = wing(false);
    const before = JSON.stringify(doc.wing.panels);
    syncAirfoilLinks(doc);
    expect(JSON.stringify(doc.wing.panels)).toBe(before);
  });
});
