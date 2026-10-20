/**
 * Suppressed features. A feature can be switched off without deleting it: it stays in the list, greyed, and everything built from
 * the project (ribs, the 3D view, the exports, the checks) behaves as if it were not there. This is done once, up front, by
 * handing the geometry a copy of the project without them, so no part of the geometry has to know about suppression.
 */
import type { Panel, ProjectDoc } from "../domain/schema";

const hasAny = (p: Panel) =>
  p.spars.some((s) => s.suppressed) ||
  !!p.leadingEdge?.suppressed ||
  !!p.trailingEdge?.suppressed ||
  (p.extraEdges ?? []).some((x) => x.suppressed) ||
  !!p.sheeting?.suppressed ||
  p.sheeting?.strips.some((s) => s.suppressed) ||
  p.ribCombs.some((c) => c.suppressed) ||
  !!p.buildingTabs?.suppressed ||
  !!p.lighteningHoles?.suppressed;

export function withoutSuppressed(doc: ProjectDoc): ProjectDoc {
  if (!doc.wing.panels.some(hasAny)) return doc;
  const panels = doc.wing.panels.map((p): Panel =>
    !hasAny(p)
      ? p
      : {
          ...p,
          spars: p.spars.filter((s) => !s.suppressed),
          leadingEdge: p.leadingEdge?.suppressed ? { ...p.leadingEdge, enabled: false } : p.leadingEdge,
          trailingEdge: p.trailingEdge?.suppressed ? { ...p.trailingEdge, enabled: false } : p.trailingEdge,
          extraEdges: (p.extraEdges ?? []).filter((x) => !x.suppressed),
          sheeting: p.sheeting.suppressed ? { ...p.sheeting, type: "none" } : { ...p.sheeting, strips: p.sheeting.strips.filter((s) => !s.suppressed) },
          ribCombs: p.ribCombs.filter((c) => !c.suppressed),
          buildingTabs: p.buildingTabs?.suppressed ? { ...p.buildingTabs, enabled: false } : p.buildingTabs,
          lighteningHoles: p.lighteningHoles?.suppressed ? { ...p.lighteningHoles, type: "none" } : p.lighteningHoles,
        },
  );
  return { ...doc, wing: { ...doc.wing, panels } };
}
