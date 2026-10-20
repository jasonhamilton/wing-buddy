import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { seedProject } from "../../domain/seed";
import { rebuild } from "../../geometry";
import { DXF_DEFAULTS, buildDxf, trimTrailingEdge, type DxfOptions } from "../dxf";
import { PAGE_SIZES, PDF_DEFAULTS, buildPdf } from "../pdf";

const result = rebuild(seedProject());

describe("dxf", () => {
  const dxf = buildDxf(result, { ...DXF_DEFAULTS, boxesAroundRibs: true });

  it("declares millimetres so CAM software does not guess", () => {
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toMatch(/\$INSUNITS\n70\n4\n/);
    expect(dxf).toMatch(/\$MEASUREMENT\n70\n1\n/);
  });

  it("is a complete R12 file", () => {
    expect(dxf).toMatch(/^0\nSECTION\n2\nHEADER\n/);
    expect(dxf.trimEnd().endsWith("0\nEOF")).toBe(true);
    expect(dxf).toMatch(/\$ACADVER\n1\nAC1009\n/);
  });

  it("names its layers", () => {
    for (const layer of ["RIBS", "HOLES", "BOXES", "LABELS"]) {
      expect(dxf).toContain(`2\n${layer}\n`);
    }
  });

  it("emits one closed polyline per ring", () => {
    const rings = result.ribs.reduce((s, r) => s + r.outline.length + r.holes.length, 0);
    const polylines = (dxf.match(/0\nPOLYLINE\n/g) ?? []).length;
    const seqends = (dxf.match(/0\nSEQEND\n/g) ?? []).length;
    expect(polylines).toBe(rings + result.ribs.length); // + one box per rib
    expect(seqends).toBe(polylines);
    expect((dxf.match(/70\n1\n/g) ?? []).length).toBeGreaterThanOrEqual(polylines);
  });

  it("writes coordinates in millimetres at full size", () => {
    // The widest rib must appear in the file at its real chord, not normalised.
    const widest = Math.max(...result.ribs.map((r) => r.chordMm));
    const xs = [...dxf.matchAll(/\n10\n(-?\d+\.\d+)\n/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeGreaterThan(widest * 0.9);
  });
});

describe("pdf", () => {
  /** PDF content streams are Flate-compressed; inflate every one and join them. */
  function contentText(bytes: Uint8Array): string {
    const raw = Buffer.from(bytes);
    const out: string[] = [];
    let i = 0;
    for (;;) {
      const s = raw.indexOf("stream", i);
      if (s < 0) break;
      let b = s + 6;
      if (raw[b] === 0x0d) b++;
      if (raw[b] === 0x0a) b++;
      const e = raw.indexOf("endstream", b);
      if (e < 0) break;
      try {
        out.push(inflateSync(raw.subarray(b, e)).toString("latin1"));
      } catch {
        out.push(raw.subarray(b, e).toString("latin1"));
      }
      i = e + 9;
    }
    return out.join("\n");
  }

  it("builds pages at the exact physical size requested", async () => {
    const { bytes, pages } = await buildPdf(result, { ...PDF_DEFAULTS, pageSize: "A4", landscape: true });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(pages).toBeGreaterThanOrEqual(1);

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(pages);
    const { width, height } = reloaded.getPage(0).getSize();
    // A4 landscape is 297mm x 210mm. In points, exactly.
    expect(width).toBeCloseTo((PAGE_SIZES.A4.h * 72) / 25.4, 4);
    expect(height).toBeCloseTo((PAGE_SIZES.A4.w * 72) / 25.4, 4);
  });

  it("draws the calibration bar exactly 100mm long", async () => {
    const { bytes } = await buildPdf(result, { ...PDF_DEFAULTS, showCalibration: true, marginMm: 10 });
    const content = contentText(bytes);

    const x0 = (10 * 72) / 25.4;
    const x1 = (110 * 72) / 25.4;
    expect(x1 - x0).toBeCloseTo(283.4646, 3);

    // Find the horizontal run whose endpoints are the bar's, at one shared y.
    const runs = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l/g)];
    const bar = runs.find(
      (m) =>
        Math.abs(Number(m[1]) - x0) < 0.01 &&
        Math.abs(Number(m[3]) - x1) < 0.01 &&
        Math.abs(Number(m[2]) - Number(m[4])) < 1e-6,
    );
    expect(bar, "no 100mm calibration bar found in the content stream").toBeTruthy();
  });

  it("places a rib at its true size, not scaled to fit", async () => {
    const one = rebuild(
      (() => {
        const d = seedProject();
        d.wing.panels = [d.wing.panels[0]];
        d.wing.panels[0].ribs = d.wing.panels[0].ribs.slice(0, 1);
        d.wing.panels[0].spars = [];
        d.wing.panels[0].leadingEdge.enabled = false;
        d.wing.panels[0].trailingEdge.enabled = false;
        return d;
      })(),
    );
    const chord = one.ribs[0].chordMm;
    const { bytes } = await buildPdf(one, { ...PDF_DEFAULTS, showCalibration: false, pageSize: "A3", landscape: true });
    const content = contentText(bytes);
    const xs = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]/g)].map((m) => Number(m[1]));
    const widthPt = Math.max(...xs) - Math.min(...xs);
    // The drawn width must equal the chord in points, within a tenth of a millimetre.
    expect(widthPt).toBeCloseTo((chord * 72) / 25.4, 0);
    expect(Math.abs((widthPt * 25.4) / 72 - chord)).toBeLessThan(0.1);
  });

  it("reports ribs too large for the page instead of shrinking them", async () => {
    const big = rebuild(
      (() => {
        const d = seedProject();
        d.wing.panels[0].rootChordMm = 900;
        d.wing.panels[0].tipChordMm = 900;
        return d;
      })(),
    );
    const { oversized } = await buildPdf(big, { ...PDF_DEFAULTS, pageSize: "A4", landscape: false });
    expect(oversized.length).toBeGreaterThan(0);
  });
});

describe("DXF options: the original silhouette and trailing-edge trim", () => {
  const withOpts = (o: Partial<DxfOptions>) => buildDxf(rebuild(seedProject()), { ...DXF_DEFAULTS, ...o });
  const polylinesOn = (dxf: string, layer: string) => dxf.split(`0\nPOLYLINE\n8\n${layer}\n`).length - 1;
  const ribCount = rebuild(seedProject()).ribs.length;

  it("draws no silhouette unless asked", () => {
    expect(polylinesOn(withOpts({}), "SILHOUETTE")).toBe(0);
  });
  it("draws one closed silhouette per rib on its own layer when asked, so it can be left out of the cut", () => {
    const dxf = withOpts({ drawOriginalSilhouette: true });
    expect(polylinesOn(dxf, "SILHOUETTE")).toBe(ribCount);
    expect(dxf).toMatch(/2\nSILHOUETTE\n/); // the layer is declared
  });
  it("the silhouette is the whole airfoil, so it is never smaller than the rib that is cut from it", () => {
    const geo = rebuild(seedProject());
    for (const rib of geo.ribs.slice(0, 5)) {
      const sil = rib.silhouette;
      const out = rib.outline.flat();
      expect(Math.min(...sil.map((p) => p.x))).toBeLessThanOrEqual(Math.min(...out.map((p) => p.x)) + 1e-6);
      expect(Math.max(...sil.map((p) => p.x))).toBeGreaterThanOrEqual(Math.max(...out.map((p) => p.x)) - 1e-6);
      expect(Math.max(...sil.map((p) => p.y))).toBeGreaterThanOrEqual(Math.max(...out.map((p) => p.y)) - 1e-3);
      expect(Math.min(...sil.map((p) => p.y))).toBeLessThanOrEqual(Math.min(...out.map((p) => p.y)) + 1e-3);
    }
  });
  it("turning the silhouette on does not move the cut parts, only adds to the file", () => {
    const off = withOpts({});
    const on = withOpts({ drawOriginalSilhouette: true });
    expect(on.length).toBeGreaterThan(off.length);
    expect(polylinesOn(on, "RIBS")).toBe(polylinesOn(off, "RIBS"));
  });
  it("leaves room for the silhouette, so neighbouring ribs do not overlap it", () => {
    const geo = rebuild(seedProject());
    const dxf = buildDxf(geo, { ...DXF_DEFAULTS, drawOriginalSilhouette: true, spacingMm: 5 });
    const xs = [...dxf.matchAll(/0\nPOLYLINE\n8\nSILHOUETTE\n[\s\S]*?0\nSEQEND/g)].map((m) => {
      const v = [...m[0].matchAll(/\n10\n(-?[\d.]+)\n/g)].map((q) => Number(q[1]));
      return [Math.min(...v), Math.max(...v)];
    });
    for (let i = 1; i < xs.length; i++) expect(xs[i][0]).toBeGreaterThanOrEqual(xs[i - 1][1] + 5 - 1e-3);
  });
});

describe("trimTrailingEdge", () => {
  const sharp = () => {
    const doc = seedProject();
    for (const p of doc.wing.panels) {
      p.trailingEdge.enabled = false;
      p.spars = [];
    }
    return rebuild(doc).ribs[0];
  };
  const thicknessAt = (rings: { x: number; y: number }[][], x: number) => {
    const ys: number[] = [];
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
      }
    return ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
  };
  const maxX = (rings: { x: number }[][]) => Math.max(...rings.flat().map((p) => p.x));

  it("cuts a sharp trailing edge back to the minimum thickness, no further", () => {
    const rib = sharp();
    const out = trimTrailingEdge(rib.outline, 1);
    expect(maxX(out)).toBeLessThan(maxX(rib.outline));
    expect(thicknessAt(out, maxX(out) - 0.05)).toBeGreaterThanOrEqual(0.95);
    expect(thicknessAt(out, maxX(out) - 0.05)).toBeLessThan(1.4);
  });
  it("never takes more than a twentieth of the chord, whatever the minimum asked for", () => {
    const rib = sharp();
    const out = trimTrailingEdge(rib.outline, 50);
    expect(maxX(rib.outline) - maxX(out)).toBeLessThanOrEqual(0.05 * rib.chordMm + 1e-6);
  });
  it("leaves an edge that is already thick enough exactly as it was (a rib cut back for trailing-edge stock)", () => {
    const blunt = rebuild(seedProject()).ribs[0]; // the stock cut leaves a face several millimetres tall
    expect(trimTrailingEdge(blunt.outline, 0.8)).toEqual(blunt.outline);
  });
  it("a minimum of zero or less changes nothing", () => {
    const rib = sharp();
    expect(trimTrailingEdge(rib.outline, 0)).toEqual(rib.outline);
    expect(trimTrailingEdge(rib.outline, -3)).toEqual(rib.outline);
  });
  it("removes area only at the trailing edge: the nose is untouched", () => {
    const rib = sharp();
    const out = trimTrailingEdge(rib.outline, 1);
    expect(Math.min(...out.flat().map((p) => p.x))).toBeCloseTo(Math.min(...rib.outline.flat().map((p) => p.x)), 6);
  });
  it("through the DXF: the option shortens the ribs in the file", () => {
    const doc = seedProject();
    for (const p of doc.wing.panels) p.trailingEdge.enabled = false;
    const geo = rebuild(doc);
    const longest = (t: string) => Math.max(...[...t.matchAll(/10\n(-?[\d.]+)\n/g)].map((m) => Number(m[1])));
    const off = buildDxf(geo, { ...DXF_DEFAULTS, spacingMm: 0 });
    const on = buildDxf(geo, { ...DXF_DEFAULTS, spacingMm: 0, trimTrailingEdge: true, trailingMinMm: 1 });
    expect(longest(on)).toBeLessThan(longest(off));
  });
});
