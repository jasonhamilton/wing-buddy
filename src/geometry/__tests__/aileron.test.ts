/**
 * The aileron cutter, with its hinge. A notch is cut from the surface opposite the hinge; the faces are
 * tilted by alpha (wing side) and beta (aileron side). Cut off, it goes right through and the rib comes
 * out in two pieces; attached, it stops part-way and the hinge-side skin holds the two together. Close-off
 * recesses each face so a thin wall can be fitted.
 */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject, defaultAileron, defaultPanel, defaultSpar } from "../../domain/doc";
import type { Aileron, ProjectDoc } from "../../domain/schema";
import { surfaceAt } from "../airfoil";
import { aileronCut } from "../aileron";
import { buildMesh, meshReport } from "../../export/mesh";

const CHORD = 200;
const foil = resolveSurfaces("naca-0012", [])!;
/** A flat single-panel wing with one aileron spar 25% from the trailing edge, ribs at the root and mid-span. */
function wing(a: Partial<Aileron> | null, opts: { from?: number; to?: number } = {}): ProjectDoc {
  const doc = createProject();
  const p = defaultPanel("P");
  p.lengthMm = 200;
  p.rootChordMm = CHORD;
  p.tipChordMm = CHORD;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.rootAirfoilId = "naca-0012";
  p.tipAirfoilId = null;
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.ribs = [0, 100, 200].map((pos, i) => ({ id: `r${i}`, positionMm: pos, thicknessMm: 3 }));
  const s = defaultSpar(p, "Aileron", "aileronCutter");
  s.distanceFrom = "TE";
  s.distance = { start: { unit: "pct", value: 25 }, end: null };
  s.spanStartMm = opts.from ?? 0;
  s.spanEndMm = opts.to ?? 200;
  s.aileron = a === null ? null : { ...defaultAileron(), ...a };
  p.spars = [s];
  doc.wing.panels = [p];
  return doc;
}
const rings = (doc: ProjectDoc, rib = 0) => rebuild(doc).ribs[rib].outline;
const area = (r: { x: number; y: number }[]) => Math.abs(r.reduce((s, p, i) => s + (p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y), 0)) / 2;
const total = (doc: ProjectDoc, rib = 0) => rings(doc, rib).reduce((s, r) => s + area(r), 0);
const xh = CHORD * 0.75; // 150
const T = (surfaceAt(foil, xh / CHORD).upper - surfaceAt(foil, xh / CHORD).lower) * CHORD;
/** Vertical extent of the rib material along the line x. */
const extentAt = (doc: ProjectDoc, x: number, rib = 0) => {
  const ys: number[] = [];
  for (const r of rings(doc, rib))
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  ys.sort((p, q) => p - q);
  return ys;
};

describe("aileronCut: the shapes", () => {
  const cut = (a: Partial<Aileron>) => aileronCut({ ...defaultAileron(), ...a }, 150, 12, -12);
  it("cut off, hinge above: the notch reaches right through and a bit beyond, narrowest at the hinge side", () => {
    const c = cut({ cutOff: true, hinge: "above", widthMm: 2, alphaDeg: 0, betaDeg: 0, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } })!;
    const ys = c.notch.map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(12); // through the top surface
    expect(Math.min(...ys)).toBeLessThan(-12); // and out of the bottom
    const xs = c.notch.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(149, 9);
    expect(Math.max(...xs)).toBeCloseTo(151, 9);
  });
  it("attached: the notch stops cutPct of the way through, from the surface opposite the hinge", () => {
    const above = cut({ cutOff: false, hinge: "above", cutPct: 50 })!;
    // hinge above, so it opens at the bottom (y = -12) and its apex is half the 24mm section up: y = 0
    expect(Math.max(...above.notch.map((p) => p.y))).toBeCloseTo(0, 9);
    const below = cut({ cutOff: false, hinge: "below", cutPct: 50 })!;
    expect(Math.min(...below.notch.map((p) => p.y))).toBeCloseTo(0, 9);
  });
  it("alpha tilts the wing-side face away from the hinge and beta the aileron-side face, widening the opening", () => {
    const c = cut({ cutOff: false, hinge: "above", cutPct: 50, widthMm: 1, alphaDeg: 0, betaDeg: 45, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } })!;
    const open = c.notch.filter((p) => p.y < -12); // the two points beyond the open surface
    expect(Math.min(...open.map((p) => p.x))).toBeCloseTo(149.5, 6); // alpha = 0: the wing face stays vertical
    expect(Math.max(...open.map((p) => p.x))).toBeGreaterThan(150.5 + 12 * 0.5); // beta = 45: leaning out by the depth
  });
  it("close-off recesses each face by its wall width, and only when enabled", () => {
    const base = cut({ closeLE: { enabled: false, widthMm: 5 }, closeTE: { enabled: false, widthMm: 5 }, alphaDeg: 0, betaDeg: 0, widthMm: 1 })!;
    const both = cut({ closeLE: { enabled: true, widthMm: 2 }, closeTE: { enabled: true, widthMm: 3 }, alphaDeg: 0, betaDeg: 0, widthMm: 1 })!;
    expect(Math.min(...both.notch.map((p) => p.x))).toBeCloseTo(Math.min(...base.notch.map((p) => p.x)) - 2, 9);
    expect(Math.max(...both.notch.map((p) => p.x))).toBeCloseTo(Math.max(...base.notch.map((p) => p.x)) + 3, 9);
    expect(base.wingWall).toBeNull();
    expect(base.aileronWall).toBeNull();
    expect(both.wingWall).not.toBeNull();
    expect(both.aileronWall).not.toBeNull();
  });
  it("a section with no depth gives no cut at all", () => {
    expect(aileronCut(defaultAileron(), 150, 3, 3)).toBeNull();
  });
});

describe("the aileron in a rib", () => {
  it("with no aileron settings it is still the simple cutter: everything behind the hinge goes", () => {
    const r = rings(wing(null));
    expect(r.length).toBe(1);
    expect(Math.max(...r.flat().map((p) => p.x))).toBeCloseTo(xh, 6);
  });
  it("cut off: the rib comes out in two pieces, a wing and an aileron, with the gap between them", () => {
    const r = rings(wing({ cutOff: true, widthMm: 2, alphaDeg: 0, betaDeg: 0, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } }));
    expect(r.length).toBe(2);
    const [front, back] = [...r].sort((a, b) => Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x)));
    expect(Math.max(...front.map((p) => p.x))).toBeCloseTo(xh - 1, 6);
    expect(Math.min(...back.map((p) => p.x))).toBeCloseTo(xh + 1, 6);
    expect(area(front)).toBeGreaterThan(100);
    expect(area(back)).toBeGreaterThan(10);
  });
  it("attached: one piece, and the hinge-side skin that is left is what is not cut", () => {
    const ys = extentAt(wing({ cutOff: false, cutPct: 50, hinge: "above", widthMm: 1, alphaDeg: 0, betaDeg: 30, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } }), xh);
    expect(rings(wing({ cutOff: false })).length).toBe(1);
    // at the hinge line the material runs from the top surface down to the notch apex: half the section
    expect(ys[ys.length - 1] - ys[ys.length - 2]).toBeCloseTo(T * 0.5, 1);
  });
  it("hinge below leaves the bottom skin instead of the top", () => {
    const d = wing({ cutOff: false, cutPct: 50, hinge: "below", widthMm: 0.4, alphaDeg: 0, betaDeg: 0, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } });
    const ys = extentAt(d, xh);
    const sf = surfaceAt(foil, xh / CHORD);
    expect(ys[0]).toBeCloseTo(sf.lower * CHORD, 3); // still reaches the bottom surface
    expect(ys[1]).toBeCloseTo(sf.lower * CHORD + T * 0.5, 1); // and stops at the apex
  });
  it("a deeper cut removes more material, and cutting right through removes the most", () => {
    const a = total(wing({ cutOff: false, cutPct: 25 }));
    const b = total(wing({ cutOff: false, cutPct: 75 }));
    const c = total(wing({ cutOff: true }));
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThanOrEqual(b);
  });
  it("only the ribs inside the aileron's span are cut", () => {
    const d = wing({ cutOff: true }, { from: 80, to: 200 });
    expect(rings(d, 0).length).toBe(1); // root rib at 0: outside the span, left whole
    expect(rings(d, 1).length).toBe(2); // mid-span rib at 100: inside
    expect(Math.max(...rings(d, 0).flat().map((p) => p.x))).toBeCloseTo(CHORD, 1);
  });
  it("the gap widens with the angles, as measured across the open surface", () => {
    const narrow = total(wing({ cutOff: false, cutPct: 80, alphaDeg: 0, betaDeg: 0 }));
    const wide = total(wing({ cutOff: false, cutPct: 80, alphaDeg: 20, betaDeg: 40 }));
    expect(wide).toBeLessThan(narrow);
  });
  it("the hinge distance follows the chord: 25% from the trailing edge is 25% of whatever the chord is", () => {
    const d = wing({ cutOff: true, widthMm: 2, alphaDeg: 0, betaDeg: 0, closeLE: { enabled: false, widthMm: 0 }, closeTE: { enabled: false, widthMm: 0 } });
    d.wing.panels[0].tipChordMm = 100;
    const root = rings(d, 0);
    const tip = rings(d, 2);
    const split = (r: typeof root) => [...r].sort((a, b) => Math.min(...a.map((p) => p.x)) - Math.min(...b.map((p) => p.x)));
    expect(Math.max(...split(root)[0].map((p) => p.x))).toBeCloseTo(0.75 * 200 - 1, 4);
    expect(Math.max(...split(tip)[0].map((p) => p.x))).toBeCloseTo(0.75 * 100 - 1, 4);
  });
});

describe("the close-off walls", () => {
  it("two thin walls, one on each cut face, run the length of the aileron", () => {
    const solids = rebuild(wing({ cutOff: true })).solids;
    expect(solids.filter((s) => s.kind === "webbing").length).toBe(2);
  });
  it("only the walls that are switched on are built", () => {
    expect(rebuild(wing({ closeLE: { enabled: false, widthMm: 1 } })).solids.length).toBe(1);
    expect(rebuild(wing({ closeLE: { enabled: false, widthMm: 1 }, closeTE: { enabled: false, widthMm: 1 } })).solids.length).toBe(0);
  });
  it("no aileron settings, no walls: the simple cutter removes material and adds none", () => {
    expect(rebuild(wing(null)).solids.length).toBe(0);
  });
  it("each wall is a valid closed solid, and together they hold the volume of two thin strips as deep as the section", () => {
    let volume = 0;
    for (const s of rebuild(wing({ cutOff: true, closeLE: { enabled: true, widthMm: 1 }, closeTE: { enabled: true, widthMm: 2 } })).solids) {
      const r = meshReport(buildMesh(s.positions));
      expect(r.closed && r.consistent).toBe(true);
      expect(r.degenerate).toBe(0);
      volume += Math.abs(r.volume);
    }
    // a 1mm wall and a 2mm wall, each the depth of the section at the hinge, 200mm long
    expect(volume).toBeGreaterThan(0.85 * (1 + 2) * T * 200);
    expect(volume).toBeLessThan(1.15 * (1 + 2) * T * 200);
  });
  it("the walls sit in the gap that the recess opens, not inside the rib", () => {
    const doc = wing({ cutOff: true, widthMm: 1, alphaDeg: 0, betaDeg: 0, closeLE: { enabled: true, widthMm: 1 }, closeTE: { enabled: true, widthMm: 1 } });
    const ribGap = rings(doc, 1).map((r) => [Math.min(...r.map((p) => p.x)), Math.max(...r.map((p) => p.x))]).sort((a, b) => a[0] - b[0]);
    const wingMax = ribGap[0][1];
    const ailMin = ribGap[1][0];
    for (const s of rebuild(doc).solids) {
      const xs: number[] = [];
      for (let i = 0; i < s.positions.length; i += 3) xs.push(s.positions[i + 1]); // OpenSCAD-free: wing coords are x,y,z; chord is x
      void xs;
      const cx = [] as number[];
      for (let i = 0; i < s.positions.length; i += 3) cx.push(s.positions[i]);
      expect(Math.min(...cx)).toBeGreaterThanOrEqual(wingMax - 1e-6);
      expect(Math.max(...cx)).toBeLessThanOrEqual(ailMin + 1e-6);
    }
  });
});
