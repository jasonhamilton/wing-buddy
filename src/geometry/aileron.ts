/**
 * The cut for an aileron hinge, in rib-local millimetres, before twist.
 *
 * A notch is cut from the surface opposite the hinge. Its faces tilt away from each other: the
 * wing-side face by alpha, the aileron-side face by beta, so the opening is wider than the gap at the
 * hinge and the aileron can swing. Cut off, the notch goes right through and the rib comes out in
 * two pieces; attached, it stops `cutPct` of the way through and the skin on the hinge side holds
 * the pieces together. Close-off recesses each face by a wall width, leaving room to glue a thin
 * wall onto the cut face of each piece.
 */
import type { Aileron } from "../domain/schema";
import type { Path } from "./types";

export type AileronCut = {
  /** what is removed from the rib */
  notch: Path;
  /** the wall that closes the wing's cut face, as a thin parallelogram in the recess; null if not switched on */
  wingWall: Path | null;
  /** the same for the aileron's cut face */
  aileronWall: Path | null;
};

const RAD = Math.PI / 180;
/** How far the notch is run past the surface it opens on, so the cut is clean. */
const MARGIN = 1;

export function aileronCut(a: Aileron, xHinge: number, yTop: number, yBot: number): AileronCut | null {
  const thickness = yTop - yBot;
  if (!(thickness > 1e-6)) return null;

  const openBottom = a.hinge === "above";
  const yOpen = openBottom ? yBot : yTop;
  const toward = openBottom ? 1 : -1; // from the open surface toward the hinge surface

  const depth = a.cutOff ? thickness + MARGIN : (Math.min(100, Math.max(0, a.cutPct)) / 100) * thickness;
  if (!(depth > 1e-6)) return null;
  const yApex = yOpen + toward * depth;
  const yOut = yOpen - toward * MARGIN;

  const g = Math.max(0, a.widthMm) / 2;
  const rLE = a.closeLE.enabled ? Math.max(0, a.closeLE.widthMm) : 0;
  const rTE = a.closeTE.enabled ? Math.max(0, a.closeTE.widthMm) : 0;
  const tanA = Math.tan(a.alphaDeg * RAD);
  const tanB = Math.tan(a.betaDeg * RAD);

  // The faces, as a function of distance from the apex toward the open side.
  const wingFace = (dist: number, recess: number) => xHinge - g - recess - tanA * dist;
  const ailFace = (dist: number, recess: number) => xHinge + g + recess + tanB * dist;

  const notch: Path = [
    { x: wingFace(0, rLE), y: yApex },
    { x: ailFace(0, rTE), y: yApex },
    { x: ailFace(depth + MARGIN, rTE), y: yOut },
    { x: wingFace(depth + MARGIN, rLE), y: yOut },
  ];

  // Where the notch crosses the section, for the walls: the part of the cut that is inside the airfoil.
  const lo = openBottom ? yBot : Math.max(yBot, yApex);
  const hi = openBottom ? Math.min(yTop, yApex) : yTop;
  const distAt = (y: number) => Math.abs(y - yApex);
  const wall = (face: (d: number, r: number) => number, recess: number): Path | null =>
    recess > 0 && hi > lo
      ? [
          { x: face(distAt(lo), 0), y: lo },
          { x: face(distAt(hi), 0), y: hi },
          { x: face(distAt(hi), recess), y: hi },
          { x: face(distAt(lo), recess), y: lo },
        ]
      : null;

  return {
    notch,
    wingWall: wall(wingFace, rLE),
    aileronWall: wall(ailFace, rTE),
  };
}
