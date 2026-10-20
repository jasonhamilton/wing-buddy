import { describe, expect, it } from "vitest";
import { createProject, defaultSpar } from "../doc";
import { alignWith, copyOf, maxThicknessPct, moveToMaxThickness, neighbour } from "../sparOps";

function setup() {
  const doc = createProject();
  const panel = doc.wing.panels[0];
  panel.rootAirfoilId = "naca-2412";
  panel.tipAirfoilId = null;
  return { doc, panel };
}

describe("moveToMaxThickness", () => {
  it("finds a NACA 2412 maximum near 30% of the chord", () => {
    const { doc, panel } = setup();
    const pct = maxThicknessPct(panel, doc.airfoils, 0)!;
    expect(pct).toBeGreaterThan(25);
    expect(pct).toBeLessThan(35);
  });
  it("keeps a percentage spar in percent and measures a TE spar from the trailing edge", () => {
    const { doc, panel } = setup();
    const le = defaultSpar(panel, "a");
    const te = { ...defaultSpar(panel, "b"), distanceFrom: "TE" as const };
    const a = moveToMaxThickness(panel, le, doc.airfoils)!.distance!.start;
    const b = moveToMaxThickness(panel, te, doc.airfoils)!.distance!.start;
    expect(a.unit).toBe("pct");
    expect(a.value + b.value).toBeCloseTo(100, 2);
  });
  it("converts to mm using the chord at the spar's own station", () => {
    const { doc, panel } = setup();
    panel.rootChordMm = 200;
    panel.tipChordMm = 100;
    const s = defaultSpar(panel, "a");
    s.distance.start = { unit: "mm", value: 1 };
    const root = moveToMaxThickness(panel, s, doc.airfoils)!.distance!.start.value;
    s.spanStartMm = panel.lengthMm;
    const tip = moveToMaxThickness(panel, s, doc.airfoils)!.distance!.start.value;
    expect(root / tip).toBeCloseTo(2, 1);
  });
  it("leaves a following end alone when there is none", () => {
    const { doc, panel } = setup();
    expect(moveToMaxThickness(panel, defaultSpar(panel, "a"), doc.airfoils)!.distance!.end).toBeNull();
  });
  it("returns null rather than guessing when the airfoil cannot be found", () => {
    const { doc, panel } = setup();
    panel.rootAirfoilId = "nope";
    expect(moveToMaxThickness(panel, defaultSpar(panel, "a"), doc.airfoils)).toBeNull();
  });
});

describe("alignWith", () => {
  it("previous: starts where the previous spar ends, using its edge reference", () => {
    const { panel } = setup();
    const src = { ...defaultSpar(panel, "src"), distanceFrom: "TE" as const };
    src.distance = { start: { unit: "pct", value: 20 }, end: { unit: "pct", value: 35 } };
    const patch = alignWith(defaultSpar(panel, "me"), src, "previous");
    expect(patch.distanceFrom).toBe("TE");
    expect(patch.distance!.start).toEqual({ unit: "pct", value: 35 });
  });
  it("next: ends where the next spar starts, and does not alias the source object", () => {
    const { panel } = setup();
    const src = defaultSpar(panel, "src");
    src.distance.start = { unit: "pct", value: 40 };
    const patch = alignWith(defaultSpar(panel, "me"), src, "next");
    expect(patch.distance!.end).toEqual({ unit: "pct", value: 40 });
    expect(patch.distance!.end).not.toBe(src.distance.start);
  });
  it("collapses to no separate end when the two already coincide", () => {
    const { panel } = setup();
    const me = defaultSpar(panel, "me");
    const src = defaultSpar(panel, "src");
    expect(alignWith(me, src, "next").distance!.end).toBeNull();
  });
});

describe("copyOf and neighbour", () => {
  it("copy has a new id, a new name and no shared nested objects", () => {
    const { panel } = setup();
    const s = defaultSpar(panel, "Main spar");
    const c = copyOf(s);
    expect(c.id).not.toBe(s.id);
    expect(c.name).toBe("Main spar copy");
    expect(c.distance).not.toBe(s.distance);
  });
  it("in front moves toward the LE, behind away from it; never below zero", () => {
    const { panel } = setup();
    const s = defaultSpar(panel, "s");
    s.distance.start = { unit: "pct", value: 28 };
    expect(neighbour(panel, s, "front", "f").distance.start.value).toBe(18);
    expect(neighbour(panel, s, "behind", "b").distance.start.value).toBe(38);
    s.distance.start.value = 4;
    expect(neighbour(panel, s, "front", "f").distance.start.value).toBe(0);
  });
  it("for a spar measured from the TE, in front means a larger distance", () => {
    const { panel } = setup();
    const s = { ...defaultSpar(panel, "s"), distanceFrom: "TE" as const };
    s.distance.start = { unit: "pct", value: 60 };
    expect(neighbour(panel, s, "front", "f").distance.start.value).toBe(70);
  });
  it("a neighbour does not inherit webbing or an aileron cut", () => {
    const { panel } = setup();
    const s = defaultSpar(panel, "s");
    s.webbing = { widthMm: 1.5 } as never;
    expect(neighbour(panel, s, "behind", "n").webbing).toBeNull();
  });
});
