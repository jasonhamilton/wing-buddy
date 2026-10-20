/**
 * Add panel, three ways, when a panel already exists. Pure: it returns the new panel and touches nothing.
 *
 * - direct: a 1:1 duplicate. Same geometry, same spars, same ribs; only the ids and the name are new.
 * - mirror: the far side of the join, a reflection of the previous panel. Chords, twist, sweep and
 *   airfoils run backwards, and only the spars that reach the join come across, reflected along the span.
 * - smart: carry on from the previous tip. The new root is the old tip (chord, twist, section and
 *   thickness), the airfoil is linked through the join, and the spars that reach the join continue
 *   across the whole new panel from where the old ones ended.
 */
import { generateRibs, uid } from "./doc";
import type { Panel, Spar } from "./schema";

export type CopyMethod = "direct" | "mirror" | "smart";

export const COPY_METHODS: { id: CopyMethod; label: string; summary: string }[] = [
  {
    id: "smart",
    label: "Carry on from the previous tip",
    summary:
      "The new panel starts where the last one ends: same chord, twist and airfoil, with the airfoil blended smoothly through the join. Spars that reach the join carry on across it. Best for extending a wing outwards.",
  },
  {
    id: "mirror",
    label: "Mirror the previous panel",
    summary:
      "The far side of the join, as a reflection: chords, twist, sweep and airfoils run backwards. Only the spars at the join come across. Best for a wing that tapers in and out, like a gull or an elliptical tip.",
  },
  {
    id: "direct",
    label: "Duplicate the previous panel",
    summary: "An exact copy of everything: shape, spars and ribs. Best for repeating a section.",
  },
];

const REACH_TOLERANCE_MM = 0.5;
const reachesTip = (s: Spar, panel: Panel) => s.spanEndMm >= panel.lengthMm - REACH_TOLERANCE_MM;

/** A fresh copy of a spar: new id, nothing shared with the original. */
function freshSpar(s: Spar): Spar {
  return { ...structuredClone(s), id: uid() };
}

const swapEnds = <T extends { start: unknown; end: unknown } | null>(v: T): T => {
  if (!v || v.end === null) return v;
  return { ...v, start: v.end, end: v.start } as T;
};

export function newPanelFrom(prev: Panel, method: CopyMethod, name: string): Panel {
  if (method === "direct") {
    return {
      ...structuredClone(prev),
      id: uid(),
      name,
      ribs: prev.ribs.map((r) => ({ ...r, id: uid() })),
      spars: prev.spars.map(freshSpar),
    };
  }

  const prevTipId = prev.tipAirfoilId ?? prev.rootAirfoilId;

  if (method === "mirror") {
    const length = prev.lengthMm;
    const panel: Panel = {
      ...structuredClone(prev),
      id: uid(),
      name,
      rootChordMm: prev.tipChordMm,
      tipChordMm: prev.rootChordMm,
      sweepMm: -prev.sweepMm,
      rootTwistDeg: prev.tipTwistDeg,
      tipTwistDeg: prev.rootTwistDeg,
      rootAirfoilId: prevTipId,
      rootAirfoilScale: prev.tipAirfoilScale,
      tipAirfoilId: prev.rootAirfoilId,
      tipAirfoilScale: prev.rootAirfoilScale,
      airfoilLinkedToPrev: false,
      ribs: [],
      spars: prev.spars
        .filter((s) => reachesTip(s, prev))
        .map((s) => {
          const c = freshSpar(s);
          // Reflected along the span; what was the far end of the span is now the near end.
          c.spanStartMm = Math.max(0, length - s.spanEndMm);
          c.spanEndMm = Math.min(length, length - s.spanStartMm);
          c.distance = swapEnds(c.distance);
          c.width = swapEnds(c.width);
          c.height = swapEnds(c.height);
          c.offsetY = swapEnds(c.offsetY);
          return c;
        }),
    };
    panel.ribs = generateRibs(panel);
    return panel;
  }

  // smart
  const panel: Panel = {
    ...structuredClone(prev),
    id: uid(),
    name,
    rootChordMm: prev.tipChordMm,
    tipChordMm: prev.tipChordMm,
    rootTwistDeg: prev.tipTwistDeg,
    tipTwistDeg: prev.tipTwistDeg,
    rootAirfoilId: prevTipId,
    rootAirfoilScale: prev.tipAirfoilScale,
    tipAirfoilId: null,
    tipAirfoilScale: prev.tipAirfoilScale,
    airfoilLinkedToPrev: true,
    ribs: [],
    spars: prev.spars
      .filter((s) => reachesTip(s, prev))
      .map((s) => {
        const c = freshSpar(s);
        // Continue from where the old spar ended, with one value for the whole new span.
        c.spanStartMm = 0;
        c.spanEndMm = prev.lengthMm;
        c.distance = { start: { ...(s.distance.end ?? s.distance.start) }, end: null };
        c.width = s.width ? { start: s.width.end ?? s.width.start, end: null } : null;
        c.height = s.height ? { start: s.height.end ?? s.height.start, end: null } : null;
        c.offsetY = s.offsetY ? { start: s.offsetY.end ?? s.offsetY.start, end: null } : null;
        return c;
      }),
  };
  panel.ribs = generateRibs(panel);
  return panel;
}
