/**
 * Every edge stock a panel has, enabled ones only, the panel's own leading and trailing stock first and then the extra ones in
 * the order they were added. The geometry takes each in turn; the collisions between them are only warned about.
 */
import type { Panel } from "../domain/schema";

type EdgeStockType = Panel["leadingEdge"];

export type EdgeEntry = {
  /** absent for the panel's own leadingEdge and trailingEdge */
  id: string | null;
  name: string;
  which: "leadingEdge" | "trailingEdge";
  edge: EdgeStockType;
};

export function edgeEntries(panel: Panel): EdgeEntry[] {
  const out: EdgeEntry[] = [];
  if (panel.leadingEdge?.enabled) out.push({ id: null, name: "Leading edge stock", which: "leadingEdge", edge: panel.leadingEdge });
  if (panel.trailingEdge?.enabled) out.push({ id: null, name: "Trailing edge stock", which: "trailingEdge", edge: panel.trailingEdge });
  for (const x of panel.extraEdges ?? []) {
    out.push({ id: x.id, name: x.name, which: x.side === "leading" ? "leadingEdge" : "trailingEdge", edge: { ...x, enabled: true } });
  }
  return out;
}

/** The stretch of the chord the stock occupies, from the nose, in millimetres (a rod: its own width, set back). */
export function edgeSpan(entry: EdgeEntry, chordMm: number): [number, number] {
  const e = entry.edge;
  const w = Math.min(Math.max(e.widthMm, 0), chordMm);
  if (entry.which === "leadingEdge") {
    const back = e.shape === "round" ? (e.setbackMm ?? 0) : 0;
    return [back, back + w];
  }
  return [chordMm - w, chordMm];
}
