/**
 * Keeps a panel's ribs in step with its rib layout. Runs inside every edit, so one edit and its knock-on
 * respacing are one undo step. Ribs keep their ids by position in the row, so a selection survives respacing.
 */
import { calculatedPositions, ribLayoutOf } from "../geometry/ribDistribution";
import type { Panel, Rib } from "./schema";
import { uid } from "./doc";

/** Put the ribs of a panel where its layout says. Mutates the panel (it is an immer draft). */
export function applyRibLayout(panel: Panel): void {
  // An older file whose ribs were edited by hand is a custom layout: say so, so it stays that way.
  if (!panel.ribLayout && panel.ribsManuallyEdited) panel.ribLayout = ribLayoutOf(panel);
  const layout = ribLayoutOf(panel);
  const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);

  // Linear, exponential and chord proportional are worked out. Custom positions are the table's.
  const positions: number[] | null = layout.distribution === "custom" ? null : calculatedPositions(panel);

  const thickness = (r: Rib | undefined) => (layout.vary.thickness && r ? r.thicknessMm : panel.ribThicknessMm);
  const half = (r: Rib | undefined) => (layout.vary.half && r ? (r.half ?? null) : null);

  if (positions === null) {
    // Positions belong to the user. Thickness and half ribs are put back unless they are too.
    panel.ribs = sorted.map((r) => ({ ...r, thicknessMm: thickness(r), half: half(r) }));
    return;
  }
  panel.ribs = positions.map((positionMm, i) => {
    const old = sorted[i];
    return { id: old?.id ?? uid(), positionMm, thicknessMm: thickness(old), half: half(old) };
  });
}
