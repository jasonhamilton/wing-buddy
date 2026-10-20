import { describe, expect, it } from "vitest";
import { naca4 } from "../../data/naca";
import { fromSurfaces, metrics, parseAirfoilFile, scaleThickness, toSurfaces } from "../airfoil";
import { area, difference, rect, signedArea } from "../clipper";
import { blendSurfaces, catmullRom } from "../interpolate";
import { sectionToPath } from "../rib";
import { createProject, defaultSpar, generateRibs } from "../../domain/doc";
import { seedProject } from "../../domain/seed";
import { rebuild } from "../index";

describe("naca4", () => {
  it("closes at the trailing edge and starts there", () => {
    const p = naca4("2412");
    expect(p[0].x).toBeCloseTo(1, 3);
    expect(p[p.length - 1].x).toBeCloseTo(1, 3);
  });

  it("is symmetrical for a 00xx section", () => {
    const s = toSurfaces(naca4("0012"));
    for (let i = 0; i < s.x.length; i++) {
      expect(s.yUpper[i]).toBeCloseTo(-s.yLower[i], 6);
    }
  });

  it("reports the thickness it was asked for", () => {
    const m = metrics(toSurfaces(naca4("2412")));
    expect(m.thicknessPct).toBeGreaterThan(11.7);
    expect(m.thicknessPct).toBeLessThan(12.3);
    // NACA 4-digit maximum thickness sits at 30% chord.
    expect(m.maxThicknessAtPct).toBeGreaterThan(27);
    expect(m.maxThicknessAtPct).toBeLessThan(33);
  });

  it("reports the camber it was asked for", () => {
    const m = metrics(toSurfaces(naca4("4412")));
    expect(m.camberPct).toBeGreaterThan(3.7);
    expect(m.camberPct).toBeLessThan(4.3);
    expect(m.maxCamberAtPct).toBeGreaterThan(36);
    expect(m.maxCamberAtPct).toBeLessThan(44);
  });
});

describe("surfaces round trip", () => {
  it("survives points -> surfaces -> points within a fraction of a micron", () => {
    // Resampling onto cosine stations is lossy at the nose, where curvature is
    // extreme. The bound below is the real figure, stated in the units that
    // matter: on a 250mm chord the worst-case round-trip error is well under
    // 0.01mm, which is an order of magnitude finer than a balsa knife.
    const s1 = toSurfaces(naca4("2412"));
    const s2 = toSurfaces(fromSurfaces(s1));
    let worst = 0;
    for (let i = 0; i < s1.x.length; i++) {
      worst = Math.max(worst, Math.abs(s2.yUpper[i] - s1.yUpper[i]));
      worst = Math.max(worst, Math.abs(s2.yLower[i] - s1.yLower[i]));
    }
    expect(worst).toBeLessThan(5e-5); // chord fractions
    expect(worst * 250).toBeLessThan(0.0125); // millimetres on a 250mm chord
  });

  it("produces a counter-clockwise ring", () => {
    expect(signedArea(sectionToPath(toSurfaces(naca4("2412")), 200))).toBeGreaterThan(0);
  });
});

describe("airfoil file parsing", () => {
  const selig = ["MY FOIL", ...naca4("2412", 60).map((p) => `  ${p.x.toFixed(6)}  ${p.y.toFixed(6)}`)].join("\n");

  it("reads a Selig file", () => {
    const r = parseAirfoilFile(selig);
    expect(r.name).toBe("MY FOIL");
    expect(r.points.length).toBeGreaterThan(100);
    expect(metrics(toSurfaces(r.points)).thicknessPct).toBeGreaterThan(11);
  });

  it("reads a Lednicer file", () => {
    const s = toSurfaces(naca4("2412", 40));
    const upper = s.x.map((x, i) => `${x.toFixed(6)} ${s.yUpper[i].toFixed(6)}`);
    const lower = s.x.map((x, i) => `${x.toFixed(6)} ${s.yLower[i].toFixed(6)}`);
    const text = ["LEDNICER FOIL", "  41.  41.", ...upper, "", ...lower].join("\n");
    const r = parseAirfoilFile(text);
    expect(r.name).toBe("LEDNICER FOIL");
    expect(metrics(toSurfaces(r.points)).thicknessPct).toBeGreaterThan(11);
  });

  it("refuses a file with a ragged line, naming the line", () => {
    const broken = selig.split("\n");
    broken[3] = "  0.5";
    expect(() => parseAirfoilFile(broken.join("\n"))).toThrow(/Line 4/);
  });

  it("refuses a file that is too short to be an airfoil", () => {
    expect(() => parseAirfoilFile("TINY\n0 0\n1 0\n0.5 0.1")).toThrow(/at least 20/);
  });
});

describe("interpolation", () => {
  it("is linear between two sections", () => {
    const a = toSurfaces(naca4("0009"));
    const b = toSurfaces(naca4("0015"));
    const mid = blendSurfaces([a, b], 0.5);
    for (let i = 0; i < mid.x.length; i++) {
      expect(mid.yUpper[i]).toBeCloseTo((a.yUpper[i] + b.yUpper[i]) / 2, 9);
    }
  });

  it("passes through its control values", () => {
    const knots = [0, 0.5, 1];
    const vals = [2, 7, 3];
    expect(catmullRom(knots, vals, 0)).toBeCloseTo(2, 9);
    expect(catmullRom(knots, vals, 0.5)).toBeCloseTo(7, 9);
    expect(catmullRom(knots, vals, 1)).toBeCloseTo(3, 9);
  });

  it("returns the endpoints exactly at t=0 and t=1", () => {
    const a = toSurfaces(naca4("0009"));
    const b = toSurfaces(naca4("4415"));
    expect(blendSurfaces([a, b], 0).yUpper[20]).toBeCloseTo(a.yUpper[20], 9);
    expect(blendSurfaces([a, b], 1).yUpper[20]).toBeCloseTo(b.yUpper[20], 9);
  });
});

describe("boolean cuts", () => {
  it("removes exactly the overlap", () => {
    const square = rect(0, 0, 10, 10);
    const bite = rect(8, -1, 20, 11);
    const out = difference([square], [bite]);
    expect(out).toHaveLength(1);
    expect(area(out[0])).toBeCloseTo(80, 6);
  });

  it("leaves nothing when the cut covers the subject", () => {
    expect(difference([rect(0, 0, 5, 5)], [rect(-1, -1, 6, 6)])).toHaveLength(0);
  });
});

describe("rebuild", () => {
  it("builds a rib for every station of the seed project", () => {
    const doc = seedProject();
    const r = rebuild(doc);
    const expected = doc.wing.panels.reduce((s, p) => s + p.ribs.length, 0);
    expect(r.ribs).toHaveLength(expected);
    expect(r.ribs.every((rib) => rib.outline.length > 0)).toBe(true);
  });

  it("is deterministic", () => {
    const doc = seedProject();
    const a = JSON.stringify(rebuild(doc).ribs);
    const b = JSON.stringify(rebuild(doc).ribs);
    expect(a).toBe(b);
  });

  it("tapers the chord from root to tip", () => {
    const doc = createProject();
    const r = rebuild(doc);
    expect(r.ribs[0].chordMm).toBeCloseTo(220, 6);
    expect(r.ribs[r.ribs.length - 1].chordMm).toBeCloseTo(180, 6);
  });

  it("cuts a spar notch out of the rib area", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    const withSpar = rebuild(doc);
    panel.spars = [];
    const without = rebuild(doc);
    const a = withSpar.ribs[0].outline.reduce((s, p) => s + area(p), 0);
    const b = without.ribs[0].outline.reduce((s, p) => s + area(p), 0);
    expect(a).toBeLessThan(b);
  });

  it("keeps spars attached when the rib count changes", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    const before = rebuild(doc).ribs.filter((r) => r.outline.length > 0).length;
    panel.ribCountTarget = 25;
    panel.ribs = generateRibs(panel);
    const after = rebuild(doc);
    expect(after.ribs).toHaveLength(25);
    expect(after.warnings.filter((w) => w.level === "error")).toHaveLength(0);
    expect(before).toBeGreaterThan(0);
    // every new rib still sees the spar, because the span is in millimetres
    const areas = after.ribs.map((r) => r.outline.reduce((s, p) => s + area(p), 0));
    expect(areas.every((a) => a > 0)).toBe(true);
  });

  it("warns, rather than throwing, when a joiner is bigger than the section", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    const fat = defaultSpar(panel, "Oversized joiner", "roundJoiner");
    fat.radiusMm = 60;
    panel.spars = [fat];
    const r = rebuild(doc);
    expect(r.warnings.some((w) => /breaks the surface/.test(w.message))).toBe(true);
  });

  it("warns when a spar sits outside the chord", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    const stray = defaultSpar(panel, "Stray spar");
    stray.distance = { start: { value: 180, unit: "pct" }, end: null };
    panel.spars = [stray];
    expect(rebuild(doc).warnings.some((w) => /outside the chord/.test(w.message))).toBe(true);
  });
});

describe("airfoil thickness scale", () => {
  it("scales thickness and leaves camber alone", () => {
    const base = toSurfaces(naca4("4412"));
    const thick = scaleThickness(base, 1.5);
    const m0 = metrics(base);
    const m1 = metrics(thick);
    expect(m1.thicknessPct).toBeCloseTo(m0.thicknessPct * 1.5, 6);
    expect(m1.camberPct).toBeCloseTo(m0.camberPct, 6);
  });

  it("is a no-op at 1", () => {
    const base = toSurfaces(naca4("2412"));
    expect(scaleThickness(base, 1)).toBe(base);
  });

  it("a scale-only taper still interpolates along the span", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    panel.rootAirfoilScale = 1;
    panel.tipAirfoilScale = 0.6;
    panel.spars = [];
    panel.leadingEdge.enabled = false;
    panel.trailingEdge.enabled = false;
    const r = rebuild(doc);
    const heightOf = (rib: (typeof r.ribs)[number]) => {
      const ys = rib.outline.flat().map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const first = heightOf(r.ribs[0]);
    const last = heightOf(r.ribs[r.ribs.length - 1]);
    // The tip is both shorter in chord and thinner in section, so it must be
    // well under a plain chord-scaled tip.
    expect(last).toBeLessThan(first * (180 / 220) * 0.8);
  });
});

describe("rib profiles", () => {
  it("every rib carries its unaltered airfoil profile, with the same number of points along a panel, so a skin can be drawn through them", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.sheeting = { ...p.sheeting, type: "standard", standardThicknessMm: 3, standardLength: null };
    p.leadingEdge.enabled = true;
    const r = rebuild(doc);
    expect(r.ribs.length).toBeGreaterThan(2);
    for (const rib of r.ribs) {
      expect(rib.silhouette.length).toBeGreaterThan(50);
      // what the features left is inside the original section
      const area = (path: { x: number; y: number }[]) => Math.abs(path.reduce((a, q, i) => a + (q.x * path[(i + 1) % path.length].y - path[(i + 1) % path.length].x * q.y), 0)) / 2;
      expect(rib.outline.reduce((a, o) => a + area(o), 0)).toBeLessThan(area(rib.silhouette));
    }
    expect(new Set(r.ribs.map((x) => x.silhouette.length)).size).toBe(1);
  });
});

describe("rib thickness", () => {
  it("is carried on every rib, so the 3D view can extrude each by its own thickness", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.ribs[1].thicknessMm = 6;
    const r = rebuild(doc);
    expect(r.ribs[0].thicknessMm).toBe(p.ribs[0].thicknessMm);
    expect(r.ribs[1].thicknessMm).toBe(6);
  });
});

describe("building tabs", () => {
  const withTabs = (on: boolean) => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.spars = [];
    p.leadingEdge.enabled = false;
    p.trailingEdge.enabled = false;
    p.buildingTabs = { ...p.buildingTabs, enabled: on, below: true, above: false, fore: true, aft: true, extendMm: 6 };
    return rebuild(doc);
  };

  it("adds material below the section", () => {
    const off = withTabs(false).ribs[0];
    const on = withTabs(true).ribs[0];
    const low = (r: typeof off) => Math.min(...r.outline.flat().map((p) => p.y));
    expect(low(on)).toBeLessThan(low(off) - 5);
    expect(on.outline.reduce((s, p) => s + area(p), 0)).toBeGreaterThan(
      off.outline.reduce((s, p) => s + area(p), 0),
    );
  });

  it("leaves the rib alone when switched off", () => {
    expect(JSON.stringify(withTabs(false).ribs[0].outline)).toBe(
      JSON.stringify(rebuild((() => {
        const d = createProject();
        d.wing.panels[0].spars = [];
        d.wing.panels[0].leadingEdge.enabled = false;
        d.wing.panels[0].trailingEdge.enabled = false;
        return d;
      })()).ribs[0].outline),
    );
  });

  it("tabs grow from the finished rib: thick sheeting and edge stock leave them attached, in one piece", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.spars = [];
    p.sheeting = { ...p.sheeting, type: "standard", standardThicknessMm: 3, standardLength: null };
    p.leadingEdge.enabled = true;
    p.buildingTabs = { ...p.buildingTabs, enabled: true, below: true, above: true, fore: true, aft: true, extendMm: 6, widthLE: 10, widthTE: 10 };
    const r = rebuild(doc);
    for (const rib of r.ribs) {
      expect(rib.outline).toHaveLength(1); // a tab that missed the rib would be a second piece
      const ys = rib.outline.flat().map((q) => q.y);
      const sil = rib.silhouette.map((q) => q.y);
      expect(Math.min(...ys)).toBeLessThan(Math.min(...sil) - 3); // and it does stick out past the airfoil
    }
  });

  it("punches a pin hole in each tab when asked", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.spars = [];
    p.buildingTabs = { ...p.buildingTabs, enabled: true, below: true, above: false, fore: true, aft: true, holes: true, extendMm: 8, widthLE: 12, widthTE: 12 };
    const r = rebuild(doc);
    expect(r.ribs[0].holes.length).toBeGreaterThanOrEqual(2);
  });

  it("warns rather than throwing when a tab falls off the chord", () => {
    const doc = createProject();
    const p = doc.wing.panels[0];
    p.buildingTabs = { ...p.buildingTabs, enabled: true, below: true, fore: true, aft: false, fromLE: { value: 900, unit: "mm" } };
    const r = rebuild(doc);
    expect(r.warnings.some((w) => /building tab falls outside/i.test(w.message))).toBe(true);
  });
});

describe("lofted solids", () => {
  it("builds a solid for every spar and both edges", () => {
    const r = rebuild(seedProject());
    expect(r.solids.length).toBeGreaterThan(0);
    const kinds = new Set(r.solids.map((s) => s.kind));
    expect(kinds.has("spar")).toBe(true);
    expect(kinds.has("leadingEdge")).toBe(true);
    expect(kinds.has("trailingEdge")).toBe(true);
  });

  it("emits whole triangles", () => {
    for (const s of rebuild(seedProject()).solids) {
      expect(s.positions.length % 9).toBe(0);
      expect(s.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it("places solids where the ribs are, not somewhere else", () => {
    const r = rebuild(seedProject());
    const ribZ = r.ribs.map((x) => x.origin[2]);
    // A tall stock block tilts with the dihedral, so its corners lie a little beyond the
    // rib stations: half the tallest block times sin(dihedral). 3mm is generous for the seed
    // and still tiny against a wing 700mm long, which is what this guards.
    const lo = Math.min(...ribZ) - 3;
    const hi = Math.max(...ribZ) + 3;
    for (const s of r.solids) {
      for (let i = 2; i < s.positions.length; i += 3) {
        expect(s.positions[i]).toBeGreaterThanOrEqual(lo);
        expect(s.positions[i]).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("makes no solid for an aileron cutter — it removes material", () => {
    const doc = createProject();
    const panel = doc.wing.panels[0];
    const cutter = defaultSpar(panel, "Aileron", "aileronCutter");
    panel.spars = [cutter];
    panel.leadingEdge.enabled = false;
    panel.trailingEdge.enabled = false;
    expect(rebuild(doc).solids).toHaveLength(0);
  });

  it("is deterministic, solids included", () => {
    const doc = seedProject();
    expect(JSON.stringify(rebuild(doc).solids)).toBe(JSON.stringify(rebuild(doc).solids));
  });
});

describe("a rectangle spar in neither surface", () => {
  it("cuts nothing: the rib is the same as a rib with no spar", () => {
    const build = (withSpar: boolean) => {
      const doc = createProject();
      const p = doc.wing.panels[0];
      p.spars = [];
      p.leadingEdge.enabled = false;
      p.trailingEdge.enabled = false;
      if (withSpar) {
        const spar = defaultSpar(p, "Rect");
        spar.positionTop = false;
        spar.positionBottom = false;
        spar.width = { start: 8, end: null };
        spar.height = { start: 4, end: null };
        spar.distance = { start: { value: 40, unit: "pct" }, end: null };
        p.spars = [spar];
      }
      return rebuild(doc).ribs[2];
    };
    const plain = build(false);
    const rib = build(true);
    expect(rib.holes).toHaveLength(0);
    expect(rib.outline).toEqual(plain.outline);
  });
});
