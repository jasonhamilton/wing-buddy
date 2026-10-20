import { beforeEach, describe, expect, it } from "vitest";
import { ops, useStore } from "../store";

function firstPanel() {
  return useStore.getState().doc.wing.panels[0];
}

describe("redistributeRibs", () => {
  beforeEach(() => {
    const p = firstPanel();
    ops.updatePanel(p.id, { ribCountTarget: 6 }, "setup");
  });

  it("keeps ribs before the chosen one and spaces the rest evenly", () => {
    const p = firstPanel();
    const sorted = [...p.ribs].sort((a, b) => a.positionMm - b.positionMm);
    const before = sorted.slice(0, 3).map((r) => r.positionMm);
    ops.redistributeRibs(p.id, sorted[2].id, 20, false);
    const after = [...firstPanel().ribs].sort((a, b) => a.positionMm - b.positionMm);
    expect(after.slice(0, 3).map((r) => r.positionMm)).toEqual(before);
    for (let k = 3; k < after.length; k++) {
      expect(after[k].positionMm - after[k - 1].positionMm).toBeCloseTo(20, 3);
    }
    expect(firstPanel().lengthMm).toBeCloseTo(after[after.length - 1].positionMm, 3);
  });

  it("keep-length lands the last rib on the end with equal gaps after the anchor", () => {
    const p = firstPanel();
    const len = p.lengthMm;
    const sorted = [...p.ribs].sort((a, b) => a.positionMm - b.positionMm);
    ops.redistributeRibs(p.id, sorted[1].id, 5, true);
    const after = [...firstPanel().ribs].sort((a, b) => a.positionMm - b.positionMm);
    expect(firstPanel().lengthMm).toBe(len);
    expect(after[after.length - 1].positionMm).toBeCloseTo(len, 3);
    const gaps = after.slice(2).map((r, i) => r.positionMm - after[i + 1].positionMm);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 3);
  });
});
