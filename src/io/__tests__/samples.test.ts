import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadSamples } from "../samples";

const local = async (url: string) => {
  try {
    const text = await readFile(`public/${url}`, "utf8");
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, text: async () => "", json: async () => ({}) };
  }
};

describe("sample plans", () => {
  it("every plan in the index loads, with a short name, a span and an area", async () => {
    const plans = await loadSamples(local);
    expect(plans.map((p) => p.name)).toEqual(["Allegro-Lite 2m", "Aquila", "Bird of Time", "Bubble Dancer", "Gentle Lady", "Olympic II"]);
    for (const p of plans) {
      expect(p.doc.name).toBe(p.name);
      expect(p.spanMm).toBeGreaterThan(1500);
      expect(p.areaDm2).toBeGreaterThan(20);
    }
  });
  it("one that cannot be read is left out; a missing index is an error", async () => {
    const some = async (u: string) =>
      u.endsWith("index.json")
        ? { ok: true, text: async () => "", json: async () => ({ plans: [{ name: "A", file: "aquila.wingbuddy.json" }, { name: "B", file: "nope.json" }] }) }
        : local(u);
    expect((await loadSamples(some)).map((p) => p.name)).toEqual(["A"]);
    await expect(loadSamples(async () => ({ ok: false, text: async () => "", json: async () => ({}) }))).rejects.toThrow();
  });
});
