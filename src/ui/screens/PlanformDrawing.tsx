/**
 * A panel's planform drawn to one scale in both directions, so a swept panel looks swept. Leading edge on top,
 * root on the left. With `ribs` the ribs are laid over it: a line across the chord at each station as thick as the
 * rib, and a half rib only as far as its cut line. With `spar` the spar is drawn along the panel at its place on the chord,
 * and with `highlight` (rib indices from the root) the ribs it touches stay in colour while the rest fade.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Panel, Spar } from "../../domain/schema";

/** Where the drawing puts the panel: the width of the picture, the x of the root and the tip, and the scale in picture units per millimetre. */
export function planformFrame(panel: Pick<Panel, "lengthMm" | "rootChordMm" | "tipChordMm" | "sweepMm">, maxHeight = 300) {
  const { lengthMm: len, rootChordMm: rc, tipChordMm: tc, sweepMm: sw } = panel;
  const VW = 600;
  const margin = 12;
  const extent = Math.max(rc, sw + tc, 1) - Math.min(0, sw);
  const s = Math.min((VW - 2 * margin) / Math.max(len, 1), maxHeight / extent);
  const x1 = (VW - len * s) / 2;
  return { VW, x1, x2: x1 + len * s, s };
}

/** One end of a feature's span, as a handle that can be dragged along the panel. */
export type SpanHandle = { label: string; value: number; min: number; max: number; onChange: (mm: number) => void };
export type SpanHandles = {
  start: SpanHandle;
  end: SpanHandle;
  /** positions a drag lands on, e.g. the ribs */
  snap?: number[];
  step?: number;
  /** for a feature drawn as a region rather than a spar: where along the chord (from the nose, mm) the handles sit at a station along the span */
  chordPos?: (mm: number) => number;
};

/** A feature that covers an area of the planform: sheeting, edge stock. `points` are (mm along the span, mm back from the nose of the rib there). */
export type Region = { colour: string; points: { mm: number; x: number }[] };

export function PlanformDrawing({
  panel,
  ribs = false,
  maxHeight = 300,
  spar,
  highlight,
  handles,
  region,
}: {
  panel: Panel;
  ribs?: boolean;
  maxHeight?: number;
  spar?: { spar: Spar; colour: string };
  highlight?: Set<number>;
  /** a circle at each end of the spar (or region) to drag, which changes where it starts and ends */
  handles?: SpanHandles;
  /** an area of the planform to colour in, for features that are not a line along the span */
  region?: Region;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { lengthMm: len, rootChordMm: rc, tipChordMm: tc, sweepMm: sw } = panel;
  const VW = 600;
  const margin = 12;
  const lo = Math.min(0, sw);
  const hi = Math.max(rc, sw + tc, 1);
  const extent = hi - lo;
  const s = Math.min((VW - 2 * margin) / Math.max(len, 1), maxHeight / extent);
  const x1 = (VW - len * s) / 2;
  const x2 = x1 + len * s;
  const y = (v: number) => margin + (v - lo) * s;
  const pts: [number, number][] = [
    [x1, y(0)],
    [x2, y(sw)],
    [x2, y(sw + tc)],
    [x1, y(rc)],
  ];
  const h = margin * 2 + extent * s;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${VW} ${h.toFixed(1)}`} className="block w-full" role="img" aria-label={ribs ? `${panel.name} planform with its ${panel.ribs.length} ribs, drawn to scale` : `${panel.name} planform, drawn to scale`}>
      <polygon points={pts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ")} className="fill-selected stroke-accent/60" strokeWidth="1" strokeLinejoin="round" />
      <line x1={x1} x2={x1} y1={y(0)} y2={y(rc)} className="stroke-accent" strokeWidth="3" />
      {sw !== 0 && <line x1={x1} x2={x2} y1={y(0)} y2={y(0)} className="stroke-border-strong" strokeWidth="1" strokeDasharray="3 3" />}
      {ribs &&
        [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm).map((r, ri) => {
          const t = len === 0 ? 0 : r.positionMm / len;
          const chord = rc + (tc - rc) * t;
          const x = x1 + r.positionMm * s;
          const top = y(sw * t);
          let a = top;
          let b = top + chord * s;
          const cutPct = r.half === "rear" ? (panel.halfRibRearCutPct ?? panel.halfRibCutPct ?? 35) : (panel.halfRibCutPct ?? 35);
          const cut = top + (cutPct / 100) * chord * s;
          if (r.half === "front") b = cut;
          else if (r.half === "rear") a = cut;
          return (
            <line
              key={r.id}
              data-rib-line
              x1={x}
              x2={x}
              y1={a}
              y2={b}
              style={{ stroke: "var(--wb-geo-rib)", opacity: highlight && !highlight.has(ri) ? 0.28 : 1 }}
              strokeWidth={Math.max(1, r.thicknessMm * s)}
              strokeLinecap="butt"
            />
          );
        })}
      {region && region.points.length >= 3 && (
        <polygon
          data-feature-region
          points={region.points.map((q) => `${(x1 + q.mm * s).toFixed(1)},${(y(panel.sweepMm * (len <= 0 ? 0 : q.mm / len)) + q.x * s).toFixed(1)}`).join(" ")}
          style={{ fill: region.colour, fillOpacity: 0.55, stroke: region.colour }}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
      {spar && <SparLine panel={panel} spar={spar.spar} colour={spar.colour} x1={x1} s={s} y={y} />}
      {(spar || region) && handles && (
        <>
          {([handles.start, handles.end] as const).map((hd) => {
            const colour = spar?.colour ?? region!.colour;
            const at = spar
              ? sparPoint(panel, spar.spar, hd.value, x1, s, y)
              : { x: x1 + Math.max(0, Math.min(len, hd.value)) * s, y: y(panel.sweepMm * (len <= 0 ? 0 : Math.max(0, Math.min(len, hd.value)) / len)) + (handles.chordPos?.(hd.value) ?? 0) * s };
            return <DragHandle key={hd.label} handle={hd} at={at} colour={colour} svgRef={svgRef} VW={VW} x1={x1} s={s} snap={handles.snap} step={handles.step ?? 5} />;
          })}
        </>
      )}
    </svg>
  );
}

/** A joiner is one straight rod, placed once at the spar's first rib and not at the same percentage of every rib's chord: its line stays parallel to the root. */
function joinerChordPos(panel: Panel, spar: Spar, t: number): number {
  const len = panel.lengthMm;
  const first = [...panel.ribs].map((r) => r.positionMm).sort((p, q) => p - q).find((p) => p >= spar.spanStartMm - 1e-6) ?? spar.spanStartMm;
  const tA = len <= 0 ? 0 : first / len;
  const chordA = panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * tA;
  const d = spar.distance.start.unit === "pct" ? (spar.distance.start.value / 100) * chordA : spar.distance.start.value;
  const xA = spar.distanceFrom === "LE" ? d : chordA - d;
  // from the nose of the rib at mm: the rod sits where it started, less the sweep gained since
  return xA - panel.sweepMm * (t - tA);
}

/** Where the spar's centre line is at `mm` along the span, in the drawing. */
function sparPoint(panel: Panel, spar: Spar, mm: number, x1: number, s: number, y: (v: number) => number): { x: number; y: number } {
  const len = panel.lengthMm;
  const t = len <= 0 ? 0 : Math.max(0, Math.min(1, mm / len));
  const chord = panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * t;
  const m = spar.distance.end ? { value: spar.distance.start.value + (spar.distance.end.value - spar.distance.start.value) * t, unit: spar.distance.start.unit } : spar.distance.start;
  const d = m.unit === "pct" ? (m.value / 100) * chord : m.value;
  const xc = spar.type === "roundJoiner" || spar.type === "cuboidJoiner" ? joinerChordPos(panel, spar, t) : spar.distanceFrom === "LE" ? d : chord - d;
  return { x: x1 + Math.max(0, Math.min(len, mm)) * s, y: y(panel.sweepMm * t) + xc * s };
}

/** A circle on the drawing that is dragged along the span; the arrow keys move it too. */
function DragHandle({ handle, at, colour, svgRef, VW, x1, s, snap, step }: { handle: SpanHandle; at: { x: number; y: number }; colour: string; svgRef: React.RefObject<SVGSVGElement | null>; VW: number; x1: number; s: number; snap?: number[]; step: number }) {
  const apply = (mm: number) => {
    let v = Math.max(handle.min, Math.min(handle.max, mm));
    if (snap && snap.length) {
      const inside = snap.filter((p) => p >= handle.min - 1e-6 && p <= handle.max + 1e-6);
      if (inside.length) v = inside.reduce((best, p) => (Math.abs(p - v) < Math.abs(best - v) ? p : best), inside[0]);
    } else v = Math.round(v * 10) / 10;
    if (Math.abs(v - handle.value) > 1e-9) handle.onChange(v);
  };
  // A drag moves the pointer many times between frames; only the last place reached in a frame is acted on, so the rest of the screen
  // (which has to be redrawn for each change) is not asked to keep up with every pointer event.
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const move = (e: PointerEvent<SVGCircleElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    pending.current = (((e.clientX - r.left) / r.width) * VW - x1) / s;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current !== null) applyRef.current(pending.current);
        pending.current = null;
      });
    }
  };
  const key = (e: KeyboardEvent<SVGCircleElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    apply(handle.value + (e.key === "ArrowRight" ? step : -step));
  };
  return (
    <circle
      data-span-handle={handle.label}
      role="slider"
      tabIndex={0}
      aria-label={handle.label}
      aria-valuemin={handle.min}
      aria-valuemax={handle.max}
      aria-valuenow={Math.round(handle.value * 10) / 10}
      cx={at.x}
      cy={at.y}
      r={8}
      className="cursor-ew-resize fill-surface-raised stroke-2 outline-none focus:stroke-accent"
      style={{ stroke: colour, touchAction: "none" }}
      strokeWidth={3}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onKeyDown={key}
    />
  );
}

/** The spar along the panel: from where it starts to where it ends, at its place on the chord at each station. */
function SparLine({ panel, spar, colour, x1, s, y }: { panel: Panel; spar: Spar; colour: string; x1: number; s: number; y: (v: number) => number }) {
  const len = panel.lengthMm;
  const a = Math.max(0, Math.min(len, spar.spanStartMm));
  const b = Math.max(0, Math.min(len, spar.spanEndMm));
  if (b - a < 0.01 || len <= 0) return null;
  const pts: string[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const mm = a + ((b - a) * i) / N;
    const t = mm / len;
    const chord = panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * t;
    const m = spar.distance.end ? { value: spar.distance.start.value + (spar.distance.end.value - spar.distance.start.value) * t, unit: spar.distance.start.unit } : spar.distance.start;
    const d = m.unit === "pct" ? (m.value / 100) * chord : m.value;
    const xc = spar.type === "roundJoiner" || spar.type === "cuboidJoiner" ? joinerChordPos(panel, spar, t) : spar.distanceFrom === "LE" ? d : chord - d;
    pts.push(`${(x1 + mm * s).toFixed(1)},${(y(panel.sweepMm * t) + xc * s).toFixed(1)}`);
  }
  const round = spar.type === "round" || spar.type === "roundJoiner";
  const thick = round ? (spar.radiusMm ?? 3) * 2 : (spar.width?.start ?? 6);
  return <polyline data-spar-line points={pts.join(" ")} fill="none" style={{ stroke: colour }} strokeWidth={Math.max(3, thick * s)} strokeLinecap="butt" strokeLinejoin="round" />;
}
