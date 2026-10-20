/**
 * Wing Buddy — project document schema.
 *
 * This is the app's equivalent of a database schema. There is no database and
 * no server: a project is one document that lives on the user's machine.
 *
 * Conventions, enforced everywhere:
 *   - lengths are millimetres, float64, canonical. Inches are a display unit only.
 *   - angles are degrees in the document (matching the UI), radians internally.
 *   - rib-local 2D coords: x = 0 at the leading edge, +x toward the trailing edge,
 *     +y up. Airfoil coordinates are normalised to chord 1.0 before storage.
 *   - spanwise positions are millimetres from the panel root.
 *   - every entity that a user can reorder or reference carries a uuid `id`.
 *
 */

import { z } from "zod";

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ scalars */

export const Mm = z.number().finite();
export const Deg = z.number().finite();
export const Pct = z.number().finite();
/**
 * Identifiers are opaque. Most are uuids from `crypto.randomUUID`, but built-in
 * airfoils are stable slugs like `naca-2412`, and the uuid fallback for browsers
 * without `randomUUID` is not a real uuid either.
 *
 * This was `z.string().uuid()`, which made every saved project unloadable: the
 * file wrote `naca-2412` and the loader refused it. Validating the *shape* of an
 * id buys nothing — what matters is that references resolve, which INVARIANTS
 * below cover.
 */
export const Id = z.string().min(1).max(128);

/** @deprecated kept so existing references compile; prefer `Id`. */
export const Uuid = Id;

/** A distance the UI lets you give as either a percentage or an absolute mm. */
export const Measure = z.object({
  value: z.number().finite(),
  unit: z.enum(["pct", "mm"]),
});
export type Measure = z.infer<typeof Measure>;

/** Start/end pair where the end is optional — the UI's "Separate end" checkbox. */
export const Span = z.object({
  start: Measure,
  end: Measure.nullable(), // null == "follow start", the unchecked state
});
export type Span = z.infer<typeof Span>;

export const Color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .or(z.literal("standard"));
export type Color = z.infer<typeof Color>;

/* ------------------------------------------------------------------ airfoil */

/**
 * [must] Airfoils are referenced by id, never embedded by value, so two panels
 * sharing a foil stay in sync and the file stays small. Built-in foils resolve
 * against the bundled library; user foils are stored in the document so a shared
 * project opens correctly on someone else's machine.
 */
export const AirfoilPoint = z.tuple([z.number(), z.number()]); // x 0..1, y/chord

export const Airfoil = z.object({
  id: Uuid,
  name: z.string().min(1),
  /** "builtin" resolves from the bundled library; "embedded" carries its points. */
  origin: z.enum(["builtin", "embedded"]),
  source: z.enum(["dat", "cor", "designed"]).nullable(),
  /** Selig order: TE -> upper -> LE -> lower -> TE. Normalised, nose-smoothed. */
  points: z.array(AirfoilPoint).min(20).nullable(),
  /** [could] control points for a foil drawn in the airfoil designer. */
  controlPoints: z.array(AirfoilPoint).nullable(),
  createdAt: z.string().datetime(),
});
export type Airfoil = z.infer<typeof Airfoil>;

/** Derived, never stored — recomputed from points. Shown read-only on S05. */
export type AirfoilMetrics = {
  thicknessPct: number;
  maxThicknessAtPct: number;
  camberPct: number;
  maxCamberAtPct: number;
};

/* --------------------------------------------------------------------- ribs */

/**
 * [must] A rib is a station along the panel. `id` is stable across regeneration
 * so the 2D view, selection and measurements survive a "Generate ribs".
 * Rib *indices* are derived from sort order and are never persisted.
 */
export const Rib = z.object({
  id: Uuid,
  positionMm: Mm, // from the panel root, 0 <= positionMm <= panel.lengthMm
  thicknessMm: Mm.positive(),
  /** a half rib keeps only the part in front of (or behind) the panel's half-rib cut line; null or absent is a full rib */
  half: z.enum(["front", "rear"]).nullable().optional(),
});
export type Rib = z.infer<typeof Rib>;

/**
 * How a panel's ribs are laid out. `distribution` says where they go: linear (even), exponential (crowded toward one
 * end by `bias`), chord proportional (closer where the chord is narrow, by `chordProportionality`), or custom, where
 * the positions are the user's, set in the rib table. These four follow the panel as it changes, except custom.
 * Thickness and half ribs are separate: each is the panel's own value for every rib unless `vary` says the user sets it
 * rib by rib. Files saved with the earlier "calculated"/"custom" mode read as the distribution they meant.
 */
const RibLayoutShape = z.object({
  distribution: z.enum(["linear", "exponential", "chord", "custom"]).default("linear"),
  /** exponential: -3 to 3. 0 is even; positive crowds the ribs toward the root, negative toward the tip */
  bias: z.number().min(-3).max(3).default(0),
  /** chord proportional: -2 to 2. 0 ignores the chord, 1 spaces ribs in proportion to it, 2 goes further; negative puts them further apart where the chord is narrow */
  chordProportionality: z.number().min(-2).max(2).default(0),
  /** which of the rib table's other columns belong to the user */
  vary: z.object({ thickness: z.boolean(), half: z.boolean() }).default({ thickness: false, half: false }),
});
export const RibLayout = z.preprocess((raw) => {
  const r = (raw ?? {}) as { distribution?: string; mode?: string; bias?: number; chordProportionality?: number };
  if (r.distribution) return r;
  const distribution = r.mode === "custom" ? "custom" : r.bias ? "exponential" : r.chordProportionality ? "chord" : "linear";
  return { ...r, distribution };
}, RibLayoutShape);
export type RibLayout = z.infer<typeof RibLayoutShape>;

/** [should] S06 — tabs that hold the rib to the building board. */
export const BuildingTabs = z.object({
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  enabled: z.boolean(),
  above: z.boolean(),
  below: z.boolean(),
  fore: z.boolean(),
  aft: z.boolean(),
  holes: z.boolean(),
  fromLE: Measure,
  fromTE: Measure,
  widthLE: Mm,
  widthTE: Mm,
  extendMm: Mm,
  sidesMm: Mm,
  endsMm: Mm,
});

/* -------------------------------------------------------------------- spars */

export const SparType = z.enum([
  "round", // [should]
  "rectangle", // [must] the one the core loop needs
  "webbing", // [should]
  "roundJoiner", // [should]
  "cuboid", // [should]
  "cuboidJoiner", // [should]
  "aileronCutter", // [should]
]);

export const Webbing = z.object({
  mode: z.enum(["none", "middle", "inFront", "behind", "box"]),
  widthMm: Mm,
  inside: z.boolean(),
  /** mm span, same convention as the spar itself. */
  fromMm: Mm,
  toMm: Mm,
});

export const Aileron = z.object({
  hinge: z.enum(["above", "below"]),
  cutOff: z.boolean(),
  widthMm: Mm,
  cutPct: Pct,
  alphaDeg: Deg,
  betaDeg: Deg,
  closeLE: z.object({ enabled: z.boolean(), widthMm: Mm }),
  closeTE: z.object({ enabled: z.boolean(), widthMm: Mm }),
});
export type Aileron = z.infer<typeof Aileron>;

/**
 * A structural member running spanwise.
 *
 * A spar is anchored to a millimetre span from the panel root, not to rib
 * *indices*. The UI still shows and accepts rib numbers and converts both ways.
 * Regenerating ribs then cannot orphan a spar — pockets are simply cut wherever
 * a rib now falls inside the span.
 */
export const Spar = z.object({
  /** hidden in the 3D view (95 % transparent); the ribs, the exports and the checks are not affected */
  hidden: z.boolean().optional(),
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  id: Uuid,
  name: z.string(),
  type: SparType,
  color: Color,

  spanStartMm: Mm,
  spanEndMm: Mm,

  /** chordwise placement */
  distanceFrom: z.enum(["LE", "TE"]),
  distance: Span,
  angleDeg: Deg.nullable(), // null = auto (perpendicular to the reference edge)
  followLE: z.boolean(),

  /** rectangle / cuboid */
  width: z.object({ start: Mm, end: Mm.nullable() }).nullable(),
  height: z.object({ start: Mm, end: Mm.nullable() }).nullable(),
  autoAdjustWidth: z.boolean(),
  realWidth: z.boolean(),
  verticalCut: z.boolean(),
  flat: z.boolean(),

  /** round / roundJoiner */
  radiusMm: Mm.nullable(),
  /** round: a different radius at the spar's last rib; null or absent keeps one radius throughout */
  radiusEndMm: Mm.nullable().optional(),
  /** cuboid: the box is turned by this many degrees (counter-clockwise) about its centre */
  rotationDeg: z.number().finite().optional(),
  offsetY: z.object({ start: Mm, end: Mm.nullable() }).nullable(),

  gapForeMm: Mm,
  gapAftMm: Mm,
  positionTop: z.boolean(),
  positionBottom: z.boolean(),

  webbing: Webbing.nullable(),
  aileron: Aileron.nullable(),
});
export type Spar = z.infer<typeof Spar>;

/* --------------------------------------------- edges, sheeting, construction */

/** [should] S08 / S09 — field set never observed; revisit after the videos. */
export const EdgeStock = z.object({
  /** show the stock that is carved away, as a faint copy in the 3D view; absent means yes. Each edge stock has its own. */
  showCutStock: z.boolean().optional(),
  /** hidden in the 3D view (95 % transparent); the ribs, the exports and the checks are not affected */
  hidden: z.boolean().optional(),
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  enabled: z.boolean(),
  /** a rectangle or wedge: how far along the chord it reaches. A round rod: its diameter */
  widthMm: Mm,
  heightMm: Mm,
  /** a rectangular strip, a wedge that comes to a point, or (leading edge) a round rod */
  shape: z.enum(["rectangle", "triangle", "round"]),
  /** a wedge: the angle at its point, in degrees. Width and this give the height */
  angleDeg: z.number().min(1).max(80).optional(),
  /** a round rod: how far it sits above (or below, negative) the mean line of the section */
  offsetMm: z.number().optional(),
  /** a round rod: how far back from the leading edge its front sits */
  setbackMm: z.number().min(0).optional(),
});

/** A further leading or trailing edge stock on the same panel: a second strip, a rod beside a strip. The panel's own leadingEdge and trailingEdge stay the first of each. */
export const ExtraEdge = EdgeStock.extend({
  id: Uuid,
  name: z.string(),
  side: z.enum(["leading", "trailing"]),
});
export type ExtraEdge = z.infer<typeof ExtraEdge>;

/** [could] S10 */
export const SheetStrip = z.object({
  /** hidden in the 3D view (95 % transparent); the ribs, the exports and the checks are not affected */
  hidden: z.boolean().optional(),
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  id: Uuid,
  name: z.string(),
  color: Color,
  spanStartMm: Mm,
  spanEndMm: Mm,
  startingAt: z.enum(["LE", "TE"]),
  capStrip: z.boolean(),
  distance: Span,
  length: Span,
  thicknessMm: Mm,
  applyAbove: z.boolean(),
  applyBelow: z.boolean(),
});
export type SheetStrip = z.infer<typeof SheetStrip>;

export const Sheeting = z.object({
  /** hidden in the 3D view (95 % transparent); the ribs, the exports and the checks are not affected */
  hidden: z.boolean().optional(),
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  type: z.enum(["none", "standard", "advanced"]),
  standardLength: Measure.nullable(),
  standardThicknessMm: Mm.nullable(),
  strips: z.array(SheetStrip),
});

/** [could] S11 */
export const RibComb = z.object({
  /** hidden in the 3D view (95 % transparent); the ribs, the exports and the checks are not affected */
  hidden: z.boolean().optional(),
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  id: Uuid,
  name: z.string(),
  type: z.enum(["above", "below"]),
  color: Color,
  spanStartMm: Mm,
  spanEndMm: Mm,
  distanceFrom: z.enum(["LE", "TE"]),
  distance: Span,
  angleDeg: Deg,
  widthMm: Mm,
  extendMm: Mm,
  asTabs: z.boolean(),
  leveled: z.boolean(),
  cutIntoRibPct: Pct,
  gapForeMm: Mm,
  gapAftMm: Mm,
  needleAdjustmentMm: Mm,
  slitHeightMm: Mm,
  slitAdjustMm: Mm,
});
export type RibComb = z.infer<typeof RibComb>;

/** [could] S12 — the hardest geometry in the app. */
export const LighteningHoles = z.object({
  /** switched off without being deleted: the geometry, the exports and the checks leave it out */
  suppressed: z.boolean().optional(),
  type: z.enum(["none", "standard", "triangle"]),
  minDistanceMm: Mm,
  minDistanceFromLEMm: Mm,
  minDistanceFromTEMm: Mm,
  distanceFromEdgeMm: Mm,
  minWidthMm: Mm,
  maxWidthMm: Mm,
  supportWidthMm: Mm,
  roundCorners: z.boolean(),
  roundnessPct: Pct,
  smoothnessPoints: z.number().int().min(2).max(32),
});

/* ------------------------------------------------------------------- panels */

export const Panel = z.object({
  id: Uuid,
  name: z.string().min(1),

  /** [must] S05 base geometry */
  lengthMm: Mm.positive(),
  rootChordMm: Mm.positive(),
  tipChordMm: Mm.positive(),
  sweepMm: Mm,
  rootTwistDeg: Deg,
  tipTwistDeg: Deg,
  straightTE: z.boolean(),
  dihedralDeg: Deg,
  dihedralTipDeg: Deg.nullable(), // [could] free-form panels only
  startAtMm: Mm.nullable(), // [could] free-form panels only

  /** [must] airfoils */
  rootAirfoilId: Uuid,
  rootAirfoilScale: z.number().positive(),
  tipAirfoilId: Uuid.nullable(), // null = same as root
  tipAirfoilScale: z.number().positive(),
  /** Blend smoothly through the previous panel: this panel starts on the section that one ends on. */
  airfoilLinkedToPrev: z.boolean(),
  /** Even out a lumpy leading edge (digitised or imported sections) without changing the shape. */
  noseSmoothing: z.object({ enabled: z.boolean(), extentPct: z.number().min(1).max(30) }).default({ enabled: false, extentPct: 8 }),

  ribAlign: z.enum(["none", "top", "bottom"]),

  /** [must] generation inputs, kept so the UI can show what produced the ribs */
  ribThicknessMm: Mm.positive(),
  ribCountTarget: z.number().int().positive(),
  /** true once a rib has been hand-edited, which invalidates ribCountTarget */
  ribsManuallyEdited: z.boolean(),
  /** where front half ribs are cut (they keep the part ahead of it), as a percentage of the chord from the leading edge */
  halfRibCutPct: z.number().min(5).max(95).default(35),
  /** where rear half ribs are cut, as a percentage of the chord from the leading edge; absent means the same line as the front half ribs */
  halfRibRearCutPct: z.number().min(5).max(95).optional(),
  /** the order the builder lists the panel's features in: spar, strip and comb ids, and "le", "te", "holes", "sheet"; absent means the default order */
  featureOrder: z.array(z.string()).optional(),
  /** absent on older files: they are "even", or "custom" if their ribs were edited by hand */
  ribLayout: RibLayout.optional(),
  ribs: z.array(Rib),

  spars: z.array(Spar),
  buildingTabs: BuildingTabs,
  leadingEdge: EdgeStock,
  trailingEdge: EdgeStock,
  /** more edge stock than the one at each edge; absent on older files. Where they collide a warning is shown, nothing is stopped. */
  extraEdges: z.array(ExtraEdge).optional(),
  sheeting: Sheeting,
  ribCombs: z.array(RibComb),
  lighteningHoles: LighteningHoles,
});
export type Panel = z.infer<typeof Panel>;

/* ------------------------------------------------------------------ project */

export const Wing = z.object({
  panels: z.array(Panel), // ordered root -> tip; adjacency is meaningful
  wingHalvesDistanceMm: Mm,
});

export const ProjectDoc = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Uuid,
  name: z.string().min(1),
  /** display only — all stored lengths are mm regardless */
  displayUnits: z.enum(["mm", "in"]),
  wing: Wing,
  /** every foil the project references that is not a builtin */
  airfoils: z.array(Airfoil),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectDoc = z.infer<typeof ProjectDoc>;

/* -------------------------------------------------------------- app-level UI */

/**
 * NOT part of the document. Lives in localStorage so that toggling a checkbox
 * does not mark the project dirty and so a shared file is portable.
 */
export const ViewPrefs = z.object({
  show: z.object({
    ribs: z.boolean(),
    spars: z.boolean(),
    sheeting: z.boolean(),
    leadingEdge: z.boolean(),
    trailingEdge: z.boolean(),
    axes: z.boolean(),
    dihedral: z.boolean(),
    ribCombs: z.boolean(),
    foilSpan: z.boolean(),
    ghostPanels: z.boolean(),
    grayGhosts: z.boolean(),
  }),
  transparency: z.number().min(0).max(1),
  ghostTransparency: z.number().min(0).max(1),
  viewPreset: z.number().int().min(0).max(6),
});

/* ---------------------------------------------------------------- invariants */

/**
 * Checked on every mutation, not just on load. The ones marked HARD are the
 * geometric equivalent of a database constraint: violating them produces
 * garbage downstream, so they are rejected rather than warned about.
 */
export const INVARIANTS = [
  "HARD panel.tipChordMm > 0 and rootChordMm > 0",
  "HARD every rib.positionMm within [0, panel.lengthMm]",
  "HARD no two ribs in a panel closer than (thickness of the thicker one)",
  "HARD spar.spanStartMm < spar.spanEndMm, both within [0, panel.lengthMm]",
  "HARD panel.rootAirfoilId resolves, in builtins or doc.airfoils",
  "HARD airfoil.points monotonic in x along each surface after normalisation",
  "WARN  spar lies partly outside the interpolated airfoil envelope at some rib",
  "WARN  panel n rootChordMm != panel n-1 tipChordMm (a step in the wing)",
  "WARN  sheeting strip or comb overlaps a spar pocket",
  "WARN  rootChordMm exceeds the printable page width (export will tile)",
] as const;
