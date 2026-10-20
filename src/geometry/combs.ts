/**
 * Rib combs. A comb is a thin wall that runs along the span, standing in slots cut in the ribs on the top
 * or the bottom surface. Between the ribs the wall reaches deeper than the slot floor, so it has a tooth
 * there; at each rib the wall has a slit that the rib's own material passes through. The two lock together
 * like a halving joint, which is what holds the ribs square while the glue sets.
 */
import { uid } from "../domain/doc";
import type { Panel, RibComb } from "../domain/schema";
import { surfaceAt } from "./airfoil";
import { rect, rotate } from "./clipper";
import { loft, type SpanFrame } from "./loft";
import { along } from "./sheeting";
import type { Path, Solid, Surfaces, Warning } from "./types";

export function defaultComb(panel: Panel, name: string, type: "above" | "below"): RibComb {
  return {
    id: uid(),
    name,
    type,
    color: "standard",
    spanStartMm: 0,
    spanEndMm: panel.lengthMm,
    distanceFrom: "LE",
    distance: { start: { unit: "pct", value: 30 }, end: null },
    angleDeg: 90,
    widthMm: 2,
    extendMm: 0,
    asTabs: false,
    leveled: false,
    cutIntoRibPct: 50,
    gapForeMm: 0,
    gapAftMm: 0,
    needleAdjustmentMm: 0,
    slitHeightMm: 2,
    slitAdjustMm: 0,
  };
}

/** Where the comb stands along the chord at this station, millimetres from the leading edge. */
export function combStation(comb: RibComb, chordMm: number, spanT: number): number {
  const d = along(comb.distance, chordMm, spanT);
  return comb.distanceFrom === "LE" ? d : chordMm - d;
}

const inSpan = (comb: RibComb, positionMm: number) => positionMm >= comb.spanStartMm - 1e-6 && positionMm <= comb.spanEndMm + 1e-6;

type SectionAt = (positionMm: number) => { t: number; chordMm: number; surfaces: Surfaces };

/** The depth of the slot at a station: a share of the section's depth there, plus the needle allowance. */
function slotDepth(comb: RibComb, chordMm: number, surfaces: Surfaces, xc: number): number {
  const s = surfaceAt(surfaces, Math.min(1, Math.max(0, xc / chordMm)));
  return (comb.cutIntoRibPct / 100) * (s.upper - s.lower) * chordMm + comb.needleAdjustmentMm;
}

/**
 * With "leveled", every slot is as deep as the shallowest in the run, so the comb's floor is at one depth
 * below the surface all along. Returns the depth per comb id, for the combs that ask for it.
 */
export function levelledDepths(panel: Panel, sectionAt: SectionAt): Record<string, number> {
  const out: Record<string, number> = {};
  for (const comb of panel.ribCombs ?? []) {
    if (!comb.leveled) continue;
    let m = Infinity;
    for (const rib of panel.ribs) {
      if (!inSpan(comb, rib.positionMm)) continue;
      const sec = sectionAt(rib.positionMm);
      const xc = combStation(comb, sec.chordMm, sec.t);
      if (xc < 0 || xc > sec.chordMm) continue;
      m = Math.min(m, slotDepth(comb, sec.chordMm, sec.surfaces, xc));
    }
    if (Number.isFinite(m)) out[comb.id] = m;
  }
  return out;
}

/** How far a slot's rectangle reaches out past the surface, so nothing is left behind. */
const REACH = 10;

/** A rectangle on the wall's line: `inner` and `outer` are heights above the surface (negative is inside). */
function wallRect(comb: RibComb, xc: number, ySurface: number, x0: number, x1: number, inner: number, outer: number): Path {
  const sign = comb.type === "above" ? 1 : -1;
  const ya = ySurface + sign * inner;
  const yb = ySurface + sign * outer;
  const ring = rect(x0, Math.min(ya, yb), x1, Math.max(ya, yb));
  const lean = comb.angleDeg - 90;
  return lean === 0 ? ring : rotate(ring, { x: xc, y: ySurface }, lean);
}

/**
 * The slots one rib gets from the combs, and anything worth saying about them. The rib is cut after the
 * edge stock and the sheeting and before the spars, like the other notches.
 */
export function combNotches(
  panel: Panel,
  positionMm: number,
  chordMm: number,
  surfaces: Surfaces,
  spanT: number,
  levels: Record<string, number> | undefined,
  warn: (w: Warning) => void,
  fmt: (mm: number, d?: number) => string,
): Path[] {
  const out: Path[] = [];
  for (const comb of panel.ribCombs ?? []) {
    if (!inSpan(comb, positionMm)) continue;
    const xc = combStation(comb, chordMm, spanT);
    if (xc < 0 || xc > chordMm) {
      warn({ level: "warn", message: `${comb.name || "A comb"} sits ${fmt(xc < 0 ? -xc : xc - chordMm)} outside the chord here.` });
      continue;
    }
    const s = surfaceAt(surfaces, chordMm === 0 ? 0 : xc / chordMm);
    const height = (s.upper - s.lower) * chordMm;
    const ySurface = (comb.type === "above" ? s.upper : s.lower) * chordMm;
    const depth = Math.max(0, levels?.[comb.id] ?? slotDepth(comb, chordMm, surfaces, xc));
    if (depth >= height - 0.5) {
      warn({
        level: "warn",
        message: `${comb.name || "A comb"} cuts ${fmt(depth)} into a section only ${fmt(height)} deep here, which leaves almost nothing of the rib.`,
      });
    }
    out.push(wallRect(comb, xc, ySurface, xc - comb.widthMm / 2 - comb.gapForeMm, xc + comb.widthMm / 2 + comb.gapAftMm, -depth, REACH));
  }
  return out;
}

/** The wall's cross-section at one station: the floor `slitMm` below the slot floor for a tooth, at the floor for a slit. */
function wallRing(comb: RibComb, sec: ReturnType<SectionAt>, levels: Record<string, number>, slitMm: number): Path | null {
  const xc = combStation(comb, sec.chordMm, sec.t);
  if (xc < 0 || xc > sec.chordMm) return null;
  const s = surfaceAt(sec.surfaces, sec.chordMm === 0 ? 0 : xc / sec.chordMm);
  const ySurface = (comb.type === "above" ? s.upper : s.lower) * sec.chordMm;
  const depth = Math.max(0, levels[comb.id] ?? slotDepth(comb, sec.chordMm, sec.surfaces, xc));
  const outer = comb.asTabs ? 0 : Math.max(0, comb.extendMm);
  return wallRect(comb, xc, ySurface, xc - comb.widthMm / 2, xc + comb.widthMm / 2, -depth - slitMm, outer);
}

/** The combs as solids for the 3D view and the exports. */
export function combSolids(panel: Panel, sectionAt: SectionAt, frameAt: (positionMm: number) => SpanFrame, levels: Record<string, number>): Solid[] {
  const out: Solid[] = [];
  for (const comb of panel.ribCombs ?? []) {
    const ribs = panel.ribs.filter((r) => inSpan(comb, r.positionMm)).sort((a, b) => a.positionMm - b.positionMm);
    if (ribs.length === 0) continue;
    const colour = comb.color !== "standard" ? { color: comb.color } : {};
    const piece = (id: string, z0: number, z1: number, slit: number) => {
      if (z1 - z0 < 0.05) return;
      const a = wallRing(comb, sectionAt(z0), levels, slit);
      const b = wallRing(comb, sectionAt(z1), levels, slit);
      if (!a || !b) return;
      const positions = loft(a, b, frameAt(z0), frameAt(z1));
      if (positions.length) out.push({ id, panelId: panel.id, kind: "comb", positions, ...colour });
    };
    // the slit around a rib is as wide as the rib plus the allowance
    const window = (rib: { positionMm: number; thicknessMm: number }): [number, number] => {
      const half = (rib.thicknessMm + comb.slitAdjustMm) / 2;
      return [Math.max(0, rib.positionMm - half), Math.min(panel.lengthMm, rib.positionMm + half)];
    };
    ribs.forEach((rib, i) => {
      const [w0, w1] = window(rib);
      piece(`${comb.id}-rib-${rib.id}`, w0, w1, 0);
      if (!comb.asTabs && i < ribs.length - 1) {
        const next = window(ribs[i + 1]);
        piece(`${comb.id}-tooth-${i}`, w1, next[0], Math.max(0, comb.slitHeightMm));
      }
    });
  }
  return out;
}
