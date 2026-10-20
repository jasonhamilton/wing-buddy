/**
 * The 2D rib view.
 *
 * Both draw from the same geometry the exporters consume, which is what makes
 * "what you see is what you cut" true rather than aspirational. Part type is
 * encoded by stroke colour AND dash pattern AND weight, so the drawing still
 * reads when hue does not.
 */
import { useEffect, useRef } from "react";
import type { GeometryResult, Path, RibGeometry } from "../../geometry/types";
import { lineTheme } from "./theme";

function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(devicePixelRatio, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    render();
    const ro = new ResizeObserver(render);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

type Fit = { scale: number; ox: number; oy: number };

function fitTo(wMm: number, hMm: number, w: number, h: number, pad = 28): Fit {
  const scale = Math.min((w - pad * 2) / Math.max(wMm, 1e-6), (h - pad * 2) / Math.max(hMm, 1e-6));
  return { scale, ox: (w - wMm * scale) / 2, oy: (h - hMm * scale) / 2 };
}

/* -------------------------------------------------------------- Rib view */

/** A fixed frame to draw in, in rib millimetres: with it, ribs of different sizes are drawn to one scale instead of each filling the view. */
export type RibFrame = { minX: number; minY: number; maxX: number; maxY: number };

export function RibView({ rib, label, frame }: { rib: RibGeometry | null; label: string; frame?: RibFrame }) {
  const ref = useCanvas(
    (ctx, w, h) => {
      if (!rib || rib.outline.length === 0) return;
      const t = lineTheme();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const ring of [...rib.outline, ...rib.holes]) {
        for (const p of ring) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
      if (frame) {
        minX = frame.minX;
        minY = frame.minY;
        maxX = frame.maxX;
        maxY = frame.maxY;
      }
      const f = fitTo(maxX - minX, maxY - minY, w, h, 18);
      const X = (x: number) => f.ox + (x - minX) * f.scale;
      const Y = (y: number) => h - f.oy - (y - minY) * f.scale;

      const trace = (ring: Path) => {
        ctx.beginPath();
        ring.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.closePath();
      };

      for (const ring of rib.outline) {
        trace(ring);
        ctx.fillStyle = t.rib;
        ctx.globalAlpha = 0.1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = t.rib;
        ctx.stroke();
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = t.spar;
      ctx.setLineDash([]);
      for (const ring of rib.holes) {
        trace(ring);
        ctx.stroke();
      }

      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillStyle = t.muted;
      ctx.fillText(label, 10, 16);
    },
    [rib, label, frame?.minX, frame?.minY, frame?.maxX, frame?.maxY],
  );
  return <canvas ref={ref} className="block" role="img" aria-label={`Rib outline: ${label}`} />;
}

export function Panel2D({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-6 shrink-0 items-center border-b border-border bg-surface px-4 text-micro font-medium uppercase tracking-[.07em] text-muted">
        {title}
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-viewport">{children}</div>
    </div>
  );
}

export function useResult(result: GeometryResult | null, ribId: string | null): RibGeometry | null {
  if (!result) return null;
  if (ribId) return result.ribs.find((r) => r.ribId === ribId) ?? result.ribs[0] ?? null;
  return result.ribs[0] ?? null;
}
