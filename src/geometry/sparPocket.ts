/**
 * The pocket a rectangular spar leaves in a rib, cut by moving outline points rather than subtracting a box.
 *
 * The pocket takes the run of outline points between the spar's front and back edges
 * and moves them. By default every point is moved by one vector: the unit normal of the outline at the FRONT edge,
 * times minus the spar height. So the floor is a copy of the surface shifted straight in, and both walls run parallel
 * to the front edge's normal (leaning, on a curved surface, rather than standing vertical). "Flat" then replaces that
 * floor by a straight line between its two ends. "Vertical cut" instead puts every point at one height, the higher
 * of the two edge heights minus the spar height (lower plus height on the bottom), with vertical walls.
 */
import { surfaceAt } from "./airfoil";
import type { Path, Pt, Surfaces } from "./types";

export type PocketOptions = {
  side: "upper" | "lower";
  /** front and back edge, millimetres from the leading edge */
  x0: number;
  x1: number;
  height: number;
  flat: boolean;
  verticalCut: boolean;
};

/** How far the pocket is run out past the surface so that cutting with it leaves no sliver. Walls keep their direction. */
const OUT = 2;

/** The outline's y on one side at x (millimetres), and the stored stations that fall strictly between x0 and x1. */
function strip(s: Surfaces, chordMm: number, side: "upper" | "lower", x0: number, x1: number): Pt[] {
  const ys = side === "upper" ? s.yUpper : s.yLower;
  const y = (xf: number) => {
    const v = surfaceAt(s, Math.min(1, Math.max(0, xf)));
    return (side === "upper" ? v.upper : v.lower) * chordMm;
  };
  const pts: Pt[] = [{ x: x0, y: y(x0 / chordMm) }];
  for (let i = 0; i < s.x.length; i++) {
    const x = s.x[i] * chordMm;
    if (x > x0 + 1e-9 && x < x1 - 1e-9) pts.push({ x, y: ys[i] * chordMm });
  }
  pts.push({ x: x1, y: y(x1 / chordMm) });
  return pts;
}

/** Unit outward normal of the outline at x, from the local slope. */
function normalAt(s: Surfaces, chordMm: number, side: "upper" | "lower", x: number): Pt {
  const e = Math.max(chordMm / 400, 0.01);
  const a = Math.max(0, x - e);
  const b = Math.min(chordMm, x + e);
  const ya = surfaceAt(s, a / chordMm);
  const yb = surfaceAt(s, b / chordMm);
  const slope = b > a ? ((side === "upper" ? yb.upper - ya.upper : yb.lower - ya.lower) * chordMm) / (b - a) : 0;
  const k = 1 / Math.hypot(1, slope);
  return side === "upper" ? { x: -slope * k, y: k } : { x: slope * k, y: -k };
}

/** The shape to subtract from the rib, or null when the spar does not reach the section. */
export function sparPocket(s: Surfaces, chordMm: number, o: PocketOptions): Path | null {
  const x0 = Math.max(0, o.x0);
  const x1 = Math.min(chordMm, o.x1);
  if (!(x1 > x0) || !(chordMm > 0)) return null;
  const upper = o.side === "upper";
  const surface = strip(s, chordMm, o.side, x0, x1);

  let floor: Pt[];
  let outward: Pt[];
  if (o.verticalCut) {
    const edge = upper
      ? Math.max(surface[0].y, surface[surface.length - 1].y) - o.height
      : Math.min(surface[0].y, surface[surface.length - 1].y) + o.height;
    floor = surface.map((p) => ({ x: p.x, y: edge }));
    const lift = upper ? OUT : -OUT;
    outward = surface.map((p) => ({ x: p.x, y: p.y + lift }));
  } else {
    const n = normalAt(s, chordMm, o.side, x0);
    const d = { x: -o.height * n.x, y: -o.height * n.y };
    floor = surface.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
    if (o.flat) {
      const a = floor[0];
      const b = floor[floor.length - 1];
      floor = floor.map((_, i) => {
        const t = (surface[i].x - surface[0].x) / (surface[surface.length - 1].x - surface[0].x);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      });
    }
    outward = surface.map((p) => ({ x: p.x + OUT * n.x, y: p.y + OUT * n.y }));
  }
  // Out along the walls' own direction at both ends, so the side walls keep their lean.
  return [...outward, ...floor.slice().reverse()];
}

/**
 * The stick that sits in a pocket, as a four-cornered section with its top on the surface: for the 3D view. It has the same walls as the
 * pocket the rib is cut with (leaning along the front edge's normal, or vertical for a vertical cut) and a straight floor, and always four
 * points, so the section at one end of a spar can be lofted to the section at the other.
 */
export function pocketStick(s: Surfaces, chordMm: number, o: PocketOptions): Path | null {
  const x0 = Math.max(0, o.x0);
  const x1 = Math.min(chordMm, o.x1);
  if (!(x1 > x0) || !(chordMm > 0)) return null;
  const upper = o.side === "upper";
  const y = (x: number) => {
    const v = surfaceAt(s, Math.min(1, Math.max(0, x / chordMm)));
    return (upper ? v.upper : v.lower) * chordMm;
  };
  const p0 = { x: x0, y: y(x0) };
  const p1 = { x: x1, y: y(x1) };
  let quad: Path;
  if (o.verticalCut) {
    const edge = upper ? Math.max(p0.y, p1.y) - o.height : Math.min(p0.y, p1.y) + o.height;
    quad = [{ x: x0, y: edge }, { x: x1, y: edge }, p1, p0];
  } else {
    const n = normalAt(s, chordMm, o.side, x0);
    const d = { x: -o.height * n.x, y: -o.height * n.y };
    quad = [{ x: p0.x + d.x, y: p0.y + d.y }, { x: p1.x + d.x, y: p1.y + d.y }, p1, p0];
  }
  // counter-clockwise, whichever side it is on
  const area = quad.reduce((a, q, i) => a + (q.x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * q.y), 0);
  return area < 0 ? quad.slice().reverse() : quad;
}
