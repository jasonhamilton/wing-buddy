/**
 * Sheeting. Thin sheets glued over the ribs, either one "standard" sheet from the leading edge or a list
 * of named strips (and cap strips, which sit on each rib). A strip covers a band of the chord on the top
 * and/or the bottom surface, for a run of ribs. Under it each rib is cut back by the sheet's thickness, so
 * the finished surface is the airfoil and not the airfoil plus a layer.
 */
import { edgeEntries } from "./edgeList";
import { uid } from "../domain/doc";
import type { Measure, Panel, SheetStrip, Span } from "../domain/schema";
import { surfaceAt } from "./airfoil";
import { difference, signedArea } from "./clipper";
import { loft, type SpanFrame } from "./loft";
import type { Path, Solid, Surfaces } from "./types";

export type Band = {
  /** chordwise extent, millimetres from the leading edge */
  x0: number;
  x1: number;
  above: boolean;
  below: boolean;
  thicknessMm: number;
  /** a cap strip: a narrow strip on each rib, rather than a continuous sheet */
  cap: boolean;
  /** the strip it came from; null for standard sheeting */
  strip: SheetStrip | null;
};

/** A strip as a modeller would start it: from the nose, 27% of the chord, 1.5mm, both surfaces, the whole span. */
export function defaultStrip(panel: Panel, name: string): SheetStrip {
  return {
    id: uid(),
    name,
    color: "standard",
    spanStartMm: 0,
    spanEndMm: panel.lengthMm,
    startingAt: "LE",
    capStrip: false,
    distance: { start: { unit: "pct", value: 0 }, end: null },
    length: { start: { unit: "pct", value: 27 }, end: null },
    thicknessMm: 1.5,
    applyAbove: true,
    applyBelow: true,
  };
}

export const resolve = (m: Measure, chord: number) => (m.unit === "pct" ? (m.value / 100) * chord : m.value);

/** A start/end pair resolved against the chord and blended along the span. One value means one value throughout. */
export function along(span: Span, chord: number, t: number): number {
  const a = resolve(span.start, chord);
  if (!span.end) return a;
  const b = resolve(span.end, chord);
  return a + (b - a) * t;
}

const MIN_BAND_MM = 0.05;

/** The band one strip covers at a station, or null when it does not cover it. */
export function stripBand(strip: SheetStrip, chord: number, spanT: number, positionMm: number): Band | null {
  if (positionMm < strip.spanStartMm - 1e-6 || positionMm > strip.spanEndMm + 1e-6) return null;
  const d = along(strip.distance, chord, spanT);
  const len = along(strip.length, chord, spanT);
  const [raw0, raw1] = strip.startingAt === "LE" ? [d, d + len] : [chord - d - len, chord - d];
  const x0 = Math.max(0, raw0);
  const x1 = Math.min(chord, raw1);
  if (x1 - x0 < MIN_BAND_MM) return null;
  return { x0, x1, above: strip.applyAbove, below: strip.applyBelow, thicknessMm: strip.thicknessMm, cap: strip.capStrip, strip };
}

function standardBand(panel: Panel, chord: number): Band | null {
  const len = panel.sheeting.standardLength ?? { unit: "pct" as const, value: 30 };
  const x1 = Math.min(chord, resolve(len, chord));
  if (x1 < MIN_BAND_MM) return null;
  return { x0: 0, x1, above: true, below: true, thicknessMm: panel.sheeting.standardThicknessMm ?? 1.5, cap: false, strip: null };
}

/** Sheeting stops where the edge stock begins: the stock is the surface there, and the sheet goes on what is left. */
export function clipToStock(panel: Panel, b: Band | null, chord: number): Band | null {
  if (!b) return null;
  // the widest stock at each edge: the sheet stops where the first of it begins
  const widest = (which: "leadingEdge" | "trailingEdge") => Math.max(0, ...edgeEntries(panel).filter((e) => e.which === which).map((e) => e.edge.widthMm));
  const le = widest("leadingEdge");
  const te = widest("trailingEdge");
  const x0 = Math.max(b.x0, le);
  const x1 = Math.min(b.x1, chord - te);
  return x1 - x0 < MIN_BAND_MM ? null : { ...b, x0, x1 };
}

/** Every band of sheeting that covers the rib at this station. */
export function bandsAt(panel: Panel, chord: number, spanT: number, positionMm: number): Band[] {
  const s = panel.sheeting;
  if (!s || s.type === "none") return [];
  if (s.type === "standard") {
    const b = clipToStock(panel, standardBand(panel, chord), chord);
    return b ? [b] : [];
  }
  return s.strips.map((st) => clipToStock(panel, stripBand(st, chord, spanT, positionMm), chord)).filter((b): b is Band => b !== null);
}

/**
 * The cross-section of a sheet on one surface: its outer edge follows the surface, its inner edge is
 * the thickness below it (measured square to the surface, so a little more than the thickness vertically
 * where the surface slopes). The same number of points whatever the chord, so root and tip loft together.
 *
 * `lift` sits the sheet that far below the surface, on top of sheets already there; `margin` runs the outer
 * edge past the surface, so that cutting with it leaves no sliver.
 */
export function bandRing(surfaces: Surfaces, chord: number, band: Band, side: "above" | "below", n = 32, lift = 0, margin = 0): Path {
  const outer: { x: number; y: number }[] = [];
  const inner: { x: number; y: number }[] = [];
  const y = (x: number) => {
    const s = surfaceAt(surfaces, Math.min(1, Math.max(0, x / chord)));
    return (side === "above" ? s.upper : s.lower) * chord;
  };
  const sign = side === "above" ? 1 : -1;
  // The points are crowded at the front end of the band (a cosine spacing): the surface turns fastest at the nose, and a ring
  // sampled evenly along a 200 mm chord cuts across it and leaves crescents of rib standing outside the cut.
  const xs = Array.from({ length: n + 1 }, (_, k) => band.x0 + (band.x1 - band.x0) * (1 - Math.cos((Math.PI * k) / (2 * n))));
  for (let k = 0; k <= n; k++) {
    const x = xs[k];
    const gap = Math.min(k > 0 ? x - xs[k - 1] : Infinity, k < n ? xs[k + 1] - x : Infinity);
    const e = Math.max(gap * 0.25, 0.002);
    const slope = (y(Math.min(chord, x + e)) - y(Math.max(0, x - e))) / (Math.min(chord, x + e) - Math.max(0, x - e));
    // where the surface turns upright at the nose the offset would run away: it is capped
    const stretch = Math.min(Math.sqrt(1 + slope * slope), 4);
    const surfaceY = y(x);
    outer.push({ x, y: surfaceY - sign * lift * stretch + sign * margin });
    inner.push({ x, y: surfaceY - sign * (lift + band.thicknessMm) * stretch });
  }
  return [...outer, ...inner.reverse()];
}

/**
 * The layer each sheet occupies on a rib, as the ring between the surface and the sheet's underside (a strip over an earlier one
 * includes that one's thickness), for checking that nothing else on the rib runs into it. `name` is the strip's name.
 */
export function sheetLayers(bands: Band[], surfaces: Surfaces, chord: number): { name: string; side: "above" | "below"; ring: Path }[] {
  const out: { name: string; side: "above" | "below"; ring: Path }[] = [];
  const placed: { side: "above" | "below"; x0: number; x1: number; t: number }[] = [];
  for (const b of bands) {
    if (!(b.thicknessMm > 0)) continue;
    for (const side of ["above", "below"] as const) {
      if (side === "above" ? !b.above : !b.below) continue;
      const stack = placed.filter((q) => q.side === side && q.x0 < b.x1 && q.x1 > b.x0).reduce((sum, q) => sum + q.t, 0) + b.thicknessMm;
      out.push({ name: b.strip?.name ?? "The sheeting", side, ring: bandRing(surfaces, chord, { ...b, thicknessMm: stack }, side, 96, 0, 0) });
      placed.push({ side, x0: b.x0, x1: b.x1, t: b.thicknessMm });
    }
  }
  return out;
}

/**
 * Cut the rib back by each band's thickness on the surfaces it is applied to. The removed material is
 * the sheet's own cross-section; a strip over an earlier one on the same surface sits on top of it, so the
 * rib is cut back by both.
 */
export function insetRib(outline: Path[], bands: Band[], surfaces: Surfaces, chord: number): Path[] {
  let out = outline;
  const placed: { side: "above" | "below"; x0: number; x1: number; t: number }[] = [];
  for (const b of bands) {
    if (!(b.thicknessMm > 0)) continue;
    for (const side of ["above", "below"] as const) {
      if (side === "above" ? !b.above : !b.below) continue;
      const lift = placed.filter((q) => q.side === side && q.x0 < b.x1 && q.x1 > b.x0).reduce((sum, q) => sum + q.t, 0);
      // The first strip runs past the surface so no sliver is left; a strip over an earlier one runs up into that one's cut for the same reason
      // (the two outlines are sampled at different points, and without the overlap thin slivers of rib are left between them).
      const ring = bandRing(surfaces, chord, b, side, 96, lift, lift === 0 ? 0.5 : 0.3);
      out = difference(out, [ring]);
      placed.push({ side, x0: b.x0, x1: b.x1, t: b.thicknessMm });
    }
  }
  // Where a strip starts on the nose the surface is nearly upright, and the offset outline folds over itself: that leaves flecks of
  // rib no bigger than a pinhead. A piece under a square millimetre is not a part of the rib; drop it.
  const kept = out.filter((r) => Math.abs(signedArea(r)) >= 1);
  return kept.length ? kept : out;
}

type SectionAt = (positionMm: number) => { t: number; chordMm: number; surfaces: Surfaces };

/** The sheets as solids for the 3D view and the exports. */
export function sheetSolids(panel: Panel, sectionAt: SectionAt, frameAt: (positionMm: number) => SpanFrame): Solid[] {
  const s = panel.sheeting;
  if (!s || s.type === "none" || panel.lengthMm <= 0) return [];
  const out: Solid[] = [];

  type Spec = { id: string; band: (chord: number, t: number, pos: number) => Band | null; from: number; to: number; cap: boolean; colour?: string };
  const specs: Spec[] =
    s.type === "standard"
      ? [{ id: `${panel.id}-standard`, band: (c) => clipToStock(panel, standardBand(panel, c), c), from: 0, to: panel.lengthMm, cap: false }]
      : s.strips.map((st) => ({
          id: st.id,
          band: (c: number, t: number, pos: number) => clipToStock(panel, stripBand(st, c, t, pos), c),
          from: Math.max(0, st.spanStartMm),
          to: Math.min(panel.lengthMm, st.spanEndMm),
          cap: st.capStrip,
          colour: st.color !== "standard" ? st.color : undefined,
        }));

  for (const spec of specs) {
    if (spec.to - spec.from < 0.01) continue;
    const ringAt = (pos: number, side: "above" | "below"): Path | null => {
      const sec = sectionAt(pos);
      // Evaluated inside the span even at its ends, where rounding could otherwise put it just outside.
      const inside = Math.min(spec.to, Math.max(spec.from, pos));
      const b = spec.band(sec.chordMm, sec.t, inside);
      if (!b || (side === "above" ? !b.above : !b.below)) return null;
      return bandRing(sec.surfaces, sec.chordMm, b, side);
    };
    for (const side of ["above", "below"] as const) {
      const push = (id: string, a: Path | null, b: Path | null, fa: SpanFrame, fb: SpanFrame) => {
        if (!a || !b) return;
        const positions = loft(a, b, fa, fb);
        if (positions.length) out.push({ id, panelId: panel.id, kind: "sheeting", positions, ...(spec.colour ? { color: spec.colour } : {}) });
      };
      if (!spec.cap) {
        push(`${spec.id}-${side}`, ringAt(spec.from, side), ringAt(spec.to, side), frameAt(spec.from), frameAt(spec.to));
      } else {
        for (const rib of panel.ribs) {
          if (rib.positionMm < spec.from - 1e-6 || rib.positionMm > spec.to + 1e-6) continue;
          const w = rib.thicknessMm + 2; // a little wider than the rib it sits on
          const za = Math.max(0, rib.positionMm - w / 2);
          const zb = Math.min(panel.lengthMm, rib.positionMm + w / 2);
          const ring = ringAt(rib.positionMm, side);
          push(`${spec.id}-${side}-${rib.id}`, ring, ring, frameAt(za), frameAt(zb));
        }
      }
    }
  }
  return out;
}
