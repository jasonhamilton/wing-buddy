/**
 * How a check is shown: the panel it is on and the feature it is about, kept apart from what is wrong with it.
 * The geometry words its messages with the panel's name in front ("Panel 2: ..."); that is taken off here, since the panel
 * is shown on its own line.
 */
import type { ProjectDoc } from "../domain/schema";
import type { Warning } from "../geometry/types";

export function describeCheck(doc: ProjectDoc, w: Warning): { panel: string | null; feature: string | null; text: string } {
  const panel = doc.wing.panels.find((p) => p.id === w.panelId) ?? null;
  const spar = panel?.spars.find((s) => s.id === w.sparId) ?? null;
  let text = w.message;
  if (panel && text.startsWith(`${panel.name}: `)) text = text.slice(panel.name.length + 2);
  return { panel: panel?.name ?? null, feature: w.feature ?? (spar ? spar.name || "Spar" : null), text: text.charAt(0).toUpperCase() + text.slice(1) };
}
