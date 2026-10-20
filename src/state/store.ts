/**
 * One store: the document, its history, and the geometry derived from it.
 *
 * Undo is Immer patches, not document snapshots, so the history of a 30-rib
 * wing costs kilobytes rather than megabytes. Geometry never enters history —
 * it is recomputed from whatever document the undo restores.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import { invalidateFoil } from "../domain/airfoils";
import { applyRibLayout } from "../domain/ribLayout";
import { defaultPanel, generateRibs, syncAirfoilLinks, totalRibs, uid } from "../domain/doc";
import { fixWarning } from "../geometry/fixes";
import type { Warning } from "../geometry/types";
import type { Panel, ProjectDoc, Rib, RibComb, SheetStrip, Spar } from "../domain/schema";
import { seedProject } from "../domain/seed";
import { newPanelFrom, type CopyMethod } from "../domain/panelCopy";
import { loadLocal } from "../io/localStore";
import type { GeometryResult } from "../geometry/types";
import { scheduleRebuild } from "./scheduler";

enablePatches();

const HISTORY_LIMIT = 100;
const COALESCE_MS = 400;

type HistoryEntry = { patches: Patch[]; inverse: Patch[]; label: string; at: number };

export type Selection = {
  panelId: string | null;
  sparId: string | null;
  ribId: string | null;
};

type State = {
  doc: ProjectDoc;
  geometry: GeometryResult | null;
  computing: boolean;
  dirty: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  selection: Selection;
  dialogPanelId: string | null;
  dialogTab: string;
  /** The panel open in the slide-out simplified builder, if any. */
  builderPanelId: string | null;
  /** which half of the builder is showing: the panel's own geometry, or its additional features */
  builderSection: "geometry" | "features";
  /** the feature the builder should have open when it is opened from a panel card's preview (a fresh object each time) */
  builderPick: { k: string; id?: string } | null;
  /** the feature open in the builder's details, as the ids of the solids it is drawn with; the 3D view fades everything else in its panel */
  featureFocus: { panelId: string; ids: string[] } | null;
  setFeatureFocus: (f: { panelId: string; ids: string[] } | null) => void;
  /** with a feature open: how see-through it is, and how see-through the rest of its panel is (0 solid to 1 gone) */
  featureTransparency: number;
  panelTransparency: number;
  setFade: (f: { featureTransparency?: number; panelTransparency?: number }) => void;
  /** The airfoil library, open to choose a section for one end of a panel. */
  foilPicker: { panelId: string; target: "root" | "tip" } | null;
  /** Set when the browser will not keep the project between visits. */
  storageProblem: "unavailable" | "full" | null;
  setStorageProblem: (p: State["storageProblem"]) => void;

  mutate: (label: string, fn: (draft: ProjectDoc) => void) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Partial<Selection>) => void;
  openPanelDialog: (panelId: string, tab?: string) => void;
  closePanelDialog: () => void;
  openBuilder: (panelId: string, section?: "geometry" | "features", pick?: { k: string; id?: string } | null) => void;
  setBuilderSection: (section: "geometry" | "features") => void;
  closeBuilder: () => void;
  openFoilPicker: (panelId: string, target: "root" | "tip") => void;
  closeFoilPicker: () => void;
  setDialogTab: (t: string) => void;
  replaceDoc: (doc: ProjectDoc, label: string) => void;
  /** The project was just written to a file: nothing is unexported any more. */
  markExported: () => void;
  recompute: () => void;

  activePanel: () => Panel | null;
  activeSpar: () => Spar | null;
};

// Pick up where the last visit left off; a first visit gets the example wing.
const restored = loadLocal();
if (restored) syncAirfoilLinks(restored.doc);

export const useStore = create<State>((set, get) => ({
  doc: restored?.doc ?? seedProject(),
  geometry: null,
  computing: false,
  dirty: restored?.dirty ?? false,
  storageProblem: null,
  setStorageProblem: (p) => set({ storageProblem: p }),
  undoStack: [],
  redoStack: [],
  selection: { panelId: null, sparId: null, ribId: null },
  dialogPanelId: null,
  dialogTab: "base",
  builderPanelId: null,
  builderSection: "geometry",
  builderPick: null,
  featureFocus: null,
  setFeatureFocus: (f) => set({ featureFocus: f }),
  featureTransparency: 0,
  panelTransparency: 0.9,
  setFade: (f) => set(f),
  foilPicker: null,

  mutate(label, fn) {
    const state = get();
    const [next, patches, inverse] = produceWithPatches(state.doc, (draft) => {
      fn(draft);
      for (const panel of draft.wing.panels) applyRibLayout(panel);
      syncAirfoilLinks(draft);
      draft.updatedAt = new Date().toISOString();
    });
    if (patches.length === 0) return;

    const now = Date.now();
    const top = state.undoStack[state.undoStack.length - 1];
    const coalesce = top && top.label === label && now - top.at < COALESCE_MS;

    const undoStack = coalesce
      ? [
          ...state.undoStack.slice(0, -1),
          { patches: [...top.patches, ...patches], inverse: [...inverse, ...top.inverse], label, at: now },
        ]
      : [...state.undoStack, { patches, inverse, label, at: now }].slice(-HISTORY_LIMIT);

    set({ doc: next, undoStack, redoStack: [], dirty: true });
    get().recompute();
  },

  undo() {
    const { undoStack, redoStack, doc } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    set({
      doc: applyPatches(doc, entry.inverse),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
      dirty: true,
    });
    get().recompute();
  },

  redo() {
    const { undoStack, redoStack, doc } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    set({
      doc: applyPatches(doc, entry.patches),
      undoStack: [...undoStack, entry],
      redoStack: redoStack.slice(0, -1),
      dirty: true,
    });
    get().recompute();
  },

  select(s) {
    set({ selection: { ...get().selection, ...s } });
  },
  openPanelDialog(panelId, tab = "base") {
    set({ dialogPanelId: panelId, dialogTab: tab, selection: { ...get().selection, panelId } });
  },
  closePanelDialog() {
    set({ dialogPanelId: null });
  },
  openBuilder(panelId, section = "geometry", pick = null) {
    set({ builderPanelId: panelId, builderSection: section, builderPick: pick ? { ...pick } : null, selection: { panelId, sparId: null, ribId: null } });
  },
  setBuilderSection(section) {
    set({ builderSection: section });
  },
  closeBuilder() {
    set({ builderPanelId: null });
  },
  openFoilPicker(panelId, target) {
    set({ foilPicker: { panelId, target } });
  },
  closeFoilPicker() {
    set({ foilPicker: null });
  },
  setDialogTab(t) {
    set({ dialogTab: t });
  },
  replaceDoc(doc, _label) {
    syncAirfoilLinks(doc);
    set({
      doc,
      undoStack: [],
      redoStack: [],
      dirty: false,
      builderPanelId: null,
      selection: { panelId: null, sparId: null, ribId: null },
    });
    get().recompute();
  },
  markExported() {
    set({ dirty: false });
  },

  recompute() {
    const doc = get().doc;
    scheduleRebuild(doc, {
      onStart: () => set({ computing: true }),
      onResult: (geometry) => set({ geometry, computing: false }),
    });
  },

  activePanel() {
    const { doc, selection } = get();
    return doc.wing.panels.find((p) => p.id === selection.panelId) ?? doc.wing.panels[0] ?? null;
  },
  activeSpar() {
    const panel = get().activePanel();
    const id = get().selection.sparId;
    return panel?.spars.find((s) => s.id === id) ?? null;
  },
}));

// ---------------------------------------------------------------- operations

export const ops = {
  /**
   * Add a panel after the last one. With a panel before it, `method` says how it starts out (see
   * panelCopy.ts); the default carries on from the previous tip. The copy is made OUTSIDE the
   * producer: Immer drafts are proxies and structuredClone refuses to copy a proxy, which
   * silently broke this whole operation until an end-to-end test caught it.
   */
  addPanel(method: CopyMethod = "smart") {
    const doc = useStore.getState().doc;
    const last = doc.wing.panels[doc.wing.panels.length - 1];
    const name = `Panel ${doc.wing.panels.length + 1}`;
    let panel: Panel;
    if (last) {
      panel = newPanelFrom(last, method, name);
    } else {
      panel = defaultPanel(name);
      panel.ribs = generateRibs(panel);
    }
    useStore.getState().mutate("add panel", (d) => {
      d.wing.panels.push(panel);
    });
    return panel.id;
  },

  removePanel(panelId: string) {
    useStore.getState().mutate("delete panel", (d) => {
      d.wing.panels = d.wing.panels.filter((p) => p.id !== panelId);
    });
  },

  /** Put a panel at a position (0 is the root end). Out-of-range positions are clamped. */
  movePanelTo(panelId: string, toIndex: number) {
    useStore.getState().mutate("move panel", (d) => {
      const i = d.wing.panels.findIndex((p) => p.id === panelId);
      if (i < 0) return;
      const j = Math.max(0, Math.min(d.wing.panels.length - 1, toIndex));
      if (j === i) return;
      const [p] = d.wing.panels.splice(i, 1);
      d.wing.panels.splice(j, 0, p);
    });
  },

  updatePanel(panelId: string, patch: Partial<Panel>, label = "edit panel") {
    useStore.getState().mutate(label, (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) Object.assign(p, patch);
    });
  },

  regenerateRibs(panelId: string) {
    useStore.getState().mutate("generate ribs", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      p.ribs = generateRibs(p);
      p.ribsManuallyEdited = false;
    });
  },

  updateRib(panelId: string, ribId: string, patch: Partial<Rib>) {
    useStore.getState().mutate("edit rib", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      const r = p?.ribs.find((x) => x.id === ribId);
      if (!r || !p) return;
      Object.assign(r, patch);
      p.ribsManuallyEdited = true;
      p.ribs.sort((a, b) => a.positionMm - b.positionMm);
    });
  },

  setRibHalf(panelId: string, ribId: string, half: "front" | "rear" | null) {
    useStore.getState().mutate("rib type", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      const r = p?.ribs.find((x) => x.id === ribId);
      if (!r || !p) return;
      r.half = half;
      p.ribsManuallyEdited = true;
    });
  },

  /** Every second rib between the first and the last becomes a half rib on `side`; the rest are full. */
  alternateHalfRibs(panelId: string, side: "front" | "rear") {
    useStore.getState().mutate("alternate half ribs", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const sorted = [...p.ribs].sort((a, b) => a.positionMm - b.positionMm);
      sorted.forEach((r, i) => {
        const target = p.ribs.find((x) => x.id === r.id)!;
        target.half = i > 0 && i < sorted.length - 1 && i % 2 === 1 ? side : null;
      });
      p.ribsManuallyEdited = true;
    });
  },

  clearHalfRibs(panelId: string) {
    useStore.getState().mutate("make all ribs full", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      for (const r of p.ribs) r.half = null;
    });
  },

  addRib(panelId: string, afterRibId?: string) {
    const id = uid();
    useStore.getState().mutate("add rib", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const sorted = [...p.ribs].sort((a, b) => a.positionMm - b.positionMm);
      const i = afterRibId ? sorted.findIndex((r) => r.id === afterRibId) : sorted.length - 1;
      const here = sorted[i];
      const next = sorted[i + 1];
      // Halfway to the next station, or one pitch past the last one.
      const position =
        next !== undefined
          ? (here.positionMm + next.positionMm) / 2
          : Math.min(p.lengthMm, (here?.positionMm ?? 0) + (p.lengthMm / Math.max(p.ribs.length, 1)));
      p.ribs.push({
        id,
        positionMm: Number(position.toFixed(4)),
        thicknessMm: here?.thicknessMm ?? p.ribThicknessMm,
      });
      p.ribs.sort((a, b) => a.positionMm - b.positionMm);
      p.ribsManuallyEdited = true;
    });
    useStore.getState().select({ ribId: id });
  },

  removeRib(panelId: string, ribId: string) {
    useStore.getState().mutate("delete rib", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p || p.ribs.length <= 2) return;
      p.ribs = p.ribs.filter((r) => r.id !== ribId);
      p.ribsManuallyEdited = true;
    });
  },

  redistributeRibs(panelId: string, fromRibId: string, pitchMm: number, keepLength: boolean) {
    useStore.getState().mutate("redistribute ribs", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const i = p.ribs.findIndex((r) => r.id === fromRibId);
      if (i < 0) return;
      // Ribs are respaced in position order, whatever order the array holds them in.
      p.ribs.sort((a, b) => a.positionMm - b.positionMm);
      const anchor = p.ribs.findIndex((r) => r.id === fromRibId);
      const from = p.ribs[anchor].positionMm;
      for (let k = anchor + 1; k < p.ribs.length; k++) {
        p.ribs[k].positionMm = Number((from + pitchMm * (k - anchor)).toFixed(4));
      }
      const last = p.ribs[p.ribs.length - 1].positionMm;
      if (keepLength && last > from && p.lengthMm > from) {
        // Stretch only what follows the chosen rib, about that rib, so the gap
        // after it stays proportional to the others and the last rib lands on the end.
        const scale = (p.lengthMm - from) / (last - from);
        for (let k = anchor + 1; k < p.ribs.length; k++) {
          p.ribs[k].positionMm = Number((from + (p.ribs[k].positionMm - from) * scale).toFixed(4));
        }
      } else {
        p.lengthMm = Number(last.toFixed(4));
      }
      p.ribsManuallyEdited = true;
    });
  },

  setDisplayUnits(units: "mm" | "in") {
    useStore.getState().mutate("display units", (d) => {
      d.displayUnits = units;
    });
  },

  renameProject(name: string) {
    useStore.getState().mutate("rename project", (d) => {
      d.name = name;
    });
  },

  addSpar(panelId: string, spar: Spar, afterSparId?: string) {
    useStore.getState().mutate("add spar", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const i = afterSparId ? p.spars.findIndex((s) => s.id === afterSparId) : -1;
      if (i >= 0) p.spars.splice(i + 1, 0, spar);
      else p.spars.push(spar);
    });
    useStore.getState().select({ sparId: spar.id });
  },

  updateSpar(panelId: string, sparId: string, patch: Partial<Spar>, label = "edit spar") {
    useStore.getState().mutate(label, (d) => {
      const s = d.wing.panels.find((x) => x.id === panelId)?.spars.find((x) => x.id === sparId);
      if (s) Object.assign(s, patch);
    });
  },

  removeSpar(panelId: string, sparId: string) {
    useStore.getState().mutate("delete spar", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) p.spars = p.spars.filter((s) => s.id !== sparId);
    });
  },

  /** Sheeting: the type and the standard sheet's settings. */
  updateSheeting(panelId: string, patch: Partial<Panel["sheeting"]>, label = "sheeting") {
    useStore.getState().mutate(label, (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) Object.assign(p.sheeting, patch);
    });
  },

  addStrip(panelId: string, strip: SheetStrip, afterId?: string) {
    useStore.getState().mutate("add strip", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const i = afterId ? p.sheeting.strips.findIndex((s) => s.id === afterId) : -1;
      if (i >= 0) p.sheeting.strips.splice(i + 1, 0, strip);
      else p.sheeting.strips.push(strip);
    });
  },

  updateStrip(panelId: string, stripId: string, patch: Partial<SheetStrip>, label = "edit strip") {
    useStore.getState().mutate(label, (d) => {
      const s = d.wing.panels.find((x) => x.id === panelId)?.sheeting.strips.find((x) => x.id === stripId);
      if (s) Object.assign(s, patch);
    });
  },

  removeStrip(panelId: string, stripId: string) {
    useStore.getState().mutate("delete strip", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) p.sheeting.strips = p.sheeting.strips.filter((s) => s.id !== stripId);
    });
  },

  /** Lightening holes: the type and every setting. */
  updateHoles(panelId: string, patch: Partial<Panel["lighteningHoles"]>, label = "lightening holes") {
    useStore.getState().mutate(label, (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) Object.assign(p.lighteningHoles, patch);
    });
  },

  /** Try to put a check right. Returns what was done, or null when it could not be fixed; one undo step either way. */
  fixCheck(w: Warning): string | null {
    const fixed = fixWarning(useStore.getState().doc, w);
    if (!fixed) return null;
    useStore.getState().mutate("fix check", (d) => {
      // a copy: the repaired wing is frozen, and the rib layout step that follows every edit has to be able to move ribs
      d.wing = structuredClone(fixed.doc.wing) as typeof d.wing;
      d.airfoils = fixed.doc.airfoils as typeof d.airfoils;
    });
    return fixed.summary;
  },

  /** Remove an imported airfoil from the project. Built-in sections cannot be removed, and neither can one in use. */
  deleteAirfoil(id: string) {
    useStore.getState().mutate("delete airfoil", (d) => {
      const inUse = d.wing.panels.some((p) => p.rootAirfoilId === id || p.tipAirfoilId === id);
      if (inUse) return;
      d.airfoils = d.airfoils.filter((a) => a.id !== id);
    });
    invalidateFoil(id);
  },

  /** A new strip, switching the panel to strip sheeting if it is not already. */
  addSheetStrip(panelId: string, strip: SheetStrip) {
    useStore.getState().mutate("add strip", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      if (p.sheeting.type !== "advanced") p.sheeting.type = "advanced";
      p.sheeting.strips.push(strip);
    });
  },

  /** Remove a strip; with none left the panel has no sheeting. */
  removeSheetStrip(panelId: string, stripId: string) {
    useStore.getState().mutate("delete strip", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      p.sheeting.strips = p.sheeting.strips.filter((x) => x.id !== stripId);
      if (p.sheeting.strips.length === 0) p.sheeting.type = "none";
    });
  },

  /** The order the builder lists a panel's features in. Only the builder reads it. */
  setFeatureOrder(panelId: string, order: string[], label = "reorder features") {
    useStore.getState().mutate(label, (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) p.featureOrder = order;
    });
  },

  addComb(panelId: string, comb: RibComb, afterId?: string) {
    useStore.getState().mutate("add comb", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (!p) return;
      const i = afterId ? p.ribCombs.findIndex((c) => c.id === afterId) : -1;
      if (i >= 0) p.ribCombs.splice(i + 1, 0, comb);
      else p.ribCombs.push(comb);
    });
  },

  updateComb(panelId: string, combId: string, patch: Partial<RibComb>, label = "edit comb") {
    useStore.getState().mutate(label, (d) => {
      const c = d.wing.panels.find((x) => x.id === panelId)?.ribCombs.find((x) => x.id === combId);
      if (c) Object.assign(c, patch);
    });
  },

  removeComb(panelId: string, combId: string) {
    useStore.getState().mutate("delete comb", (d) => {
      const p = d.wing.panels.find((x) => x.id === panelId);
      if (p) p.ribCombs = p.ribCombs.filter((c) => c.id !== combId);
    });
  },

  stats() {
    const doc = useStore.getState().doc;
    return { ribs: totalRibs(doc), panels: doc.wing.panels.length };
  },
};
