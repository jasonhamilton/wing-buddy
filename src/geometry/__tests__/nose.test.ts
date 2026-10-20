import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { resolveSurfaces } from "../../domain/airfoils";
import { createProject, defaultPanel } from "../../domain/doc";
import { fromSurfaces } from "../airfoil";
import type { ProjectDoc } from "../../domain/schema";
import type { Surfaces } from "../types";

/** A section with a lumpy nose, as an imported foil: the clean one plus deterministic noise. */
function lumpy(): Surfaces {
  const c = resolveSurfaces("naca-0012", [])!;
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const jig = (ys: number[]) => ys.map((y, i) => (i > 1 && c.x[i] <= 0.1 ? y + 0.0006 * rnd() : y));
  return { x: c.x, yUpper: jig(c.yUpper), yLower: jig(c.yLower) };
}

let counter = 0;
function wingWith(smooth: boolean, foil: "lumpy" | "clean"): ProjectDoc {
  // resolved airfoils are cached by id, as in the app where every airfoil has its own
  const id = `lump-${foil}-${++counter}`;
  const doc = createProject();
  const surfaces = foil === "lumpy" ? lumpy() : resolveSurfaces("naca-0012", [])!;
  const points = fromSurfaces(surfaces).map((p) => [p.x, p.y] as [number, number]);
  doc.airfoils = [{ id, name: "Lumpy", origin: "embedded", source: "dat", points, controlPoints: null, createdAt: "" } as never];
  const p = defaultPanel("P");
  p.lengthMm = 100;
  p.rootChordMm = 200;
  p.tipChordMm = 200;
  p.sweepMm = 0;
  p.dihedralDeg = 0;
  p.rootAirfoilId = id;
  p.tipAirfoilId = null;
  p.spars = [];
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  p.ribs = [{ id: "r0", positionMm: 0, thicknessMm: 3 }];
  p.noseSmoothing = { enabled: smooth, extentPct: 10 };
  doc.wing.panels = [p];
  return doc;
}

/** The upper surface of the first rib at the nose, as y at increasing x, in chord fractions. */
function upperNose(doc: ProjectDoc): { x: number; y: number }[] {
  const rib = rebuild(doc).ribs[0];
  return rib.outline
    .flat()
    .filter((p) => p.y > 0 && p.x < 0.1 * rib.chordMm && p.x > 0.002 * rib.chordMm)
    .map((p) => ({ x: p.x / rib.chordMm, y: p.y / rib.chordMm }))
    .sort((a, b) => a.x - b.x);
}

const rough = (pts: { x: number; y: number }[], clean: { x: number; y: number }[]) => {
  // error against the clean rib at the same stations, then its second differences
  const err = pts.map((p, i) => p.y - clean[Math.min(i, clean.length - 1)].y);
  let r = 0;
  for (let i = 1; i < err.length - 1; i++) r += (err[i + 1] - 2 * err[i] + err[i - 1]) ** 2;
  return r;
};

describe("nose smoothing on a panel", () => {
  const clean = upperNose(wingWith(false, "clean"));
  it("the clean section is not changed by it (the rib is the section, either way)", () => {
    const a = upperNose(wingWith(false, "clean"));
    const b = upperNose(wingWith(true, "clean"));
    expect(b.length).toBe(a.length);
    b.forEach((p, i) => expect(Math.abs(p.y - a[i].y)).toBeLessThan(4e-4));
  });
  it("a lumpy imported nose comes out of the rib smoother when smoothing is on, and not when it is off", () => {
    const off = upperNose(wingWith(false, "lumpy"));
    const on = upperNose(wingWith(true, "lumpy"));
    expect(rough(on, clean)).toBeLessThan(rough(off, clean) * 0.5);
  });
  it("is off by default, so no existing project changes", () => {
    expect(defaultPanel("x").noseSmoothing).toEqual({ enabled: false, extentPct: 8 });
  });
  it("leaves the rib behind the nose exactly as it was", () => {
    const rib = (d: ProjectDoc) => rebuild(d).ribs[0].outline.flat().filter((p) => p.x > 0.15 * 200).map((p) => [p.x, p.y]);
    expect(rib(wingWith(true, "lumpy"))).toEqual(rib(wingWith(false, "lumpy")));
  });
});
