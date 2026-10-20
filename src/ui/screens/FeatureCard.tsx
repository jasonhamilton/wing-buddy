/**
 * One feature of a panel as a card like the ones in the wing panel list: a header band (handle, number, name,
 * kind, bin) over a drawing. The drawing is the panel's first and last rib. Each is the whole airfoil it was cut
 * from, with what this feature alone takes away shown in the feature's colour and the rib that is left on top.
 * "Alone" is the point: the feature is applied to the original rib, not to what the other features left behind,
 * so a spar's pocket, a comb's slots or a row of holes can each be read on their own.
 */
import { useDeferredValue, useMemo } from "react";
import type { Panel, ProjectDoc } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { rebuild } from "../../geometry";
import type { Path, RibGeometry } from "../../geometry/types";
import { useStore } from "../../state/store";
import { IconButton } from "../primitives";
import { difference, signedArea } from "../../geometry/clipper";
import { affectedRibs, type Feature, type Pick } from "./panelFeatures";

const GRIP = (
  <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="3" r="1.3" /><circle cx="8.5" cy="3" r="1.3" />
    <circle cx="3.5" cy="8" r="1.3" /><circle cx="8.5" cy="8" r="1.3" />
    <circle cx="3.5" cy="13" r="1.3" /><circle cx="8.5" cy="13" r="1.3" />
  </svg>
);
const BIN = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.7 7.2v3.6M9.3 7.2v3.6" />
  </svg>
);

const SHOWN = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2l5.5 3v6L8 14 2.5 11V5z" />
    <path d="M2.5 5L8 8l5.5-3M8 8v6" />
  </svg>
);
const HIDDEN = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" aria-hidden="true">
    <path d="M8 2l5.5 3v6L8 14 2.5 11V5z" />
    <path d="M2.5 5L8 8l5.5-3M8 8v6" />
  </svg>
);
const EYE = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);
const EYE_OFF = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <path d="M2.5 13.5l11-11" />
  </svg>
);

/** The panel with only the one feature on it: everything else switched off, so the rib shows that feature's work. */
export function isolate(panel: Panel, pick: Pick): Panel {
  // A suppressed feature is still drawn on its own card, so the flag is cleared on the one being shown.
  const on = <T extends { suppressed?: boolean }>(x: T): T => ({ ...x, suppressed: false });
  return {
    ...panel,
    spars: pick.k === "spar" ? panel.spars.filter((s) => s.id === pick.id).map(on) : [],
    leadingEdge: { ...on(panel.leadingEdge), enabled: pick.k === "le" },
    trailingEdge: { ...on(panel.trailingEdge), enabled: pick.k === "te" },
    extraEdges: pick.k === "edge" ? (panel.extraEdges ?? []).filter((x) => x.id === pick.id).map(on) : [],
    sheeting:
      pick.k === "sheet"
        ? { ...on(panel.sheeting), type: "standard" }
        : pick.k === "strip"
          ? { ...on(panel.sheeting), type: "advanced", strips: panel.sheeting.strips.filter((s) => s.id === pick.id).map(on) }
          : { ...panel.sheeting, type: "none" },
    buildingTabs: { ...on(panel.buildingTabs), enabled: pick.k === "tabs" },
    ribCombs: pick.k === "comb" ? panel.ribCombs.filter((c) => c.id === pick.id).map(on) : [],
    lighteningHoles: pick.k === "holes" ? on(panel.lighteningHoles) : { ...panel.lighteningHoles, type: "none" },
  };
}

/**
 * The ribs one feature leaves on its own, kept by what they depend on: the panel's own shape with only that feature on it, and the
 * panels before it. Another feature, or another panel after this one, changing is no reason to build them again, and the cards, the
 * previews on the panel list and the details of one feature all ask for the same thing.
 */
const featureRibCache = new Map<string, RibGeometry[]>();
const CACHE_LIMIT = 400;

function featureRibs(doc: ProjectDoc, panelId: string, pick: Pick): RibGeometry[] {
  const index = doc.wing.panels.findIndex((p) => p.id === panelId);
  if (index < 0) return [];
  // Panels after this one cannot change it; earlier ones matter only for linked airfoils.
  const panels = [...doc.wing.panels.slice(0, index), isolate(doc.wing.panels[index], pick)];
  const touched = affectedRibs(doc.wing.panels[index], pick);
  const key = JSON.stringify([panels, touched, doc.airfoils]);
  const hit = featureRibCache.get(key);
  if (hit) return hit;
  const result = rebuild({ ...doc, wing: { ...doc.wing, panels } } as ProjectDoc);
  const mine = result.ribs.filter((r) => r.panelId === panelId && touched.includes(r.index)).sort((a, b) => a.index - b.index);
  const ribs = mine.length <= 1 ? mine : [mine[0], mine[mine.length - 1]];
  featureRibCache.set(key, ribs);
  if (featureRibCache.size > CACHE_LIMIT) featureRibCache.delete(featureRibCache.keys().next().value as string);
  return ribs;
}

/** The first and last of the ribs this feature touches, as that one feature leaves them (the same rib twice is one). */
export function useFeatureRibs(panel: Panel, pick: Pick): RibGeometry[] {
  // Deferred: while a slider is being dragged the slider is drawn first, and the previews catch up when there is time.
  const doc = useDeferredValue(useStore((s) => s.doc));
  const pickKey = JSON.stringify(pick);
  return useMemo(() => featureRibs(doc, panel.id, JSON.parse(pickKey) as Pick), [doc, panel.id, pickKey]);
}

const ring = (r: Path) => r.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join("") + "Z";

/** One rib: the airfoil it came from tinted with the feature's colour (that tint is what was taken away), the rib over it. */
export function RibDrawing({ rib, colour, caption, units, adds, frame, tall }: { rib: RibGeometry; colour: string; caption: string; units: ProjectDoc["displayUnits"]; adds?: boolean; /** a shared frame (svg units) so ribs of different sizes draw to one scale */ frame?: { x0: number; y0: number; w: number; h: number }; /** drawn larger, as in the feature details: the frame is half as tall again */ tall?: boolean }) {
  // A feature that adds material (tabs) reaches past the section: the frame has to take in the rib as well.
  const extent = adds ? [...rib.silhouette, ...rib.outline.flat()] : rib.silhouette;
  const xs = extent.map((p) => p.x);
  const ys = extent.map((p) => -p.y);
  const pad = Math.max(...xs) * 0.03;
  const x0 = frame ? frame.x0 : Math.min(...xs) - pad;
  const y0 = frame ? frame.y0 : Math.min(...ys) - pad;
  const w = frame ? frame.w : Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h0 = frame ? frame.h : Math.max(...ys) - Math.min(...ys) + 2 * pad;
  // A tall frame is half as tall again, the extra shared between the top and the bottom: the airfoil sits in the middle of it.
  const extra = tall ? h0 * 0.5 : 0;
  const y1 = y0 - extra / 2;
  const h = h0 + extra;
  const left = [...rib.outline, ...rib.holes].map(ring).join("");
  return (
    <figure className="min-w-0 rounded-lg bg-surface px-3 py-2">
      <div className="relative">
      <svg viewBox={`${x0} ${y1} ${w} ${h}`} className={`block w-full ${tall ? "" : "max-h-24"}`} role="img" aria-label={`${caption}, ${adds ? "what this feature adds" : "the part this feature takes away"} is coloured`}>
        {adds ? (
          <>
            <path d={left} fillRule="evenodd" style={{ fill: colour, fillOpacity: 0.9, stroke: colour }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={ring(rib.silhouette)} className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <>
            <path d={ring(rib.silhouette)} style={{ fill: colour, fillOpacity: 0.9, stroke: colour }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={left} fillRule="evenodd" className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      </div>
      <figcaption className="mt-1 flex justify-between gap-2 text-micro text-muted">
        <span>{caption}</span>
        <span className="tabular-nums">chord {formatLength(rib.chordMm, units, 0)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * A small preview of one rib showing what this feature does to it, in a 3:2 frame: the airfoil it came from tinted with the
 * feature's colour (what was taken away, or added for tabs) and the rib over it. A feature that touches no rib shows an empty frame.
 */
export function RibThumb({ panel, feature }: { panel: Panel; feature: Feature }) {
  const ribs = useFeatureRibs(panel, feature.pick);
  const rib = ribs[0];
  const adds = feature.pick.k === "tabs";
  let box = { x0: 0, y0: 0, w: 3, h: 2 };
  if (rib) {
    const extent = adds ? [...rib.silhouette, ...rib.outline.flat()] : rib.silhouette;
    const xs = extent.map((p) => p.x);
    const ys = extent.map((p) => -p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const pad = (Math.max(...xs) - minX) * 0.06;
    const w0 = Math.max(...xs) - minX + 2 * pad;
    const h0 = Math.max(...ys) - minY + 2 * pad;
    // the whole rib, in a frame of exactly 3:2 with the section in the middle of it
    const fw = Math.max(w0, h0 * 1.5);
    const full = { x0: minX - pad - (fw - w0) / 2, y0: minY - pad - (fw / 1.5 - h0) / 2, w: fw, h: fw / 1.5 };
    // What the feature did: the material it took away (or added), and its holes. A close-up of that, not the whole rib; where it
    // is spread over the whole rib (sheeting, edge stock, a row of holes) the whole rib is the picture.
    const worked = (adds ? difference(rib.outline, [rib.silhouette]) : [...difference([rib.silhouette], rib.outline), ...rib.holes]).filter((r) => Math.abs(signedArea(r)) > 0.3);
    box = full;
    if (worked.length) {
      const wx = worked.flat().map((p) => p.x);
      const wy = worked.flat().map((p) => -p.y);
      const bw = Math.max(...wx) - Math.min(...wx);
      const bh = Math.max(...wy) - Math.min(...wy);
      const chord = Math.max(...xs) - minX;
      if (bw < chord * 0.45) {
        // room around the feature: twice its width, enough for its height, and never less than a quarter of the chord
        const w = Math.min(full.w, Math.max(bw * 2.2, bh * 1.5 * 1.5, chord * 0.25));
        const h = w / 1.5;
        const cx = (Math.max(...wx) + Math.min(...wx)) / 2;
        const cy = (Math.max(...wy) + Math.min(...wy)) / 2;
        box = { x0: cx - w / 2, y0: cy - h / 2, w, h };
      }
    }
  }
  const left = rib ? [...rib.outline, ...rib.holes].map(ring).join("") : "";
  return (
    <svg viewBox={`${box.x0} ${box.y0} ${box.w} ${box.h}`} className="block aspect-[3/2] w-full" role="img" aria-label={`${feature.name}: ${rib ? `rib ${rib.index + 1}` : "no rib touched"}`}>
      {rib &&
        (adds ? (
          <>
            <path d={left} fillRule="evenodd" style={{ fill: feature.colour, fillOpacity: 0.9, stroke: feature.colour }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={ring(rib.silhouette)} className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <>
            <path d={ring(rib.silhouette)} style={{ fill: feature.colour, fillOpacity: 0.9, stroke: feature.colour }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={left} fillRule="evenodd" className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        ))}
    </svg>
  );
}

/**
 * A row of ticks, one per rib in the panel, root to tip: the ribs this feature touches are filled in its colour and the rest
 * left pale. A quiet picture of how far along the panel the feature goes.
 */
export function RibsAffected({ panel, pick, colour }: { panel: Panel; pick: Pick; colour: string }) {
  const touched = affectedRibs(panel, pick);
  const n = panel.ribs.length;
  const set = new Set(touched);
  const text = touched.length === 0 ? "no ribs" : touched.length === 1 ? `rib ${touched[0] + 1}` : touched.length === n ? "every rib" : `ribs ${touched[0] + 1} to ${touched[touched.length - 1] + 1}`;
  return (
    <div data-ribs-affected={touched.map((i) => i + 1).join(",")} className="flex items-center gap-2" role="img" aria-label={`Affects ${text} of ${n}`}>
      <div aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-0.5">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} data-rib-tick={set.has(i) ? "on" : "off"} className={`min-w-px flex-1 rounded-[1px] ${set.has(i) ? "h-4" : "h-1.5 bg-border"}`} style={set.has(i) ? { backgroundColor: colour } : undefined} />
        ))}
      </div>
      <span className="shrink-0 text-micro text-muted">{text}</span>
    </div>
  );
}

export function FeatureCard({
  panel,
  feature,
  number,
  selected,
  onSelect,
  onRemove,
  onSuppress,
  onHide,
  grip,
  dragging,
  cardRef,
  actualSize = false,
  dimmed = false,
}: {
  panel: Panel;
  feature: Feature;
  number: number;
  selected: boolean;
  onSelect: () => void;
  /** absent for the ribs, which every panel has */
  onRemove?: () => void;
  /** switch the feature off (or back on) without deleting it */
  onSuppress?: () => void;
  /** hide the feature in the 3D view (95 % transparent) or show it again; absent where there is nothing to hide */
  onHide?: () => void;
  grip?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  dragging?: boolean;
  cardRef?: (el: HTMLLIElement | null) => void;
  /** draw the first and last rib to one scale, so the smaller one looks smaller; otherwise each fills its frame */
  actualSize?: boolean;
  /** another feature is the one being edited: this one is greyed out, as the other panels are when one is open */
  dimmed?: boolean;
}) {
  const units = useStore((s) => s.doc.displayUnits);
  const ribs = useFeatureRibs(panel, feature.pick);
  const name = feature.name;
  // One frame for both ribs when they are drawn to scale: wide and tall enough for the larger of them, from the nose.
  const frame = (() => {
    if (!actualSize || ribs.length < 2) return undefined;
    const xs = ribs.flatMap((r) => [...r.silhouette, ...(feature.pick.k === "tabs" ? r.outline.flat() : [])].map((p) => p.x));
    const ys = ribs.flatMap((r) => [...r.silhouette, ...(feature.pick.k === "tabs" ? r.outline.flat() : [])].map((p) => -p.y));
    const pad = Math.max(...xs) * 0.03;
    return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
  })();
  return (
    <li
      ref={cardRef}
      data-feature-card={name}
      aria-current={selected || undefined}
      data-dimmed={dimmed || undefined}
      onClick={onSelect}
      className={`overflow-hidden rounded-lg border bg-surface-raised shadow-card ${selected ? "border-accent ring-1 ring-accent" : "border-border-strong"} ${dragging ? "opacity-60" : ""} ${dimmed ? "grayscale bg-surface-sunken" : ""} ${feature.suppressed ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2 border-b border-border-strong bg-selected px-3 py-2 text-on-selected">
        {grip ? (
          <button
            type="button"
            aria-label={`Reorder ${name}`}
            title="Drag to reorder, or use the up and down arrow keys"
            onClick={(e) => e.stopPropagation()}
            className={`-ml-1 flex h-ctl w-5 shrink-0 touch-none items-center justify-center opacity-70 hover:opacity-100 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            {...grip}
          >
            {GRIP}
          </button>
        ) : (
          <span aria-hidden="true" className="-ml-1 w-5 shrink-0" />
        )}
        <span aria-hidden="true" data-feature-colour className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-fg" style={{ backgroundColor: feature.colour }}>
          {number}
        </span>
        <button
          type="button"
          title={name}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="min-w-0 flex-1 truncate text-left text-base font-medium hover:underline"
        >
          {name}
        </button>
        <span className="shrink-0 rounded-md border border-accent bg-surface-raised px-2 py-px text-xs text-fg">{feature.suppressed ? `${feature.type} (suppressed)` : feature.type}</span>
        {onHide && (
          <IconButton
            label={feature.hidden ? `Show ${name}` : `Hide ${name}`}
            title={feature.hidden ? "Hidden in the 3D view (95 % transparent). Click to show it." : "Hide in the 3D view: 95 % transparent. The ribs and exports are not changed."}
            aria-pressed={!!feature.hidden}
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
            className="text-muted hover:text-fg"
          >
            {feature.hidden ? HIDDEN : SHOWN}
          </IconButton>
        )}
        {onSuppress && (
          <IconButton
            label={feature.suppressed ? `Unsuppress ${name}` : `Suppress ${name}`}
            title={feature.suppressed ? "Suppressed: left out of the ribs, the 3D view and the exports. Click to bring it back." : "Suppress: leave it out without deleting it"}
            aria-pressed={!!feature.suppressed}
            onClick={(e) => {
              e.stopPropagation();
              onSuppress();
            }}
            className="text-muted hover:text-fg"
          >
            {feature.suppressed ? EYE_OFF : EYE}
          </IconButton>
        )}
        {onRemove && (
        <IconButton
          label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-2 text-muted hover:text-danger"
        >
          {BIN}
        </IconButton>
        )}
      </div>

      <section aria-label={`${name} on the ribs`} className="px-3 py-3">
        <div className="mb-3">
          <RibsAffected panel={panel} pick={feature.pick} colour={feature.colour} />
        </div>
        {ribs.length === 0 ? (
          <p className="text-xs text-muted">No rib is touched by this yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {ribs.map((r, i) => (
              <RibDrawing key={r.ribId} frame={frame} rib={r} colour={feature.colour} units={units} adds={feature.pick.k === "tabs"} caption={`Rib ${r.index + 1}${ribs.length > 1 ? (i === 0 ? " (first)" : " (last)") : ""}`} />
            ))}
          </div>
        )}
      </section>
    </li>
  );
}
