/** Document creation and the mutations the UI is allowed to make. */
import { DEFAULT_EDGE } from "../geometry/edgeStock";
import { SCHEMA_VERSION, type Aileron, type Panel, type ProjectDoc, type Rib, type Spar } from "./schema";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-000000000000`;

const now = () => new Date().toISOString();

export function defaultPanel(name: string, rootAirfoilId = "naca-2412"): Panel {
  const panel: Panel = {
    id: uid(),
    name,
    lengthMm: 600,
    rootChordMm: 220,
    tipChordMm: 180,
    sweepMm: 15,
    rootTwistDeg: 0,
    tipTwistDeg: 0,
    straightTE: false,
    dihedralDeg: 3,
    dihedralTipDeg: null,
    startAtMm: null,
    rootAirfoilId,
    rootAirfoilScale: 1,
    tipAirfoilId: null,
    tipAirfoilScale: 1,
    airfoilLinkedToPrev: false,
    noseSmoothing: { enabled: false, extentPct: 8 },
    ribAlign: "none",
    ribThicknessMm: 3,
    ribCountTarget: 12,
    ribsManuallyEdited: false,
    halfRibCutPct: 35,
    ribs: [],
    spars: [],
    buildingTabs: {
      enabled: false,
      above: false,
      below: false,
      fore: true,
      aft: true,
      holes: false,
      // Default project values
      fromLE: { value: 10, unit: "mm" },
      fromTE: { value: 20, unit: "mm" },
      widthLE: 10,
      widthTE: 10,
      extendMm: 5.5,
      sidesMm: 3.5,
      endsMm: 3.5,
    },
    leadingEdge: { enabled: false, ...DEFAULT_EDGE.leadingEdge, shape: "rectangle" },
    trailingEdge: { enabled: false, ...DEFAULT_EDGE.trailingEdge, shape: "triangle" },
    sheeting: { type: "none", standardLength: null, standardThicknessMm: null, strips: [] },
    ribCombs: [],
    lighteningHoles: {
      type: "none",
      minDistanceMm: 5,
      minDistanceFromLEMm: 5,
      minDistanceFromTEMm: 5,
      distanceFromEdgeMm: 2,
      minWidthMm: 10,
      maxWidthMm: 40,
      supportWidthMm: 4,
      roundCorners: true,
      roundnessPct: 20,
      smoothnessPoints: 4,
    },
  };
  panel.ribs = generateRibs(panel);
  return panel;
}

/** Evenly spaced stations, root to tip inclusive. */
export function generateRibs(panel: Panel): Rib[] {
  const n = Math.max(2, Math.round(panel.ribCountTarget));
  const out: Rib[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: uid(),
      positionMm: Number(((i / (n - 1)) * panel.lengthMm).toFixed(4)),
      thicknessMm: panel.ribThicknessMm,
      half: null,
    });
  }
  return out;
}

/** An aileron hinge as a modeller would start it: hinge on top, cut right off, a 1mm gap, 30 degrees of room. */
export function defaultAileron(): Aileron {
  return {
    hinge: "above",
    cutOff: true,
    widthMm: 1,
    cutPct: 50,
    alphaDeg: 0,
    betaDeg: 30,
    closeLE: { enabled: true, widthMm: 1 },
    closeTE: { enabled: true, widthMm: 1 },
  };
}

export function defaultSpar(panel: Panel, name: string, type: Spar["type"] = "rectangle"): Spar {
  return {
    id: uid(),
    name,
    type,
    color: "standard",
    spanStartMm: 0,
    spanEndMm: panel.lengthMm,
    distanceFrom: "LE",
    distance: { start: { value: 28, unit: "pct" }, end: null },
    angleDeg: null,
    followLE: false,
    width: { start: 6, end: null },
    height: { start: 3, end: null },
    autoAdjustWidth: false,
    realWidth: false,
    verticalCut: false,
    flat: false,
    radiusMm: type === "round" || type === "roundJoiner" ? 3 : null,
    offsetY: null,
    gapForeMm: 0,
    gapAftMm: 0,
    positionTop: true,
    positionBottom: true,
    webbing: null,
    aileron: null,
  };
}

export function createProject(name = "Untitled wing"): ProjectDoc {
  const panel = defaultPanel("Panel 1");
  panel.spars.push(defaultSpar(panel, "Main spar"));
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    name,
    displayUnits: "mm",
    wing: { panels: [panel], wingHalvesDistanceMm: 0 },
    airfoils: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

/** Span, in millimetres, tip to tip including both halves. */
const DEG = Math.PI / 180;

/**
 * A panel whose airfoil is linked to the previous one starts on the section that panel ends on: its
 * root section and thickness factor are not its own to choose. Called after every edit so the stored
 * document, the summary and the files always say what the geometry uses. The first panel has nothing
 * to link to, so its flag is ignored.
 */
export function syncAirfoilLinks(doc: { wing: { panels: Panel[] } }): void {
  const panels = doc.wing.panels;
  for (let i = 1; i < panels.length; i++) {
    if (!panels[i].airfoilLinkedToPrev) continue;
    const prev = panels[i - 1];
    panels[i].rootAirfoilId = prev.tipAirfoilId ?? prev.rootAirfoilId;
    panels[i].rootAirfoilScale = prev.tipAirfoilScale;
  }
}

/**
 * The figures a modeller quotes, all projected onto the plane of the wing, which is how
 * span and area are conventionally measured (a dihedral wing is a little narrower and a
 * little smaller than its unbent outline). Aspect ratio is span squared over area, so it
 * has no unit and does not change with the display unit.
 */
export function wingStats(doc: ProjectDoc): {
  spanMm: number;
  /** both halves */
  areaDm2: number;
  meanChordMm: number;
  aspectRatio: number;
} {
  let halfSpan = 0;
  let halfAreaMm2 = 0;
  for (const p of doc.wing.panels) {
    const projected = p.lengthMm * Math.cos(p.dihedralDeg * DEG);
    halfSpan += projected;
    halfAreaMm2 += ((p.rootChordMm + p.tipChordMm) / 2) * projected;
  }
  const spanMm = halfSpan * 2 + doc.wing.wingHalvesDistanceMm;
  const areaMm2 = halfAreaMm2 * 2;
  return {
    spanMm,
    areaDm2: areaMm2 / 10_000,
    meanChordMm: spanMm > 0 ? areaMm2 / spanMm : 0,
    aspectRatio: areaMm2 > 0 ? spanMm ** 2 / areaMm2 : 0,
  };
}

/** Span tip to tip, projected. */
export function wingSpanMm(doc: ProjectDoc): number {
  return wingStats(doc).spanMm;
}

/** Projected planform area of one half, in square decimetres. */
export function halfAreaDm2(doc: ProjectDoc): number {
  return wingStats(doc).areaDm2 / 2;
}

export function totalRibs(doc: ProjectDoc): number {
  return doc.wing.panels.reduce((s, p) => s + p.ribs.length, 0);
}
