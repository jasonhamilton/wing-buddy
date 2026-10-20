import { describe, expect, it } from "vitest";
import {
  formatArea,
  formatInches,
  formatLength,
  fromDisplay,
  lengthDecimals,
  lengthStep,
  mmFromInput,
  parseLength,
  toDisplay,
} from "../units";

describe("conversion", () => {
  it("25.4mm is exactly one inch, both ways", () => {
    expect(toDisplay(25.4, "in")).toBe(1);
    expect(fromDisplay(1, "in")).toBe(25.4);
    expect(toDisplay(230, "mm")).toBe(230);
  });
  it("a value survives mm -> in -> mm to four decimals, for awkward numbers", () => {
    for (const mm of [0.4, 3, 52.5, 230, 419.7, 1555.57, 0.2]) {
      expect(mmFromInput(toDisplay(mm, "in"), "in")).toBeCloseTo(mm, 3);
    }
  });
  it("mmFromInput rounds away float noise: 9in is exactly 228.6, not 228.60000000000002", () => {
    expect(mmFromInput(9, "in")).toBe(228.6);
    expect(mmFromInput(0.1, "in")).toBe(2.54);
  });
  it("decimals: two for mm, three for inches", () => {
    expect(lengthDecimals("mm")).toBe(2);
    expect(lengthDecimals("in")).toBe(3);
  });
  it("formatLength follows the unit: millimetres as asked, inches trimmed", () => {
    expect(formatLength(228.6, "in", 2)).toBe("9in");
    expect(formatLength(228.6, "mm", 1)).toBe("228.6mm");
  });
});

describe("formatInches: up to three decimals, and only the ones that are needed", () => {
  it("a whole inch is written as a whole number", () => {
    expect(formatInches(1)).toBe("1");
    expect(formatInches(9)).toBe("9");
    expect(formatInches(0)).toBe("0");
    expect(formatInches(1.0004)).toBe("1");
  });
  it("1.125 stays 1.125; trailing zeros are dropped, not padded", () => {
    expect(formatInches(1.125)).toBe("1.125");
    expect(formatInches(0.5)).toBe("0.5");
    expect(formatInches(2.1)).toBe("2.1");
    expect(formatInches(1.1)).toBe("1.1");
  });
  it("more than three decimals rounds to three", () => {
    expect(formatInches(1.1254)).toBe("1.125");
    expect(formatInches(1.1256)).toBe("1.126");
    expect(formatInches(9.0551181)).toBe("9.055");
    expect(formatInches(12.3456)).toBe("12.346");
  });
  it("never writes -0, and keeps the sign of a real negative", () => {
    expect(formatInches(-0.0001)).toBe("0");
    expect(formatInches(-1.5)).toBe("-1.5");
  });
  it("a value 230mm long is shown as 9.055, not 9.0551181", () => {
    expect(formatLength(230, "in")).toBe("9.055in");
    expect(formatLength(25.4, "in")).toBe("1in");
    expect(formatLength(28.575, "in")).toBe("1.125in");
  });
});

describe("parseLength: what a person types", () => {
  it("plain numbers are in the display unit", () => {
    expect(parseLength("12.5", "mm")).toBe(12.5);
    expect(parseLength("12.5", "in")).toBe(12.5);
    expect(parseLength("12,5", "mm")).toBe(12.5);
  });
  it("an explicit unit wins over the display unit, in either direction", () => {
    expect(parseLength("25.4mm", "in")).toBeCloseTo(1, 9);
    expect(parseLength("1in", "mm")).toBeCloseTo(25.4, 9);
    expect(parseLength('2"', "mm")).toBeCloseTo(50.8, 9);
    expect(parseLength("3 cm", "mm")).toBeCloseTo(30, 9);
    expect(parseLength("180mm", "mm")).toBe(180);
    expect(parseLength("9 in", "in")).toBe(9);
  });
  it("fractions of an inch, which is how inch dimensions are written", () => {
    expect(parseLength("3/8", "in")).toBeCloseTo(0.375, 9);
    expect(parseLength("1 3/8", "in")).toBeCloseTo(1.375, 9);
    expect(parseLength("1-3/8", "in")).toBeCloseTo(1.375, 9);
    expect(parseLength('1 1/2"', "mm")).toBeCloseTo(38.1, 9);
    expect(parseLength("-1/4", "in")).toBeCloseTo(-0.25, 9);
  });
  it("rubbish is refused rather than guessed at", () => {
    for (const t of ["", "abc", "-", ".", "1/0", "3/", "/4", "1..2", "12 13", "1/2/3"]) expect(parseLength(t, "in")).toBeNull();
  });
});

describe("lengthStep", () => {
  it("keeps millimetre steps as they are", () => {
    expect(lengthStep(5, "mm")).toBe(5);
  });
  it("gives inch steps a person would choose, not 0.19685", () => {
    expect(lengthStep(5, "in")).toBe(0.25);
    expect(lengthStep(1, "in")).toBe(0.05);
    expect(lengthStep(0.5, "in")).toBe(0.025);
    expect(lengthStep(0.05, "in")).toBeGreaterThan(0);
  });
});

describe("formatArea", () => {
  it("square decimetres in metric, square inches in imperial", () => {
    expect(formatArea(33.18, "mm")).toBe("33.18 dm²");
    // 1 dm² = 100 cm² = 15.5 in²
    // inches follow the same rule as lengths: up to three decimals, none that are not needed
    expect(formatArea(1, "in")).toBe("15.5 in²");
    expect(formatArea(33.18, "in")).toBe("514.291 in²");
  });
});
