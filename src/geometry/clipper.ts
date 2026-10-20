/**
 * Boolean operations on 2D paths.
 *
 * Clipper works in integers. Everything crossing this boundary is scaled by
 * SCALE and rounded exactly once, on the way in — rounding twice is how a
 * watertight outline turns into a sliver. SCALE of 1e4 gives 0.1 micron
 * resolution, which is four orders of magnitude finer than a balsa knife.
 */
import { Clipper, FillRule, Path64, Paths64, type IPoint64 } from "clipper2-js";
import type { Path } from "./types";

const SCALE = 1e4;

function toPaths64(paths: Path[]): Paths64 {
  const out = new Paths64();
  for (const p of paths) {
    if (p.length < 3) continue;
    const path = new Path64();
    for (const pt of p) {
      path.push({ x: Math.round(pt.x * SCALE), y: Math.round(pt.y * SCALE) } as IPoint64);
    }
    out.push(path);
  }
  return out;
}

function fromPaths64(paths: Paths64): Path[] {
  const out: Path[] = [];
  for (const p of paths) {
    if (p.length < 3) continue;
    out.push(p.map((pt) => ({ x: pt.x / SCALE, y: pt.y / SCALE })));
  }
  return out;
}

/** Signed area. Positive is counter-clockwise in a y-up system. */
export function signedArea(path: Path): number {
  let a = 0;
  for (let i = 0, n = path.length; i < n; i++) {
    const p = path[i];
    const q = path[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(path: Path): number {
  return Math.abs(signedArea(path));
}

/** Split a clipper result into outer rings and the voids inside them. */
export function classify(paths: Path[]): { outline: Path[]; holes: Path[] } {
  const outline: Path[] = [];
  const holes: Path[] = [];
  for (const p of paths) {
    (signedArea(p) >= 0 ? outline : holes).push(p);
  }
  return { outline, holes };
}

export function difference(subject: Path[], clip: Path[]): Path[] {
  if (clip.length === 0) return subject;
  return fromPaths64(Clipper.Difference(toPaths64(subject), toPaths64(clip), FillRule.NonZero));
}

export function union(subject: Path[], clip: Path[] = []): Path[] {
  return fromPaths64(Clipper.Union(toPaths64(subject), toPaths64(clip), FillRule.NonZero));
}

export function intersect(subject: Path[], clip: Path[]): Path[] {
  return fromPaths64(Clipper.Intersect(toPaths64(subject), toPaths64(clip), FillRule.NonZero));
}

/** Axis-aligned rectangle as a CCW ring. */
export function rect(x0: number, y0: number, x1: number, y1: number): Path {
  const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [c, d] = y0 <= y1 ? [y0, y1] : [y1, y0];
  return [
    { x: a, y: c },
    { x: b, y: c },
    { x: b, y: d },
    { x: a, y: d },
  ];
}

/** Circle as a CCW ring. 48 segments keeps a 6mm hole within 5 microns of round. */
export function circle(cx: number, cy: number, r: number, segments = 48): Path {
  const out: Path = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Rotate a ring about a pivot. */
export function rotate(path: Path, pivot: Pt2, deg: number): Path {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return path.map((p) => {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
  });
}

type Pt2 = { x: number; y: number };
