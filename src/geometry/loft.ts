/**
 * Lofting: sweep a 2D cross-section along a panel's span to make something the
 * 3D view can draw.
 *
 * Only the viewport consumes this. The DXF and PDF exporters work from the rib
 * paths, which are the parts you actually cut, so nothing here can put a wrong
 * shape on a sheet of balsa.
 */
import { pocketStick } from "./sparPocket";
import type { Spar } from "../domain/schema";
import { surfaceAt } from "./airfoil";
import { aileronCut } from "./aileron";
import { circle, rect, rotate } from "./clipper";
import type { Path, Solid, Surfaces } from "./types";

export type SpanFrame = {
  /** rib-local origin in wing coordinates */
  origin: [number, number, number];
  dihedralRad: number;
  /** twist at this station, degrees. Ribs turn about the leading edge, so bars must too. */
  twistDeg: number;
  /** vertical shift the rib received from top/bottom alignment, mm */
  alignShiftMm: number;
};

/**
 * Section (x, y) to wing coordinates, in the same order the rib is made:
 * twist about the leading edge, then alignment, then dihedral. A bar lofted
 * without the first two floats off the rib it is meant to sit in.
 */
function toWorld(p: { x: number; y: number }, f: SpanFrame): [number, number, number] {
  const r = (-f.twistDeg * Math.PI) / 180;
  const tx = p.x * Math.cos(r) - p.y * Math.sin(r);
  const ty = p.x * Math.sin(r) + p.y * Math.cos(r) - f.alignShiftMm;
  const c = Math.cos(f.dihedralRad);
  const s = Math.sin(f.dihedralRad);
  // rotation about the chordwise axis by -dihedral, same as the rib meshes
  return [f.origin[0] + tx, f.origin[1] + ty * c, f.origin[2] - ty * s];
}

/** Two matching rings become a closed tube: a quad per edge, plus both caps. */
export function loft(a: Path, b: Path, fa: SpanFrame, fb: SpanFrame): number[] {
  const n = Math.min(a.length, b.length);
  if (n < 3) return [];
  const A = a.slice(0, n).map((p) => toWorld(p, fa));
  const B = b.slice(0, n).map((p) => toWorld(p, fb));
  const out: number[] = [];
  const push = (v: [number, number, number]) => out.push(v[0], v[1], v[2]);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push(A[i]); push(B[i]); push(B[j]);
    push(A[i]); push(B[j]); push(A[j]);
  }
  // Close the ends. Edge-stock crescents are concave, so a fan from one corner would
  // spill outside them; ear clipping triangulates any simple ring correctly.
  for (const [i, j, k] of triangulate(a.slice(0, n))) {
    push(A[i]); push(A[k]); push(A[j]);
    push(B[i]); push(B[j]); push(B[k]);
  }
  return out;
}

/** Ear clipping for a simple ring. Returns index triples; tolerates repeated points. */
export function triangulate(ring: Path): [number, number, number][] {
  const n = ring.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();

  const cross = (a: number, b: number, c: number) =>
    (ring[b].x - ring[a].x) * (ring[c].y - ring[a].y) - (ring[b].y - ring[a].y) * (ring[c].x - ring[a].x);
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;

  const tris: [number, number, number][] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      const turn = cross(a, b, c);
      if (Math.abs(turn) <= 1e-9) {
        idx.splice(i, 1); // a collinear or repeated point adds no area
        clipped = true;
        break;
      }
      if (turn < 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3 && Math.abs(cross(idx[0], idx[1], idx[2])) > 1e-9) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** A spar's solid cross-section at one station — the material, not the cut. */
export function sparSection(
  spar: Spar,
  chordMm: number,
  surfaces: Surfaces,
  spanT: number,
): { path: Path; kind: Solid["kind"] }[] {
  const along = (start: number, end: number | null) => (end === null ? start : start + (end - start) * spanT);

  const dStart = spar.distance.start.unit === "pct" ? (spar.distance.start.value / 100) * chordMm : spar.distance.start.value;
  const dEnd = spar.distance.end
    ? spar.distance.end.unit === "pct"
      ? (spar.distance.end.value / 100) * chordMm
      : spar.distance.end.value
    : null;
  const fromLE = along(dStart, dEnd);
  const xc = spar.distanceFrom === "LE" ? fromLE : chordMm - fromLE;
  if (xc < 0 || xc > chordMm) return [];

  const surf = surfaceAt(surfaces, chordMm === 0 ? 0 : xc / chordMm);
  const yTop = surf.upper * chordMm;
  const yBot = surf.lower * chordMm;

  switch (spar.type) {
    case "cuboid": {
      const w = along(spar.width?.start ?? 6, spar.width?.end ?? null);
      const h = along(spar.height?.start ?? 3, spar.height?.end ?? null);
      const cy = (yTop + yBot) / 2 + along(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null);
      const box = rect(xc - w / 2, cy - h / 2, xc + w / 2, cy + h / 2);
      return [{ path: spar.rotationDeg ? rotate(box, { x: xc, y: cy }, spar.rotationDeg) : box, kind: "spar" }];
    }
    case "rectangle": {
      const w = along(spar.width?.start ?? 6, spar.width?.end ?? null);
      const h = along(spar.height?.start ?? 3, spar.height?.end ?? null);
      const out: { path: Path; kind: Solid["kind"] }[] = [];
      // A notch: the stick fills the pocket the rib is cut with, wall for wall, so it sits in the ribs' notches however the surface slopes.
      const stick = (side: "upper" | "lower") =>
        pocketStick(surfaces, chordMm, { side, x0: xc - w / 2 - spar.gapForeMm, x1: xc + w / 2 + spar.gapAftMm, height: h, flat: spar.flat, verticalCut: spar.verticalCut });
      if (spar.positionTop) {
        const q = stick("upper");
        if (q) out.push({ path: q, kind: "spar" });
      }
      if (spar.positionBottom) {
        const q = stick("lower");
        if (q) out.push({ path: q, kind: "spar" });
      }
      if (!spar.positionTop && !spar.positionBottom) {
        // in neither surface: the stick sits in a rectangular hole through the middle of the rib
        const cy = (yTop + yBot) / 2 + along(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null);
        out.push({ path: rect(xc - w / 2, cy - h / 2, xc + w / 2, cy + h / 2), kind: "spar" });
      }
      return out;
    }
    case "webbing": {
      const w = along(spar.width?.start ?? 2, spar.width?.end ?? null);
      return [{ path: rect(xc - w / 2, yBot, xc + w / 2, yTop), kind: "webbing" }];
    }
    case "round":
    case "roundJoiner": {
      const r = spar.type === "round" ? along(spar.radiusMm ?? 3, spar.radiusEndMm ?? null) : (spar.radiusMm ?? 3);
      const oy = along(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null);
      return [{ path: circle(xc, (yTop + yBot) / 2 + oy, r, 20), kind: "spar" }];
    }
    case "cuboidJoiner": {
      const w = along(spar.width?.start ?? 6, spar.width?.end ?? null);
      const h = along(spar.height?.start ?? 6, spar.height?.end ?? null);
      const oy = along(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null);
      const cy = (yTop + yBot) / 2 + oy;
      return [{ path: rect(xc - w / 2, cy - h / 2, xc + w / 2, cy + h / 2), kind: "spar" }];
    }
    case "aileronCutter": {
      // The cut itself removes material. What it adds is the thin walls that close each cut face.
      const cut = spar.aileron ? aileronCut(spar.aileron, xc, yTop, yBot) : null;
      const walls = cut ? [cut.wingWall, cut.aileronWall] : [];
      return walls.filter((w): w is Path => w !== null).map((path) => ({ path, kind: "webbing" as const }));
    }
    default:
      return [];
  }
}
