import { describe, expect, it } from "vitest";
import { buildScad, ribMatrix, SCAD_DEFAULTS, type ScadOptions } from "../scad";
import { rebuild } from "../../geometry";
import { seedProject } from "../../domain/seed";

const doc = seedProject();
const geometry = rebuild(doc);
const make = (o: Partial<ScadOptions> = {}) => buildScad(doc, geometry, { ...SCAD_DEFAULTS, ...o });
const count = (text: string, needle: string) => text.split(needle).length - 1;

/** The wing's own coordinates for a point in a rib's plane, as the 3D view places it. */
function viewerWorld(rib: (typeof geometry.ribs)[0], lx: number, ly: number, lz: number): [number, number, number] {
  const c = Math.cos(rib.dihedralRad);
  const s = Math.sin(rib.dihedralRad);
  return [rib.origin[0] + lx, rib.origin[1] + ly * c + lz * s, rib.origin[2] - ly * s + lz * c];
}
const apply = (m: number[][], p: number[]) => [0, 1, 2].map((r) => m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3]);

describe("ribMatrix: rib-local to OpenSCAD axes (X = span, Y = chord, Z = up)", () => {
  it("puts every rib point where the 3D view puts it, with the axes renamed span, chord, up", () => {
    for (const rib of [geometry.ribs[0], geometry.ribs[8], geometry.ribs.at(-1)!]) {
      const m = ribMatrix(rib);
      for (const p of [[0, 0, 0], [50, 10, 0], [120, -8, 1.5], [200, 3, -1.5]]) {
        const [wx, wy, wz] = viewerWorld(rib, p[0], p[1], p[2]);
        const got = apply(m, p);
        expect(got[0]).toBeCloseTo(wz, 9); // X is the span
        expect(got[1]).toBeCloseTo(wx, 9); // Y is the chord
        expect(got[2]).toBeCloseTo(wy, 9); // Z is up
      }
    }
  });
  it("is a rotation and a move, never a reflection: the wing is not mirrored by the export", () => {
    const m = ribMatrix(geometry.ribs.at(-1)!);
    const [a, b, c] = [m[0], m[1], m[2]];
    const det =
      a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(det).toBeCloseTo(1, 9);
  });
});

describe("buildScad: the file", () => {
  const text = make();
  it("says what it is and what the axes are, in millimetres, and is the same every time", () => {
    expect(text).toMatch(/OpenSCAD/);
    expect(text).toMatch(/millimetres/i);
    expect(text).toMatch(/X = span/);
    expect(make()).toBe(text);
  });
  it("has one extruded outline per rib per half... in the module, once", () => {
    expect(count(text, "linear_extrude(")).toBe(geometry.ribs.length);
  });
  it("has one polyhedron per spar, webbing, leading-edge and trailing-edge member, and none for the carved-away excess", () => {
    const members = geometry.solids.filter((s) => !s.kind.endsWith("Excess")).length;
    expect(count(text, "polyhedron(")).toBe(members);
  });
  it("is syntactically balanced and has no NaN or Infinity", () => {
    for (const [o, c] of [["(", ")"], ["[", "]"], ["{", "}"]]) expect(count(text, o)).toBe(count(text, c));
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("every number is finite and short enough to be a sensible millimetre value", () => {
    const nums = text.match(/-?\d+\.?\d*(e-?\d+)?/g)!.map(Number);
    expect(nums.every(Number.isFinite)).toBe(true);
    expect(Math.max(...nums.map(Math.abs))).toBeLessThan(10_000);
  });
  it("each polyhedron is wound the way OpenSCAD wants (negative volume), which the mesh tests guarantee", () => {
    expect(text).toMatch(/polyhedron\(points=\[/);
    expect(text).toMatch(/faces=\[/);
  });
});

describe("buildScad: the options", () => {
  it("ribs only: no polyhedron at all", () => {
    const t = make({ ribs: true, leadingEdge: false, trailingEdge: false, spars: false });
    expect(count(t, "polyhedron(")).toBe(0);
    expect(count(t, "linear_extrude(")).toBe(geometry.ribs.length);
  });
  it("spars only: no ribs, and only spar and webbing members", () => {
    const t = make({ ribs: false, leadingEdge: false, trailingEdge: false, spars: true });
    expect(count(t, "linear_extrude(")).toBe(0);
    const n = geometry.solids.filter((s) => s.kind === "spar" || s.kind === "webbing").length;
    expect(count(t, "polyhedron(")).toBe(n);
  });
  it("leading edge only, and trailing edge only, pick out just those members", () => {
    const le = geometry.solids.filter((s) => s.kind === "leadingEdge").length;
    const te = geometry.solids.filter((s) => s.kind === "trailingEdge").length;
    expect(count(make({ ribs: false, leadingEdge: true, trailingEdge: false, spars: false }), "polyhedron(")).toBe(le);
    expect(count(make({ ribs: false, leadingEdge: false, trailingEdge: true, spars: false }), "polyhedron(")).toBe(te);
  });
  it("nothing chosen still writes a valid, empty file rather than failing", () => {
    const t = make({ ribs: false, leadingEdge: false, trailingEdge: false, spars: false });
    expect(count(t, "linear_extrude(") + count(t, "polyhedron(")).toBe(0);
    expect(count(t, "{")).toBe(count(t, "}"));
  });
  it("both halves adds the mirror, one half does not", () => {
    expect(make({ bothHalves: true })).toMatch(/mirror\(\[1, ?0, ?0\]\)/);
    expect(make({ bothHalves: false })).not.toMatch(/mirror\(/);
  });
  it("spacing between panels moves each panel further out by one more step", () => {
    const t = make({ panelSpacingMm: 50 });
    expect(t).toMatch(/translate\(\[50, ?0, ?0\]\)\s*panel_2\(\)/);
    expect(make({ panelSpacingMm: 0 })).not.toMatch(/translate\(\[\d+, ?0, ?0\]\)\s*panel_2/);
  });
  it("the gap between the wing halves is honoured", () => {
    const d = seedProject();
    d.wing.wingHalvesDistanceMm = 30;
    const t = buildScad(d, rebuild(d), { ...SCAD_DEFAULTS, bothHalves: true });
    expect(t).toMatch(/translate\(\[15, ?0, ?0\]\)/);
  });
  it("a project with no ribs yet writes a file that says so", () => {
    const d = seedProject();
    d.wing.panels.forEach((p) => (p.ribs = []));
    const t = buildScad(d, rebuild(d), SCAD_DEFAULTS);
    expect(count(t, "linear_extrude(")).toBe(0);
  });
  it("a project name with odd characters cannot break out of the comment", () => {
    const d = seedProject();
    d.name = "Evil */ wing\nmodule x() {} // ☃";
    const t = buildScad(d, rebuild(d), SCAD_DEFAULTS);
    expect(t.split("\n")[0].startsWith("//")).toBe(true);
    expect(t).not.toMatch(/\nmodule x\(\)/);
  });
});
