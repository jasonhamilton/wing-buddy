import { describe, expect, it } from "vitest";
import { defaultPanel } from "../../domain/doc";
import { applyRibLayout } from "../../domain/ribLayout";
import { RibLayout, type Panel } from "../../domain/schema";
import { calculatedPositions, distributeRibs } from "../ribDistribution";

const base = { lengthMm: 900, rootChordMm: 250, tipChordMm: 150, ribCount: 16 };
const gaps = (p: number[]) => p.slice(1).map((v, i) => v - p[i]);
const panel = (patch: Partial<Panel> = {}): Panel => ({ ...defaultPanel("P"), lengthMm: 900, rootChordMm: 250, tipChordMm: 150, ...patch });
const layout = (patch: Partial<RibLayout> = {}): RibLayout => ({ distribution: "linear", bias: 0, chordProportionality: 0, vary: { thickness: false, half: false }, ...patch });

describe("calculated rib distribution", () => {
  it("bias 0 and proportionality 0 is even, on a tapered panel too", () => {
    const p = distributeRibs(base);
    expect(p).toHaveLength(16);
    expect(p[0]).toBe(0);
    expect(p[15]).toBe(900);
    for (const g of gaps(p)) expect(g).toBeCloseTo(60, 3);
  });

  it("the last rib sits a rib thickness short of the end (0, 99.5 ... 597 for 600 mm, 3 mm, 7 ribs)", () => {
    const p = distributeRibs({ lengthMm: 600, rootChordMm: 200, tipChordMm: 120, ribCount: 7, thicknessMm: 3 });
    expect(p).toEqual([0, 99.5, 199, 298.5, 398, 497.5, 597]);
  });

  it("a rib at each end, ascending, whatever the settings", () => {
    for (const bias of [-3, -1.5, 0, 2, 3]) {
      for (const chordProportionality of [-2, -1, 0, 0.5, 1, 1.7, 2]) {
        const p = distributeRibs({ ...base, ribCount: 9, bias, chordProportionality });
        expect(p[0]).toBe(0);
        expect(p[8]).toBe(900);
        expect(p).toEqual([...p].sort((a, b) => a - b));
        expect(new Set(p).size).toBe(9);
      }
    }
  });

  it("positive bias crowds the ribs toward the root, negative toward the tip", () => {
    const pos = gaps(distributeRibs({ ...base, bias: 2 }));
    expect(pos[0]).toBeLessThan(pos[pos.length - 1]);
    const neg = gaps(distributeRibs({ ...base, bias: -2 }));
    expect(neg[0]).toBeGreaterThan(neg[neg.length - 1]);
  });

  it("chord proportionality 1 spaces ribs in proportion to the chord: closer where it is narrow", () => {
    const p = distributeRibs({ ...base, chordProportionality: 1 });
    const g = gaps(p);
    expect(g[0]).toBeGreaterThan(g[g.length - 1]);
    // each gap over the chord at its middle is the same
    const chordAt = (y: number) => 250 + (150 - 250) * (y / 900);
    const k = g.map((gap, i) => gap / chordAt((p[i] + p[i + 1]) / 2));
    for (const v of k) expect(v / k[0]).toBeGreaterThan(0.97), expect(v / k[0]).toBeLessThan(1.03);
  });

  it("more proportionality is a stronger effect", () => {
    const spread = (a: number) => {
      const g = gaps(distributeRibs({ ...base, chordProportionality: a }));
      return g[0] / g[g.length - 1];
    };
    expect(spread(2)).toBeGreaterThan(spread(1));
    expect(spread(1)).toBeGreaterThan(spread(0.5));
  });

  it("negative proportionality does the opposite: further apart where the chord is narrow, down to -2", () => {
    const neg = gaps(distributeRibs({ ...base, chordProportionality: -1 }));
    expect(neg[0]).toBeLessThan(neg[neg.length - 1]);
    const more = gaps(distributeRibs({ ...base, chordProportionality: -2 }));
    expect(more[more.length - 1] / more[0]).toBeGreaterThan(neg[neg.length - 1] / neg[0]);
    // below -2 is held at -2
    expect(distributeRibs({ ...base, chordProportionality: -5 })).toEqual(distributeRibs({ ...base, chordProportionality: -2 }));
  });

  it("a rectangular panel has no chord to follow, so only the bias acts", () => {
    const rect = { ...base, tipChordMm: 250 };
    for (const g of gaps(distributeRibs({ ...rect, chordProportionality: 2 }))) expect(g).toBeCloseTo(60, 3);
    const biased = gaps(distributeRibs({ ...rect, chordProportionality: 2, bias: 1 }));
    expect(biased[0]).toBeLessThan(biased[biased.length - 1]);
  });

  it("anything unusable gives an even layout, never an error", () => {
    const p = distributeRibs({ lengthMm: 300, rootChordMm: 0, tipChordMm: 100, ribCount: 4, bias: Number.NaN, chordProportionality: 1 });
    expect(p).toEqual([0, 100, 200, 300]);
  });
});

describe("applying a layout to a panel", () => {
  it("a worked-out layout follows the panel: change its length and the ribs move, keeping their ids", () => {
    const p = panel({ ribCountTarget: 5 });
    p.ribs = [];
    applyRibLayout(p);
    const ids = p.ribs.map((r) => r.id);
    p.lengthMm = 400;
    applyRibLayout(p);
    expect(p.ribs.map((r) => r.id)).toEqual(ids);
    expect(p.ribs[4].positionMm).toBe(400 - p.ribThicknessMm); // the last rib's far face is the panel's end
  });

  it("the distribution decides which number acts: exponential the bias, chord proportional the proportionality, linear neither", () => {
    const at = (distribution: RibLayout["distribution"]) => {
      const p = panel({ ribCountTarget: 10, ribLayout: layout({ distribution, bias: 2, chordProportionality: 1 }) });
      return calculatedPositions(p);
    };
    const t = panel().ribThicknessMm;
    const linear = at("linear");
    for (const g of gaps(linear)) expect(g).toBeCloseTo((900 - t) / 9, 3);
    expect(at("exponential")).toEqual(distributeRibs({ ...base, ribCount: 10, bias: 2, thicknessMm: t }));
    expect(at("chord")).toEqual(distributeRibs({ ...base, ribCount: 10, chordProportionality: 1, thicknessMm: t }));
    const p = panel({ ribCountTarget: 10, ribLayout: layout({ distribution: "exponential", bias: 2 }) });
    p.ribs = [];
    applyRibLayout(p);
    expect(p.ribs.map((r) => r.positionMm)).toEqual(calculatedPositions(p));
  });

  it("custom keeps the positions the user set", () => {
    const p = panel({ ribCountTarget: 4 });
    p.ribs = [];
    applyRibLayout(p);
    p.ribLayout = layout({ distribution: "custom" });
    p.ribs[1].positionMm = 123;
    applyRibLayout(p);
    expect(p.ribs[1].positionMm).toBe(123);
    p.lengthMm = 500; // and the panel changing does not move them
    applyRibLayout(p);
    expect(p.ribs[1].positionMm).toBe(123);
  });

  it("thickness and half ribs are the panel's unless the user takes them, whatever the distribution", () => {
    const p = panel({ ribCountTarget: 4, ribThicknessMm: 2 });
    p.ribs = [];
    applyRibLayout(p);
    p.ribs[1].thicknessMm = 5;
    p.ribs[1].half = "front";
    applyRibLayout(p);
    expect(p.ribs[1].thicknessMm).toBe(2);
    expect(p.ribs[1].half).toBeNull();
    p.ribLayout = layout({ vary: { thickness: true, half: true } });
    p.ribs[1].thicknessMm = 5;
    p.ribs[1].half = "front";
    applyRibLayout(p);
    expect(p.ribs[1].thicknessMm).toBe(5);
    expect(p.ribs[1].half).toBe("front");
    expect(p.ribs[2].positionMm).toBeCloseTo(((900 - 2) * 2) / 3, 3); // still linear: the positions are not theirs
  });

  it("an older panel whose ribs were edited by hand becomes custom, so nothing is respaced", () => {
    const p = panel({ ribCountTarget: 4 });
    p.ribs = [];
    applyRibLayout(p);
    p.ribs[2].positionMm = 301;
    p.ribsManuallyEdited = true;
    applyRibLayout(p);
    expect(p.ribLayout?.distribution).toBe("custom");
    expect(p.ribs[2].positionMm).toBe(301);
  });
});

describe("saved layouts", () => {
  it("files saved with the earlier modes read as the distribution they meant, and the numbers are held to their ranges", () => {
    expect(RibLayout.parse({ mode: "even" }).distribution).toBe("linear");
    expect(RibLayout.parse({ mode: "calculated" }).distribution).toBe("linear");
    expect(RibLayout.parse({ mode: "calculated", bias: 1.5 }).distribution).toBe("exponential");
    expect(RibLayout.parse({ mode: "calculated", chordProportionality: 1 }).distribution).toBe("chord");
    expect(RibLayout.parse({ mode: "custom", vary: { position: true, thickness: true, half: false } })).toMatchObject({ distribution: "custom", vary: { thickness: true, half: false } });
    expect(() => RibLayout.parse({ distribution: "exponential", bias: 4 })).toThrow();
    expect(() => RibLayout.parse({ distribution: "chord", chordProportionality: 2.5 })).toThrow();
    expect(() => RibLayout.parse({ distribution: "chord", chordProportionality: -2.5 })).toThrow();
    expect(RibLayout.parse({ distribution: "chord", chordProportionality: -2 })).toMatchObject({ chordProportionality: -2 });
    expect(RibLayout.parse({ distribution: "linear" })).toMatchObject({ bias: 0, chordProportionality: 0 });
  });
});
