/**
 * The project the app opens with, and the one File > New starts from: the first
 * screen shows the tool working rather than an empty shell, and a new project is
 * never a different thing from the first one. A two-panel trainer wing with a tapered outer
 * section: enough structure to exercise interpolation, spars and joiners.
 */
import { createProject, defaultPanel, defaultSpar, generateRibs, uid } from "./doc";
import type { ProjectDoc } from "./schema";

export function seedProject(): ProjectDoc {
  const doc = createProject("Trainer 1200");

  const inner = doc.wing.panels[0];
  inner.name = "Inner panel";
  inner.lengthMm = 420;
  inner.rootChordMm = 230;
  inner.tipChordMm = 230;
  inner.sweepMm = 0;
  inner.dihedralDeg = 2;
  inner.ribCountTarget = 9;
  inner.ribs = generateRibs(inner);
  inner.leadingEdge = { enabled: true, widthMm: 6, heightMm: 20, shape: "rectangle" };
  inner.trailingEdge = { enabled: true, widthMm: 14, heightMm: 8, shape: "triangle" };

  inner.spars = [];
  const mainSpar = defaultSpar(inner, "Main spar");
  mainSpar.distance = { start: { value: 28, unit: "pct" }, end: null };
  mainSpar.width = { start: 8, end: null };
  mainSpar.height = { start: 3, end: null };
  inner.spars.push(mainSpar);

  const joiner = defaultSpar(inner, "Wing joiner", "roundJoiner");
  joiner.radiusMm = 4;
  joiner.spanEndMm = 140;
  joiner.distance = { start: { value: 30, unit: "pct" }, end: null };
  inner.spars.push(joiner);

  const outer = defaultPanel("Outer panel");
  outer.lengthMm = 360;
  outer.rootChordMm = 230;
  outer.tipChordMm = 155;
  outer.sweepMm = 38;
  outer.dihedralDeg = 6;
  outer.tipTwistDeg = -1.5;
  outer.ribCountTarget = 8;
  outer.ribs = generateRibs(outer);
  outer.tipAirfoilId = "naca-2412";
  outer.leadingEdge = { enabled: true, widthMm: 6, heightMm: 20, shape: "rectangle" };
  outer.trailingEdge = { enabled: true, widthMm: 14, heightMm: 8, shape: "triangle" };

  outer.spars = [];
  const outerSpar = defaultSpar(outer, "Main spar");
  outerSpar.distance = { start: { value: 28, unit: "pct" }, end: null };
  outerSpar.width = { start: 8, end: 5 };
  outerSpar.height = { start: 3, end: null };
  outer.spars.push(outerSpar);

  doc.wing.panels.push(outer);
  doc.id = uid();
  return doc;
}
