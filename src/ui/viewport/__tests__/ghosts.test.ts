import { describe, expect, it } from "vitest";
import { ghostedPanels, ghostOpacity } from "../ghosts";

describe("ghostedPanels: every panel except the selected one, when ghosting is on", () => {
  const ids = ["a", "b", "c"];
  it("ghosts the others and keeps the selected panel solid", () => {
    expect([...ghostedPanels(ids, "b", true)].sort()).toEqual(["a", "c"]);
  });
  it("ghosts nothing when the option is off", () => {
    expect(ghostedPanels(ids, "b", false).size).toBe(0);
  });
  it("ghosts nothing when no panel is selected, or the selection is not in the wing", () => {
    expect(ghostedPanels(ids, null, true).size).toBe(0);
    expect(ghostedPanels(ids, "zzz", true).size).toBe(0);
  });
  it("a single panel has nothing to ghost", () => {
    expect(ghostedPanels(["a"], "a", true).size).toBe(0);
  });
  it("an empty wing is fine", () => {
    expect(ghostedPanels([], "a", true).size).toBe(0);
  });
});

describe("ghostOpacity: the slider is transparency, so 0 is solid and 1 is nearly gone", () => {
  it("is the complement of transparency", () => {
    expect(ghostOpacity(0.7)).toBeCloseTo(0.3, 12);
    expect(ghostOpacity(0)).toBe(1);
  });
  it("never reaches zero, so a ghost can always be found", () => {
    expect(ghostOpacity(1)).toBeGreaterThan(0);
    expect(ghostOpacity(5)).toBeGreaterThan(0);
  });
  it("never goes above fully solid", () => {
    expect(ghostOpacity(-1)).toBe(1);
  });
});
