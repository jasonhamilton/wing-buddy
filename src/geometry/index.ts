/**
 * The rebuild. Walks the document and produces every rib's geometry plus the
 * transform that places it in the wing.
 *
 * Deterministic by contract: the same document produces byte-identical output,
 * which is what makes the golden-file tests in rib.test.ts meaningful and what
 * keeps a DXF diff readable.
 */
import { resolveSurfaces } from "../domain/airfoils";
import type { Panel, ProjectDoc, Spar } from "../domain/schema";
import { scaleThickness, surfaceAt } from "./airfoil";
import { blendSurfaces, blendSurfacesAlong } from "./interpolate";
import { smoothNose } from "./smooth";
import { edgeEntries, edgeSpan } from "./edgeList";
import { withoutSuppressed } from "./suppress";
import { coverHeightMm, edgeParts, isRod } from "./edgeStock";
import { loft, sparSection, type SpanFrame } from "./loft";
import { combSolids, levelledDepths } from "./combs";
import { sheetSolids } from "./sheeting";
import { circle, rect } from "./clipper";
import { buildRibPaths, joinerCentre, resolveChordwise, sparT, type JoinerFrame, type SparCutContext, type SparEnds } from "./rib";
import { formatLength } from "../domain/units";
import type { WebbingPart, GeometryResult, LengthFormatter, Path, RibGeometry, Solid, Surfaces, Warning } from "./types";

const DEG = Math.PI / 180;

/** Spars whose millimetre span covers this rib station. */
export function sparsAtStation(panel: Panel, positionMm: number): Spar[] {
  return panel.spars.filter((s) => positionMm >= s.spanStartMm - 1e-6 && positionMm <= s.spanEndMm + 1e-6);
}

/** The section at a station along a panel, millimetres from its root; null when its airfoil cannot be loaded. */
export type SectionAt = (positionMm: number) => Surfaces;

/**
 * How each panel's section varies along its span. A panel on its own blends straight from its
 * root section to its tip section (two sections whenever the tip differs from the root in section OR
 * in thickness, so a scale-only taper still interpolates). A run of panels whose airfoils are linked
 * is one blend: a smooth curve through the section at every join, so there is no kink where one panel
 * ends and the next begins.
 */
export function panelSections(doc: ProjectDoc): (SectionAt | null)[] {
  const panels = doc.wing.panels;
  const out: (SectionAt | null)[] = new Array(panels.length).fill(null);

  /** A section as the panel wants it: scaled in thickness, and with the nose smoothed if asked. */
  const prepare = (p: Panel, foil: Surfaces, scale: number): Surfaces => {
    const scaled = scaleThickness(foil, scale || 1);
    return p.noseSmoothing?.enabled ? smoothNose(scaled, p.noseSmoothing.extentPct) : scaled;
  };

  const standalone = (p: Panel): SectionAt | null => {
    const root = resolveSurfaces(p.rootAirfoilId, doc.airfoils);
    if (!root) return null;
    const tip = p.tipAirfoilId ? resolveSurfaces(p.tipAirfoilId, doc.airfoils) : root;
    const rootScaled = prepare(p, root, p.rootAirfoilScale);
    const tipScaled = tip && tip !== root ? prepare(p, tip, p.tipAirfoilScale) : prepare(p, root, p.tipAirfoilScale);
    const differs = (tip && tip !== root) || (p.tipAirfoilScale || 1) !== (p.rootAirfoilScale || 1);
    const controls = differs ? [rootScaled, tipScaled] : [rootScaled];
    return (pos) => blendSurfaces(controls, p.lengthMm === 0 ? 0 : pos / p.lengthMm);
  };

  let i = 0;
  while (i < panels.length) {
    let j = i;
    while (j + 1 < panels.length && panels[j + 1].airfoilLinkedToPrev) j++;
    if (i === j) {
      out[i] = standalone(panels[i]);
      i++;
      continue;
    }

    // A linked run: the section at each join, in order. A panel's root is the previous tip.
    const controls: Surfaces[] = [];
    const at: number[] = [0];
    let broken = false;
    let rootId = panels[i].rootAirfoilId;
    let rootScale = panels[i].rootAirfoilScale || 1;
    const first = resolveSurfaces(rootId, doc.airfoils);
    if (first) controls.push(prepare(panels[i], first, rootScale));
    else broken = true;
    for (let k = i; k <= j && !broken; k++) {
      const tipId = panels[k].tipAirfoilId ?? rootId;
      const tipScale = panels[k].tipAirfoilScale || 1;
      const sec = resolveSurfaces(tipId, doc.airfoils);
      if (!sec) {
        broken = true;
        break;
      }
      controls.push(prepare(panels[k], sec, tipScale));
      at.push(at[at.length - 1] + panels[k].lengthMm);
      rootId = tipId;
      rootScale = tipScale;
    }

    if (broken) {
      // One bad airfoil must not take the whole run down: each panel falls back to standing alone.
      for (let k = i; k <= j; k++) out[k] = standalone(panels[k]);
    } else {
      for (let k = i; k <= j; k++) {
        const offset = at[k - i];
        out[k] = (pos) => blendSurfacesAlong(controls, at, offset + pos);
      }
    }
    i = j + 1;
  }
  return out;
}

/** The edge-stock height that just covers the airfoil at both ends of the panel, mm. */
export function edgeFitHeightMm(doc: ProjectDoc, panelId: string, which: "leadingEdge" | "trailingEdge", stock?: Panel["leadingEdge"]): number | null {
  const index = doc.wing.panels.findIndex((p) => p.id === panelId);
  if (index < 0) return null;
  const panel = doc.wing.panels[index];
  const section = panelSections(doc)[index];
  if (!section) return null;
  const edge = stock ?? panel[which];
  if (isRod(edge, which)) return null; // a rod is fitted by its diameter, not its height
  return Math.max(
    ...[0, 1].map((t) => coverHeightMm(edge, which, chordAt(panel, t), section(t * panel.lengthMm))),
  );
}

export function chordAt(panel: Panel, t: number): number {
  return panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * t;
}

/** Each joiner's anchor: the section, chord and twist at its first rib, and the middle of its run (see JoinerFrame). */
function joinerFramesFor(
  panel: Panel,
  sortedRibs: Panel["ribs"],
  sectionAt: (positionMm: number) => { t: number; chordMm: number; surfaces: Surfaces },
): Record<string, JoinerFrame> {
  const out: Record<string, JoinerFrame> = {};
  for (const spar of panel.spars) {
    if (spar.type !== "roundJoiner" && spar.type !== "cuboidJoiner") continue;
    const inside = sortedRibs.filter((r) => r.positionMm >= spar.spanStartMm - 1e-6 && r.positionMm <= spar.spanEndMm + 1e-6);
    if (inside.length === 0) continue;
    const first = inside[0].positionMm;
    const last = inside[inside.length - 1].positionMm;
    const sec = sectionAt(first);
    out[spar.id] = {
      anchorChordMm: sec.chordMm,
      anchorSurfaces: sec.surfaces,
      anchorTwistDeg: twistAt(panel, sec.t),
      anchorPositionMm: first,
      midPositionMm: (first + last) / 2,
      sweepMm: panel.sweepMm,
      lengthMm: panel.lengthMm,
      dihedralDeg: panel.dihedralDeg,
    };
  }
  return out;
}

/** The first and last rib of each round or cuboid spar: the hole is spread between them (see interpolatedCentre). */
function sparEndsFor(
  panel: Panel,
  sortedRibs: Panel["ribs"],
  sectionAt: (positionMm: number) => { t: number; chordMm: number; surfaces: Surfaces },
): Record<string, SparEnds> {
  const out: Record<string, SparEnds> = {};
  const frame = (positionMm: number) => {
    const sec = sectionAt(positionMm);
    return { chordMm: sec.chordMm, surfaces: sec.surfaces, twistDeg: twistAt(panel, sec.t), positionMm };
  };
  for (const spar of panel.spars) {
    if (spar.type !== "round" && spar.type !== "cuboid") continue;
    const inside = sortedRibs.filter((r) => r.positionMm >= spar.spanStartMm - 1e-6 && r.positionMm <= spar.spanEndMm + 1e-6);
    if (inside.length < 2) continue;
    out[spar.id] = { first: frame(inside[0].positionMm), last: frame(inside[inside.length - 1].positionMm) };
  }
  return out;
}

/** The root rib's highest and lowest points once finished (no tabs yet): the level every building tab stands at. */
function tabLevelFor(
  panel: Panel,
  sorted: Panel["ribs"],
  sectionAt: (positionMm: number) => { t: number; chordMm: number; surfaces: Surfaces },
  _tAt: (positionMm: number) => number,
  _section: (positionMm: number) => Surfaces,
  sparEnds: Record<string, SparEnds>,
  joinerFrames: Record<string, JoinerFrame>,
  combLevels: Record<string, number>,
): { top: number; bottom: number } | undefined {
  if (!panel.buildingTabs?.enabled || sorted.length === 0) return undefined;
  // One flat level for every rib, set by the highest and lowest point
  // of ANY rib in the finished (twisted) frame, not just the root's.
  const noTabs = { ...panel, buildingTabs: { ...panel.buildingTabs, enabled: false } };
  let top = -Infinity;
  let bottom = Infinity;
  for (const rib of sorted) {
    const sec = sectionAt(rib.positionMm);
    if (sec.chordMm <= 0) continue;
    const built = buildRibPaths({
      panel: noTabs,
      surfaces: sec.surfaces,
      chordMm: sec.chordMm,
      twistDeg: twistAt(panel, sec.t),
      spanT: sec.t,
      positionMm: rib.positionMm,
      activeSpars: sparsAtStation(panel, rib.positionMm),
      fmt: () => "",
      combLevels,
      joinerFrames,
      sparEnds,
    });
    for (const ring of built.outline) {
      for (const p of ring) {
        top = Math.max(top, p.y);
        bottom = Math.min(bottom, p.y);
      }
    }
  }
  if (!Number.isFinite(top)) return undefined;
  return { top, bottom };
}

export function twistAt(panel: Panel, t: number): number {
  return panel.rootTwistDeg + (panel.tipTwistDeg - panel.rootTwistDeg) * t;
}

export function rebuild(source: ProjectDoc): GeometryResult {
  const started = performance.now();
  // features that are switched off are left out of everything
  const doc = withoutSuppressed(source);
  const ribs: RibGeometry[] = [];
  const solids: Solid[] = [];
  const webbingParts: WebbingPart[] = [];
  const warnings: Warning[] = [];
  // Messages quote lengths in the unit the user works in; the numbers they come from stay millimetres.
  const fmt: LengthFormatter = (mm, decimals = 2) => formatLength(mm, doc.displayUnits, doc.displayUnits === "in" ? decimals + 1 : decimals);

  // Running origin at the root of the current panel.
  let baseX = 0;
  let baseY = 0;
  let baseZ = 0;

  const sections = panelSections(doc);

  for (const [panelIndex, panel] of doc.wing.panels.entries()) {
    const section = sections[panelIndex];
    if (!section) {
      warnings.push({
        level: "error",
        fix: { kind: "airfoil" },
        panelId: panel.id,
        message: `${panel.name}: its airfoil could not be loaded, so no ribs were generated.`,
      });
      continue;
    }

    const dihedralRad = panel.dihedralDeg * DEG;
    const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);

    if (sorted.length === 0) {
      warnings.push({
        level: "warn",
        fix: { kind: "noRibs" },
        panelId: panel.id,
        message: `${panel.name} has no ribs yet. Set a count and press Generate ribs.`,
      });
    }

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].positionMm - sorted[i - 1].positionMm;
      const need = Math.max(sorted[i].thicknessMm, sorted[i - 1].thicknessMm);
      if (gap < need) {
        warnings.push({
          level: "warn",
          fix: { kind: "overlap" },
          panelId: panel.id,
          ribId: sorted[i].id,
          message: `${panel.name}: ribs ${i} and ${i + 1} are ${fmt(gap)} apart but ${fmt(need)} thick — they overlap.`,
        });
      }
    }

    // The last rib takes the exact tip chord and twist, wherever it ends up (it stands a rib thickness short of the end).
    const lastPos = sorted.length > 1 ? sorted[sorted.length - 1].positionMm : null;
    const tAt = (positionMm: number) =>
      lastPos !== null && Math.abs(positionMm - lastPos) < 1e-6 ? 1 : panel.lengthMm === 0 ? 0 : positionMm / panel.lengthMm;
    const sectionAt = (positionMm: number) => {
      const t = tAt(positionMm);
      return { t, chordMm: chordAt(panel, t), surfaces: section(positionMm) };
    };
    const combLevels = levelledDepths(panel, sectionAt);
    const joinerFrames = joinerFramesFor(panel, sorted, sectionAt);
    const sparEnds = sparEndsFor(panel, sorted, sectionAt);
    const tabLevel = tabLevelFor(panel, sorted, sectionAt, tAt, section, sparEnds, joinerFrames, combLevels);

    sorted.forEach((rib, index) => {
      const t = tAt(rib.positionMm);
      const chordMm = chordAt(panel, t);
      const twistDeg = twistAt(panel, t);

      if (chordMm <= 0) {
        warnings.push({
          level: "error",
          fix: { kind: "chord" },
          panelId: panel.id,
          ribId: rib.id,
          message: `${panel.name} rib ${index + 1}: the chord has shrunk to zero.`,
        });
        return;
      }

      const surfaces = section(rib.positionMm);
      const built = buildRibPaths({
        panel,
        surfaces,
        chordMm,
        twistDeg,
        spanT: t,
        positionMm: rib.positionMm,
        activeSpars: sparsAtStation(panel, rib.positionMm),
        fmt,
        half: rib.half ?? null,
        halfCutPct: rib.half === "rear" ? (panel.halfRibRearCutPct ?? panel.halfRibCutPct) : panel.halfRibCutPct,
        combLevels,
        joinerFrames,
        sparEnds,
        tabLevel,
      });
      warnings.push(...built.warnings.map((w) => ({ ...w, panelId: w.panelId ?? panel.id, ribId: rib.id })));

      const sweepOffsetMm = panel.lengthMm === 0 ? 0 : (rib.positionMm / panel.lengthMm) * panel.sweepMm;

      ribs.push({
        ribId: rib.id,
        panelId: panel.id,
        index,
        outline: built.outline,
        holes: built.holes,
        silhouette: built.silhouette,
        profile: built.profile,
        chordMm,
        thicknessMm: rib.thicknessMm,
        twistDeg,
        origin: [
          baseX + sweepOffsetMm,
          baseY + rib.positionMm * Math.sin(dihedralRad),
          baseZ + rib.positionMm * Math.cos(dihedralRad),
        ],
        dihedralRad,
        sweepOffsetMm,
      });
    });

    // --- webbing: one flat part between each pair of neighbouring ribs ---
    for (const spar of panel.spars) {
      if (spar.type !== "webbing") continue;
      const inside = sorted.filter((r) => r.positionMm >= spar.spanStartMm - 1e-6 && r.positionMm <= spar.spanEndMm + 1e-6);
      const at = (r: (typeof sorted)[number]) => {
        const sec = sectionAt(r.positionMm);
        const spanT = sparT(spar, r.positionMm);
        const d0 = resolveChordwise(spar.distance.start.value, spar.distance.start.unit, sec.chordMm);
        const d1 = spar.distance.end ? resolveChordwise(spar.distance.end.value, spar.distance.end.unit, sec.chordMm) : d0;
        const d = d0 + (d1 - d0) * spanT;
        const x = spar.distanceFrom === "LE" ? d : sec.chordMm - d;
        const surf = surfaceAt(sec.surfaces, sec.chordMm === 0 ? 0 : Math.min(1, Math.max(0, x / sec.chordMm)));
        return { top: surf.upper * sec.chordMm, bottom: surf.lower * sec.chordMm };
      };
      for (let i = 1; i < inside.length; i++) {
        const a = inside[i - 1];
        const b = inside[i];
        const len = b.positionMm - a.positionMm - (a.thicknessMm + b.thicknessMm) / 2;
        if (len <= 0) continue;
        const ha = at(a);
        const hb = at(b);
        webbingParts.push({
          sparId: spar.id,
          panelId: panel.id,
          index: sorted.indexOf(a),
          path: [
            { x: 0, y: ha.bottom },
            { x: 0, y: ha.top },
            { x: len, y: hb.top },
            { x: len, y: hb.bottom },
          ],
        });
      }
    }

    // --- lofted members, for the 3D view only ---------------------------
    const frameAt = (positionMm: number): SpanFrame => {
      const t = tAt(positionMm);
      // Ask the rib builder what it would do at this station, so alignment agrees exactly.
      const sec = sectionAt(positionMm);
      const built = buildRibPaths({
        panel,
        surfaces: sec.surfaces,
        chordMm: sec.chordMm,
        twistDeg: twistAt(panel, t),
        spanT: t,
        positionMm,
        activeSpars: sparsAtStation(panel, positionMm),
        combLevels,
        joinerFrames,
        sparEnds,
        tabLevel,
      });
      return {
        twistDeg: twistAt(panel, t),
        alignShiftMm: built.alignShiftMm,
        origin: [
          baseX + t * panel.sweepMm,
          baseY + positionMm * Math.sin(dihedralRad),
          baseZ + positionMm * Math.cos(dihedralRad),
        ],
        dihedralRad,
      };
    };

    for (const spar of panel.spars) {
      const a = Math.max(0, Math.min(panel.lengthMm, spar.spanStartMm));
      const b = Math.max(0, Math.min(panel.lengthMm, spar.spanEndMm));
      if (b - a < 0.01) continue;
      const sa = sectionAt(a);
      const sb = sectionAt(b);
      // A joiner is one straight rod: its solid has to end where the ribs' holes are, not at the same percentage of each local chord.
      const rod = (spar.type === "roundJoiner" || spar.type === "cuboidJoiner") ? joinerFrames[spar.id] : undefined;
      const joinerPart = (pos: number, sec: ReturnType<typeof sectionAt>, spanT: number): { path: Path; kind: Solid["kind"] }[] => {
        if (!rod) return [];
        const ctx: SparCutContext = { spar, chordMm: sec.chordMm, surfaces: sec.surfaces, spanT, positionMm: pos, startChordMm: sectionAt(spar.spanStartMm).chordMm, twistDeg: twistAt(panel, sec.t), rod, warn: () => {}, fmt };
        const c = joinerCentre(ctx, rod);
        const lerp = (v: number, e: number | null | undefined) => (e == null ? v : v + (e - v) * spanT);
        if (spar.type === "roundJoiner") return [{ path: circle(c.x, c.y, spar.radiusMm ?? 3, 32), kind: "spar" }];
        const w = lerp(spar.width?.start ?? 6, spar.width?.end ?? null);
        const h = lerp(spar.height?.start ?? 3, spar.height?.end ?? null);
        return [{ path: rect(c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2), kind: "spar" }];
      };
      const partsA = rod ? joinerPart(a, sa, 0) : sparSection(spar, sa.chordMm, sa.surfaces, 0);
      const partsB = rod ? joinerPart(b, sb, 1) : sparSection(spar, sb.chordMm, sb.surfaces, 1);
      const fa = frameAt(a);
      const fb = frameAt(b);
      for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
        const positions = loft(partsA[i].path, partsB[i].path, fa, fb);
        if (positions.length) {
          solids.push({
            id: `${spar.id}-${i}`,
            panelId: panel.id,
            kind: partsA[i].kind,
            positions,
            ...(spar.color !== "standard" ? { color: spar.color } : {}),
          });
        }
      }
    }

    solids.push(...sheetSolids(panel, sectionAt, frameAt));
    solids.push(...combSolids(panel, sectionAt, frameAt, combLevels));

    const entries = edgeEntries(panel);
    for (const entry of entries) {
      const { which, edge } = entry;
      const sa = sectionAt(0);
      const sb = sectionAt(panel.lengthMm);
      const a = edgeParts(edge, which, sa.chordMm, sa.surfaces);
      const b = edgeParts(edge, which, sb.chordMm, sb.surfaces);
      if (!a || !b) continue;
      const fa = frameAt(0);
      const fb = frameAt(panel.lengthMm);
      const sid = entry.id ?? `${panel.id}-${which}`;
      const add = (suffix: string, kind: Solid["kind"], ra: Path, rb: Path) => {
        const positions = loft(ra, rb, fa, fb);
        if (positions.length) solids.push({ id: `${sid}${suffix}`, panelId: panel.id, kind, positions });
      };
      add("", which, a.shaped, b.shaped);
      add("-above", `${which}Excess`, a.excess[0], b.excess[0]);
      add("-below", `${which}Excess`, a.excess[1], b.excess[1]);

      const short = Math.max(a.uncoveredMm, b.uncoveredMm);
      if (short > 0.05) {
        warnings.push({
          level: "warn",
          // the one-click fix raises the panel's own stock; an extra one is fixed by hand
          ...(entry.id === null ? { fix: { kind: "edgeFit" as const, which } } : {}),
          panelId: panel.id,
          feature: entry.name,
          message: `${panel.name}: ${entry.id === null ? `the ${which === "leadingEdge" ? "leading" : "trailing"} edge stock` : entry.name} is ${fmt(short, 1)} too ${isRod(edge, which) ? "small" : "low"} to cover the airfoil. ${isRod(edge, which) ? "Change its diameter or position, or press Fit to nose." : "Raise its height, or press Fit height to wing."}`,
        });
      }
    }

    // Edge stock that collides with other edge stock is allowed, and only warned about.
    for (const where of [0, panel.lengthMm]) {
      const sec = sectionAt(where);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [a0, a1] = edgeSpan(entries[i], sec.chordMm);
          const [b0, b1] = edgeSpan(entries[j], sec.chordMm);
          if (Math.min(a1, b1) - Math.max(a0, b0) > 0.05) {
            warnings.push({
              level: "warn",
              panelId: panel.id,
              feature: `${entries[i].name} and ${entries[j].name}`,
              message: `${panel.name}: ${entries[i].name} and ${entries[j].name} overlap ${fmt(Math.min(a1, b1) - Math.max(a0, b0), 1)} along the chord.`,
            });
          }
        }
      }
    }

    // ...and so is edge stock that runs into a spar, notch or joiner.
    for (const where of [0, panel.lengthMm]) {
      const sec = sectionAt(where);
      const t = panel.lengthMm === 0 ? 0 : where / panel.lengthMm;
      for (const spar of panel.spars) {
        if (spar.type === "aileronCutter" || where < spar.spanStartMm - 1e-6 || where > spar.spanEndMm + 1e-6) continue;
        const m = spar.distance.end ? { value: spar.distance.start.value + (spar.distance.end.value - spar.distance.start.value) * t, unit: spar.distance.start.unit } : spar.distance.start;
        const d = m.unit === "pct" ? (m.value / 100) * sec.chordMm : m.value;
        const xc = spar.distanceFrom === "LE" ? d : sec.chordMm - d;
        const half = (spar.type === "round" || spar.type === "roundJoiner" ? (spar.radiusMm ?? 3) : (spar.width?.start ?? 6) / 2);
        for (const entry of entries) {
          const [e0, e1] = edgeSpan(entry, sec.chordMm);
          if (Math.min(e1, xc + half) - Math.max(e0, xc - half) > 0.05) {
            warnings.push({ level: "warn", sparId: spar.id, panelId: panel.id, feature: entry.name, message: `${entry.name} runs into ${spar.name || "a spar"}.` });
          }
        }
      }
    }

    // Hand the tip of this panel to the root of the next.
    baseX += panel.sweepMm;
    baseY += panel.lengthMm * Math.sin(dihedralRad);
    baseZ += panel.lengthMm * Math.cos(dihedralRad);
  }

  // Dedupe identical messages — one warning per cause, not one per rib.
  const seen = new Set<string>();
  const unique = warnings.filter((w) => {
    const k = `${w.level}|${w.panelId}|${w.sparId}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { ribs, webbingParts, solids, warnings: unique, tookMs: performance.now() - started };
}
