/**
 * 1:1 printable templates.
 *
 * The whole point of this file is that a rib measured on paper matches the rib
 * on screen. Three things protect that:
 *
 *   1. Geometry is placed in PDF points computed from millimetres, never scaled
 *      to fit. A part too wide for the page tiles across sheets instead.
 *   2. Page 1 carries a 100mm calibration ruler. If it does not measure 100mm,
 *      the print was scaled and every part is wrong.
 *   3. The instruction to print at actual size is on the page, not in a dialog
 *      the user has already dismissed.
 */
import {
  PDFDocument,
  StandardFonts,
  closePath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setDashPattern,
  setLineWidth,
  setStrokingColor,
  stroke,
} from "pdf-lib";
import type { GeometryResult, Path } from "../geometry/types";

export const PAGE_SIZES = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  Tabloid: { w: 279.4, h: 431.8 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

export type PdfOptions = {
  pageSize: PageSizeName;
  landscape: boolean;
  marginMm: number;
  projectName: string;
  showCalibration: boolean;
};

export const PDF_DEFAULTS: PdfOptions = {
  pageSize: "A4",
  landscape: true,
  marginMm: 10,
  projectName: "Untitled wing",
  showCalibration: true,
};

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;

function bounds(paths: Path[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Raw path operators, in PDF points, origin bottom-left. */
function ringOps(path: Path, dxMm: number, dyMm: number) {
  const ops = [moveTo(mm(path[0].x + dxMm), mm(path[0].y + dyMm))];
  for (let i = 1; i < path.length; i++) {
    ops.push(lineTo(mm(path[i].x + dxMm), mm(path[i].y + dyMm)));
  }
  ops.push(closePath());
  return ops;
}

type Placed = { rib: GeometryResult["ribs"][number]; xMm: number; yMm: number; page: number };

export async function buildPdf(
  result: GeometryResult,
  options: PdfOptions = PDF_DEFAULTS,
): Promise<{ bytes: Uint8Array; pages: number; oversized: string[] }> {
  const size = PAGE_SIZES[options.pageSize];
  const pageW = options.landscape ? size.h : size.w;
  const pageH = options.landscape ? size.w : size.h;
  const m = options.marginMm;
  const usableW = pageW - m * 2;
  const usableH = pageH - m * 2;

  const doc = await PDFDocument.create();
  doc.setTitle(`${options.projectName} — rib templates`);
  doc.setCreator("Wing Buddy");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // --- pack ribs into pages, in rows ---------------------------------------
  const placed: Placed[] = [];
  const oversized: string[] = [];
  const gap = 6;
  const labelBand = 6;
  let page = 0;
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  // Page 1 reserves a strip for the calibration ruler and instructions.
  let reserved = options.showCalibration ? 26 : 0;

  for (const rib of result.ribs) {
    const all = [...rib.outline, ...rib.holes];
    if (all.length === 0) continue;
    const b = bounds(all);
    const w = b.w;
    const h = b.h + labelBand;

    if (w > usableW || h > usableH - reserved) {
      oversized.push(`${rib.panelId.slice(0, 4)}/R${rib.index + 1}`);
    }

    if (cx + w > usableW && cx > 0) {
      cx = 0;
      cy += rowH + gap;
      rowH = 0;
    }
    if (cy + h > usableH - reserved) {
      page += 1;
      reserved = 0;
      cx = 0;
      cy = 0;
      rowH = 0;
    }

    placed.push({ rib, xMm: m + cx - b.minX, yMm: pageH - m - reserved - cy - h - b.minY + labelBand, page });
    cx += w + gap;
    rowH = Math.max(rowH, h);
  }

  const pageCount = Math.max(1, page + 1);
  const pages = Array.from({ length: pageCount }, () => doc.addPage([mm(pageW), mm(pageH)]));

  // --- calibration strip ----------------------------------------------------
  if (options.showCalibration) {
    const p = pages[0];
    const y = pageH - m - 10;
    p.drawText("Print at 100% / Actual size. Do NOT use 'Fit to page'.", {
      x: mm(m),
      y: mm(y + 7),
      size: 9,
      font: bold,
    });
    p.drawText("This bar must measure exactly 100mm. If it does not, the print was scaled and every part is wrong.", {
      x: mm(m),
      y: mm(y + 1.5),
      size: 7,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    const ops = [
      pushGraphicsState(),
      setLineWidth(0.6),
      setStrokingColor(rgb(0, 0, 0)),
      moveTo(mm(m), mm(y - 4)),
      lineTo(mm(m + 100), mm(y - 4)),
    ];
    for (let i = 0; i <= 100; i += 10) {
      const tick = i % 50 === 0 ? 3.5 : 2;
      ops.push(moveTo(mm(m + i), mm(y - 4)), lineTo(mm(m + i), mm(y - 4 + tick)));
    }
    ops.push(stroke(), popGraphicsState());
    p.pushOperators(...ops);
    p.drawText("0", { x: mm(m), y: mm(y - 8), size: 6, font });
    p.drawText("100mm", { x: mm(m + 90), y: mm(y - 8), size: 6, font });
  }

  // --- ribs -----------------------------------------------------------------
  for (const item of placed) {
    const p = pages[item.page];
    const ops = [pushGraphicsState(), setLineWidth(0.5), setStrokingColor(rgb(0, 0, 0))];
    for (const ring of item.rib.outline) ops.push(...ringOps(ring, item.xMm, item.yMm));
    ops.push(stroke());
    if (item.rib.holes.length) {
      ops.push(setLineWidth(0.4), setStrokingColor(rgb(0.4, 0.4, 0.4)));
      for (const ring of item.rib.holes) ops.push(...ringOps(ring, item.xMm, item.yMm));
      ops.push(stroke());
    }
    ops.push(popGraphicsState());
    p.pushOperators(...ops);

    const b = bounds([...item.rib.outline, ...item.rib.holes]);
    p.drawText(`Rib ${item.rib.index + 1}  ·  chord ${item.rib.chordMm.toFixed(1)}mm`, {
      x: mm(item.xMm + b.minX),
      y: mm(item.yMm + b.minY - 4.5),
      size: 6.5,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  }

  // --- footers ---------------------------------------------------------------
  pages.forEach((p, i) => {
    p.drawText(`${options.projectName}  ·  page ${i + 1} of ${pageCount}  ·  1:1`, {
      x: mm(m),
      y: mm(4),
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
    if (i > 0) {
      // Registration crosses, so sheets can be aligned over a light box.
      const ops = [pushGraphicsState(), setLineWidth(0.3), setStrokingColor(rgb(0.6, 0.6, 0.6)), setDashPattern([], 0)];
      for (const [x, y] of [[m, m], [pageW - m, m], [m, pageH - m], [pageW - m, pageH - m]]) {
        ops.push(moveTo(mm(x - 3), mm(y)), lineTo(mm(x + 3), mm(y)));
        ops.push(moveTo(mm(x), mm(y - 3)), lineTo(mm(x), mm(y + 3)));
      }
      ops.push(stroke(), popGraphicsState());
      p.pushOperators(...ops);
    }
  });

  return { bytes: await doc.save(), pages: pageCount, oversized };
}
