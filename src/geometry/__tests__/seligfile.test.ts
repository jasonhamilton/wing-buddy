import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAirfoilFile } from "../airfoil";

describe("the sample Selig file in the project folder", () => {
  it("parses", () => {
    const r = parseAirfoilFile(readFileSync("seligdatfile.dat", "utf8"));
    expect(r.name).toBe("RG 14 AIRFOIL");
    expect(r.points.length).toBeGreaterThan(30);
  });
});
