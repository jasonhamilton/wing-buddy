/** Shared geometry types. All lengths in millimetres, all angles in degrees. */

export type Pt = { x: number; y: number };

/** A closed ring. First point is not repeated at the end. */
export type Path = Pt[];

/**
 * An airfoil resampled onto shared chordwise stations, normalised to chord 1.
 * `x` runs 0 (leading edge) to 1 (trailing edge) with cosine spacing, so points
 * cluster where curvature is highest. Interpolating two foils is then a
 * station-by-station blend rather than a resampling problem.
 */
export type Surfaces = {
  x: number[];
  yUpper: number[];
  yLower: number[];
};

export type AirfoilMetrics = {
  thicknessPct: number;
  maxThicknessAtPct: number;
  camberPct: number;
  maxCamberAtPct: number;
};

/** One rib, ready to draw, export or loft. */
export type RibGeometry = {
  ribId: string;
  panelId: string;
  index: number;
  /** rib-local mm: x from the leading edge, y up. Outer rings, CCW. */
  outline: Path[];
  /** interior voids (spar tubes, lightening holes), CW */
  holes: Path[];
  /** the whole airfoil this rib was cut from, turned and aligned like the rib: what the cuts took away shows against it */
  silhouette: Path;
  /** the rib before any feature touches it, but as a half rib if it is one: the airfoil with only the half-rib cut applied */
  profile: Path[];
  chordMm: number;
  /** how thick the rib is along the span: the 3D view extrudes it by this */
  thicknessMm: number;
  twistDeg: number;
  /** where this rib sits in wing coordinates */
  origin: [number, number, number];
  /** rotation about the spanwise axis, radians, from dihedral */
  dihedralRad: number;
  sweepOffsetMm: number;
};

/** What the Fix button on a check does about it. */
export type Fix =
  | { kind: "airfoil" }
  | { kind: "chord" }
  | { kind: "noRibs" }
  | { kind: "overlap" }
  | { kind: "emptyRib" }
  | { kind: "edgeFit"; which: "leadingEdge" | "trailingEdge" };

export type Warning = {
  fix?: Fix;
  level: "warn" | "error";
  panelId?: string;
  ribId?: string;
  sparId?: string;
  /** the feature it is about, by name, when it is not a spar (edge stock, a strip, a comb); shown apart from the message */
  feature?: string;
  message: string;
};

/**
 * A structural member lofted along the span, ready for the 3D view. Triangles
 * only: the exporters work from the 2D rib paths, so this exists purely to be
 * looked at, and carrying anything more would be weight for nothing.
 */
export type Solid = {
  id: string;
  panelId: string;
  kind: "spar" | "webbing" | "sheeting" | "comb" | "leadingEdge" | "trailingEdge" | "leadingEdgeExcess" | "trailingEdgeExcess";
  /** flat xyz triples in wing coordinates */
  positions: number[];
  /** the part's own colour, "#rrggbb"; absent means the standard colour for its kind */
  color?: string;
};

/** A flat webbing part: the web that stands between two neighbouring ribs, drawn on its own for cutting. */
export type WebbingPart = {
  sparId: string;
  panelId: string;
  /** index of the rib it starts at */
  index: number;
  /** x along the span between the facing rib faces, y up; a trapezoid, as tall at each end as the section is there */
  path: Path;
};

export type GeometryResult = {
  ribs: RibGeometry[];
  /** webbing between neighbouring ribs, for the DXF */
  webbingParts: WebbingPart[];
  solids: Solid[];
  warnings: Warning[];
  /** wall-clock milliseconds the rebuild took */
  tookMs: number;
};

/** Formats a length in millimetres for a message, in the project's display unit. */
export type LengthFormatter = (mm: number, decimals?: number) => string;
