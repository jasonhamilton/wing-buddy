/**
 * NACA 4-digit airfoil generator.
 *
 * Written from the published NACA series equations so the app ships a usable
 * starter library without copying anybody's coordinate files. Commercial wing tools
 * bundle ~1500 foils sourced from the Airfoil Investigation Database; that
 * bundle is not ours to redistribute. Users bring their own with .dat import.
 */
import type { Pt } from "../geometry/types";

/** Cosine-spaced stations: dense at the leading edge, where curvature is. */
export function cosineStations(n: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push((1 - Math.cos((Math.PI * i) / n)) / 2);
  return xs;
}

/** Half-thickness distribution. The classic -0.1015 term leaves the trailing edge open (about 0.2 % of the chord thick at 10 % thickness). */
function halfThickness(t: number, x: number): number {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
  );
}

function camberLine(m: number, p: number, x: number): { yc: number; dy: number } {
  if (m === 0 || p === 0) return { yc: 0, dy: 0 };
  if (x < p) {
    return { yc: (m / (p * p)) * (2 * p * x - x * x), dy: ((2 * m) / (p * p)) * (p - x) };
  }
  const q = (1 - p) * (1 - p);
  return { yc: (m / q) * (1 - 2 * p + 2 * p * x - x * x), dy: ((2 * m) / q) * (p - x) };
}

/**
 * Generate a NACA 4-digit section, e.g. "2412".
 * Returns Selig order: trailing edge, over the top to the nose, under to the
 * trailing edge. Chord is 1.
 */
export function naca4(code: string, n = 100): Pt[] {
  if (!/^\d{4}$/.test(code)) throw new Error(`not a 4-digit NACA code: ${code}`);
  const m = Number(code[0]) / 100;
  const p = Number(code[1]) / 10;
  const t = Number(code.slice(2)) / 100;

  const xs = cosineStations(n);
  const upper: Pt[] = [];
  const lower: Pt[] = [];

  for (const x of xs) {
    const yt = halfThickness(t, x);
    const { yc, dy } = camberLine(m, p, x);
    const th = Math.atan(dy);
    const sin = Math.sin(th);
    const cos = Math.cos(th);
    upper.push({ x: x - yt * sin, y: yc + yt * cos });
    lower.push({ x: x + yt * sin, y: yc - yt * cos });
  }

  // TE -> LE along the top, then LE -> TE along the bottom, without doubling the nose.
  return [...upper.reverse(), ...lower.slice(1)];
}

export type BuiltinFoil = { id: string; name: string; code: string; note: string };

/**
 * The starter library. Deliberately small and generated, not harvested: enough
 * to design a real wing, and a clear prompt to import the foil you actually want.
 */
export const BUILTIN_FOILS: BuiltinFoil[] = [
  { id: "naca-0009", name: "NACA 0009", code: "0009", note: "Thin symmetrical — tails, fins" },
  { id: "naca-0012", name: "NACA 0012", code: "0012", note: "Symmetrical — aerobatic wings" },
  { id: "naca-0015", name: "NACA 0015", code: "0015", note: "Thick symmetrical — 3D flying" },
  { id: "naca-1410", name: "NACA 1410", code: "1410", note: "Low camber — fast sport" },
  { id: "naca-2410", name: "NACA 2410", code: "2410", note: "Thin, mild camber — sport and scale" },
  { id: "naca-2412", name: "NACA 2412", code: "2412", note: "General purpose trainer" },
  { id: "naca-2415", name: "NACA 2415", code: "2415", note: "Thicker trainer, docile stall" },
  { id: "naca-4412", name: "NACA 4412", code: "4412", note: "High lift — slow flyers" },
  { id: "naca-4415", name: "NACA 4415", code: "4415", note: "High lift, thick — cargo" },
  { id: "naca-6409", name: "NACA 6409", code: "6409", note: "Very high camber — floaters" },
];
