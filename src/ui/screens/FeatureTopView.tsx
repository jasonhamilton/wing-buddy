/**
 * The top view of a panel with a feature on it, as the spar's details have it, for features that are not a spar: sheeting strips,
 * rib combs, edge stock. The area (or line) the feature covers is coloured in, the ribs it touches stay in colour while the rest fade,
 * and, where the feature has a start and an end along the span, a circle at each end can be dragged, with Starts at and Ends at
 * set out underneath. A drag lands on the nearest rib while Snap to rib is on; turning it back on moves both ends to the nearest rib.
 */
import { useState } from "react";
import type { Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { useStore } from "../../state/store";
import { LengthField } from "../LengthField";
import { Editable, Value } from "./Editable";
import { colourOf, dragStepFor, Section } from "./detailParts";
import { affectedRibs, type Pick } from "./panelFeatures";
import { PlanformDrawing, type Region } from "./PlanformDrawing";

export type SpanEdit = {
  start: number;
  end: number;
  /** write the new start and end */
  set: (start: number, end: number) => void;
  /** where along the chord (mm from the nose) the handles sit, at a station along the span */
  chordPos: (mm: number) => number;
};

export function FeatureTopView({ panel, pick, region, span, label = "Top view" }: { panel: Panel; pick: Pick; region: Omit<Region, "colour">; span?: SpanEdit; label?: string }) {
  const units = useStore((s) => s.doc.displayUnits);
  const [snap, setSnap] = useState(true);
  const len = panel.lengthMm;
  const ribs = [...panel.ribs].map((r) => r.positionMm).sort((a, b) => a - b);
  const colour = colourOf(panel, pick);
  const near = (v: number) => ribs.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), ribs[0]);

  const ends = span
    ? [
        { label: "Span start", caption: "Starts at", value: span.start, min: 0, max: Math.max(0, span.end - 1), apply: (v: number) => span.set(v, span.end), align: "left" as const },
        { label: "Span end", caption: "Ends at", value: span.end, min: Math.min(len, span.start + 1), max: len, apply: (v: number) => span.set(span.start, v), align: "right" as const },
      ]
    : [];
  const bad = span && span.end <= span.start ? "The end must be past the start." : null;
  const past = span && span.end > len ? `Ends ${formatLength(span.end - len, units)} past the tip of this panel.` : null;

  return (
    <Section title={label}>
      <div className="relative">
        <PlanformDrawing
          panel={panel}
          ribs
          maxHeight={300}
          region={{ ...region, colour }}
          highlight={new Set(affectedRibs(panel, pick))}
          handles={
            span
              ? {
                  snap: snap ? ribs : undefined,
                  chordPos: span.chordPos,
                  start: { label: "Drag the start of the span", value: span.start, min: 0, max: Math.max(0, span.end - 1), onChange: (v) => span.set(v, span.end) },
                  end: { label: "Drag the end of the span", value: span.end, min: Math.min(len, span.start + 1), max: len, onChange: (v) => span.set(span.start, v) },
                }
              : undefined
          }
        />
        {span && (
          <label className="absolute bottom-1 right-1 flex items-center gap-1.5 rounded-sm border border-border-input bg-surface-raised px-2 py-1 text-xs shadow-card">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => {
                setSnap(e.target.checked);
                if (!e.target.checked || ribs.length === 0) return;
                const a = near(span.start);
                let b = near(span.end);
                if (b <= a) b = ribs.find((r) => r > a) ?? b;
                if (a !== span.start || b !== span.end) span.set(a, Math.max(b, a));
              }}
            />
            Snap to rib
          </label>
        )}
      </div>
      {span && (
        <div className="mt-2 flex justify-between gap-3">
          {ends.map((e) => (
            <Value key={e.label} caption={e.caption} align={e.align}>
              <Editable
                label={e.label}
                drag={{ value: e.value, step: dragStepFor(2, units), min: e.min, max: e.max, stops: snap ? ribs : undefined, onChange: (v) => e.apply(v) }}
                display={formatLength(e.value, units, 1)}
                edit={<LengthField label={e.label} value={e.value} min={0} max={len} step={5} onCommit={(v) => e.apply(v)} />}
              />
            </Value>
          ))}
        </div>
      )}
      {span && (bad || past) && <p className="mt-1 text-xs text-warning">{bad ?? past}</p>}
    </Section>
  );
}
