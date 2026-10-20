/**
 * A close-up of part of a rib, square and to scale, that can be panned and zoomed. The window it opens on is worked out once,
 * when it first shows (and again if the button for it is pressed), and is not touched by changes to the feature: the thing being
 * drawn grows and moves inside a window that stays put, so changing a setting never makes the picture jump about.
 *
 * Drag to pan, scroll or pinch to zoom, or use the buttons. Units are millimetres in the rib's own frame, y up as in the rib
 * (the drawing flips it).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "../primitives";

export type Window = { cx: number; cy: number; size: number };
/** What the drawing needs to size things that should stay the same size on screen: the window and mm per screen pixel. */
export type View = Window & { x0: number; y0: number; perPx: number };

const MIN = 0.5;
const MAX = 4000;

export function CloseUp({ fit, label, focus, children }: { fit: () => Window; label: string; /** where the feature is: if a change carries it out of the window, the window moves to it (the zoom stays) */ focus?: { x: number; y: number }; children: (v: View) => ReactNode }) {
  const [win, setWin] = useState<Window>(fit);
  const box = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(300);
  const drag = useRef<null | { x: number; y: number; cx: number; cy: number }>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setPx(el.clientWidth || 300);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A setting that moves the feature out of the picture: follow it. A feature that is still well inside leaves the window alone.
  useEffect(() => {
    if (!focus) return;
    setWin((w) => (Math.abs(focus.x - w.cx) > w.size * 0.4 || Math.abs(focus.y - w.cy) > w.size * 0.4 ? { ...w, cx: focus.x, cy: focus.y } : w));
  }, [focus?.x, focus?.y]);

  const perPx = win.size / px;
  const zoomBy = (factor: number, at?: { fx: number; fy: number }) =>
    setWin((w) => {
      const size = Math.max(MIN, Math.min(MAX, w.size * factor));
      // keep the point under the pointer where it is: fx, fy are 0 to 1 across the window
      const f = at ?? { fx: 0.5, fy: 0.5 };
      return { size, cx: w.cx + (f.fx - 0.5) * (w.size - size), cy: w.cy - (f.fy - 0.5) * (w.size - size) };
    });

  // The wheel is attached by hand: React's own wheel listener is passive, and a page that scrolls under the pointer is no use.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(e.deltaY * 0.0015), { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const view: View = { ...win, x0: win.cx - win.size / 2, y0: -win.cy - win.size / 2, perPx };
  return (
    <div
      ref={box}
      role="group"
      aria-label={label}
      data-close-up
      data-window={`${win.cx.toFixed(2)},${win.cy.toFixed(2)},${win.size.toFixed(2)}`}
      className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-md bg-surface-sunken"
      style={{ cursor: drag.current ? "grabbing" : "grab" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: win.cx, cy: win.cy };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setWin((w) => ({ ...w, cx: d.cx - (e.clientX - d.x) * perPx, cy: d.cy + (e.clientY - d.y) * perPx }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => setWin(fit())}
    >
      <svg viewBox={`${view.x0} ${view.y0} ${win.size} ${win.size}`} className="block h-full w-full" role="img" aria-label={`${label}, drawn to scale`}>
        {children(view)}
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <IconButton label="Zoom in" className="border-border-input bg-surface-raised shadow-card" onClick={() => zoomBy(0.7)}>
          <span className="text-base leading-none">+</span>
        </IconButton>
        <IconButton label="Zoom out" className="border-border-input bg-surface-raised shadow-card" onClick={() => zoomBy(1 / 0.7)}>
          <span className="text-base leading-none">−</span>
        </IconButton>
        <IconButton label="Fit the view to the feature" className="border-border-input bg-surface-raised shadow-card" onClick={() => setWin(fit())}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
