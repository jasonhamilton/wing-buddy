import { describe, expect, it } from "vitest";
import { defaultPanel, defaultSpar } from "../doc";
import { newPanelFrom } from "../panelCopy";
import type { Panel } from "../schema";

/** A tapered, swept, twisted panel with a spar that reaches the tip and one that does not. */
function source(): Panel {
  const p = defaultPanel("Inner");
  p.lengthMm = 400;
  p.rootChordMm = 240;
  p.tipChordMm = 180;
  p.sweepMm = 30;
  p.rootTwistDeg = 0;
  p.tipTwistDeg = -2;
  p.dihedralDeg = 3;
  p.rootAirfoilId = "naca-2412";
  p.rootAirfoilScale = 1;
  p.tipAirfoilId = "naca-0012";
  p.tipAirfoilScale = 0.9;
  p.ribCountTarget = 9;
  p.ribThicknessMm = 2.5;
  const main = defaultSpar(p, "Main spar");
  main.spanStartMm = 0;
  main.spanEndMm = 400;
  main.distance = { start: { unit: "pct", value: 30 }, end: { unit: "pct", value: 25 } };
  main.width = { start: 8, end: 5 };
  main.height = { start: 3, end: 2 };
  const joiner = defaultSpar(p, "Joiner", "roundJoiner");
  joiner.spanStartMm = 0;
  joiner.spanEndMm = 140;
  const tail = defaultSpar(p, "Rear spar");
  tail.spanStartMm = 150;
  tail.spanEndMm = 400;
  tail.distance = { start: { unit: "pct", value: 60 }, end: null };
  p.spars = [main, joiner, tail];
  return p;
}

const ids = (p: Panel) => [p.id, ...p.ribs.map((r) => r.id), ...p.spars.map((s) => s.id)];

describe("direct copy: a 1:1 duplicate", () => {
  it("everything is the same except the name and the ids", () => {
    const a = source();
    const b = newPanelFrom(a, "direct", "Panel 2");
    expect(b.name).toBe("Panel 2");
    const strip = (p: Panel) => JSON.parse(JSON.stringify(p, (k, v) => (["id", "name"].includes(k) ? undefined : v)));
    expect(strip(b)).toEqual(strip(a));
  });
  it("shares no ids and no objects with the original", () => {
    const a = source();
    const b = newPanelFrom(a, "direct", "Panel 2");
    expect(ids(b).filter((i) => ids(a).includes(i))).toEqual([]);
    b.spars[0].width!.start = 99;
    expect(a.spars[0].width!.start).toBe(8);
  });
  it("a copy of a panel with ribs keeps the ribs, with new ids", () => {
    const a = source();
    a.ribs = [{ id: "r1", positionMm: 0, thicknessMm: 3 }, { id: "r2", positionMm: 400, thicknessMm: 3 }];
    const b = newPanelFrom(a, "direct", "P");
    expect(b.ribs.map((r) => r.positionMm)).toEqual([0, 400]);
    expect(b.ribs.map((r) => r.id)).not.toContain("r1");
  });
});

describe("mirror copy: the far side of the join, a reflection of the previous panel", () => {
  it("chords, twist, sweep and airfoils run backwards", () => {
    const a = source();
    const b = newPanelFrom(a, "mirror", "Panel 2");
    expect(b.rootChordMm).toBe(180);
    expect(b.tipChordMm).toBe(240);
    expect(b.sweepMm).toBe(-30);
    expect(b.rootTwistDeg).toBe(-2);
    expect(b.tipTwistDeg).toBe(0);
    expect(b.rootAirfoilId).toBe("naca-0012");
    expect(b.tipAirfoilId).toBe("naca-2412");
    expect(b.rootAirfoilScale).toBe(0.9);
    expect(b.tipAirfoilScale).toBe(1);
    expect(b.lengthMm).toBe(400);
    expect(b.dihedralDeg).toBe(3);
  });
  it("keeps only the spars that reach the join, mirrored along the span", () => {
    const a = source();
    const b = newPanelFrom(a, "mirror", "Panel 2");
    expect(b.spars.map((s) => s.name)).toEqual(["Main spar", "Rear spar"]);
    const rear = b.spars.find((s) => s.name === "Rear spar")!;
    // [150, 400] reflected in a 400mm panel is [0, 250]
    expect(rear.spanStartMm).toBe(0);
    expect(rear.spanEndMm).toBe(250);
  });
  it("swaps a spar's start and end values, because the far end of the span is now the near end", () => {
    const b = newPanelFrom(source(), "mirror", "Panel 2");
    const main = b.spars.find((s) => s.name === "Main spar")!;
    expect(main.distance.start.value).toBe(25);
    expect(main.distance.end!.value).toBe(30);
    expect(main.width).toEqual({ start: 5, end: 8 });
    expect(main.height).toEqual({ start: 2, end: 3 });
  });
  it("a spar with one value for the whole span is left with one value", () => {
    const b = newPanelFrom(source(), "mirror", "Panel 2");
    const rear = b.spars.find((s) => s.name === "Rear spar")!;
    expect(rear.distance.end).toBeNull();
  });
  it("mirroring twice gives back the original panel's geometry", () => {
    const a = source();
    const c = newPanelFrom(newPanelFrom(a, "mirror", "B"), "mirror", "C");
    expect(c.rootChordMm).toBe(a.rootChordMm);
    expect(c.tipChordMm).toBe(a.tipChordMm);
    expect(c.sweepMm).toBe(a.sweepMm);
    expect(c.rootTwistDeg).toBe(a.rootTwistDeg);
    expect(c.tipTwistDeg).toBe(a.tipTwistDeg);
    expect(c.rootAirfoilId).toBe(a.rootAirfoilId);
    expect(c.tipAirfoilId).toBe(a.tipAirfoilId);
    const main = c.spars.find((s) => s.name === "Main spar")!;
    expect(main.distance.start.value).toBe(30);
    expect(main.spanStartMm).toBe(0);
    expect(main.spanEndMm).toBe(400);
  });
  it("a panel whose tip is 'same as root' mirrors to one with the same section at both ends", () => {
    const a = source();
    a.tipAirfoilId = null;
    const b = newPanelFrom(a, "mirror", "P");
    expect(b.rootAirfoilId).toBe("naca-2412");
    expect(b.tipAirfoilId === null || b.tipAirfoilId === "naca-2412").toBe(true);
  });
  it("has ribs of the same count and thickness, and no shared ids", () => {
    const a = source();
    const b = newPanelFrom(a, "mirror", "P");
    expect(b.ribs.length).toBe(a.ribCountTarget);
    expect(ids(b).filter((i) => ids(a).includes(i))).toEqual([]);
  });
});

describe("smart copy: carry on from the previous tip", () => {
  it("starts on the previous tip's chord and section, and the airfoil is linked through the join", () => {
    const b = newPanelFrom(source(), "smart", "Panel 2");
    expect(b.rootChordMm).toBe(180);
    expect(b.tipChordMm).toBe(180);
    expect(b.rootAirfoilId).toBe("naca-0012");
    expect(b.rootAirfoilScale).toBe(0.9);
    expect(b.tipAirfoilId).toBeNull();
    expect(b.airfoilLinkedToPrev).toBe(true);
  });
  it("carries the twist on rather than restarting it, and keeps the length, sweep and dihedral", () => {
    const b = newPanelFrom(source(), "smart", "Panel 2");
    expect(b.rootTwistDeg).toBe(-2);
    expect(b.tipTwistDeg).toBe(-2);
    expect(b.lengthMm).toBe(400);
    expect(b.sweepMm).toBe(30);
    expect(b.dihedralDeg).toBe(3);
  });
  it("continues only the spars that reach the join, across the whole new panel, from where the previous one ended", () => {
    const b = newPanelFrom(source(), "smart", "Panel 2");
    expect(b.spars.map((s) => s.name)).toEqual(["Main spar", "Rear spar"]);
    const main = b.spars.find((s) => s.name === "Main spar")!;
    expect(main.spanStartMm).toBe(0);
    expect(main.spanEndMm).toBe(400);
    expect(main.distance.start.value).toBe(25); // where the previous panel's spar ended
    expect(main.distance.end).toBeNull();
    expect(main.width).toEqual({ start: 5, end: null });
    expect(main.height).toEqual({ start: 2, end: null });
  });
  it("a spar that stops short of the join is not carried", () => {
    expect(newPanelFrom(source(), "smart", "P").spars.map((s) => s.name)).not.toContain("Joiner");
  });
  it("has fresh ribs from the previous panel's count and thickness, and no shared ids", () => {
    const a = source();
    const b = newPanelFrom(a, "smart", "P");
    expect(b.ribs.length).toBe(9);
    expect(b.ribs.every((r) => r.thicknessMm === 2.5)).toBe(true);
    expect(ids(b).filter((i) => ids(a).includes(i))).toEqual([]);
  });
  it("copes with a previous panel that has no spars at all", () => {
    const a = source();
    a.spars = [];
    expect(newPanelFrom(a, "smart", "P").spars).toEqual([]);
    expect(newPanelFrom(a, "mirror", "P").spars).toEqual([]);
  });
});
