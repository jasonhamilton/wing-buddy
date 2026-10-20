/** Ghost panels: the panels that are not the one being worked on, drawn faint so it stands out. */

/** Every panel except the selected one, when ghosting is on and there is a selected panel in the wing. */
export function ghostedPanels(panelIds: string[], selectedId: string | null, enabled: boolean): Set<string> {
  if (!enabled || selectedId === null || !panelIds.includes(selectedId)) return new Set();
  return new Set(panelIds.filter((id) => id !== selectedId));
}

/** The slider is a transparency (0 solid); a ghost is never quite invisible. */
export function ghostOpacity(transparency: number): number {
  return Math.min(1, Math.max(0.04, 1 - transparency));
}
