/**
 * The simplified builder: one panel on one screen, in two halves chosen at the top. Wing geometry is the panel's
 * own airfoils, planform and dihedral, edited by clicking the value. Features is a list of the additional features on
 * the left with the chosen feature's settings on the right, and the rib drawn full width underneath. Only what a panel always needs is
 * shown to begin with; everything else is added with a + and taken away with a bin, so a plain panel stays plain.
 *
 * It edits the same project as the full Wing panel definition window, so the two can be used side by side
 * while the full window is phased out.
 */
import { useEffect, useRef, useState } from "react";
import { defaultAileron, defaultSpar, uid } from "../../domain/doc";
import type { Panel } from "../../domain/schema";
import { defaultComb } from "../../geometry/combs";
import { defaultStrip } from "../../geometry/sheeting";
import { formatLength } from "../../domain/units";
import { panelSections } from "../../geometry";
import { fitRodDiameterMm, wedgeAngleDeg, wedgeHeightMm } from "../../geometry/edgeStock";
import { ops, useStore } from "../../state/store";
import { IconButton, type MenuItem } from "../primitives";
import { AddFeatureDialog, type EdgeShape, type SparVariant } from "./AddFeatureDialog";
import { Panel2D, RibView } from "../viewport/Canvas2D";
import { EdgeDetail } from "./EdgeDetails";
import { CombDetail, HolesDetail, SheetDetail, StripDetail, TabsDetail } from "./FeatureDetails";
import { AileronDetail, JoinerDetail, SparDetail } from "./SparDetails";
import { FeatureCard } from "./FeatureCard";
import { GeometryView } from "./GeometryView";
import { featuresOf, isNotch, type Feature, type Pick } from "./panelFeatures";

const isAileron = (s: { type: string }) => s.type === "aileronCutter";
const isJoiner = (s: { type: string }) => s.type === "roundJoiner" || s.type === "cuboidJoiner";

const same = (a: Pick | null, b: Pick | null) => a !== null && b !== null && a.k === b.k && ("id" in a ? "id" in b && a.id === b.id : true);

const PLUS = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);
const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 3L5 8l5 5" />
  </svg>
);

/* ------------------------------------------------------------ feature list */

/* ----------------------------------------------------------------- builder */

export function SimplifiedBuilder({ panel }: { panel: Panel }) {
  const { geometry, selection, select, closeBuilder, doc, builderSection: section, setBuilderSection, builderPick } = useStore();
  const [picked, setPicked] = useState<Pick | null>((builderPick as Pick | null) ?? null);
  // opened from a feature's preview on the panel card: that feature is the one to show
  useEffect(() => {
    if (builderPick) setPicked(builderPick as Pick);
  }, [builderPick]);
  // the guided dialog for adding a feature
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<null | { key: string; over: number }>(null);
  const [announce, setAnnounce] = useState("");
  // Ribs on the cards and in the preview: each filling its frame, or all to one scale so a small rib looks small.
  const [ribSize, setRibSize] = useState<"full" | "actual">("full");
  const cards = useRef(new Map<string, HTMLLIElement>());

  const features = featuresOf(panel);
  // Escape on the features half: close the details that are open; with none open, go back to the wing panels.
  useEffect(() => {
    if (section !== "features" || adding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return; // that field's own Escape
      if (document.querySelector('[role="dialog"]')) return; // a dialog is open: it takes the key
      e.preventDefault();
      if (picked && features.some((f) => same(f.pick, picked))) setPicked(null);
      else closeBuilder();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  // The feature being edited, if one is open. None is open until one is clicked, and it closes when it is removed.
  const current: Pick | null = picked && features.some((f) => same(f.pick, picked)) ? picked : null;
  const is = (p: Pick) => same(current, p);

  // Tell the 3D view which feature is open, so it can fade the rest of the panel. The ids are those of the solids the feature is drawn with.
  const setFeatureFocus = useStore((st) => st.setFeatureFocus);
  const featureTransparency = useStore((st) => st.featureTransparency);
  const panelTransparency = useStore((st) => st.panelTransparency);
  const setFade = useStore((st) => st.setFade);
  const focusKey = section === "features" && current ? JSON.stringify(current) : "";
  useEffect(() => {
    if (!focusKey) {
      setFeatureFocus(null);
      return;
    }
    const c = JSON.parse(focusKey) as Pick;
    const ids =
      c.k === "spar" || c.k === "strip" || c.k === "comb" || c.k === "edge"
        ? [c.id]
        : c.k === "sheet"
          ? [`${panel.id}-standard`]
          : c.k === "le"
            ? [`${panel.id}-leadingEdge`]
            : c.k === "te"
              ? [`${panel.id}-trailingEdge`]
              : []; // tabs and holes are cut in the ribs themselves
    setFeatureFocus({ panelId: panel.id, ids });
    return () => setFeatureFocus(null);
  }, [focusKey, panel.id, setFeatureFocus]);

  const spar = current?.k === "spar" ? panel.spars.find((s) => s.id === current.id) : undefined;
  const strip = current?.k === "strip" ? panel.sheeting.strips.find((s) => s.id === current.id) : undefined;
  const comb = current?.k === "comb" ? panel.ribCombs.find((c) => c.id === current.id) : undefined;

  const panelRibs = geometry?.ribs.filter((r) => r.panelId === panel.id) ?? [];
  // The extent of the largest of the panel's ribs, to draw every rib against when they are shown to scale.
  const panelFrame = (() => {
    const pts = panelRibs.flatMap((r) => [...r.outline, ...r.holes].flat());
    return pts.length ? { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) } : undefined;
  })();
  const activeRib = panelRibs.find((r) => r.ribId === selection.ribId) ?? panelRibs[0] ?? null;

  const setEdge = (key: "leadingEdge" | "trailingEdge", enabled: boolean) =>
    ops.updatePanel(panel.id, { [key]: { ...panel[key], enabled } } as Partial<Panel>, "edge stock");

  const remove = (f: Feature) => {
    const p = f.pick;
    if (p.k === "spar") ops.removeSpar(panel.id, p.id);
    else if (p.k === "le") setEdge("leadingEdge", false);
    else if (p.k === "te") setEdge("trailingEdge", false);
    else if (p.k === "edge") ops.updatePanel(panel.id, { extraEdges: (panel.extraEdges ?? []).filter((x) => x.id !== p.id) }, "remove edge stock");
    else if (p.k === "strip") ops.removeSheetStrip(panel.id, p.id);
    else if (p.k === "sheet") ops.updateSheeting(panel.id, { type: "none" }, "sheeting type");
    else if (p.k === "comb") ops.removeComb(panel.id, p.id);
    else if (p.k === "holes") ops.updateHoles(panel.id, { type: "none" }, "lightening holes type");
    else if (p.k === "tabs") ops.updatePanel(panel.id, { buildingTabs: { ...panel.buildingTabs, enabled: false } }, "building tabs");
  };

  /** Switch a feature off, or back on, without deleting it. */
  const toggleSuppressed = (f: Feature) => {
    const p = f.pick;
    const next = !f.suppressed;
    const label = next ? "suppress feature" : "unsuppress feature";
    if (p.k === "spar") ops.updateSpar(panel.id, p.id, { suppressed: next }, label);
    else if (p.k === "le") ops.updatePanel(panel.id, { leadingEdge: { ...panel.leadingEdge, suppressed: next } }, label);
    else if (p.k === "te") ops.updatePanel(panel.id, { trailingEdge: { ...panel.trailingEdge, suppressed: next } }, label);
    else if (p.k === "edge") ops.updatePanel(panel.id, { extraEdges: (panel.extraEdges ?? []).map((x) => (x.id === p.id ? { ...x, suppressed: next } : x)) }, label);
    else if (p.k === "strip") ops.updateStrip(panel.id, p.id, { suppressed: next }, label);
    else if (p.k === "sheet") ops.updateSheeting(panel.id, { suppressed: next }, label);
    else if (p.k === "comb") ops.updateComb(panel.id, p.id, { suppressed: next }, label);
    else if (p.k === "holes") ops.updateHoles(panel.id, { suppressed: next }, label);
    else if (p.k === "tabs") ops.updatePanel(panel.id, { buildingTabs: { ...panel.buildingTabs, suppressed: next } }, label);
  };

  /** Hide a feature in the 3D view, or show it again. Tabs and holes are cut in the ribs and have nothing to hide. */
  const toggleHidden = (f: Feature) => {
    const p = f.pick;
    const next = !f.hidden;
    const label = next ? "hide feature" : "show feature";
    if (p.k === "spar") ops.updateSpar(panel.id, p.id, { hidden: next }, label);
    else if (p.k === "le") ops.updatePanel(panel.id, { leadingEdge: { ...panel.leadingEdge, hidden: next } }, label);
    else if (p.k === "te") ops.updatePanel(panel.id, { trailingEdge: { ...panel.trailingEdge, hidden: next } }, label);
    else if (p.k === "edge") ops.updatePanel(panel.id, { extraEdges: (panel.extraEdges ?? []).map((x) => (x.id === p.id ? { ...x, hidden: next } : x)) }, label);
    else if (p.k === "strip") ops.updateStrip(panel.id, p.id, { hidden: next }, label);
    else if (p.k === "sheet") ops.updateSheeting(panel.id, { hidden: next }, label);
    else if (p.k === "comb") ops.updateComb(panel.id, p.id, { hidden: next }, label);
  };

  /** A new feature goes to the end of the list. Same label as the add, so the two are one undo step. */
  const last = (key: string, label: string) => ops.setFeatureOrder(panel.id, [...features.map((f) => f.key), key], label);

  /** A new spar, notch or edge stock of the kind picked on the dialog's second screen. */
  const addVariant = (variant: SparVariant, shape?: EdgeShape) => {
    if (variant === "leading" || variant === "trailing") {
      const which = variant === "leading" ? "leadingEdge" : "trailingEdge";
      const base = panel[which];
      // the shape asked for, started the way the details start it: a rod just covers the nose, a wedge keeps its width and angle
      const section = panelSections(doc)[doc.wing.panels.findIndex((p) => p.id === panel.id)];
      let look: Partial<typeof base> = {};
      if (shape === "round" && section) {
        const d = Number(fitRodDiameterMm(panel.rootChordMm, section(0)).toFixed(1));
        look = { shape, widthMm: d, heightMm: d, offsetMm: 0, setbackMm: 0 };
      } else if (shape === "triangle") {
        const a = Math.min(80, Math.max(1, wedgeAngleDeg(base.widthMm, base.heightMm) || 20));
        look = { shape, angleDeg: Number(a.toFixed(1)), heightMm: Number(wedgeHeightMm(base.widthMm, a).toFixed(2)) };
      } else if (shape) look = { shape };
      if (!base.enabled) {
        // the first at this edge is the panel's own
        ops.updatePanel(panel.id, { [which]: { ...base, ...look, enabled: true } } as Partial<Panel>, "edge stock");
        last(variant === "leading" ? "le" : "te", "edge stock");
        setPicked({ k: variant === "leading" ? "le" : "te" });
      } else {
        // a further one at the same edge: any collision with the others is only warned about
        const n = (panel.extraEdges ?? []).filter((x) => x.side === variant).length + 2;
        const id = uid();
        ops.updatePanel(panel.id, { extraEdges: [...(panel.extraEdges ?? []), { ...base, ...look, enabled: true, id, side: variant, name: `${variant === "leading" ? "Leading" : "Trailing"} edge stock ${n}` }] }, "edge stock");
        last(id, "edge stock");
        setPicked({ k: "edge", id });
      }
      return;
    }
    if (variant === "sheetTop" || variant === "sheetBottom" || variant === "sheetBoth") {
      // a sheeting strip on the top surface, the bottom, or both
      const n = defaultStrip(panel, `Strip ${panel.sheeting.strips.length + 1}`);
      n.applyAbove = variant !== "sheetBottom";
      n.applyBelow = variant !== "sheetTop";
      ops.addSheetStrip(panel.id, n);
      last(n.id, "add strip");
      setPicked({ k: "strip", id: n.id });
      return;
    }
    if (variant === "roundJoiner" || variant === "cuboidJoiner") {
      // named for its shape; the second is Round Joiner 2, and so on
      const base = variant === "roundJoiner" ? "Round Joiner" : "Cuboid Joiner";
      let k = 1;
      while (panel.spars.some((x) => x.name === (k === 1 ? base : `${base} ${k}`))) k++;
      const n = defaultSpar(panel, k === 1 ? base : `${base} ${k}`, variant);
      n.spanStartMm = 0;
      n.spanEndMm = Math.min(50, panel.lengthMm);
      ops.addSpar(panel.id, n);
      last(n.id, "add joiner");
      select({ sparId: n.id });
      setPicked({ k: "spar", id: n.id });
      return;
    }
    const notch = variant === "top" || variant === "bottom" || variant === "both";
    const plain = panel.spars.filter((x) => !isAileron(x) && !isJoiner(x) && !isNotch(x) && x.type !== "webbing").length;
    const notches = panel.spars.filter(isNotch).length;
    // a spar is round or cuboid; a notch is a rectangular cut let in from the surface
    const n = defaultSpar(panel, notch ? `Notch ${notches + 1}` : `Spar ${plain + 1}`, variant === "round" ? "round" : variant === "cuboid" ? "cuboid" : "rectangle");
    n.positionTop = variant === "top" || variant === "both";
    n.positionBottom = variant === "bottom" || variant === "both";
    ops.addSpar(panel.id, n);
    last(n.id, notch ? "add notch" : "add spar");
    select({ sparId: n.id });
    setPicked({ k: "spar", id: n.id });
  };

  /** What the + offers. One-only features are listed but off once they are there. */
  const addItems: MenuItem[] = [
    {
      label: "Spar",
      onSelect: () => addVariant("cuboid"),
    },
    {
      label: "Webbing",
      onSelect: () => {
        const n = defaultSpar(panel, `Webbing ${panel.spars.filter((x) => x.type === "webbing").length + 1}`, "webbing");
        n.width = { start: 2, end: null };
        n.positionTop = false;
        n.positionBottom = false;
        ops.addSpar(panel.id, n);
        last(n.id, "add webbing");
        select({ sparId: n.id });
        setPicked({ k: "spar", id: n.id });
      },
    },
    {
      label: "Notch",
      onSelect: () => addVariant("both"),
    },
    {
      label: "Aileron cutter",
      onSelect: () => {
        const n = defaultSpar(panel, `Aileron ${panel.spars.filter(isAileron).length + 1}`, "aileronCutter");
        n.aileron = defaultAileron();
        // hinged near the back, over the outer part of the panel
        n.distance = { start: { value: 72, unit: "pct" }, end: null };
        n.spanStartMm = Math.round(panel.lengthMm * 0.4);
        n.spanEndMm = panel.lengthMm;
        ops.addSpar(panel.id, n);
        last(n.id, "add aileron");
        select({ sparId: n.id });
        setPicked({ k: "spar", id: n.id });
      },
    },
    {
      label: "Joiner",
      onSelect: () => addVariant("roundJoiner"),
    },
    { label: "Leading edge stock", onSelect: () => addVariant("leading") },
    { label: "Trailing edge stock", onSelect: () => addVariant("trailing") },
    panel.sheeting.type === "standard"
      ? { label: "Sheeting", disabled: true, reason: "standard sheeting is in use" }
      : {
          label: "Sheeting",
          onSelect: () => {
            const n = defaultStrip(panel, `Strip ${panel.sheeting.strips.length + 1}`);
            ops.addSheetStrip(panel.id, n);
            last(n.id, "add strip");
            setPicked({ k: "strip", id: n.id });
          },
        },
    {
      label: "Rib comb",
      onSelect: () => {
        const n = defaultComb(panel, `Comb ${panel.ribCombs.length + 1}`, panel.ribCombs.length % 2 === 0 ? "below" : "above");
        ops.addComb(panel.id, n);
        last(n.id, "add comb");
        setPicked({ k: "comb", id: n.id });
      },
    },
    panel.buildingTabs.enabled
      ? { label: "Building tabs", disabled: true, reason: "already added" }
      : { label: "Building tabs", onSelect: () => { ops.updatePanel(panel.id, { buildingTabs: { ...panel.buildingTabs, enabled: true } }, "building tabs"); last("tabs", "building tabs"); setPicked({ k: "tabs" }); } },
    panel.lighteningHoles.type !== "none"
      ? { label: "Lightening holes", disabled: true, reason: "already added" }
      : { label: "Lightening holes", onSelect: () => { ops.updateHoles(panel.id, { type: "standard" }, "lightening holes type"); last("holes", "lightening holes type"); setPicked({ k: "holes" }); } },
  ];

  /* ---- reordering: drag the grip, or focus it and use the arrow keys ---- */
  const commitOrder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= features.length) return;
    const keys = features.map((f) => f.key);
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved);
    ops.setFeatureOrder(panel.id, keys);
    return moved;
  };
  const overIndex = (y: number) => {
    let best = 0;
    features.forEach((f, i) => {
      const r = cards.current.get(f.key)?.getBoundingClientRect();
      if (r && y >= r.top + r.height / 2) best = i;
    });
    return best;
  };
  const grip = (f: Feature, i: number): React.ButtonHTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ key: f.key, over: i });
    },
    onPointerMove: (e) => {
      if (drag?.key === f.key) setDrag({ key: f.key, over: overIndex(e.clientY) });
    },
    onPointerUp: () => {
      if (drag?.key === f.key) commitOrder(i, drag.over);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onClick: (e) => e.stopPropagation(),
    onKeyDown: (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      if (!commitOrder(i, to)) return;
      setAnnounce(`${f.name} moved to position ${to + 1} of ${features.length}`);
      const label = `Reorder ${f.name}`;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`)?.focus());
    },
  });

  // The rib selector and the rib drawn under it. It runs the width of the builder, under the details card's place too, to where the card's
  // right edge is, whether or not a feature is open.
  const ribsStrip = (
    <>
      <div className="pointer-events-auto shrink-0 border-t border-border bg-surface px-4 pt-2">
        <div tabIndex={0} aria-label="Rib selector" className="wb-scroll flex items-center gap-2 overflow-x-auto pb-2">
          <span className="shrink-0 text-micro uppercase tracking-[.07em] text-muted">Ribs</span>
          {panelRibs.map((r) => (
            <button
              key={r.ribId}
              type="button"
              onClick={() => select({ ribId: r.ribId })}
              aria-pressed={r.ribId === activeRib?.ribId}
              className={`h-ctl shrink-0 rounded-sm border px-3 font-mono text-micro ${
                r.ribId === activeRib?.ribId ? "border-accent bg-selected text-on-selected" : "border-border-input bg-input-bg text-muted hover:text-fg"
              }`}
            >
              R{r.index + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="pointer-events-auto aspect-[4/1] max-h-[32vh] min-h-[150px] w-full shrink-0 border-t border-border">
        <Panel2D title={`Rib preview — ${panel.name}`}>
          {activeRib ? (
            <RibView rib={activeRib} frame={ribSize === "actual" ? panelFrame : undefined} label={`Rib ${activeRib.index + 1} · chord ${formatLength(activeRib.chordMm, doc.displayUnits, 1)}`} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">No ribs yet. Add ribs to see them here.</div>
          )}
        </Panel2D>
      </div>
    </>
  );

  return (
    <section aria-label="Simplified builder" className="wb-slide-in flex h-full min-h-0 flex-col">
      {/* ---------------------------------------------------------- header */}
      <header className="pointer-events-auto flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <IconButton label="Close the builder" onClick={closeBuilder} className="border-border-input bg-input-bg">
          {CHEVRON}
        </IconButton>
        <div className="min-w-0 flex-1" />
        <div role="group" aria-label="What to edit" className="flex shrink-0 overflow-hidden rounded-sm border border-border-input">
          {(["features", "geometry"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={section === k}
              onClick={() => setBuilderSection(k)}
              className={`h-ctl px-3 text-xs ${section === k ? "bg-selected text-on-selected" : "bg-input-bg text-muted hover:text-fg"}`}
            >
              {k === "geometry" ? "Wing geometry" : "Features"}
            </button>
          ))}
        </div>
      </header>

      {/* ----------------------------------------------------- features + detail */}
      {section === "geometry" ? (
        <div tabIndex={0} aria-label="Wing geometry" className="wb-scroll min-h-0 flex-1 overflow-auto bg-bg p-5">
          <GeometryView panel={panel} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(240px,48%)_minmax(0,1fr)]">
        {/* the list, and under it the ribs: one solid column, so the area to its right is free for the details and the wing beneath */}
        <div className="pointer-events-auto flex min-h-0 flex-col border-b border-border bg-surface md:border-b-0 md:border-r">
        <nav aria-label="Features" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-4 pt-3">
            <h3 className="text-micro font-medium uppercase tracking-[.07em] text-muted">
              <button type="button" title={current ? "Close the details" : undefined} onClick={() => setPicked(null)} className="rounded-sm uppercase tracking-[.07em] hover:text-fg">
                Features
              </button>
            </h3>
            <div role="group" aria-label="Rib size" className="flex overflow-hidden rounded-sm border border-border-input text-xs">
              {(["full", "actual"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={ribSize === k}
                  title={k === "full" ? "Each rib fills its frame" : "Ribs drawn to the same scale, so a smaller rib looks smaller"}
                  onClick={() => setRibSize(k)}
                  className={`h-6 px-2.5 ${ribSize === k ? "bg-selected text-on-selected" : "bg-input-bg text-muted hover:text-fg"}`}
                >
                  {k === "full" ? "Full" : "Actual"}
                </button>
              ))}
            </div>
            <IconButton
              label="Add a feature"
              className="border-border-input bg-input-bg"
              onClick={() => setAdding(true)}
            >
              {PLUS}
            </IconButton>
          </div>
          <ul aria-label="Panel features" className="wb-scroll min-h-0 flex-1 space-y-3 overflow-auto p-3">
            {features.map((f, i) => (
              <FeatureCard
                key={f.key}
                panel={panel}
                feature={f}
                number={i + 1}
                cardRef={(el) => {
                  if (el) cards.current.set(f.key, el);
                  else cards.current.delete(f.key);
                }}
                selected={is(f.pick)}
                dragging={drag?.key === f.key}
                onSelect={() => setPicked(is(f.pick) ? null : f.pick)}
                onRemove={() => remove(f)}
                onSuppress={() => toggleSuppressed(f)}
                onHide={f.pick.k === "tabs" || f.pick.k === "holes" ? undefined : () => toggleHidden(f)}
                grip={grip(f, i)}
                actualSize={ribSize === "actual"}
                dimmed={current !== null && !is(f.pick)}
              />
            ))}
            {features.length === 0 && <li className="px-1 text-xs text-muted">Nothing added yet. Use + to add a spar, edge stock, sheeting, a comb, building tabs or lightening holes.</li>}
            <li>
              <button
                type="button"
                aria-haspopup="dialog"
                data-add-feature
                onClick={() => setAdding(true)}
                className="group flex h-36 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-surface-raised text-sm font-medium text-muted transition-colors hover:border-border-strong hover:bg-surface-sunken hover:text-fg"
              >
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors group-hover:border-border-strong group-hover:text-fg">
                  {PLUS}
                </span>
                Add feature
              </button>
            </li>
          </ul>
          <p role="status" className="sr-only">
            {announce}
          </p>
        </nav>
        </div>

        {current !== null && (
        <div className="pointer-events-auto m-3 flex min-h-0 max-h-[calc(100%-1.5rem)] flex-col gap-3 self-start">
        {/* how see-through the open feature is, and how see-through the rest of its panel is in the 3D view */}
        <section aria-label="View transparency" className="shrink-0 rounded-lg border border-border bg-bg px-5 py-3 shadow-card">
          {/* the words at the left, each slider and its value at the right */}
          <div className="grid gap-2">
            <label className="flex items-center justify-between gap-6 text-sm">
              <span className="text-left text-muted">Selected feature transparency</span>
              <span className="flex items-center gap-3">
                <input type="range" min={0} max={95} value={Math.round(featureTransparency * 100)} onChange={(e) => setFade({ featureTransparency: Number(e.target.value) / 100 })} className="w-32" aria-label="Selected feature transparency" />
                <span className="w-8 text-right font-mono text-xs tabular-nums text-muted">{Math.round(featureTransparency * 100)}%</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-6 text-sm">
              <span className="text-left text-muted">Panel transparency</span>
              <span className="flex items-center gap-3">
                <input type="range" min={0} max={95} value={Math.round(panelTransparency * 100)} onChange={(e) => setFade({ panelTransparency: Number(e.target.value) / 100 })} className="w-32" aria-label="Panel transparency" />
                <span className="w-8 text-right font-mono text-xs tabular-nums text-muted">{Math.round(panelTransparency * 100)}%</span>
              </span>
            </label>
          </div>
        </section>
        <div tabIndex={0} aria-label="Feature details" className="wb-scroll min-h-0 overflow-auto rounded-lg border border-border bg-bg p-5 shadow-card">
          {current?.k === "tabs" && <TabsDetail panel={panel} />}
          {spar && spar.type === "aileronCutter" && <AileronDetail panel={panel} spar={spar} />}
          {spar && (spar.type === "roundJoiner" || spar.type === "cuboidJoiner") && <JoinerDetail panel={panel} spar={spar} />}
          {spar && spar.type !== "aileronCutter" && spar.type !== "roundJoiner" && spar.type !== "cuboidJoiner" && <SparDetail panel={panel} spar={spar} />}
          {current?.k === "le" && <EdgeDetail panel={panel} which="le" />}
          {current?.k === "te" && <EdgeDetail panel={panel} which="te" />}
          {current?.k === "edge" && (() => {
            const x = (panel.extraEdges ?? []).find((e) => e.id === current.id);
            return x ? <EdgeDetail key={x.id} panel={panel} which={x.side === "leading" ? "le" : "te"} edgeId={x.id} /> : null;
          })()}
          {strip && <StripDetail panel={panel} strip={strip} />}
          {current?.k === "sheet" && <SheetDetail panel={panel} />}
          {comb && <CombDetail panel={panel} comb={comb} />}
          {current?.k === "holes" && <HolesDetail panel={panel} />}
        </div>
        </div>
        )}
      </div>
      )}
      {section === "features" && <div className="pointer-events-auto mr-3 shrink-0 bg-surface">{ribsStrip}</div>}

      {adding && (
        <AddFeatureDialog
          items={addItems}
          onAddVariant={addVariant}
          onClose={() => {
            setAdding(false);
            document.querySelector<HTMLElement>('button[aria-label="Add a feature"]')?.focus();
          }}
        />
      )}
    </section>
  );
}
