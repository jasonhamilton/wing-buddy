/**
 * DXF writer, R12 ASCII.
 *
 * Written by hand rather than pulled from a library: the libraries that exist
 * either skip the header (so CAM software guesses the units and silently scales
 * the part) or cannot emit closed polylines on named layers. Both matter here.
 *
 * R12 is the most widely readable dialect — LibreCAD, Inkscape, LightBurn,
 * Fusion and every laser cutter's own tool open it. $INSUNITS is written even
 * though R12 predates it: readers that understand it stop guessing, and readers
 * that do not simply skip it.
 */
import { difference, rect } from "../geometry/clipper";
import type { GeometryResult, Path } from "../geometry/types";

export type DxfOptions = {
  boxesAroundRibs: boolean;
  drawOriginalSilhouette: boolean;
  /** millimetres of clear space between parts on the sheet */
  spacingMm: number;
  /** cut a sliver of a trailing edge back to a usable thickness, so a laser is not asked to cut two lines that nearly touch */
  trimTrailingEdge: boolean;
  /** how thick the trailing edge must be where it is trimmed, millimetres */
  trailingMinMm: number;
};

export const DXF_DEFAULTS: DxfOptions = {
  boxesAroundRibs: false,
  drawOriginalSilhouette: false,
  spacingMm: 10,
  trimTrailingEdge: false,
  trailingMinMm: 0.8,
};

const LAYERS = [
  { name: "RIBS", colour: 7 },
  { name: "HOLES", colour: 1 },
  { name: "BOXES", colour: 8 },
  { name: "LABELS", colour: 3 },
  // Webbing is cut as parts of its own, one between each pair of neighbouring ribs.
  { name: "PARTS_WEBBING", colour: 5 },
  // The whole airfoil each rib was cut from: a guide, on its own layer so it can be left out of the cut.
  { name: "SILHOUETTE", colour: 9 },
] as const;

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function polyline(path: Path, layer: string, closed = true): string {
  let out = pair(0, "POLYLINE") + pair(8, layer) + pair(66, 1) + pair(70, closed ? 1 : 0);
  for (const p of path) {
    out += pair(0, "VERTEX") + pair(8, layer) + pair(10, p.x.toFixed(4)) + pair(20, p.y.toFixed(4));
  }
  return out + pair(0, "SEQEND") + pair(8, layer);
}

function text(value: string, x: number, y: number, height: number, layer: string): string {
  return (
    pair(0, "TEXT") +
    pair(8, layer) +
    pair(10, x.toFixed(4)) +
    pair(20, y.toFixed(4)) +
    pair(40, height.toFixed(4)) +
    pair(1, value)
  );
}

function bounds(paths: Path[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Vertical thickness of a set of rings at one x: the spread of where a vertical line crosses their edges. */
function thicknessAt(rings: Path[], x: number): number {
  const ys: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  }
  return ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
}

/**
 * Cut a sharp trailing edge back to where the rib is `minMm` thick. A trailing edge that runs out to a
 * point leaves a laser cutter two lines that almost touch, which burns through the thin tip anyway. Never
 * takes more than a twentieth of the chord, and leaves an edge that is already thick enough alone.
 */
export function trimTrailingEdge(outline: Path[], minMm: number): Path[] {
  if (!(minMm > 0) || outline.length === 0) return outline;
  const xs = outline.flat().map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const chord = maxX - minX;
  if (chord <= 0) return outline;
  // Probe a little inside the tip, not at it: a trailing edge cut flat for stock is turned a degree or so
  // by twist, so its top corner pokes out a fraction of a millimetre and would otherwise look sharp.
  if (thicknessAt(outline, maxX - Math.min(0.2, chord * 0.002)) >= minMm) return outline;

  const limit = maxX - 0.05 * chord;
  const step = Math.max(chord / 4000, 0.01);
  let cut = maxX;
  for (let x = maxX - step; x >= limit; x -= step) {
    cut = x;
    if (thicknessAt(outline, x) >= minMm) break;
  }
  return difference(outline, [rect(cut, -1e5, maxX + 1e3, 1e5)]);
}

const shift = (path: Path, dx: number, dy: number): Path => path.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** Lay every rib out in a row, nose-left, with a labelled origin at 0,0. */
export function buildDxf(result: GeometryResult, options: DxfOptions = DXF_DEFAULTS): string {
  const entities: string[] = [];
  let cursorX = 0;
  let maxY = 0;

  for (const rib of result.ribs) {
    const outline = options.trimTrailingEdge ? trimTrailingEdge(rib.outline, options.trailingMinMm) : rib.outline;
    const all = [...outline, ...rib.holes];
    if (all.length === 0) continue;
    // Room is made for the silhouette too, so a neighbouring rib is never drawn on top of it.
    const b = bounds(options.drawOriginalSilhouette ? [...all, rib.silhouette] : all);
    const dx = cursorX - b.minX;
    const dy = -b.minY;

    if (options.drawOriginalSilhouette) entities.push(polyline(shift(rib.silhouette, dx, dy), "SILHOUETTE"));
    for (const ring of outline) entities.push(polyline(shift(ring, dx, dy), "RIBS"));
    for (const ring of rib.holes) entities.push(polyline(shift(ring, dx, dy), "HOLES"));

    if (options.boxesAroundRibs) {
      entities.push(
        polyline(
          [
            { x: cursorX, y: 0 },
            { x: cursorX + b.w, y: 0 },
            { x: cursorX + b.w, y: b.h },
            { x: cursorX, y: b.h },
          ],
          "BOXES",
        ),
      );
    }

    entities.push(text(`R${rib.index + 1}`, cursorX + 1, -6, 4, "LABELS"));

    cursorX += b.w + options.spacingMm;
    maxY = Math.max(maxY, b.h);
  }

  // The webbing parts go in a row under the ribs and their labels.
  let webX = 0;
  let webMinY = 0;
  for (const part of result.webbingParts ?? []) {
    const b = bounds([part.path]);
    entities.push(polyline(shift(part.path, webX - b.minX, -30 - b.maxY), "PARTS_WEBBING"));
    webX += b.w + options.spacingMm;
    webMinY = Math.min(webMinY, -30 - b.h);
  }
  cursorX = Math.max(cursorX, webX);

  const header =
    pair(0, "SECTION") +
    pair(2, "HEADER") +
    pair(9, "$ACADVER") + pair(1, "AC1009") +
    pair(9, "$INSUNITS") + pair(70, 4) +   // 4 = millimetres
    pair(9, "$MEASUREMENT") + pair(70, 1) + // 1 = metric
    pair(9, "$EXTMIN") + pair(10, "0.0") + pair(20, Math.min(-10, webMinY).toFixed(1)) +
    pair(9, "$EXTMAX") + pair(10, cursorX.toFixed(4)) + pair(20, maxY.toFixed(4)) +
    pair(0, "ENDSEC");

  const tables =
    pair(0, "SECTION") +
    pair(2, "TABLES") +
    pair(0, "TABLE") +
    pair(2, "LAYER") +
    pair(70, LAYERS.length) +
    LAYERS.map((l) => pair(0, "LAYER") + pair(2, l.name) + pair(70, 0) + pair(62, l.colour) + pair(6, "CONTINUOUS")).join("") +
    pair(0, "ENDTAB") +
    pair(0, "ENDSEC");

  const body =
    pair(0, "SECTION") + pair(2, "ENTITIES") + entities.join("") + pair(0, "ENDSEC") + pair(0, "EOF");

  return header + tables + body;
}
