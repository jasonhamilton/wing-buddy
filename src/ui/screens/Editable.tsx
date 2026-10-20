/** Values that are text until clicked, and can be dragged sideways. Used by the wing geometry view. */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Dragging a value sideways: every PX_PER_STEP pixels moves it one `step`, always onto a multiple of it, clamped to min and max. */
const PX_PER_STEP = 10;
export type Drag = {
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  /** Values the drag may land on, in order. Each step then moves to the next one, however far apart they are. */
  stops?: number[];
};

/**
 * Shows `display` as a button; clicking it swaps in `edit`, focused. Leaving the field (or Enter) swaps back.
 * With `drag`, pressing and sliding left or right changes the value instead; a press that barely moves is a click.
 */
export function Editable({ label, display, edit, drag, className = "", cell }: { label: string; display: ReactNode; edit: ReactNode; drag?: Drag; className?: string; /** a cell of a table: no underline, fills the cell, shows a quiet outline on hover */ cell?: boolean }) {
  const [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape leave the field with the keyboard: put focus back on the text. Clicking elsewhere does not.
  const refocus = useRef(false);
  const press = useRef<null | { x: number; start: number; moved: boolean }>(null);

  useEffect(() => {
    if (editing) {
      const input = box.current?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
      input?.focus();
      if (input instanceof HTMLInputElement) input.select();
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <div
        ref={box}
        className={className}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") refocus.current = true;
          if (e.key === "Enter") setEditing(false);
        }}
      >
        {edit}
      </div>
    );
  }
  return (
    <button
      ref={button}
      type="button"
      aria-label={`Change ${label}`}
      title={drag ? `Click to change ${label.toLowerCase()}, or drag sideways` : `Change ${label.toLowerCase()}`}
      onClick={() => {
        // the click that ends a drag is not a request to type
        if (press.current?.moved) press.current = null;
        else setEditing(true);
      }}
      {...(drag && {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press.current = { x: e.clientX, start: drag.value, moved: false };
        },
        onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
          const p = press.current;
          if (!p) return;
          const dx = e.clientX - p.x;
          if (!p.moved && Math.abs(dx) < 4) return;
          p.moved = true;
          // Land on a multiple of the step. The first step in a direction goes to the nearest multiple that way
          // (230 right is 240, 233 right is 240, 233 left is 230); each further step is one more step.
          const n = Math.round(dx / PX_PER_STEP);
          let v: number;
          const stops = drag.stops?.filter((x) => (drag.min === undefined || x >= drag.min - 1e-6) && (drag.max === undefined || x <= drag.max + 1e-6));
          if (stops && stops.length > 0) {
            // Stops: start from the one nearest where the press began, and each step moves one stop along.
            const from = stops.reduce((best, x, i) => (Math.abs(x - p.start) < Math.abs(stops[best] - p.start) ? i : best), 0);
            v = stops[Math.max(0, Math.min(stops.length - 1, from + n))];
          } else {
            const ratio = Number((p.start / drag.step).toFixed(6));
            v = Number(((n > 0 ? Math.floor(ratio) + n : n < 0 ? Math.ceil(ratio) + n : ratio) * drag.step).toFixed(4));
            if (drag.min !== undefined) v = Math.max(drag.min, v);
            if (drag.max !== undefined) v = Math.min(drag.max, v);
          }
          if (v !== drag.value) drag.onChange(v);
        },
        onPointerUp: () => {
          if (press.current && !press.current.moved) press.current = null;
        },
        onPointerCancel: () => {
          press.current = null;
        },
      })}
      className={`${drag ? "cursor-ew-resize touch-none " : ""}${cell ? "block w-full rounded-sm border border-transparent px-2 py-0 leading-6 hover:border-border-strong " : "rounded-sm px-1.5 py-0.5 text-left underline decoration-dotted decoration-muted underline-offset-4 hover:bg-surface-sunken "}${className}`}
    >
      {display}
    </button>
  );
}

/** A value with a small caption above it, e.g. "Root chord" over "150.0 mm". */
export function Value({ caption, children, align = "left" }: { caption: string; children: ReactNode; align?: "left" | "center" | "right" }) {
  return (
    <div className={`min-w-0 ${align === "center" ? "text-center" : align === "right" ? "text-right" : ""}`}>
      <div className="text-micro text-muted">{caption}</div>
      <div className="flex min-h-7 items-center text-sm font-medium">{children}</div>
    </div>
  );
}

