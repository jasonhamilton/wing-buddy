/** A spar notch under a sheet is a collision, warned about; a feature switched off is left out of everything. */
import { describe, expect, it } from "vitest";
import { rebuild } from "..";
import { createProject, defaultPanel, defaultSpar } from "../../domain/doc";
import { defaultStrip } from "../sheeting";

function wing() {
  const doc = createProject();
  const p = defaultPanel("P");
  Object.assign(p, { lengthMm: 400, rootChordMm: 200, tipChordMm: 160, sweepMm: 20, dihedralDeg: 0, rootTwistDeg: 0, tipTwistDeg: 0 });
  p.leadingEdge.enabled = false;
  p.trailingEdge.enabled = false;
  const s = defaultSpar(p, "Main spar");
  s.positionTop = true;
  s.positionBottom = false;
  s.distance.start = { value: 15, unit: "pct" }; // inside the default strip, which covers the front 27 %
  p.spars = [s];
  p.sheeting.type = "advanced";
  p.sheeting.strips = [defaultStrip(p, "Top sheet")];
  doc.wing.panels = [p];
  return doc;
}

describe("sheeting collisions and suppressed features", () => {
  it("warns when a spar notch runs into a sheet, and says which", () => {
    const w = rebuild(wing()).warnings.filter((x) => /runs into/.test(x.message));
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].message).toContain("Main spar");
    expect(w[0].message).toContain("Top sheet");
  });
  it("a suppressed sheet or spar is left out, and so is the warning", () => {
    const a = wing();
    a.wing.panels[0].sheeting.strips[0].suppressed = true;
    expect(rebuild(a).warnings.some((x) => /runs into/.test(x.message))).toBe(false);
    const b = wing();
    b.wing.panels[0].spars[0].suppressed = true;
    const r = rebuild(b);
    expect(r.warnings.some((x) => /runs into/.test(x.message))).toBe(false);
    expect(r.solids.some((s) => s.kind === "spar")).toBe(false);
  });
});
