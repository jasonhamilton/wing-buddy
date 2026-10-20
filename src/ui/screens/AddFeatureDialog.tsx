/**
 * Adding a feature, as a short guided dialog instead of a menu. Step one is a grid of large tiles, one per kind of
 * feature, each with an airfoil showing what that feature typically does to a rib. Step two repeats the choice
 * bigger, says what it does and what happens next, and adds it. Features that cannot be added again are shown, greyed,
 * with the reason.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { airfoilPath } from "./panelDrawings";
import { Button, Dialog, type MenuItem } from "../primitives";

type Option = {
  /** the label the panel's add list uses for it */
  label: string;
  title: string;
  /** one line, on the tile */
  summary: string;
  /** a sentence or two, on the second step */
  does: string;
  /** what the user will see once it is added */
  next: string;
  colour: string;
  /** adding it goes straight to editing it: there is nothing to check first */
  immediate?: boolean;
  /** adding it asks which variant, as a second screen of pictures: the name of the set in VARIANTS */
  variants?: "spar" | "notch" | "edge" | "joiner" | "sheeting";
  /** the typical modification, drawn on the airfoil in a 100-wide, chord-long box; `foil` is clipped to the airfoil */
  draw: (c: string, foil: string) => ReactNode;
};

/** Every cut is drawn in the one colour, the spar blue, so the pictures read as a set and only the shape tells them apart. */
const SPAR = "var(--wb-geo-spar)";

/** Solid in the colour, or (ghost) a faint tint with a thin dotted outline of the same shape. */
const paint = (c: string, ghost?: boolean) => (ghost ? { fill: c, fillOpacity: 0.16, stroke: c, strokeWidth: 0.3, strokeDasharray: "1.2 1" } : { fill: c });

/** Notches, bands and blocks are drawn clipped to the airfoil, so they sit inside it as the real cut does. */
const OPTIONS: Option[] = [
  {
    label: "Spar",
    title: "Spar",
    summary: "A core structural component.",
    does: "A core structural component. It cuts a slot in every rib so a spar can run through the panel and tie the ribs together.",
    next: "",
    colour: SPAR,
    variants: "spar",
    // a small square hole through the middle of the rib
    draw: (c) => <rect x="31" y="-2.6" width="5.2" height="5.2" fill={c} />,
  },
  {
    label: "Webbing",
    title: "Webbing",
    summary: "A thin sheet that stands between the spars.",
    does: "A thin sheet of balsa that stands between the spars and ties the top and bottom of the panel together. Each rib gets a slot right across it, and the web is cut as a separate part.",
    next: "A slot across every rib it passes through, and a web part for each gap between ribs.",
    colour: SPAR,
    immediate: true,
    // a slot right across the rib
    draw: (c) => <rect x="31" y="-13" width="3" height="26" fill={c} />,
  },
  {
    label: "Notch",
    title: "Notch",
    summary: "A spar let into the edge of the rib.",
    does: "",
    next: "",
    colour: SPAR,
    variants: "notch",
    // notches from the top and bottom surfaces
    draw: (c) => (
      <g fill={c}>
        <rect x="30" y="-12" width="7.2" height="7.2" />
        <rect x="30" y="1" width="7.2" height="11.6" />
      </g>
    ),
  },
  {
    label: "Aileron cutter",
    title: "Aileron cutter",
    summary: "A hinge cut that frees a control surface.",
    does: "",
    next: "",
    colour: SPAR,
    immediate: true,
    // a wedge cut at the hinge line: square on the front face, sloping back from the top surface to the bottom
    draw: (c) => <polygon points="72,-3.6 72,10 79.5,10" fill={c} />,
  },
  {
    label: "Joiner",
    title: "Joiner",
    summary: "A rod that joins two panels or the two wings.",
    does: "",
    next: "",
    colour: SPAR,
    variants: "joiner",
    draw: (c) => <circle cx="38" cy="-1.2" r="3.6" fill={c} />,
  },
  {
    label: "Edge stock",
    title: "Edge stock",
    summary: "A block for the nose or the tail.",
    does: "",
    next: "",
    colour: SPAR,
    variants: "edge",
    draw: (c) => (
      <g fill={c}>
        <rect x="-3" y="-12" width="12" height="24" />
        <rect x="90" y="-12" width="15" height="24" />
      </g>
    ),
  },
  {
    label: "Sheeting",
    title: "Sheeting",
    summary: "A skin of thin balsa over the ribs.",
    does: "",
    next: "",
    colour: SPAR,
    variants: "sheeting",
    draw: (c, foil) => <path d={foil} fill="none" stroke={c} strokeWidth="4.5" strokeLinejoin="round" />,
  },
  {
    label: "Rib comb",
    title: "Rib comb",
    summary: "Slots that a comb of teeth locks into.",
    does: "A wall running along the span that slots into the ribs and holds them upright and evenly spaced while the glue sets. Each rib gets matching slots.",
    next: "A row of notches is cut in every rib, and the comb appears in the list.",
    colour: SPAR,
    draw: (c) => (
      <g fill={c}>
        {[33, 50, 67].map((x) => (
          <rect key={x} x={x - 2} y="-12" width="4" height="6.6" />
        ))}
      </g>
    ),
  },
  {
    label: "Building tabs",
    title: "Building tabs",
    summary: "Stubs that pin the rib to the board.",
    does: "Extra material that hangs below (or above) each rib so it can be pinned to a flat building board while the wing is glued. Snap them off afterwards.",
    next: "Tabs are added to every rib, down to the finished rib after any sheeting and stock.",
    colour: SPAR,
    immediate: true,
    draw: (c, foil) => (
      <g>
        <path d={foil} fill="none" />
        <rect x="14" y="3" width="10" height="9" fill={c} />
        <rect x="68" y="1" width="10" height="11" fill={c} />
      </g>
    ),
  },
  {
    label: "Lightening holes",
    title: "Lightening holes",
    summary: "Holes that take weight out of each rib.",
    does: "Cuts a row of holes in every rib wherever there is room, leaving a margin around the spars and edges, to make the wing lighter without losing the shape.",
    next: "A row of holes appears in every rib, sized to the space between the spars.",
    colour: SPAR,
    immediate: true,
    draw: (c) => <LighteningHolesDrawing colour={c} />,
  },
];

/** The section's upper and lower edge at x (0 to 100 along the chord), in the drawing's units, for the NACA 2412 the pictures use. */
function foilEdges(x: number): { top: number; bottom: number } {
  const u = x / 100;
  const t = 0.12;
  const yt = 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  const m = 0.02;
  const p = 0.4;
  const yc = u < p ? (m / (p * p)) * (2 * p * u - u * u) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * u - u * u);
  return { top: -(yc + yt) * 100, bottom: -(yc - yt) * 100 };
}

/** The same close-up as the notch pictures, so the sheet is easy to see. */
const SHEET_VIEW = "14 -13 39 26";

/** The line of one surface of the section, for drawing a sheet along it. */
function sheetLine(side: "top" | "bottom"): string {
  return `M${Array.from({ length: 26 }, (_, i) => i * 4).map((x) => `${x} ${foilEdges(x)[side].toFixed(2)}`).join("L")}`;
}

/**
 * What the software's standard lightening holes look like: in the free run between the nose margin and the spar, and
 * between the spar and the tail margin, equal holes with rounded corners that follow the surfaces at a set distance,
 * a strip of material left beside the spar and between one hole and the next.
 */
function LighteningHolesDrawing({ colour }: { colour: string }) {
  const inset = 2.4;
  const holes: [number, number][] = [
    [13, 23], // the run from the nose margin to the spar
    [38, 48],
    [51.5, 61.5],
    [65, 75],
  ];
  const d = (x0: number, x1: number) => {
    const xs = Array.from({ length: 7 }, (_, i) => x0 + ((x1 - x0) * i) / 6);
    const top = xs.map((x) => `${x.toFixed(2)} ${(foilEdges(x).top + inset).toFixed(2)}`);
    const bottom = [...xs].reverse().map((x) => `${x.toFixed(2)} ${(foilEdges(x).bottom - inset).toFixed(2)}`);
    return `M${top.join("L")}L${bottom.join("L")}Z`;
  };
  return (
    <g>
      <rect x="26" y="-12" width="7" height="7.2" fill={colour} />
      <rect x="26" y="1" width="7" height="11.6" fill={colour} />
      {holes.map(([a, b]) => (
        <path key={a} d={d(a + 0.8, b - 0.8)} fill={colour} stroke={colour} strokeWidth="1.6" strokeLinejoin="round" />
      ))}
    </g>
  );
}

/** A rib section with what a feature typically does to it, in the feature's colour. */
function Illustration({ option, className = "", decorative = false, view = "-4 -13 108 26", ghost }: { option: Pick<Option, "label" | "title" | "summary" | "colour" | "draw">; className?: string; decorative?: boolean; /** the part of the drawing to show, as an svg viewBox: a close-up of the feature rather than the whole rib */ view?: string; /** the shape before the cut, drawn whole over the foil, e.g. as a dotted outline */ ghost?: (c: string) => ReactNode }) {
  const clip = useId();
  const foil = airfoilPath("naca-2412", []) ?? airfoilPath("naca-0012", []) ?? "";
  return (
    <svg
      viewBox={view}
      className={`block w-full ${className}`}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `A rib with ${option.title.toLowerCase()}: ${option.summary.toLowerCase()}` })}
    >
      <defs>
        <clipPath id={clip}>
          <path d={foil} />
        </clipPath>
      </defs>
      <path d={foil} className="fill-selected stroke-accent" strokeWidth="0.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {option.label === "Building tabs" ? (
        // tabs are extra material outside the section: not clipped to it
        option.draw(option.colour, foil)
      ) : (
        <g clipPath={`url(#${clip})`}>{option.draw(option.colour, foil)}</g>
      )}
      <path d={foil} fill="none" className="stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {ghost && ghost(option.colour)}
    </svg>
  );
}

export type EdgeShape = "rectangle" | "round" | "triangle";
export type SparVariant = "cuboid" | "round" | "roundJoiner" | "cuboidJoiner" | "sheetTop" | "sheetBottom" | "sheetBoth" | "top" | "bottom" | "both" | "leading" | "trailing";

/** The second screen of a feature that asks which kind: each choice drawn on the airfoil. `item` names the add-list entry that makes it. */
const VARIANTS: Record<NonNullable<Option["variants"]>, { label: string; kinds: string; items: { id: SparVariant; title: string; item?: string; /** the close-up shown on the tile: a 3:2 window on the drawing */ view: string; draw: (c: string) => ReactNode; /** a kind that is then asked which shape: each shape is drawn, and clicking one makes it */ shapes?: { id: EdgeShape; title: string; /** `ghost`: the same shape as a dotted outline, drawn whole and not clipped to the airfoil */ draw: (c: string, ghost?: boolean) => ReactNode }[] }[] }> = {
  spar: {
    label: "Spar",
    kinds: "Kinds of spar",
    items: [
      { id: "cuboid", title: "Cuboid", view: "18.6 -10 30 20", draw: (c) => <rect x="31" y="-2.6" width="5.2" height="5.2" fill={c} /> },
      { id: "round", title: "Round", view: "18.6 -10 30 20", draw: (c) => <circle cx="33.6" cy="0" r="3.6" fill={c} /> },
    ],
  },
  sheeting: {
    label: "Sheeting",
    kinds: "Where the sheeting goes",
    items: [
      { id: "sheetTop", title: "Top", view: SHEET_VIEW, draw: (c) => <path d={sheetLine("top")} fill="none" stroke={c} strokeWidth="5" strokeLinejoin="round" /> },
      { id: "sheetBottom", title: "Bottom", view: SHEET_VIEW, draw: (c) => <path d={sheetLine("bottom")} fill="none" stroke={c} strokeWidth="5" strokeLinejoin="round" /> },
      {
        id: "sheetBoth",
        title: "Both",
        view: SHEET_VIEW,
        draw: (c) => (
          <g fill="none" stroke={c} strokeWidth="5" strokeLinejoin="round">
            <path d={sheetLine("top")} />
            <path d={sheetLine("bottom")} />
          </g>
        ),
      },
    ],
  },
  joiner: {
    label: "Joiner",
    kinds: "Kinds of joiner",
    items: [
      { id: "roundJoiner", title: "Round", view: "23 -10 30 20", draw: (c) => <circle cx="38" cy="-1.2" r="3.6" fill={c} /> },
      { id: "cuboidJoiner", title: "Cuboid", view: "23 -10 30 20", draw: (c) => <rect x="35.4" y="-3.8" width="5.2" height="5.2" fill={c} /> },
    ],
  },
  notch: {
    label: "Notch",
    kinds: "Kinds of notch",
    items: [
      { id: "top", title: "Top", view: "14 -13 39 26", draw: (c) => <rect x="30" y="-12" width="7.2" height="7.2" fill={c} /> },
      { id: "bottom", title: "Bottom", view: "14 -13 39 26", draw: (c) => <rect x="30" y="1" width="7.2" height="11.6" fill={c} /> },
      {
        id: "both",
        title: "Top and bottom",
        view: "14 -13 39 26",
        draw: (c) => (
          <g fill={c}>
            <rect x="30" y="-12" width="7.2" height="7.2" />
            <rect x="30" y="1" width="7.2" height="11.6" />
          </g>
        ),
      },
    ],
  },
  edge: {
    label: "Edge stock",
    kinds: "Kinds of edge stock",
    items: [
      {
        id: "leading",
        title: "Leading edge",
        item: "Leading edge stock",
        view: "-4 -13 39 26",
        draw: (c) => <rect x="-3" y="-12" width="12" height="24" fill={c} />,
        shapes: [
          { id: "rectangle", title: "Rectangle", draw: (c, g) => <rect x="0" y="-6.5" width="6" height="11" {...paint(c, g)} /> },
          { id: "round", title: "Rounded", draw: (c, g) => <circle cx="3.6" cy="-0.6" r="3.6" {...paint(c, g)} /> },
        ],
      },
      {
        id: "trailing",
        title: "Trailing edge",
        item: "Trailing edge stock",
        view: "70 -13 39 26",
        draw: (c) => <rect x="90" y="-12" width="15" height="24" fill={c} />,
        shapes: [
          { id: "rectangle", title: "Rectangle", draw: (c, g) => <rect x="86" y="-3.4" width="14" height="5" {...paint(c, g)} /> },
          { id: "triangle", title: "Wedge", draw: (c, g) => <polygon points="86,-3.4 86,1.6 100,-0.4" {...paint(c, g)} /> },
        ],
      },
    ],
  },
};

/**
 * Adding a feature. A grid of large tiles, one per kind, each with an airfoil showing what it typically does to a rib.
 * Most go straight to editing the new feature when clicked. A spar, a notch and edge stock show their kinds on the tile itself
 * when the pointer is over it (or it has focus, or is tapped): click one, drawn with its name, and it is made at once. The kind is
 * fixed once made. A rib comb and a joiner show what they do and ask to be added.
 */
export function AddFeatureDialog({ items, onAddVariant, onClose }: { items: MenuItem[]; onAddVariant: (variant: SparVariant, shape?: EdgeShape) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  // the tile whose kinds are showing: the pointer is over it, it has focus, or it was tapped
  const [showing, setShowing] = useState<string | null>(null);
  // edge stock: the side that was clicked, whose shapes are then shown
  const [side, setSide] = useState<SparVariant | null>(null);
  useEffect(() => setSide(null), [showing]);
  const byLabel = new Map(items.map((i) => [i.label, i]));
  const option = OPTIONS.find((o) => o.label === chosen) ?? null;

  // a rib comb or a joiner: what it does, and add it
  if (option) {
    const item = byLabel.get(option.label);
    return (
      <Dialog
        title="Add a feature"
        large
        onClose={onClose}
        footer={
          <>
            <Button onClick={() => setChosen(null)}>Back</Button>
            <Button
              variant="primary"
              onClick={() => {
                item?.onSelect?.();
                onClose();
              }}
            >
              {`Add ${option.title.toLowerCase()}`}
            </Button>
          </>
        }
      >
        <div className="p-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-lg bg-surface px-4 py-4">
              <Illustration option={option} />
            </div>
            <div>
              <h3 className="mb-1 text-lg font-medium">{option.title}</h3>
              <p className="text-sm">{option.does}</p>
              {option.next && (
                <>
                  <h4 className="mb-1 mt-4 text-micro uppercase tracking-[.07em] text-muted">What happens next</h4>
                  <p className="text-sm">{option.next}</p>
                </>
              )}
            </div>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Add a feature" large onClose={onClose} footer={<Button onClick={onClose}>Cancel</Button>}>
      <div className="p-5">
        <ul aria-label="Features you can add" className="grid gap-4 sm:grid-cols-2">
          {OPTIONS.map((o) => {
            const item = byLabel.get(o.label);
            // the spar and the notch are always on offer, edge stock until both are in; the rest may be in use already
            // the kinds are always on offer, except sheeting while the old standard sheeting is in use
            const off = o.variants === "sheeting" ? !!item?.disabled : o.variants ? false : !item || item.disabled;
            const set = o.variants ? VARIANTS[o.variants] : null;
            const open = !!set && !off && showing === o.label;
            return (
              <li
                key={o.label}
                className="relative"
                onMouseEnter={() => set && setShowing(o.label)}
                onMouseLeave={() => setShowing(null)}
                onFocus={() => set && setShowing(o.label)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowing(null);
                }}
              >
                <button
                  type="button"
                  aria-disabled={off || undefined}
                  aria-expanded={set ? open : undefined}
                  onClick={() => {
                    if (off) return;
                    if (set) {
                      setShowing(open ? null : o.label); // a tap on a touch screen, or Enter: show the kinds
                      return;
                    }
                    if (o.immediate) {
                      // nothing to check: make it, and the details are open to edit
                      item?.onSelect?.();
                      onClose();
                    } else setChosen(o.label);
                  }}
                  className={`flex h-full w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                    off ? "cursor-not-allowed border-border bg-surface-sunken opacity-60" : "border-border-strong bg-surface-raised hover:border-accent hover:bg-selected"
                  }`}
                >
                  <div className="rounded-md bg-surface px-2 py-2">
                    <Illustration option={o} decorative />
                  </div>
                  <span className="text-base font-medium">{o.title}</span>
                  <span className="text-sm text-muted">{off && item?.reason ? `${item.reason[0].toUpperCase()}${item.reason.slice(1)}.` : o.summary}</span>
                </button>
                {open && set && (() => {
                  // edge stock asks twice: which edge, then which shape of that edge. Anything else is made on the first click.
                  const chosenKind = set.items.find((v) => v.id === side && v.shapes);
                  const list = chosenKind?.shapes
                    ? chosenKind.shapes.map((sh) => ({ key: sh.id, title: sh.title, view: chosenKind.view, draw: (c: string) => sh.draw(c), ghost: (c: string) => sh.draw(c, true), disabled: false, reason: undefined as string | undefined, pick: () => { onAddVariant(chosenKind.id, sh.id); onClose(); } }))
                    : set.items.map((v) => {
                        const entry = v.item ? byLabel.get(v.item) : undefined;
                        return { key: v.id, title: v.title, view: v.view, draw: v.draw, ghost: undefined as ((c: string) => ReactNode) | undefined, disabled: !!v.item && !entry, reason: entry?.reason, pick: () => { if (v.shapes) setSide(v.id); else { onAddVariant(v.id); onClose(); } } };
                      });
                  return (
                    // the kinds, right on the tile: click one and it is made
                    <ul aria-label={chosenKind ? `Shapes of ${chosenKind.title.toLowerCase()} stock` : set.kinds} className="absolute inset-0 grid gap-2 rounded-lg border border-accent bg-surface-raised p-2 shadow-card" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
                      {list.map((v) => (
                        <li key={v.key} className="min-w-0">
                          <button
                            type="button"
                            aria-disabled={v.disabled || undefined}
                            onClick={() => !v.disabled && v.pick()}
                            className={`flex h-full w-full flex-col justify-between gap-1 rounded-md border p-2 text-left transition-colors ${
                              v.disabled ? "cursor-not-allowed border-border bg-surface-sunken opacity-60" : "border-border-strong bg-surface-raised hover:border-accent hover:bg-selected"
                            }`}
                          >
                            <div className="rounded-sm bg-surface px-1 py-1">
                              <Illustration option={{ label: set.label, title: v.title, summary: "", colour: SPAR, draw: v.draw }} view={v.view} ghost={v.ghost} decorative />
                            </div>
                            <span className="text-sm font-medium">{v.title}</span>
                            {v.disabled && v.reason && <span className="text-micro text-muted">{`${v.reason[0].toUpperCase()}${v.reason.slice(1)}.`}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
