import { describe, expect, it } from "vitest";
import { createProject, wingStats } from "../doc";
import { seedProject } from "../seed";

const rad = (d: number) => (d * Math.PI) / 180;

describe("wingStats", () => {
  it("the example wing: projected span, projected area, mean chord and aspect ratio, worked by hand", () => {
    const doc = seedProject();
    // inner: 420mm long, chord 230 -> 230, 2deg. outer: 360mm, 230 -> 155, 6deg.
    const span = 2 * (420 * Math.cos(rad(2)) + 360 * Math.cos(rad(6)));
    const areaMm2 = 2 * (230 * 420 * Math.cos(rad(2)) + ((230 + 155) / 2) * 360 * Math.cos(rad(6)));
    const s = wingStats(doc);
    expect(s.spanMm).toBeCloseTo(span, 6);
    expect(s.areaDm2).toBeCloseTo(areaMm2 / 10_000, 6);
    expect(s.meanChordMm).toBeCloseTo(areaMm2 / span, 6);
    expect(s.aspectRatio).toBeCloseTo(span ** 2 / areaMm2, 6);
    expect(s.aspectRatio).toBeGreaterThan(7.3);
    expect(s.aspectRatio).toBeLessThan(7.33);
  });

  it("a plain rectangular wing has aspect ratio 2L/c, and for a flat wing that is exact", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.lengthMm = 500;
    p.rootChordMm = 200;
    p.tipChordMm = 200;
    p.dihedralDeg = 0;
    expect(wingStats(doc).aspectRatio).toBeCloseTo((2 * 500) / 200, 9);
  });

  it("aspect ratio is a pure number: the display unit does not change it", () => {
    const a = seedProject();
    const b = seedProject();
    b.displayUnits = "in";
    expect(wingStats(b).aspectRatio).toBeCloseTo(wingStats(a).aspectRatio, 12);
  });

  it("dihedral shortens the projected span and the projected area, never lengthens them", () => {
    const flat = seedProject();
    flat.wing.panels.forEach((p) => (p.dihedralDeg = 0));
    const bent = seedProject();
    expect(wingStats(bent).spanMm).toBeLessThan(wingStats(flat).spanMm);
    expect(wingStats(bent).areaDm2).toBeLessThan(wingStats(flat).areaDm2);
  });

  it("a gap between the halves adds span but no area", () => {
    const a = seedProject();
    const b = seedProject();
    b.wing.wingHalvesDistanceMm = 40;
    expect(wingStats(b).spanMm).toBeCloseTo(wingStats(a).spanMm + 40, 9);
    expect(wingStats(b).areaDm2).toBeCloseTo(wingStats(a).areaDm2, 12);
  });

  it("no area means aspect ratio 0, never NaN or Infinity", () => {
    const doc = createProject();
    doc.wing.panels = [];
    const s = wingStats(doc);
    expect(s.aspectRatio).toBe(0);
    expect(s.meanChordMm).toBe(0);
    expect(Number.isFinite(s.spanMm + s.areaDm2)).toBe(true);
  });
});
