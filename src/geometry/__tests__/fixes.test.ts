/** The Fix button on the checks: each fixable problem is put right, and the check goes away. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel } from "../../domain/doc";
import type { Panel, ProjectDoc } from "../../domain/schema";
import { fixWarning } from "../fixes";

function wing(edit: (p: Panel) => void): ProjectDoc {
  const doc = createProject();
  const p = defaultPanel("P");
  p.lengthMm = 200;
  p.rootChordMm = 200;
  p.tipChordMm = 200;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.spars = [];
  p.ribs = [0, 100, 200].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }));
  edit(p);
  doc.wing.panels = [p];
  return doc;
}
const checks = (d: ProjectDoc) => rebuild(d).warnings;
const first = (d: ProjectDoc, kind: string) => checks(d).find((w) => w.fix?.kind === kind)!;

describe("fixWarning", () => {
  it("an airfoil that cannot be loaded is replaced by the one that can, or the default", () => {
    const d = wing((p) => {
      p.rootAirfoilId = "does-not-exist";
      p.tipAirfoilId = "naca-0012";
    });
    const w = first(d, "airfoil");
    expect(w.level).toBe("error");
    const r = fixWarning(d, w)!;
    expect(r.doc.wing.panels[0].rootAirfoilId).toBe("naca-0012");
    expect(checks(r.doc).some((x) => x.fix?.kind === "airfoil")).toBe(false);
    const both = wing((p) => { p.rootAirfoilId = "nope"; p.tipAirfoilId = "nope2"; });
    const r2 = fixWarning(both, first(both, "airfoil"))!;
    expect(r2.doc.wing.panels[0].rootAirfoilId).toBe("naca-2412");
    expect(checks(r2.doc).some((x) => x.fix?.kind === "airfoil")).toBe(false);
  });
  it("a panel with no ribs gets them generated", () => {
    const d = wing((p) => (p.ribs = []));
    const r = fixWarning(d, first(d, "noRibs"))!;
    expect(r.doc.wing.panels[0].ribs.length).toBeGreaterThan(1);
    expect(checks(r.doc).some((x) => x.fix?.kind === "noRibs")).toBe(false);
  });
  it("ribs that overlap are moved apart, and one that would fall off the end is dropped", () => {
    const d = wing((p) => (p.ribs = [0, 1, 2, 100, 200].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }))));
    const r = fixWarning(d, first(d, "overlap"))!;
    const pos = r.doc.wing.panels[0].ribs.map((x) => x.positionMm);
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(pos[0]).toBe(0);
    expect(pos[pos.length - 1]).toBe(200);
    expect(checks(r.doc).some((x) => x.fix?.kind === "overlap")).toBe(false);
    const crowded = wing((p) => (p.ribs = [197, 198, 199, 200].map((z, i) => ({ id: `r${i}`, positionMm: z, thicknessMm: 3 }))));
    const r2 = fixWarning(crowded, first(crowded, "overlap"))!;
    expect(r2.doc.wing.panels[0].ribs.every((x) => x.positionMm <= 200)).toBe(true);
    expect(checks(r2.doc).some((x) => x.fix?.kind === "overlap")).toBe(false);
  });
  it("edge stock too low is raised to cover the airfoil", () => {
    const d = wing((p) => {
      p.leadingEdge.enabled = true;
      p.leadingEdge.heightMm = 2;
      p.leadingEdge.widthMm = 10;
    });
    const w = first(d, "edgeFit");
    const r = fixWarning(d, w)!;
    expect(r.doc.wing.panels[0].leadingEdge.heightMm).toBeGreaterThan(2);
    expect(checks(r.doc).some((x) => x.fix?.kind === "edgeFit")).toBe(false);
  });
  it("a rib with nothing left: edge stock wider than the chord is brought back to a sensible width", () => {
    const d = wing((p) => {
      p.leadingEdge.enabled = true;
      p.leadingEdge.widthMm = 300;
    });
    const w = first(d, "emptyRib");
    expect(w.level).toBe("error");
    const r = fixWarning(d, w)!;
    expect(checks(r.doc).some((x) => x.fix?.kind === "emptyRib")).toBe(false);
    expect(r.doc.wing.panels[0].leadingEdge.enabled).toBe(true);
    expect(r.doc.wing.panels[0].leadingEdge.widthMm).toBeLessThan(100);
  });
  it("a rib with nothing left: sheeting too thick is thinned", () => {
    const d = wing((p) => {
      p.sheeting = { type: "standard", standardLength: { unit: "pct", value: 100 }, standardThicknessMm: 200, strips: [] };
    });
    const w = first(d, "emptyRib");
    const r = fixWarning(d, w)!;
    expect(checks(r.doc).some((x) => x.fix?.kind === "emptyRib")).toBe(false);
    expect(r.doc.wing.panels[0].sheeting.type).not.toBe("none");
  });
  it("gives the steps it took, and does not touch anything else", () => {
    const d = wing((p) => (p.ribs = []));
    const r = fixWarning(d, first(d, "noRibs"))!;
    expect(r.summary).toMatch(/rib/i);
    expect(r.doc.name).toBe(d.name);
  });
  it("returns null for a check it has no fix for, and when a fix cannot clear the problem", () => {
    expect(fixWarning(wing(() => {}), { level: "warn", message: "x" })).toBeNull();
    const d = wing((p) => (p.ribs = []));
    expect(fixWarning(d, { level: "warn", fix: { kind: "noRibs" }, panelId: "gone", message: "x" })).toBeNull();
  });
});
