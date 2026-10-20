/** Half ribs: a rib that keeps only the part in front of, or behind, a cut line. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel, defaultSpar } from "../../domain/doc";
import type { ProjectDoc } from "../../domain/schema";

const CHORD = 200;
function wing(halves: ("front" | "rear" | null)[], cutPct = 35, sparAtPct?: number): ProjectDoc {
  const doc = createProject();
  const p = defaultPanel("P");
  p.lengthMm = 100 * (halves.length - 1) || 100;
  p.rootChordMm = CHORD;
  p.tipChordMm = CHORD;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.rootAirfoilId = "naca-0012";
  p.tipAirfoilId = null;
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.spars = [];
  if (sparAtPct !== undefined) {
    const s = defaultSpar(p, "Main spar");
    s.distance = { start: { unit: "pct", value: sparAtPct }, end: null };
    s.spanStartMm = 0;
    s.spanEndMm = p.lengthMm;
    p.spars = [s];
  }
  p.halfRibCutPct = cutPct;
  p.ribs = halves.map((h, i) => ({ id: `r${i}`, positionMm: i * 100, thicknessMm: 3, half: h }));
  doc.wing.panels = [p];
  return doc;
}
const xs = (doc: ProjectDoc, i: number) => rebuild(doc).ribs[i].outline.flat().map((p) => p.x);
const area = (doc: ProjectDoc, i: number) =>
  rebuild(doc).ribs[i].outline.reduce((s, r) => s + Math.abs(r.reduce((a, p, k) => a + (p.x * r[(k + 1) % r.length].y - r[(k + 1) % r.length].x * p.y), 0)) / 2, 0);

describe("half ribs", () => {
  it("a front half rib keeps the nose and stops at the cut line", () => {
    const d = wing([null, "front", null], 35);
    expect(Math.min(...xs(d, 1))).toBeCloseTo(0, 6);
    expect(Math.max(...xs(d, 1))).toBeCloseTo(0.35 * CHORD, 6);
  });
  it("a rear half rib keeps the trailing edge and starts at the cut line", () => {
    const d = wing([null, "rear", null], 35);
    expect(Math.min(...xs(d, 1))).toBeCloseTo(0.35 * CHORD, 6);
    expect(Math.max(...xs(d, 1))).toBeCloseTo(CHORD, 6);
  });
  it("front and rear half ribs each have their own cut line", () => {
    const d = wing([null, "front", "rear"], 35);
    d.wing.panels[0].halfRibRearCutPct = 60;
    expect(Math.max(...xs(d, 1))).toBeCloseTo(0.35 * CHORD, 6); // the front line is untouched
    expect(Math.min(...xs(d, 2))).toBeCloseTo(0.6 * CHORD, 6); // the rear half starts at its own
    // with no rear line of its own it uses the front one
    delete d.wing.panels[0].halfRibRearCutPct;
    expect(Math.min(...xs(d, 2))).toBeCloseTo(0.35 * CHORD, 6);
  });
  it("the unaltered profile of a half rib is the bare section cut at the same line, whatever the features do; a full rib's is the whole section", () => {
    const d = wing([null, "front", "rear"], 35, 28);
    d.wing.panels[0].halfRibRearCutPct = 60;
    d.wing.panels[0].sheeting = { ...d.wing.panels[0].sheeting, type: "standard", standardThicknessMm: 3, standardLength: null };
    const r = rebuild(d);
    const x = (i: number) => r.ribs[i].profile.flat().map((p) => p.x);
    expect(Math.max(...x(0))).toBeCloseTo(CHORD, 4); // a full rib keeps the whole section
    expect(Math.min(...x(0))).toBeCloseTo(0, 4);
    expect(Math.min(...x(1))).toBeCloseTo(0, 4); // front half: nose to the cut
    expect(Math.max(...x(1))).toBeCloseTo(0.35 * CHORD, 4);
    expect(Math.min(...x(2))).toBeCloseTo(0.6 * CHORD, 4); // rear half: its own cut to the tail
    expect(Math.max(...x(2))).toBeCloseTo(CHORD, 4);
    // the features cut the rib further than the profile, which is not cut by them
    const area = (rings: { x: number; y: number }[][]) => rings.reduce((a, q) => a + Math.abs(q.reduce((s2, p, i) => s2 + (p.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * p.y), 0)) / 2, 0);
    expect(area(r.ribs[1].outline)).toBeLessThan(area(r.ribs[1].profile));
    expect(area(r.ribs[1].profile)).toBeLessThan(area([r.ribs[1].silhouette]));
  });
  it("full ribs beside it are untouched", () => {
    const d = wing([null, "front", null]);
    expect(Math.max(...xs(d, 0))).toBeCloseTo(CHORD, 6);
    expect(Math.max(...xs(d, 2))).toBeCloseTo(CHORD, 6);
  });
  it("a half rib is a part of the full one: its area is less, and the front and rear halves add up to the whole", () => {
    const whole = area(wing([null, null, null]), 1);
    const front = area(wing([null, "front", null]), 1);
    const rear = area(wing([null, "rear", null]), 1);
    expect(front).toBeLessThan(whole);
    expect(rear).toBeLessThan(whole);
    expect(front + rear).toBeCloseTo(whole, 2); // to a few thousandths of a square millimetre: the clipper works in whole micrometres
  });
  it("the cut position is the panel's, as a percentage of the chord, and follows the chord", () => {
    expect(Math.max(...xs(wing([null, "front", null], 20), 1))).toBeCloseTo(40, 6);
    expect(Math.max(...xs(wing([null, "front", null], 60), 1))).toBeCloseTo(120, 6);
    const tapered = wing([null, "front", null], 50);
    tapered.wing.panels[0].tipChordMm = 100;
    expect(Math.max(...xs(tapered, 1))).toBeCloseTo(0.5 * 150, 6); // chord is 150 half-way out
  });
  it("building tabs that would hang off the removed part are removed with it", () => {
    const d = wing([null, "front", null], 35);
    d.wing.panels[0].buildingTabs = { ...d.wing.panels[0].buildingTabs, enabled: true, above: false, below: true, fore: true, aft: true, holes: false };
    expect(Math.max(...xs(d, 1))).toBeLessThanOrEqual(0.35 * CHORD + 1e-6);
  });
  it("is applied before twist, so the cut stays square to the rib's own chord", () => {
    const d = wing([null, "front", null], 35);
    d.wing.panels[0].tipTwistDeg = -4;
    const r = rebuild(d).ribs[1];
    expect(r.outline.flat().length).toBeGreaterThan(10);
    // twisted about the nose: the far edge is a straight line tilted by the twist angle
    expect(Math.max(...r.outline.flat().map((p) => p.x))).toBeGreaterThan(0.34 * CHORD);
    expect(Math.max(...r.outline.flat().map((p) => p.x))).toBeLessThanOrEqual(0.35 * CHORD + 1);
  });
  it("warns when a spar lies in the part that was removed, naming the rib and the spar", () => {
    const d = wing([null, "front", null], 35, 60); // spar at 60% of the chord, behind the cut
    const w = rebuild(d).warnings.find((x) => /half rib/i.test(x.message));
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/Main spar/);
  });
  it("does not warn when the spar is in the part that is kept", () => {
    expect(rebuild(wing([null, "front", null], 35, 25)).warnings.some((x) => /half rib/i.test(x.message))).toBe(false);
    expect(rebuild(wing([null, "rear", null], 35, 60)).warnings.some((x) => /half rib/i.test(x.message))).toBe(false);
  });
  it("a rib with no half setting at all (an older project) is a full rib", () => {
    const d = wing([null, null, null]);
    delete (d.wing.panels[0].ribs[1] as { half?: unknown }).half;
    expect(Math.max(...xs(d, 1))).toBeCloseTo(CHORD, 6);
  });
});
