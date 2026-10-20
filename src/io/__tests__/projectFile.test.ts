import { describe, expect, it } from "vitest";
import { createProject } from "../../domain/doc";
import { seedProject } from "../../domain/seed";
import { deserialise, serialise } from "../../io/projectFile";

describe("project file round trip", () => {
  it("a new project validates against its own schema", () => {
    const doc = createProject();
    expect(() => deserialise(serialise(doc))).not.toThrow();
  });
  it("the seed project validates against its own schema", () => {
    expect(() => deserialise(serialise(seedProject()))).not.toThrow();
  });
});

describe("project file validation still refuses real problems", () => {
  it("rejects a file that is not JSON", () => {
    expect(() => deserialise("{ nope")).toThrow(/not valid JSON/);
  });

  it("rejects JSON that is not a project", () => {
    expect(() => deserialise(JSON.stringify({ hello: "world" }))).toThrow(/does not match/);
  });

  it("rejects an impossible panel length", () => {
    const d = JSON.parse(serialise(createProject()));
    d.wing.panels[0].lengthMm = -1;
    expect(() => deserialise(JSON.stringify(d))).toThrow(/lengthMm/);
  });

  it("rejects an unknown spar type", () => {
    const d = JSON.parse(serialise(seedProject()));
    d.wing.panels[0].spars[0].type = "banana";
    expect(() => deserialise(JSON.stringify(d))).toThrow(/type/);
  });

  it("rejects a future schema version", () => {
    const d = JSON.parse(serialise(createProject()));
    d.schemaVersion = 99;
    expect(() => deserialise(JSON.stringify(d))).toThrow(/schemaVersion/);
  });

  it("round trips every value it was given", () => {
    const doc = seedProject();
    const back = deserialise(serialise(doc));
    expect(back).toEqual(doc);
  });

  it("round trips an embedded imported airfoil", () => {
    const doc = createProject();
    doc.airfoils.push({
      id: "imported-1",
      name: "MH 32",
      origin: "embedded",
      source: "dat",
      points: Array.from({ length: 24 }, (_, i) => [i / 23, Math.sin(i) * 0.05] as [number, number]),
      controlPoints: null,
      createdAt: new Date().toISOString(),
    });
    doc.wing.panels[0].rootAirfoilId = "imported-1";
    const back = deserialise(serialise(doc));
    expect(back.airfoils[0].points).toHaveLength(24);
    expect(back.wing.panels[0].rootAirfoilId).toBe("imported-1");
  });
});
