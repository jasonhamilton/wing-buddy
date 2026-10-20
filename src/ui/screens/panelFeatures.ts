/**
 * The additional features a panel has (spars, edge stock, sheeting, combs, lightening holes), in the order the
 * user arranged them, each with the colour it has in the 3D view and a short code for the panel cards.
 * The panel's own geometry is not a feature and is never in this list.
 */
import type { Panel } from "../../domain/schema";

export type Pick =
  | { k: "geometry" }
  | { k: "spar"; id: string }
  | { k: "le" }
  | { k: "te" }
  | { k: "edge"; id: string }
  | { k: "strip"; id: string }
  | { k: "sheet" }
  | { k: "comb"; id: string }
  | { k: "holes" }
  | { k: "tabs" };

export type Feature = { key: string; pick: Pick; name: string; type: string; colour: string; abbr: string; /** switched off: kept in the list, left out of the ribs, the 3D view and the exports */ suppressed?: boolean; /** hidden in the 3D view; not offered for tabs and holes, which are cut in the ribs and have nothing to hide */ hidden?: boolean };

const SPAR_LABEL: Record<string, string> = {
  rectangle: "Rectangular spar",
  round: "Round spar",
  webbing: "Webbing",
  roundJoiner: "Joiner (round)",
  cuboid: "Cuboid spar",
  cuboidJoiner: "Joiner (cuboid)",
  aileronCutter: "Aileron cutter",
};
/** A spar cut in from the surface of the rib, top or bottom or both: a notch, a feature of its own. A spar goes through a hole. */
export const isNotch = (s: { type: string; positionTop?: boolean; positionBottom?: boolean }) => (s.type === "rectangle" || s.type === "cuboid") && !!(s.positionTop || s.positionBottom);
export const token = (name: string) => `var(--wb-geo-${name})`;

/** "Main spar" -> "MS", "Spar 1" -> "S1", "Webbing" -> "WE": the first letters of the words, at most three. */
export function abbreviate(name: string): string {
  const words = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const out = words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 3).map((w) => w[0]).join("");
  return out.toUpperCase();
}

/** Every feature the panel has, in the order the user arranged them (new ones go to the end). */
export function featuresOf(panel: Panel): Feature[] {
  const all: Feature[] = [
    ...panel.spars.map((s): Feature => ({ key: s.id, pick: { k: "spar", id: s.id }, name: s.name, type: isNotch(s) ? "Notch" : SPAR_LABEL[s.type] ?? "Spar", abbr: abbreviate(s.name), colour: s.color !== "standard" ? s.color : token(s.type === "webbing" ? "webbing" : "spar"), suppressed: !!s.suppressed, hidden: !!s.hidden })),
    ...(panel.leadingEdge.enabled ? [{ key: "le", pick: { k: "le" } as Pick, name: "Leading edge stock", type: "Leading edge stock", abbr: "LE", colour: token("leading-edge"), suppressed: !!panel.leadingEdge.suppressed, hidden: !!panel.leadingEdge.hidden }] : []),
    ...(panel.trailingEdge.enabled ? [{ key: "te", pick: { k: "te" } as Pick, name: "Trailing edge stock", type: "Trailing edge stock", abbr: "TE", colour: token("trailing-edge"), suppressed: !!panel.trailingEdge.suppressed, hidden: !!panel.trailingEdge.hidden }] : []),
    ...(panel.extraEdges ?? []).map((x): Feature => ({ key: x.id, pick: { k: "edge", id: x.id }, name: x.name, type: x.side === "leading" ? "Leading edge stock" : "Trailing edge stock", abbr: abbreviate(x.name), colour: token(x.side === "leading" ? "leading-edge" : "trailing-edge"), suppressed: !!x.suppressed, hidden: !!x.hidden })),
    ...(panel.sheeting.type === "standard" ? [{ key: "sheet", pick: { k: "sheet" } as Pick, name: "Standard sheeting", type: "Sheeting", abbr: "SH", colour: token("sheeting"), suppressed: !!panel.sheeting.suppressed, hidden: !!panel.sheeting.hidden }] : []),
    ...(panel.sheeting.type === "advanced"
      ? panel.sheeting.strips.map((st): Feature => ({ key: st.id, pick: { k: "strip", id: st.id }, name: st.name, type: st.capStrip ? "Cap strip" : "Sheeting strip", abbr: abbreviate(st.name), colour: st.color !== "standard" ? st.color : token("sheeting"), suppressed: !!st.suppressed, hidden: !!st.hidden }))
      : []),
    ...panel.ribCombs.map((c): Feature => ({ key: c.id, pick: { k: "comb", id: c.id }, name: c.name, type: "Rib comb", abbr: abbreviate(c.name), colour: c.color !== "standard" ? c.color : token("comb"), suppressed: !!c.suppressed, hidden: !!c.hidden })),
    ...(panel.buildingTabs?.enabled ? [{ key: "tabs", pick: { k: "tabs" } as Pick, name: "Building tabs", type: "Building tabs", abbr: "BT", colour: token("tabs"), suppressed: !!panel.buildingTabs.suppressed }] : []),
    ...(panel.lighteningHoles.type !== "none" ? [{ key: "holes", pick: { k: "holes" } as Pick, name: "Lightening holes", type: "Lightening holes", abbr: "LH", colour: token("rib"), suppressed: !!panel.lighteningHoles.suppressed }] : []),
  ];
  const order = panel.featureOrder ?? [];
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  return all.map((f, i) => ({ f, i })).sort((x, y) => rank(x.f.key) - rank(y.f.key) || x.i - y.i).map(({ f }) => f);
}

/**
 * Which ribs a feature touches, as indices into the panel's ribs in order from the root. A spar, strip or comb reaches the
 * ribs inside its span; edge stock, sheeting, tabs and lightening holes are on every rib.
 */
export function affectedRibs(panel: Panel, pick: Pick): number[] {
  const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);
  const all = sorted.map((_, i) => i);
  const within = (a: number, b: number) => all.filter((i) => sorted[i].positionMm >= a - 1e-6 && sorted[i].positionMm <= b + 1e-6);
  if (pick.k === "spar") {
    const sp = panel.spars.find((x) => x.id === pick.id);
    return sp ? within(sp.spanStartMm, sp.spanEndMm) : [];
  }
  if (pick.k === "strip") {
    const st = panel.sheeting.strips.find((x) => x.id === pick.id);
    return st ? within(st.spanStartMm, st.spanEndMm) : [];
  }
  if (pick.k === "comb") {
    const c = panel.ribCombs.find((x) => x.id === pick.id);
    return c ? within(c.spanStartMm, c.spanEndMm) : [];
  }
  return all;
}
