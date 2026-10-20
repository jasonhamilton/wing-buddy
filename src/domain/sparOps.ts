/**
 * Spar actions behind the S07 context menu. Pure: each returns what to write,
 * the caller decides how (so each is one undo step through the store).
 */
import { chordAt } from "../geometry";
import { foilMetrics } from "./airfoils";
import { uid } from "./doc";
import type { Airfoil, Measure, Panel, Spar } from "./schema";

/** Chordwise position of the point of maximum thickness at a spanwise station, % of chord from the LE. */
export function maxThicknessPct(panel: Panel, embedded: Airfoil[], stationMm: number): number | null {
  const root = foilMetrics(panel.rootAirfoilId, embedded);
  if (!root) return null;
  const tipId = panel.tipAirfoilId ?? panel.rootAirfoilId;
  const tip = foilMetrics(tipId, embedded) ?? root;
  const t = panel.lengthMm > 0 ? Math.min(1, Math.max(0, stationMm / panel.lengthMm)) : 0;
  return root.maxThicknessAtPct + (tip.maxThicknessAtPct - root.maxThicknessAtPct) * t;
}

const round = (n: number) => Number(n.toFixed(3));

/** Put the spar on the thickest part of the section, in whichever unit it already uses. */
export function moveToMaxThickness(panel: Panel, spar: Spar, embedded: Airfoil[]): Partial<Spar> | null {
  const place = (m: Measure, stationMm: number): Measure | null => {
    const pct = maxThicknessPct(panel, embedded, stationMm);
    if (pct === null) return null;
    const fromEdge = spar.distanceFrom === "LE" ? pct : 100 - pct;
    if (m.unit === "pct") return { unit: "pct", value: round(fromEdge) };
    const t = panel.lengthMm > 0 ? stationMm / panel.lengthMm : 0;
    return { unit: "mm", value: round((fromEdge / 100) * chordAt(panel, Math.min(1, Math.max(0, t)))) };
  };
  const start = place(spar.distance.start, spar.spanStartMm);
  if (!start) return null;
  const end = spar.distance.end ? place(spar.distance.end, spar.spanEndMm) : null;
  return { distance: { start, end: spar.distance.end ? end : null } };
}

/**
 * Line a spar up with one in the neighbouring panel so the two meet at the joint.
 * "previous": this spar starts where that one ends. "next": this one ends where that one starts.
 */
export function alignWith(spar: Spar, source: Spar, direction: "previous" | "next"): Partial<Spar> {
  if (direction === "previous") {
    const at = source.distance.end ?? source.distance.start;
    return {
      distanceFrom: source.distanceFrom,
      distance: { start: { ...at }, end: spar.distance.end && sameAs(spar.distance.end, at) ? null : spar.distance.end },
    };
  }
  return {
    distanceFrom: source.distanceFrom,
    distance: {
      start: spar.distance.start,
      end: sameAs(spar.distance.start, source.distance.start) ? null : { ...source.distance.start },
    },
  };
}

const sameAs = (a: Measure, b: Measure) => a.unit === b.unit && a.value === b.value;

export function copyOf(spar: Spar): Spar {
  return { ...structuredClone(spar), id: uid(), name: `${spar.name} copy` };
}

/** A new spar just ahead of or behind this one, a tenth of the chord (or 10mm) away. */
export function neighbour(panel: Panel, spar: Spar, where: "front" | "behind", name: string): Spar {
  const base = structuredClone(spar);
  const step = 10;
  const towardLE = where === "front" ? 1 : -1;
  const sign = spar.distanceFrom === "LE" ? -towardLE : towardLE;
  const move = (m: Measure): Measure => ({ ...m, value: round(Math.max(0, m.value + sign * step)) });
  return {
    ...base,
    id: uid(),
    name,
    distance: { start: move(base.distance.start), end: base.distance.end ? move(base.distance.end) : null },
    webbing: null,
    aileron: null,
    spanStartMm: spar.spanStartMm,
    spanEndMm: Math.min(spar.spanEndMm, panel.lengthMm),
  };
}
