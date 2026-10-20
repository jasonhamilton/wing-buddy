import { describe, expect, it } from "vitest";
import { BASIC_COLOURS, hexToRgb, hsvToRgb, parseHex, readableOn, rgbToHex, rgbToHsv } from "../colour";

describe("hex", () => {
  it("round-trips through rgb", () => {
    for (const h of ["#000000", "#ffffff", "#4cb84c", "#0072b2", "#e69f00", "#123456"]) expect(rgbToHex(...hexToRgb(h))).toBe(h);
  });
  it("accepts what people type: with or without the hash, any case, three digits or six", () => {
    expect(parseHex("#4CB84C")).toBe("#4cb84c");
    expect(parseHex("4cb84c")).toBe("#4cb84c");
    expect(parseHex("  #abc ")).toBe("#aabbcc");
    expect(parseHex("FA0")).toBe("#ffaa00");
  });
  it("refuses what is not a colour", () => {
    for (const t of ["", "#", "#12", "#12345", "#1234567", "#gggggg", "red", "12 34 56", "#12345g"]) expect(parseHex(t)).toBeNull();
  });
  it("rgbToHex clamps and rounds, never writing an invalid colour", () => {
    expect(rgbToHex(300, -4, 12.6)).toBe("#ff000d");
    expect(rgbToHex(NaN, 0, 0)).toBe("#000000");
  });
});

describe("hsv", () => {
  it("round-trips through rgb for a spread of colours, to within one step of rounding", () => {
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) {
          const [h, s, v] = rgbToHsv(r, g, b);
          const back = hsvToRgb(h, s, v);
          expect(Math.abs(back[0] - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(back[1] - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(back[2] - b)).toBeLessThanOrEqual(1);
        }
  });
  it("knows the primaries", () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
    expect(rgbToHsv(0, 255, 0)[0]).toBeCloseTo(120, 9);
    expect(rgbToHsv(0, 0, 255)[0]).toBeCloseTo(240, 9);
    expect(rgbToHsv(255, 255, 255)).toEqual([0, 0, 1]);
    expect(rgbToHsv(0, 0, 0)).toEqual([0, 0, 0]);
  });
  it("hue wraps: 360 is red again, and negatives come round", () => {
    expect(hsvToRgb(360, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(-120, 1, 1)).toEqual(hsvToRgb(240, 1, 1));
  });
  it("greys have no saturation, whatever the hue says", () => {
    expect(hsvToRgb(200, 0, 0.5)).toEqual([128, 128, 128]);
  });
});

describe("the basic colours and readability", () => {
  it("there are enough basics, each a valid, distinct hex colour", () => {
    expect(BASIC_COLOURS.length).toBeGreaterThanOrEqual(24);
    const hexes = BASIC_COLOURS.map((c) => c.hex);
    expect(hexes.every((h) => parseHex(h) === h)).toBe(true);
    expect(new Set(hexes).size).toBe(hexes.length);
    expect(BASIC_COLOURS.every((c) => c.name.length > 2)).toBe(true);
  });
  it("text drawn on a swatch is black on light colours and white on dark ones", () => {
    expect(readableOn("#ffffff")).toBe("#000000");
    expect(readableOn("#ffff00")).toBe("#000000");
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#1a3a8a")).toBe("#ffffff");
  });
});
