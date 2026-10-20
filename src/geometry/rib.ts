/**
 * Build one rib: interpolate the section, scale it to the local chord, apply
 * twist and alignment, then subtract everything that passes through it.
 *
 * Subtraction order matters and follows architecture.md: leading-edge stock,
 * trailing-edge stock, sheeting, spar pockets. Later stages see the rib the
 * earlier ones left behind, which is what a builder cutting in that order gets.
 */
import type { Panel, Spar } from "../domain/schema";
import { aileronCut } from "./aileron";
import { edgeEntries } from "./edgeList";
import { isRod, rodOf } from "./edgeStock";
import { combNotches } from "./combs";
import { lighteningHoles } from "./lightening";
import { bandsAt, insetRib, sheetLayers } from "./sheeting";
import { surfaceAt } from "./airfoil";
import { sparPocket } from "./sparPocket";
import { circle, classify, difference, intersect, rect, rotate, signedArea, union } from "./clipper";
import type { LengthFormatter, Path, Pt, Surfaces, Warning } from "./types";

/** The section as a closed ring at a given chord, in millimetres. */
export function sectionToPath(s: Surfaces, chordMm: number): Path {
  const out: Path = [];
  for (let i = s.x.length - 1; i >= 1; i--) out.push({ x: s.x[i] * chordMm, y: s.yUpper[i] * chordMm });
  for (let i = 0; i < s.x.length - 1; i++) out.push({ x: s.x[i] * chordMm, y: s.yLower[i] * chordMm });
  return signedArea(out) >= 0 ? out : out.reverse();
}

/**
 * The rib's bottom and top edges across a band of chord. `bottomEdge` is the highest point of the bottom edge and
 * `topEdge` the lowest point of the top edge, so a tab reaching them touches the rib over the whole band even where the
 * surface slopes. Null when there is no rib anywhere in the band.
 */
export function ribExtentAcross(
  outline: Path[],
  x0: number,
  x1: number,
  outer = false,
): { bottomEdge: number; topEdge: number } | null {
  const big = 1e5;
  // Default: the inner edges (highest lower surface, lowest upper surface) so a tab always overlaps the rib.
  // outer: the lowest lower surface and highest upper surface, so a pin hole clears the rib across its whole width.
  let bottom = outer ? Infinity : -Infinity;
  let top = outer ? -Infinity : Infinity;
  let found = false;
  for (let k = 0; k <= 4; k++) {
    const x = x0 + ((x1 - x0) * k) / 4;
    const col = intersect(outline, [rect(x - 0.05, -big, x + 0.05, big)]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const ring of col) for (const p of ring) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    if (!Number.isFinite(lo)) continue;
    found = true;
    bottom = outer ? Math.min(bottom, lo) : Math.max(bottom, lo);
    top = outer ? Math.max(top, hi) : Math.min(top, hi);
  }
  return found ? { bottomEdge: bottom, topEdge: top } : null;
}

/** Resolve a %-or-mm measure against the local chord. */
export function resolveChordwise(value: number, unit: "pct" | "mm", chordMm: number): number {
  return unit === "pct" ? (value / 100) * chordMm : value;
}

export type SparCutContext = {
  spar: Spar;
  chordMm: number;
  surfaces: Surfaces;
  spanT: number;
  /** where this rib sits along the panel, mm; a spar's start and end values run between ITS first and last rib */
  positionMm: number;
  /** the chord at the spar's first rib, for "auto-adjust width" */
  startChordMm: number;
  /** this rib's twist, degrees: a joiner is placed in the twisted frame and carried back into this rib's own */
  twistDeg: number;
  /** what a joiner needs to find its straight rod; absent for other spars */
  rod?: JoinerFrame;
  /** the spar's first and last rib, for round and cuboid spars: the middle ribs' holes are found between theirs */
  ends?: SparEnds;
  warn: (w: Warning) => void;
  fmt: LengthFormatter;
};

/**
 * What a joiner is anchored to. A joiner is one straight rod through the whole panel, not a point at the same
 * percentage of every rib's chord: it is placed once, at the spar's first rib, and the other ribs find it where
 * the panel's sweep, dihedral and twist put it. 
 */
export type JoinerFrame = {
  /** the spar's first rib: its chord, section, twist and position along the panel */
  anchorChordMm: number;
  anchorSurfaces: Surfaces;
  anchorTwistDeg: number;
  anchorPositionMm: number;
  /** half way between the spar's first and last rib; the rod's height does not change with dihedral here */
  midPositionMm: number;
  sweepMm: number;
  lengthMm: number;
  dihedralDeg: number;
};

const ORIGIN: Pt = { x: 0, y: 0 };

/** What a rib looks like from where a round or cuboid spar is concerned. */
export type RibFrame = { chordMm: number; surfaces: Surfaces; twistDeg: number; positionMm: number };
export type SparEnds = { first: RibFrame; last: RibFrame };

/**
 * Where the hole of a round or cuboid spar sits in a rib, in this rib's own (untwisted) frame. The
 * hole's height is worked out exactly only at the spar's first and last rib, in the twisted frame the ribs are cut in, and
 * spread linearly by rib position between them (it differs from an exact hole by
 * up to 2 mm on a twisted panel, and not at all on the end ribs). The place along the chord is exact on every rib.
 */
export function interpolatedCentre(ctx: SparCutContext, ends: SparEnds): Pt {
  const { spar } = ctx;
  const at = (f: RibFrame, t: number): Pt => {
    const d0 = resolveChordwise(spar.distance.start.value, spar.distance.start.unit, f.chordMm);
    const d1 = spar.distance.end ? resolveChordwise(spar.distance.end.value, spar.distance.end.unit, f.chordMm) : null;
    const d = alongSpan(d0, d1, t);
    const x = spar.distanceFrom === "LE" ? d : f.chordMm - d;
    const surf = surfaceAt(f.surfaces, f.chordMm === 0 ? 0 : Math.min(1, Math.max(0, x / f.chordMm)));
    const y = ((surf.upper + surf.lower) / 2) * f.chordMm + alongSpan(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null, t);
    return rotate([{ x, y }], ORIGIN, -f.twistDeg)[0];
  };
  const a = at(ends.first, 0);
  const b = at(ends.last, 1);
  const run = ends.last.positionMm - ends.first.positionMm;
  const t = run > 1e-9 ? Math.min(1, Math.max(0, (ctx.positionMm - ends.first.positionMm) / run)) : 0;
  // Only the height is spread between the end ribs; where the hole sits along the chord is worked out for this rib.
  const own = at({ chordMm: ctx.chordMm, surfaces: ctx.surfaces, twistDeg: ctx.twistDeg, positionMm: ctx.positionMm }, sparT(spar, ctx.positionMm));
  const mid = { x: own.x, y: a.y + (b.y - a.y) * t };
  return rotate([mid], ORIGIN, ctx.twistDeg)[0];
}

/** The centre of a joiner's rod in this rib's own (untwisted) frame, measured from the nose; null if the rod misses the rib. */
export function joinerCentre(ctx: SparCutContext, rod: JoinerFrame): Pt {
  const { spar } = ctx;
  const d = resolveChordwise(spar.distance.start.value, spar.distance.start.unit, rod.anchorChordMm);
  const xA = spar.distanceFrom === "LE" ? d : rod.anchorChordMm - d;
  const surf = surfaceAt(rod.anchorSurfaces, rod.anchorChordMm === 0 ? 0 : Math.min(1, Math.max(0, xA / rod.anchorChordMm)));
  const yA = ((surf.upper + surf.lower) / 2) * rod.anchorChordMm + (spar.offsetY?.start ?? 0);
  // Into the final frame the rib ends up in: turned about the nose by minus the twist.
  // The dihedral lift at the first rib is part of where the rod starts in that rib's own frame, so it is turned with the
  // rib's twist (measured: otherwise every hole is out by that lift times sin(twist), a steady 0.4 to 0.75 mm);
  // from there the rod falls straight along the sheet.
  const tanHalf = Math.tan((rod.dihedralDeg * Math.PI) / 360);
  const liftAtAnchor = tanHalf * (rod.anchorPositionMm - rod.midPositionMm);
  const [a] = rotate([{ x: xA, y: yA - liftAtAnchor }], ORIGIN, -rod.anchorTwistDeg);
  const sweepShift = rod.lengthMm > 0 ? (rod.sweepMm * (ctx.positionMm - rod.anchorPositionMm)) / rod.lengthMm : 0;
  const dihedralShift = tanHalf * (ctx.positionMm - rod.midPositionMm) - liftAtAnchor;
  const [local] = rotate([{ x: a.x - sweepShift, y: a.y - dihedralShift }], ORIGIN, ctx.twistDeg);
  return local;
}

/** How far along a spar this rib is: 0 at the spar's first rib, 1 at its last. */
export function sparT(spar: Pick<Spar, "spanStartMm" | "spanEndMm">, positionMm: number): number {
  const run = spar.spanEndMm - spar.spanStartMm;
  return run > 1e-9 ? Math.min(1, Math.max(0, (positionMm - spar.spanStartMm) / run)) : 0;
}

/** Linear blend of a start value and an optional separate end value. */
function alongSpan(start: number, end: number | null, t: number): number {
  return end === null ? start : start + (end - start) * t;
}

/**
 * The cutting shapes one spar contributes to this rib.
 * `notches` are open to a surface and come out of the outline; `bores` are
 * enclosed and become holes.
 */
export function sparCuts(ctx: SparCutContext): { notches: Path[]; bores: Path[]; xc: number | null } {
  const { spar, chordMm, surfaces, warn, fmt } = ctx;
  const spanT = sparT(spar, ctx.positionMm);
  const notches: Path[] = [];
  const bores: Path[] = [];

  if ((spar.type === "roundJoiner" || spar.type === "cuboidJoiner") && ctx.rod) {
    const c = joinerCentre(ctx, ctx.rod);
    const cuboid = spar.type === "cuboidJoiner";
    const w = cuboid ? alongSpan(spar.width?.start ?? 6, spar.width?.end ?? null, spanT) : 2 * (spar.radiusMm ?? 3);
    const h = cuboid ? alongSpan(spar.height?.start ?? 6, spar.height?.end ?? null, spanT) : w;
    // A rod that leaves the section through the nose or the tail has no hole in this rib (none is written).
    if (c.x - w / 2 < 0 || c.x + w / 2 > chordMm) {
      warn({
        level: "warn",
        sparId: spar.id,
        message: `${spar.name || "Joiner"} runs outside the chord at this rib (the rod is straight, so sweep carries it past the nose), so this rib is not cut for it.`,
      });
      return { notches, bores, xc: null };
    }
    const surf = surfaceAt(surfaces, chordMm === 0 ? 0 : c.x / chordMm);
    const yTop = surf.upper * chordMm;
    const yBot = surf.lower * chordMm;
    bores.push(cuboid ? rect(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2) : circle(c.x, c.y, w / 2));
    if (c.y + h / 2 > yTop || c.y - h / 2 < yBot) {
      warn({
        level: "warn",
        sparId: spar.id,
        message: `${spar.name || "Joiner"} breaks the surface at this rib — the section is only ${fmt(yTop - yBot)} deep there.`,
      });
    }
    return { notches, bores, xc: c.x };
  }

  const dStart = resolveChordwise(spar.distance.start.value, spar.distance.start.unit, chordMm);
  const dEnd = spar.distance.end
    ? resolveChordwise(spar.distance.end.value, spar.distance.end.unit, chordMm)
    : null;
  const fromLE = alongSpan(dStart, dEnd, spanT);
  const xc = spar.distanceFrom === "LE" ? fromLE : chordMm - fromLE;

  if (xc < 0 || xc > chordMm) {
    warn({
      level: "warn",
      sparId: spar.id,
      message: `${spar.name || "Spar"} sits ${fmt(Math.abs(xc < 0 ? xc : xc - chordMm))} outside the chord here.`,
    });
    return { notches, bores, xc: null };
  }

  const frac = chordMm === 0 ? 0 : xc / chordMm;
  const surf = surfaceAt(surfaces, frac);
  const yTop = surf.upper * chordMm;
  const yBot = surf.lower * chordMm;
  const far = chordMm * 4 + 100; // comfortably outside the section

  switch (spar.type) {
    case "cuboid": {
      // A cuboid spar is a box inside the rib, not a pocket in its surface: a rectangle of the blended width and
      // height, turned by the rotation angle about its centre, which sits on the midline plus the Y offset.
      const w = alongSpan(spar.width?.start ?? 6, spar.width?.end ?? null, spanT);
      const h = alongSpan(spar.height?.start ?? 3, spar.height?.end ?? null, spanT);
      const oy = alongSpan(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null, spanT);
      const mid = ctx.ends ? interpolatedCentre(ctx, ctx.ends) : { x: xc, y: (yTop + yBot) / 2 + oy };
      const cy = mid.y;
      const box = rect(mid.x - w / 2, cy - h / 2, mid.x + w / 2, cy + h / 2);
      const turned = spar.rotationDeg ? rotate(box, { x: mid.x, y: cy }, spar.rotationDeg) : box;
      bores.push(turned);
      if (turned.some((p) => p.y > yTop || p.y < yBot)) {
        warn({
          level: "warn",
          sparId: spar.id,
          message: `${spar.name || "Spar"} breaks the surface at this rib: the section is only ${fmt(yTop - yBot)} deep there.`,
        });
      }
      break;
    }
    case "rectangle": {
      // Width runs from the start value to the end value across the spar's own ribs, growing about the spar's centre.
      // With auto-adjust it instead follows the chord: the start width scaled by this rib's chord over the first rib's.
      const w0 = spar.width?.start ?? 6;
      const w = spar.autoAdjustWidth && ctx.startChordMm > 0 ? (w0 * chordMm) / ctx.startChordMm : alongSpan(w0, spar.width?.end ?? null, spanT);
      const h = alongSpan(spar.height?.start ?? 3, spar.height?.end ?? null, spanT);
      const x0 = xc - w / 2 - spar.gapForeMm;
      const x1 = xc + w / 2 + spar.gapAftMm;
      const pocket = (side: "upper" | "lower") =>
        sparPocket(surfaces, chordMm, { side, x0, x1, height: h, flat: spar.flat, verticalCut: spar.verticalCut });
      if (spar.positionTop) {
        const p = pocket("upper");
        if (p) notches.push(p);
      }
      if (spar.positionBottom) {
        const p = pocket("lower");
        if (p) notches.push(p);
      }
      if (!spar.positionTop && !spar.positionBottom) {
        // Notched into neither surface, nothing is cut: the stick is not drawn on the rib at all.
        warn({
          level: "warn",
          sparId: spar.id,
          message: `${spar.name || "Spar"} is not notched into either surface, so the ribs are not cut for it.`,
        });
      }
      break;
    }
    case "webbing": {
      // Webbing is a separate part between the ribs (see webbingParts); the ribs themselves stay whole.
      break;
    }
    case "round":
    case "roundJoiner":
    case "cuboidJoiner": {
      const r = spar.type === "round" ? alongSpan(spar.radiusMm ?? 3, spar.radiusEndMm ?? null, spanT) : (spar.radiusMm ?? 3);
      const oy = alongSpan(spar.offsetY?.start ?? 0, spar.offsetY?.end ?? null, spanT);
      const mid = spar.type === "round" && ctx.ends ? interpolatedCentre(ctx, ctx.ends) : { x: xc, y: (yTop + yBot) / 2 + oy };
      const cy = mid.y;
      if (spar.type === "cuboidJoiner") {
        const w = alongSpan(spar.width?.start ?? 6, spar.width?.end ?? null, spanT);
        const h = alongSpan(spar.height?.start ?? 6, spar.height?.end ?? null, spanT);
        bores.push(rect(xc - w / 2, cy - h / 2, xc + w / 2, cy + h / 2));
      } else {
        bores.push(circle(mid.x, cy, r));
      }
      if (cy + r > yTop || cy - r < yBot) {
        warn({
          level: "warn",
          sparId: spar.id,
          message: `${spar.name || "Joiner"} breaks the surface at this rib — the section is only ${fmt(yTop - yBot)} deep there.`,
        });
      }
      break;
    }
    case "aileronCutter": {
      const cut = spar.aileron ? aileronCut(spar.aileron, xc, yTop, yBot) : null;
      if (cut) {
        // The hinge cut: a notch from the surface opposite the hinge, and the rib in two pieces if it goes through.
        notches.push(cut.notch);
      } else if (!spar.aileron) {
        // No hinge settings: the simple cutter. Everything aft of the hinge line leaves the rib.
        notches.push(rect(xc, -far, far, far));
      }
      break;
    }
  }

  return { notches, bores, xc };
}

export type BuildRibInput = {
  panel: Panel;
  surfaces: Surfaces;
  chordMm: number;
  twistDeg: number;
  spanT: number;
  positionMm: number;
  activeSpars: Spar[];
  /** how messages write a length; defaults to millimetres */
  fmt?: LengthFormatter;
  /** a half rib keeps only the part in front of ("front") or behind ("rear") the cut line; null or absent is a full rib */
  half?: "front" | "rear" | null;
  /** where that cut line is, as a percentage of the chord from the leading edge */
  halfCutPct?: number;
  /** slot depths for combs that are leveled, by comb id */
  combLevels?: Record<string, number>;
  /** the straight rod each joiner is anchored to, by spar id */
  joinerFrames?: Record<string, JoinerFrame>;
  /** the first and last rib of each round or cuboid spar, by spar id */
  sparEnds?: Record<string, SparEnds>;
  /** the root rib's highest and lowest points in the finished frame: every building tab stands at this level */
  tabLevel?: { top: number; bottom: number };
};

export function buildRibPaths(input: BuildRibInput): {
  outline: Path[];
  holes: Path[];
  warnings: Warning[];
  /** how far the whole rib was moved down by top/bottom alignment; 0 when alignment is off */
  alignShiftMm: number;
  /** the bare airfoil, before any cut, in the same turned and aligned frame as the rib */
  silhouette: Path;
  /** the rib before any feature touches it, but as a half rib if it is one: the airfoil with only the half-rib cut applied, turned and aligned like the rib */
  profile: Path[];
} {
  const { panel, surfaces, chordMm, twistDeg, spanT, activeSpars } = input;
  const fmt: LengthFormatter = input.fmt ?? ((mm, d = 2) => `${mm.toFixed(d)}mm`);
  const warnings: Warning[] = [];
  const warn = (w: Warning) => warnings.push({ ...w, panelId: panel.id });

  const bare = sectionToPath(surfaces, chordMm);
  let outline: Path[] = [bare];
  const bores: Path[] = [];
  const notches: Path[] = [];

  // --- leading and trailing edge stock ------------------------------------
  for (const { edge, which } of edgeEntries(panel)) {
    if (edge.widthMm <= 0) continue;
    if (which === "leadingEdge") {
      if (isRod(edge, "leadingEdge")) {
        // A round rod: the rib starts at the middle of the rod, with a round bite taken out of it for the rod to sit in.
        const { cx, cy, r } = rodOf(edge, chordMm, surfaces);
        notches.push(rect(-chordMm, -chordMm, cx, chordMm), circle(cx, cy, r, 48));
      } else {
        notches.push(rect(-chordMm, -chordMm, edge.widthMm, chordMm));
      }
    } else {
      notches.push(rect(chordMm - edge.widthMm, -chordMm, chordMm * 2, chordMm));
    }
  }

  // --- sheeting ------------------------------------------------------------
  // After the stock is cut and before the spar pockets: the sheet goes on the surface that is left, and a
  // pocket is then cut into the rib that remains.
  if (notches.length) {
    outline = difference(outline, notches);
    notches.length = 0;
  }
  const bands = bandsAt(panel, chordMm, spanT, input.positionMm);
  if (bands.length) {
    outline = insetRib(outline, bands, surfaces, chordMm);
    for (const b of bands) {
      const s = surfaceAt(surfaces, Math.min(1, Math.max(0, ((b.x0 + b.x1) / 2) / chordMm)));
      const depth = (s.upper - s.lower) * chordMm;
      if (b.thicknessMm * (b.above && b.below ? 2 : 1) >= depth) {
        warn({
          level: "warn",
          feature: b.strip?.name ?? "Sheeting",
          message: `${b.strip?.name ?? "The sheeting"} is thicker than the section is deep here (${fmt(b.thicknessMm)} against ${fmt(depth)}), so there is no rib left under it.`,
        });
      }
    }
  }

  // --- rib combs -----------------------------------------------------------
  // Anything else cut into the rib that reaches up into a sheet's layer is a collision, and is warned about (not stopped).
  const layers = bands.length ? sheetLayers(bands, surfaces, chordMm) : [];
  const clash = (shapes: Path[], who: string, sparId?: string, feature?: string) => {
    if (!layers.length || !shapes.length) return;
    for (const layer of layers) {
      const area = intersect([layer.ring], shapes).reduce((sum, r) => sum + Math.abs(signedArea(r)), 0);
      if (area > 0.05) warn({ level: "warn", ...(sparId ? { sparId } : {}), ...(feature ? { feature } : {}), message: `${who} runs into ${layer.name} on the ${layer.side === "above" ? "top" : "bottom"} surface: it reaches up into the sheet.` });
    }
  };
  const combCuts = combNotches(panel, input.positionMm, chordMm, surfaces, spanT, input.combLevels, warn, fmt);
  notches.push(...combCuts);
  clash(combCuts, "A rib comb", undefined, "Rib comb");

  // --- spars ---------------------------------------------------------------
  for (const spar of activeSpars) {
    const startChordMm = panel.lengthMm > 0 ? panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * (spar.spanStartMm / panel.lengthMm) : panel.rootChordMm;
    const cuts = sparCuts({ spar, chordMm, surfaces, spanT, positionMm: input.positionMm, startChordMm, twistDeg, rod: input.joinerFrames?.[spar.id], ends: input.sparEnds?.[spar.id], warn, fmt });
    notches.push(...cuts.notches);
    bores.push(...cuts.bores);
    if (spar.type !== "aileronCutter") clash([...cuts.notches, ...cuts.bores], spar.name || "A spar", spar.id);
    // A half rib that does not reach a spar cannot hold it: say so, by name.
    if (input.half && cuts.xc !== null && spar.type !== "aileronCutter") {
      const cutX = ((input.halfCutPct ?? 35) / 100) * chordMm;
      const missed = input.half === "front" ? cuts.xc > cutX : cuts.xc < cutX;
      if (missed) {
        warn({
          level: "warn",
          sparId: spar.id,
          message: `${spar.name || "A spar"} is in the part of this half rib that is cut away, so the rib does not hold it.`,
        });
      }
    }
  }

  // Lightening holes go in last of the cuts, kept clear of every notch and bore made so far.
  // The stock at either edge is already cut from the outline, so it is told to the holes as ground they keep out of.
  const stock: Path[] = [];
  for (const { edge, which } of edgeEntries(panel)) {
    if (edge.widthMm <= 0) continue;
    stock.push(which === "leadingEdge" ? rect(-chordMm, -chordMm, edge.widthMm, chordMm) : rect(chordMm - edge.widthMm, -chordMm, chordMm * 2, chordMm));
  }
  bores.push(...lighteningHoles(panel, chordMm, surfaces, bands, [...notches, ...bores, ...stock]));

  if (notches.length) outline = difference(outline, notches);
  if (bores.length) outline = difference(outline, bores);

  // A half rib keeps one side of a cut line, square to its own chord. Done after the tabs, so a tab
  // that would hang off the removed part goes with it, and before twist, so the cut turns with the rib.
  if (input.half) {
    const cutX = ((input.halfCutPct ?? 35) / 100) * chordMm;
    const big = chordMm * 4 + 100;
    outline = difference(outline, [input.half === "front" ? rect(cutX, -big, big, big) : rect(-big, -big, cutX, big)]);
  }

  const split = classify(outline);
  if (split.outline.length === 0) {
    warn({
      level: "error",
      fix: { kind: "emptyRib" },
      message: "Nothing is left of this rib once the cuts are made.",
    });
  }

  // --- twist, then alignment ----------------------------------------------
  // Rotation is about the leading edge: ribs are stacked and pinned at the nose
  // on a building jig, so that is the point a builder keeps fixed.
  // ASSUMPTION — the tutorial PDF never states the pivot. See build-log.md.
  const pivot: Pt = { x: 0, y: 0 };
  const twist = (p: Path[]) => (twistDeg === 0 ? p : p.map((r) => rotate(r, pivot, -twistDeg)));

  let finalOutline = twist(split.outline);
  let finalHoles = twist(split.holes);
  let silhouette = twist([bare])[0];
  // The unaltered profile: the section as it is before any feature, but a half rib is still half a rib.
  let profileRings: Path[] = [bare];
  if (input.half) {
    const cutX = ((input.halfCutPct ?? 35) / 100) * chordMm;
    const big = chordMm * 4 + 100;
    profileRings = difference([bare], [input.half === "front" ? rect(cutX, -big, big, big) : rect(-big, -big, cutX, big)]);
  }
  let profile = twist(profileRings);

  // --- building tabs ------------------------------------------------------
  // Extra material rather than a cut, added by union to the FINISHED rib (after twist): every
  // tab stands at one flat level, the highest (lowest) point of any rib in the panel plus the stick-out, so that the ribs
  // sit level on a building board whatever their twist.
  const tabs = panel.buildingTabs;
  if (tabs?.enabled && (tabs.above || tabs.below) && (tabs.fore || tabs.aft)) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of finalOutline) {
      for (const p of ring) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (Number.isFinite(minY)) {
      const extend = Math.max(tabs.extendMm, 0.1);
      const topLevel = (input.tabLevel?.top ?? maxY) + extend;
      const bottomLevel = (input.tabLevel?.bottom ?? minY) - extend;
      const place: { x0: number; x1: number }[] = [];
      if (tabs.fore) {
        const from = resolveChordwise(tabs.fromLE.value, tabs.fromLE.unit, chordMm);
        place.push({ x0: from, x1: from + tabs.widthLE });
      }
      if (tabs.aft) {
        const from = resolveChordwise(tabs.fromTE.value, tabs.fromTE.unit, chordMm);
        place.push({ x0: chordMm - from - tabs.widthTE, x1: chordMm - from });
      }
      const added: Path[] = [];
      const holes: Path[] = [];
      for (const { x0, x1 } of place) {
        const mid = (x0 + x1) / 2;
        if (mid < 0 || mid > chordMm) {
          warn({ level: "warn", message: `A building tab falls outside the chord of ${panel.name}.` });
          continue;
        }
        const ext = ribExtentAcross(finalOutline, x0, x1);
        const holeSpan = Math.max(0.3, (x1 - x0 - 2 * tabs.sidesMm) / 2);
        const centre = ribExtentAcross(finalOutline, mid - holeSpan, mid + holeSpan, true);
        if (!ext || !centre) {
          warn({ level: "warn", message: `A building tab of ${panel.name} has no rib under it here, so it is left out.` });
          continue;
        }
        // Pin hole: as wide as the tab less the margin on each side, sitting just outside the rib at the tab's middle.
        const holeR = Math.max(0.3, (x1 - x0 - 2 * tabs.sidesMm) / 2);
        if (tabs.below) {
          added.push(rect(x0, bottomLevel, x1, ext.bottomEdge + 0.5));
          if (tabs.holes) holes.push(circle(mid, centre.bottomEdge - holeR, holeR, 24));
        }
        if (tabs.above) {
          added.push(rect(x0, ext.topEdge - 0.5, x1, topLevel));
          if (tabs.holes) holes.push(circle(mid, centre.topEdge + holeR, holeR, 24));
        }
      }
      if (added.length) {
        let merged = union(finalOutline, added);
        if (holes.length) merged = difference(merged, holes);
        const sp = classify(merged);
        finalOutline = sp.outline;
        finalHoles = [...finalHoles, ...sp.holes];
      }
    }
  }

  let alignShiftMm = 0;
  if (panel.ribAlign !== "none") {
    let extreme = panel.ribAlign === "top" ? -Infinity : Infinity;
    for (const ring of finalOutline) {
      for (const p of ring) {
        if (panel.ribAlign === "top") extreme = Math.max(extreme, p.y);
        else extreme = Math.min(extreme, p.y);
      }
    }
    if (Number.isFinite(extreme) && extreme !== 0) {
      alignShiftMm = extreme;
      const shift = (rings: Path[]) => rings.map((r) => r.map((p) => ({ x: p.x, y: p.y - extreme })));
      finalOutline = shift(finalOutline);
      finalHoles = shift(finalHoles);
      silhouette = shift([silhouette])[0];
      profile = shift(profile);
    }
  }

  return { outline: finalOutline, holes: finalHoles, warnings, alignShiftMm, silhouette, profile };
}
