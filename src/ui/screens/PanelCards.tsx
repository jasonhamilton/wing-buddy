/**
 * The wing's panels, root first, as one numbered card each, split into labelled sections
 * (airfoil, planform, dihedral). Add with the small +, reorder by dragging a card's handle (or with the arrow keys while
 * the handle has focus), open one by its name, delete with the trash button after confirming.
 * Root is on the left and tip on the right in every drawing, so the cards never say "root" or
 * "tip", and anything identical at both ends is drawn once.
 */
import { useEffect, useRef, useState } from "react";
import { foilName } from "../../domain/airfoils";
import type { Airfoil, Panel } from "../../domain/schema";
import type { DisplayUnits } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { CopyMethodDialog } from "../CopyMethodDialog";
import { Empty, IconButton } from "../primitives";
import { featuresOf, type Pick } from "./panelFeatures";
import { RibThumb } from "./FeatureCard";
import { airfoilPath, foilEnds, PLANFORM_H, planform, sideView, tipValueMarginPct } from "./panelDrawings";

const GRIP = (
  <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="3" r="1.3" /><circle cx="8.5" cy="3" r="1.3" />
    <circle cx="3.5" cy="8" r="1.3" /><circle cx="8.5" cy="8" r="1.3" />
    <circle cx="3.5" cy="13" r="1.3" /><circle cx="8.5" cy="13" r="1.3" />
  </svg>
);

const TRASH = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.7 7.2v3.6M9.3 7.2v3.6" />
  </svg>
);


const MM_PER_IN = 25.4;
/** Lengths on the cards: inches to thousandths, millimetres to tenths. */
const lenText = (mm: number, units: DisplayUnits) =>
  units === "in" ? `${(mm / MM_PER_IN).toFixed(3)} in` : `${mm.toFixed(1)} mm`;
const deg = (d: number) => `${d.toFixed(1)}°`;

const dims = (p: Panel) => ({
  lengthMm: p.lengthMm,
  rootChordMm: p.rootChordMm,
  tipChordMm: p.tipChordMm,
  dihedralDeg: p.dihedralDeg,
});

/* ------------------------------------------------------------ airfoil boxes */

/** A twist of zero is not worth saying; anything else is shown in degrees, to at most two decimals. */
const twistText = (d: number) => `${Number(d.toFixed(2))}°`;

function FoilBox({
  id,
  scale,
  embedded,
  right,
  twist,
  twistDeg = 0,
  otherTwistDeg,
  pad = 0,
}: {
  id: string;
  scale: number;
  embedded: Airfoil[];
  right?: boolean;
  /** shown opposite the name; omitted when there is nothing to say */
  twist?: string;
  /** the section is drawn turned about its nose by this much, as it is built; positive lifts the nose */
  twistDeg?: number;
  /** a second twist for a box that stands for both ends: drawn as a dashed outline of the same section */
  otherTwistDeg?: number;
  /** extra room above and below, so a turned section is not clipped; the same for every box on a card */
  pad?: number;
}) {
  const path = airfoilPath(id, embedded);
  const factor = scale !== 1 ? ` ×${Number(scale.toFixed(2))}` : "";
  const name = `${foilName(id, embedded)}${factor}`;
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-2">
      {path && (
        <svg viewBox={`-2 ${-10 - pad} 104 ${20 + 2 * pad}`} className="block w-full" aria-hidden="true">
          {otherTwistDeg !== undefined && (
            <path
              d={path}
              transform={`rotate(${otherTwistDeg}) scale(1 ${scale})`}
              className="fill-none stroke-muted"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={path}
            transform={`rotate(${twistDeg}) scale(1 ${scale})`}
            className="fill-selected stroke-accent"
            strokeWidth="1"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <div className={`mt-1 flex items-baseline justify-between gap-2 ${right ? "flex-row-reverse" : ""}`}>
        <div className={`min-w-0 truncate font-mono text-xs font-medium ${right ? "text-right" : ""}`} title={name}>
          {name}
        </div>
        {twist && (
          <span aria-label={`Twist ${twist}`} title="Twist" className="shrink-0 text-xs tabular-nums text-muted">
            {twist}
          </span>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- panel card */

type CardProps = {
  panel: Panel;
  index: number;
  count: number;
  selected: boolean;
  /** another panel is open in the builder: this one is greyed out */
  dimmed: boolean;
  dragging: boolean;
  target: boolean;
  maxLengthMm: number;
  maxChordMm: number;
  units: DisplayUnits;
  embedded: Airfoil[];
  cardRef: (el: HTMLLIElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
  /** open the builder on the panel's geometry, or on its additional features */
  onBuild: (section: "geometry" | "features", pick?: Pick) => void;
  onDelete: () => void;
  grip: React.ButtonHTMLAttributes<HTMLButtonElement>;
};

function PanelCard(c: CardProps) {
  const { panel: p, units } = c;
  const foils = foilEnds(p);
  // The section is 100 wide, so a turn of t degrees moves the tail by about 100 sin t: make room for it.
  const pad = Math.min(40, Math.round(100 * Math.sin((Math.min(45, Math.max(Math.abs(p.rootTwistDeg), Math.abs(p.tipTwistDeg))) * Math.PI) / 180)));
  // One box for both ends: one twist when the ends agree, "root → tip" when they do not.
  const sharedTwist =
    p.rootTwistDeg === 0 && p.tipTwistDeg === 0
      ? undefined
      : p.rootTwistDeg === p.tipTwistDeg
        ? twistText(p.rootTwistDeg)
        : `${twistText(p.rootTwistDeg)} → ${twistText(p.tipTwistDeg)}`;
  const plan = planform(dims(p), c.maxLengthMm, c.maxChordMm);
  const side = sideView(dims(p), c.maxLengthMm);
  const sameChord = Math.abs(p.rootChordMm - p.tipChordMm) < 1e-6;
  const rootTop = plan.polygon[0][1];
  const features = featuresOf(p);

  return (
    <li
      ref={c.cardRef}
      data-panel-card={p.name}
      aria-current={c.selected ? "true" : undefined}
      data-dimmed={c.dimmed || undefined}
      onClick={() => {
        c.onSelect();
        c.onBuild("features");
      }}
      className={`overflow-hidden rounded-lg border bg-surface-raised shadow-card ${
        c.selected ? "border-accent ring-1 ring-accent" : "border-border-strong"
      } ${c.dragging ? "opacity-60" : ""} ${c.dimmed ? "grayscale bg-surface-sunken" : ""} ${c.target ? "outline outline-2 outline-offset-2 outline-accent" : ""}`}
    >
      {/* 1. header band: number, name, rib count */}
      <div className="flex items-center gap-2 border-b border-border-strong bg-selected px-3 py-2 text-on-selected">
        <button
          type="button"
          aria-label={`Reorder ${p.name}`}
          title="Drag to reorder, or use the up and down arrow keys"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`-ml-1 flex h-ctl w-5 shrink-0 touch-none items-center justify-center opacity-70 hover:opacity-100 ${
            c.dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          {...c.grip}
        >
          {GRIP}
        </button>
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-on-accent">
          {c.index + 1}
        </span>
        {/* A real button, not a tabindex on the card: the name is the thing you activate,
            and screen readers announce it as such. */}
        <button
          type="button"
          aria-label={`Edit ${p.name}`}
          title={p.name}
          data-panel-edit
          onClick={(e) => {
            e.stopPropagation();
            c.onSelect();
            c.onOpen();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate text-left text-base font-medium hover:underline"
        >
          {p.name}
        </button>
        <span className="shrink-0 rounded-md border border-accent bg-surface-raised px-2 py-px text-xs text-fg">
          {p.ribs.length} {p.ribs.length === 1 ? "rib" : "ribs"}
        </span>
        <IconButton
          label={`Delete ${p.name}`}
          title={c.count <= 1 ? "A wing needs at least one panel" : `Delete ${p.name}`}
          disabled={c.count <= 1}
          onClick={(e) => {
            e.stopPropagation();
            c.onDelete();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="-mr-2 text-muted hover:text-danger"
        >
          {TRASH}
        </IconButton>
      </div>

      {/* 2. airfoils: one box when both ends match, two otherwise (root left, tip right) */}
      <section aria-label={`${p.name} airfoil`} className="border-b border-border px-3 py-3">
        <h4 className="mb-2 text-micro text-muted">Airfoil</h4>
        {foils.same ? (
          <FoilBox id={foils.rootId} scale={foils.rootScale} embedded={c.embedded} twist={sharedTwist} twistDeg={p.rootTwistDeg} otherTwistDeg={p.rootTwistDeg !== p.tipTwistDeg ? p.tipTwistDeg : undefined} pad={pad} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <FoilBox id={foils.rootId} scale={foils.rootScale} embedded={c.embedded} twist={p.rootTwistDeg !== 0 ? twistText(p.rootTwistDeg) : undefined} twistDeg={p.rootTwistDeg} pad={pad} />
            <FoilBox id={foils.tipId} scale={foils.tipScale} embedded={c.embedded} right twist={p.tipTwistDeg !== 0 ? twistText(p.tipTwistDeg) : undefined} twistDeg={p.tipTwistDeg} pad={pad} />
          </div>
        )}
      </section>

      {/* 3. planform with its length, chords underneath */}
      <section aria-label={`${p.name} planform`} className="border-b border-border px-3 py-3">
        <h4 className="mb-2 text-micro text-muted">Planform</h4>
        <svg
          viewBox={`0 0 270 ${PLANFORM_H}`}
          className="block w-full"
          role="img"
          aria-label={`${p.name} planform, ${lenText(p.lengthMm, units)} long, chord ${lenText(p.rootChordMm, units)} at the root to ${lenText(p.tipChordMm, units)} at the tip`}
        >
          <line x1="1" x2={plan.dimMid - plan.dimGap} y1="9" y2="9" className="stroke-border-strong" strokeWidth="1" />
          <line x1={plan.dimMid + plan.dimGap} x2={plan.tipX} y1="9" y2="9" className="stroke-border-strong" strokeWidth="1" />
          <line x1="1" x2="1" y1="4" y2="14" className="stroke-border-strong" strokeWidth="1" />
          <line x1={plan.tipX} x2={plan.tipX} y1="4" y2="14" className="stroke-border-strong" strokeWidth="1" />
          <text x={plan.dimMid} y="9" textAnchor="middle" dominantBaseline="central" className="fill-fg" fontSize="12" fontWeight="500">
            {lenText(p.lengthMm, units)}
          </text>
          <polygon
            points={plan.polygon.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}
            className="fill-selected stroke-accent/60"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <line x1="1" x2="1" y1={rootTop} y2={plan.polygon[3][1]} className="stroke-accent" strokeWidth="2" />
        </svg>
        {sameChord ? (
          <p className="mt-1 text-center text-sm font-medium">
            {lenText(p.rootChordMm, units)} <span className="text-xs font-normal text-muted">chord</span>
          </p>
        ) : (
          <div className="mt-1 flex justify-between text-sm font-medium">
            <span>{lenText(p.rootChordMm, units)}</span>
            <span style={{ marginRight: `${tipValueMarginPct(plan.w)}%` }}>{lenText(p.tipChordMm, units)}</span>
          </div>
        )}
      </section>

      {/* 4. dihedral, drawn to scale */}
      <section aria-label={`${p.name} dihedral`} className="border-b border-border px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-micro text-muted">Dihedral</h4>
          <span className="text-xs font-medium">{deg(p.dihedralDeg)}</span>
        </div>
        <svg
          viewBox={`0 0 270 ${side.height}`}
          className="block w-full"
          role="img"
          aria-label={`${p.name} side view, dihedral ${deg(p.dihedralDeg)}`}
        >
          <line x1="1" x2={side.x2} y1={side.baseline} y2={side.baseline} className="stroke-border-strong" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="1" x2={side.x2} y1={side.baseline} y2={side.y2} className="stroke-accent" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </section>

      {/* 5. the additional features, as colour-coded blocks; the panel's own geometry is the three sections above */}
      <section
        aria-label={`${p.name} features`}
        data-panel-features
        className="px-3 py-3"
        onClick={(e) => {
          e.stopPropagation();
          c.onSelect();
          c.onBuild("features");
        }}
      >
        <h4 className="mb-2 text-micro text-muted">Features</h4>
        {features.length === 0 ? (
          <p className="text-xs text-muted">None added</p>
        ) : (
          <ul aria-label={`${p.name} feature list`} className="grid grid-cols-3 gap-2">
            {features.map((f) => (
              <li key={f.key} data-feature-chip={f.name}>
                <button
                  type="button"
                  title={`${f.name} (${f.type}): open it in the features panel`}
                  aria-label={`${f.name}, ${f.type}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    c.onSelect();
                    c.onBuild("features", f.pick);
                  }}
                  className={`block w-full overflow-hidden rounded-md border bg-surface text-left hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent ${f.suppressed ? "opacity-50" : ""}`}
                  style={{ borderColor: f.colour }}
                >
                  <RibThumb panel={p} feature={f} />
                  <span className="block truncate px-1 py-0.5 text-micro text-muted">{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </li>
  );
}

/* -------------------------------------------------------------------- list */

export function PanelList() {
  const { doc, selection, select, openPanelDialog, openBuilder, builderPanelId } = useStore();
  const units = doc.displayUnits;
  const panels = doc.wing.panels;
  const selected = selection.panelId ?? panels[0]?.id ?? null;
  const maxLengthMm = Math.max(0, ...panels.map((p) => p.lengthMm));
  const maxChordMm = Math.max(0, ...panels.flatMap((p) => [p.rootChordMm, p.tipChordMm]));

  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<null | { id: string; from: number; over: number }>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  // Escape abandons a drag in progress.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  /** Which card is under the pointer; above the first or below the last means those. */
  const cardAt = (y: number): number => {
    let best = 0;
    for (let i = 0; i < panels.length; i++) {
      const r = cardRefs.current.get(panels[i].id)?.getBoundingClientRect();
      if (!r) continue;
      if (y >= r.top) best = i;
    }
    return best;
  };

  const place = (id: string, to: number) => {
    const from = panels.findIndex((p) => p.id === id);
    const target = Math.max(0, Math.min(panels.length - 1, to));
    if (from < 0 || target === from) return;
    ops.movePanelTo(id, target);
    const name = panels[from].name;
    setAnnounce(`${name} moved to position ${target + 1} of ${panels.length}`);
  };

  const gripFor = (p: Panel, i: number): React.ButtonHTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id: p.id, from: i, over: i });
    },
    onPointerMove: (e) => {
      const d = dragRef.current;
      if (!d || d.id !== p.id) return;
      const over = cardAt(e.clientY);
      if (over !== d.over) setDrag({ ...d, over });
    },
    onPointerUp: (e) => {
      const d = dragRef.current;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDrag(null);
      if (d && d.id === p.id && d.over !== d.from) place(p.id, d.over);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? panels.length - 1 : null;
      if (to === null) return;
      e.preventDefault();
      place(p.id, to);
    },
  });

  // A new panel lands at the bottom of a list that may be longer than the column; bring it into view.
  const count = useRef(panels.length);
  useEffect(() => {
    if (panels.length > count.current) {
      cardRefs.current.get(panels[panels.length - 1].id)?.scrollIntoView({ block: "nearest" });
    }
    count.current = panels.length;
  }, [panels]);

  // Opening a panel in the builder brings its card into view. If any of it is cut off, the card is brought up as far as the list allows,
  // which puts its name at the top: it never goes past that, so the name is never hidden. A card that is all in view stays where it is.
  useEffect(() => {
    if (!builderPanelId) return;
    const el = cardRefs.current.get(builderPanelId);
    const box = el?.closest<HTMLElement>('[aria-label="Panel list"]');
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top < 0 || top + el.offsetHeight > box.clientHeight) box.scrollTo({ top: box.scrollTop + top, behavior: "smooth" });
  }, [builderPanelId]);

  const confirming = panels.find((p) => p.id === confirmId) ?? null;
  const [choosing, setChoosing] = useState(false);
  // A new panel is selected and opened on its wing geometry, ready to be designed.
  const createPanel = (method?: Parameters<typeof ops.addPanel>[0]) => {
    const id = ops.addPanel(method);
    if (typeof id === "string") {
      select({ panelId: id, sparId: null, ribId: null });
      openBuilder(id, "geometry");
    }
  };
  const startAdding = () => (panels.length > 0 ? setChoosing(true) : createPanel());

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-micro font-medium uppercase tracking-[.07em] text-muted">Wing panels</h2>
        <IconButton label="Add panel" className="border-border-input bg-input-bg" onClick={startAdding}>
          <span className="text-base font-medium leading-none">+</span>
        </IconButton>
      </div>

      {panels.length === 0 ? (
        <Empty title="No panels yet">Press + to add the first one.</Empty>
      ) : (
        <div tabIndex={0} aria-label="Panel list" className="wb-scroll -mx-1 min-h-48 flex-1 overflow-y-auto px-1 pb-1">
          <ul aria-label="Wing panels" className="flex flex-col gap-5">
            {panels.map((p, i) => (
              <PanelCard
                key={p.id}
                panel={p}
                index={i}
                count={panels.length}
                selected={p.id === selected}
                dragging={drag?.id === p.id}
                target={drag !== null && drag.over === i && drag.from !== i}
                maxLengthMm={maxLengthMm}
                maxChordMm={maxChordMm}
                units={units}
                embedded={doc.airfoils}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(p.id, el);
                  else cardRefs.current.delete(p.id);
                }}
                onSelect={() => select({ panelId: p.id, sparId: null, ribId: null })}
                onOpen={() => openPanelDialog(p.id)}
                onBuild={(section, pick) => openBuilder(p.id, section, pick)}
                dimmed={builderPanelId !== null && builderPanelId !== p.id}
                onDelete={() => setConfirmId(p.id)}
                grip={gripFor(p, i)}
              />
            ))}
          </ul>
          <button
            type="button"
            aria-haspopup="dialog"
            data-add-panel
            onClick={startAdding}
            className="group mt-5 flex h-36 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-surface-raised text-sm font-medium text-muted transition-colors hover:border-border-strong hover:bg-surface-sunken hover:text-fg"
          >
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-lg leading-none text-muted transition-colors group-hover:border-border-strong group-hover:text-fg">
              +
            </span>
            Add panel
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{announce}</p>

      {choosing && (
        <CopyMethodDialog
          previousName={panels[panels.length - 1]?.name ?? ""}
          onCancel={() => setChoosing(false)}
          onChoose={(method) => {
            setChoosing(false);
            createPanel(method);
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete ${confirming.name}?`}
          confirmLabel="Delete panel"
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            const id = confirming.id;
            setConfirmId(null);
            ops.removePanel(id);
            // Focus would otherwise fall to the page; put it on the first panel's name.
            requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-panel-edit]")?.focus());
          }}
        >
          <p>
            <strong>{confirming.name}</strong> and its {confirming.ribs.length} ribs and {confirming.spars.length}{" "}
            {confirming.spars.length === 1 ? "spar" : "spars"} will be removed from the wing.
          </p>
          <p className="mt-3 text-muted">You can bring it back with Edit ▸ Undo.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
