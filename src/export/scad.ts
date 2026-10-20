/**
 * OpenSCAD writer: the wing as a 3D model.
 *
 * Ribs are written as extruded outlines (an outline with its holes, one rib thick) and placed with a
 * single matrix; spars, webbing and edge stock are written as polyhedra. Everything is in millimetres.
 * The axes are renamed for a modeller, who expects Z up: X is the span, Y the chord and Z up. That is
 * a rotation of the wing's own axes, never a reflection, so the model is not a mirror image.
 *
 * Deterministic: the same project writes the same text, with no timestamp, so the file diffs cleanly.
 */
import type { ProjectDoc } from "../domain/schema";
import type { GeometryResult, Path, RibGeometry, Solid } from "../geometry/types";
import { buildMesh } from "./mesh";

export type ScadOptions = {
  ribs: boolean;
  leadingEdge: boolean;
  trailingEdge: boolean;
  /** spars and webbing */
  spars: boolean;
  sheeting: boolean;
  combs: boolean;
  bothHalves: boolean;
  /** extra distance between one panel and the next, so the panels can be pulled apart */
  panelSpacingMm: number;
};

export const SCAD_DEFAULTS: ScadOptions = {
  ribs: true,
  leadingEdge: true,
  trailingEdge: true,
  spars: true,
  sheeting: true,
  combs: true,
  bothHalves: true,
  panelSpacingMm: 0,
};

const num = (v: number): string => {
  const r = Number(v.toFixed(4));
  return String(Object.is(r, -0) ? 0 : r);
};

/** Wing coordinates (x chord, y up, z span) to OpenSCAD's (X span, Y chord, Z up): a cyclic permutation, so a rotation. */
const toScad = (x: number, y: number, z: number): [number, number, number] => [z, x, y];

/** The matrix that carries a rib's own (x, y, z) into the model. Rows are X, Y, Z, then [0, 0, 0, 1]. */
export function ribMatrix(rib: RibGeometry): number[][] {
  const c = Math.cos(rib.dihedralRad);
  const s = Math.sin(rib.dihedralRad);
  const [ox, oy, oz] = rib.origin;
  return [
    [0, -s, c, oz],
    [1, 0, 0, ox],
    [0, c, s, oy],
    [0, 0, 0, 1],
  ];
}

const pointInRing = (p: { x: number; y: number }, ring: Path): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

function polygonText(outer: Path, holes: Path[]): string {
  const rings = [outer, ...holes];
  const points = rings.flatMap((r) => r.map((p) => `[${num(p.x)}, ${num(p.y)}]`));
  let at = 0;
  const paths = rings.map((r) => {
    const ids = r.map((_, i) => at + i);
    at += r.length;
    return `[${ids.join(", ")}]`;
  });
  return `polygon(points=[${points.join(", ")}], paths=[${paths.join(", ")}])`;
}

function ribText(rib: RibGeometry, thickness: number): string[] {
  const m = ribMatrix(rib);
  const matrix = `[${m.map((r) => `[${r.map(num).join(", ")}]`).join(", ")}]`;
  const out: string[] = [];
  for (const outer of rib.outline) {
    if (outer.length < 3) continue;
    const mine = rib.holes.filter((h) => h.length > 0 && pointInRing(h[0], outer));
    out.push(`multmatrix(${matrix}) linear_extrude(height=${num(thickness)}, center=true) ${polygonText(outer, mine)};`);
  }
  return out;
}

function solidText(solid: Solid): string | null {
  const mesh = buildMesh(solid.positions);
  if (mesh.faces.length < 4) return null;
  const pts = mesh.points.map(([x, y, z]) => {
    const [a, b, c] = toScad(x, y, z);
    return `[${num(a)}, ${num(b)}, ${num(c)}]`;
  });
  const faces = mesh.faces.map((f) => `[${f.join(", ")}]`);
  return `polyhedron(points=[${pts.join(", ")}], faces=[${faces.join(", ")}]);`;
}

const keep = (s: Solid, o: ScadOptions): boolean => {
  if (s.kind === "spar" || s.kind === "webbing") return o.spars;
  if (s.kind === "sheeting") return o.sheeting;
  if (s.kind === "comb") return o.combs;
  if (s.kind === "leadingEdge") return o.leadingEdge;
  if (s.kind === "trailingEdge") return o.trailingEdge;
  return false; // the excess is what gets carved away: it is not part of the finished wing
};

export function buildScad(doc: ProjectDoc, geometry: GeometryResult, opts: ScadOptions): string {
  const name = doc.name.replace(/[\u0000-\u001f\u2028\u2029]+/g, " ").trim() || "wing";
  const lines: string[] = [
    `// Wing Buddy export for OpenSCAD: ${name}`,
    "// All dimensions are in millimetres. X = span (the root is at 0), Y = chord, Z = up.",
    "// wing_half() is one half of the wing; the other half is its mirror image.",
    "",
  ];

  doc.wing.panels.forEach((panel, i) => {
    lines.push(`module panel_${i + 1}() { // ${panel.name.replace(/[\u0000-\u001f\u2028\u2029]+/g, " ")}`);
    if (opts.ribs) {
      for (const rib of geometry.ribs.filter((r) => r.panelId === panel.id)) {
        const thickness = panel.ribs.find((r) => r.id === rib.ribId)?.thicknessMm ?? 3;
        for (const t of ribText(rib, thickness)) lines.push(`  ${t}`);
      }
    }
    for (const s of geometry.solids.filter((x) => x.panelId === panel.id && keep(x, opts))) {
      const t = solidText(s);
      if (t) lines.push(`  ${t}`);
    }
    lines.push("}", "");
  });

  lines.push("module wing_half() {");
  const gap = doc.wing.wingHalvesDistanceMm / 2;
  const indent = gap > 0 ? "    " : "  ";
  if (gap > 0) lines.push(`  translate([${num(gap)}, 0, 0]) {`);
  doc.wing.panels.forEach((_, i) => {
    const step = i * opts.panelSpacingMm;
    lines.push(step > 0 ? `${indent}translate([${num(step)}, 0, 0]) panel_${i + 1}();` : `${indent}panel_${i + 1}();`);
  });
  if (gap > 0) lines.push("  }");
  lines.push("}", "", "wing_half();");
  if (opts.bothHalves) lines.push("mirror([1, 0, 0]) wing_half();");
  lines.push("");
  return lines.join("\n");
}
