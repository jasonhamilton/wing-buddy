/**
 * The Fix button on the checks. Each fixable problem has a short list of repairs, gentlest first. A repair is
 * kept only if it changes something, and the steps are taken one after another until the check is gone. The
 * answer is checked by building the wing again, so a fix is never claimed that did not work.
 */
import { produce } from "immer";
import { foilName, resolveSurfaces } from "../domain/airfoils";
import { generateRibs, syncAirfoilLinks } from "../domain/doc";
import type { Panel, ProjectDoc } from "../domain/schema";
import { edgeFitHeightMm, rebuild } from "./index";
import type { Fix, Warning } from "./types";

export type FixResult = { doc: ProjectDoc; summary: string };

type Step = { say: string; apply: (p: Panel, doc: ProjectDoc) => boolean };

const DEFAULT_FOIL = "naca-2412";

function sameFix(a: Fix | undefined, b: Fix): boolean {
  return !!a && a.kind === b.kind && (a.kind !== "edgeFit" || (b.kind === "edgeFit" && a.which === b.which));
}

/** Is the problem this warning described still there for that panel? */
const stillThere = (doc: ProjectDoc, w: Warning, fix: Fix): boolean =>
  rebuild(doc).warnings.some((x) => sameFix(x.fix, fix) && x.panelId === w.panelId);

function stepsFor(fix: Fix): Step[] {
  switch (fix.kind) {
    case "airfoil":
      return [
        {
          say: "Replaced the airfoil that could not be loaded",
          apply: (p, d) => {
            const ok = (id: string | null) => !!id && !!resolveSurfaces(id, d.airfoils);
            const fallback = ok(p.rootAirfoilId) ? p.rootAirfoilId : ok(p.tipAirfoilId) ? (p.tipAirfoilId as string) : DEFAULT_FOIL;
            let changed = false;
            if (!ok(p.rootAirfoilId)) {
              p.rootAirfoilId = fallback;
              changed = true;
            }
            if (p.tipAirfoilId && !ok(p.tipAirfoilId)) {
              p.tipAirfoilId = fallback;
              changed = true;
            }
            // A panel linked to the one before follows its tip: the break may be upstream.
            const i = d.wing.panels.indexOf(p);
            for (let k = i - 1; k >= 0 && d.wing.panels[k + 1].airfoilLinkedToPrev; k--) {
              const q = d.wing.panels[k];
              if (!ok(q.rootAirfoilId)) {
                q.rootAirfoilId = DEFAULT_FOIL;
                changed = true;
              }
              if (q.tipAirfoilId && !ok(q.tipAirfoilId)) {
                q.tipAirfoilId = DEFAULT_FOIL;
                changed = true;
              }
            }
            return changed;
          },
        },
      ];
    case "chord":
      return [
        {
          say: "Gave the zero chord the value of the other end",
          apply: (p) => {
            const other = (b: number) => (b > 0 ? b : 100);
            let changed = false;
            if (!(p.rootChordMm > 0)) {
              p.rootChordMm = other(p.tipChordMm);
              changed = true;
            }
            if (!(p.tipChordMm > 0)) {
              p.tipChordMm = other(p.rootChordMm);
              changed = true;
            }
            return changed;
          },
        },
      ];
    case "noRibs":
      return [
        {
          say: "Generated the ribs",
          apply: (p) => {
            p.ribs = generateRibs(p);
            p.ribsManuallyEdited = false;
            return p.ribs.length > 0;
          },
        },
      ];
    case "overlap":
      return [
        {
          say: "Moved overlapping ribs apart, and dropped any that no longer fit on the panel",
          apply: (p) => {
            p.ribs.sort((a, b) => a.positionMm - b.positionMm);
            let changed = false;
            const kept = [p.ribs[0]];
            for (const rib of p.ribs.slice(1)) {
              const prev = kept[kept.length - 1];
              const need = Math.max(rib.thicknessMm, prev.thicknessMm);
              if (rib.positionMm - prev.positionMm < need) {
                changed = true;
                rib.positionMm = Number((prev.positionMm + need).toFixed(3));
              }
              if (rib.positionMm > p.lengthMm + 1e-9) continue; // off the end: dropped
              kept.push(rib);
            }
            if (kept.length !== p.ribs.length) changed = true;
            p.ribs = kept;
            return changed;
          },
        },
      ];
    case "edgeFit":
      return [
        {
          say: `Raised the ${fix.which === "leadingEdge" ? "leading" : "trailing"} edge stock to cover the airfoil`,
          apply: (p, d) => {
            const raw = edgeFitHeightMm(d, p.id, fix.which);
            if (raw === null) return false;
            const height = Math.ceil((raw + 1) * 2) / 2;
            if (height <= p[fix.which].heightMm) return false;
            p[fix.which].heightMm = height;
            return true;
          },
        },
      ];
    case "emptyRib": {
      const edgeCap = (p: Panel) => Math.min(p.rootChordMm, p.tipChordMm) * 0.25;
      return [
        {
          say: "Turned the half ribs back into whole ribs",
          apply: (p) => {
            const had = p.ribs.some((r) => r.half);
            for (const r of p.ribs) r.half = null;
            return had;
          },
        },
        {
          say: "Switched off the lightening holes",
          apply: (p) => {
            if (p.lighteningHoles.type === "none") return false;
            p.lighteningHoles.type = "none";
            return true;
          },
        },
        {
          say: "Made the comb slots shallower",
          apply: (p) => {
            let changed = false;
            for (const c of p.ribCombs) {
              if (c.cutIntoRibPct > 40 || c.needleAdjustmentMm > 0) {
                c.cutIntoRibPct = Math.min(c.cutIntoRibPct, 40);
                c.needleAdjustmentMm = 0;
                changed = true;
              }
            }
            return changed;
          },
        },
        {
          say: "Cut the edge stock back to a quarter of the chord at most",
          apply: (p) => {
            let changed = false;
            for (const e of [p.leadingEdge, p.trailingEdge, ...(p.extraEdges ?? [])]) {
              if (e.enabled && e.widthMm > edgeCap(p)) {
                e.widthMm = Number(edgeCap(p).toFixed(1));
                changed = true;
              }
            }
            return changed;
          },
        },
        {
          say: "Thinned the sheeting to 1.5mm",
          apply: (p) => {
            let changed = false;
            const cap = 1.5;
            if (p.sheeting.standardThicknessMm !== null && p.sheeting.standardThicknessMm > cap) {
              p.sheeting.standardThicknessMm = cap;
              changed = true;
            }
            for (const s of p.sheeting.strips) {
              if (s.thicknessMm > cap) {
                s.thicknessMm = cap;
                changed = true;
              }
            }
            return changed;
          },
        },
        {
          say: "Switched off the sheeting",
          apply: (p) => {
            if (p.sheeting.type === "none") return false;
            p.sheeting.type = "none";
            return true;
          },
        },
        {
          say: "Switched off the edge stock",
          apply: (p) => {
            let changed = false;
            for (const e of [p.leadingEdge, p.trailingEdge]) {
              if (e.enabled) {
                e.enabled = false;
                changed = true;
              }
            }
            return changed;
          },
        },
      ];
    }
  }
}

/**
 * Try to put a check right. Returns the repaired project and a sentence about what was done, or null when the
 * check has no fix or none of the repairs cleared it (the project is then left as it was).
 */
export function fixWarning(doc: ProjectDoc, w: Warning): FixResult | null {
  const fix = w.fix;
  if (!fix || !w.panelId) return null;
  if (!doc.wing.panels.some((p) => p.id === w.panelId)) return null;

  let working = doc;
  const said: string[] = [];
  for (const step of stepsFor(fix)) {
    let changed = false;
    working = produce(working, (d) => {
      const p = d.wing.panels.find((x) => x.id === w.panelId);
      if (p) changed = step.apply(p as Panel, d as ProjectDoc);
      if (changed) syncAirfoilLinks(d as ProjectDoc);
    });
    if (!changed) continue;
    said.push(step.say);
    if (!stillThere(working, w, fix)) {
      const panel = working.wing.panels.find((p) => p.id === w.panelId)!;
      const extra = fix.kind === "airfoil" ? ` (now ${foilName(panel.rootAirfoilId, working.airfoils)})` : "";
      return { doc: working, summary: `${said.join(". ")}${extra}.` };
    }
  }
  return null;
}
