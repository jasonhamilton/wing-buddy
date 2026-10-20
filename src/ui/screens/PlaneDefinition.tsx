/** S01: the panel cards, the wing summary beneath them, and the whole wing in 3D. */
import { totalRibs, wingStats } from "../../domain/doc";
import { formatArea, formatLength } from "../../domain/units";
import { useStore } from "../../state/store";
import { PanelList } from "./PanelCards";
import { SimplifiedBuilder } from "./SimplifiedBuilder";
import { DEFAULT_VIEW, Viewport3D, type ViewOptions } from "../viewport/Viewport3D";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

export function PlaneDefinition() {
  const { doc, geometry, computing, builderPanelId } = useStore();
  const building = doc.wing.panels.find((p) => p.id === builderPanelId) ?? null;
  // Ghosting needs a panel being worked on: only while a panel's details are open, and then the others are ghosts. Otherwise nothing is.
  const selectedId = building ? building.id : null;
  const units = doc.displayUnits;
  const stats = wingStats(doc);
  // The builder is laid over the left of the wing view, which runs underneath it: the builder is see-through where it has nothing to show.
  const builderBox = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  // how far across the builder's solid parts reach from the left edge: the list, and the details card when one is open. Nothing drawn
  // over the wing (the cross-section) may run into them.
  const [solidRight, setSolidRight] = useState(0);
  const section = useStore((s) => s.builderSection);
  useEffect(() => {
    const el = builderBox.current;
    if (!building || !el) {
      setInset(0);
      setSolidRight(0);
      return;
    }
    // On the features half only the list is solid: the details are a card, and the rest is see-through, so the wing is framed
    // in everything to the right of the list. On the geometry half the whole builder is solid.
    const measure = () => {
      const list = section === "features" ? el.querySelector<HTMLElement>('nav[aria-label="Features"]') : null;
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      setInset(wide ? (list ? list.offsetWidth : el.offsetWidth) : 0);
      const left = el.getBoundingClientRect().left;
      const card = el.querySelector<HTMLElement>('[aria-label="Feature details"]')?.parentElement;
      const edges = [section === "features" ? (list?.getBoundingClientRect().right ?? left) : el.getBoundingClientRect().right, card?.getBoundingClientRect().right ?? left];
      setSolidRight(wide ? Math.max(...edges) - left : 0);
    };
    measure();
    // the details card comes and goes without the builder changing size
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const list = el.querySelector<HTMLElement>('nav[aria-label="Features"]');
    if (list) ro.observe(list);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [building, section]);
  // The wing is always drawn the one way: everything on, no axes, both halves, the other panels as gray ghosts.
  const focus = useStore((s) => s.featureFocus);
  // With a feature open: how see-through it is, and how see-through the rest of its panel is (still in colour); set above the details.
  // Deferred, so the sliders themselves are drawn first and the wing catches up when there is time.
  const featureTransparency = useDeferredValue(useStore((s) => s.featureTransparency));
  const panelTransparency = useDeferredValue(useStore((s) => s.panelTransparency));
  // the features hidden in the 3D view, by the ids of the solids they are drawn with
  const hiddenIds = doc.wing.panels.flatMap((p) => [
    ...p.spars.filter((x) => x.hidden).map((x) => x.id),
    ...(p.leadingEdge?.hidden ? [`${p.id}-leadingEdge`] : []),
    ...(p.trailingEdge?.hidden ? [`${p.id}-trailingEdge`] : []),
    ...(p.extraEdges ?? []).filter((x) => x.hidden).map((x) => x.id),
    ...(p.sheeting.hidden ? [`${p.id}-standard`] : []),
    ...p.sheeting.strips.filter((x) => x.hidden).map((x) => x.id),
    ...p.ribCombs.filter((x) => x.hidden).map((x) => x.id),
  ]);
  // edge stock that is set not to show its cut stock, by the ids of its solids
  const noCutStockIds = doc.wing.panels.flatMap((p) => [
    ...(p.leadingEdge?.enabled && p.leadingEdge.showCutStock === false ? [`${p.id}-leadingEdge`] : []),
    ...(p.trailingEdge?.enabled && p.trailingEdge.showCutStock === false ? [`${p.id}-trailingEdge`] : []),
    ...(p.extraEdges ?? []).filter((x) => x.showCutStock === false).map((x) => x.id),
  ]);
  // one object until something in it changes, or the 3D view would be rebuilt on every render
  const hiddenKey = hiddenIds.join(",");
  const noCutKey = noCutStockIds.join(",");
  const view: ViewOptions = useMemo(
    () => ({ ...DEFAULT_VIEW, hiddenIds: hiddenKey ? hiddenKey.split(",") : [], noCutStockIds: noCutKey ? noCutKey.split(",") : [], ...(focus ? { focus, featureTransparency, panelTransparency } : {}) }),
    [hiddenKey, noCutKey, focus, featureTransparency, panelTransparency],
  );

  return (
    <div
      className={`grid h-full min-h-0 grid-cols-1 ${
        building ? "lg:grid-cols-[340px_clamp(600px,50vw,780px)_1fr]" : "lg:grid-cols-[340px_1fr]"
      }`}
    >
      {/* --------------------------------------------------------- panels */}
      {/* The list stays where it is; on a phone there is no room for both, so the builder takes its place. */}
      <div className={`flex min-h-0 flex-col overflow-hidden border-r border-border bg-bg p-5 ${building ? "max-lg:hidden" : ""}`}>
        <PanelList />
      </div>
      {/* On the features half only the list, the details and the header are solid: the rest lets the pointer through to the wing beneath,
          which can be dragged there, and has no edge line down its right side. */}
      {building && (
        <div ref={builderBox} className={`relative z-10 min-h-0 min-w-0 overflow-hidden lg:col-start-2 lg:row-start-1 ${section === "features" ? "pointer-events-none" : "border-r border-border"}`}>
          <SimplifiedBuilder key={building.id} panel={building} />
        </div>
      )}

      {/* ------------------------------------------------------- viewport */}
      <div className={`grid min-h-0 min-w-0 grid-rows-[1fr] ${building ? "lg:col-span-2 lg:col-start-2 lg:row-start-1" : ""}`}>
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <Viewport3D result={geometry} options={view} stale={computing} selectedPanelId={selectedId} focusPanelId={building ? building.id : null} panelNames={Object.fromEntries(doc.wing.panels.map((p) => [p.id, p.name]))} leftInset={inset} coverLeft={solidRight} />
          <dl aria-label="Wing summary" className="pointer-events-none absolute bottom-3 right-4 text-xs tabular-nums">
            {(
              [
                ["Span", formatLength(stats.spanMm, units, units === "in" ? 1 : 0)],
                ["Area", formatArea(stats.areaDm2, units)],
                ["Mean chord", formatLength(stats.meanChordMm, units, units === "in" ? 2 : 1)],
                ["Aspect ratio", stats.aspectRatio.toFixed(2)],
                ["Panels per half", String(doc.wing.panels.length)],
                ["Ribs per half", String(totalRibs(doc))],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-6">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
