/**
 * The pieces every feature's details are made of: sections, click-to-edit values, choices between a few things, an Advanced
 * disclosure, the frame with its name and the picture of the feature on the panel's ribs.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Color, Measure, Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { useStore } from "../../state/store";
import { ColourDialog } from "../ColourDialog";
import { LengthField } from "../LengthField";
import { NumberField, TextField } from "../primitives";
import { Editable, Value } from "./Editable";
import { RibDrawing, useFeatureRibs } from "./FeatureCard";
import { featuresOf, type Pick } from "./panelFeatures";

/* ------------------------------------------------------------------ pieces */

/** One drag step, in millimetres: the step given, or its nearest tidy fraction of an inch. */
export const dragStepFor = (stepMm: number, units: "mm" | "in") => (units === "mm" ? stepMm : stepMm <= 1 ? 0.01 * 25.4 : stepMm <= 5 ? 0.05 * 25.4 : 0.25 * 25.4);

export function Section({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-lg bg-surface px-4 py-3 ${className}`}>
      {title && <h4 className="mb-2 text-micro text-muted">{title}</h4>}
      {children}
    </section>
  );
}

/** A group of values side by side, wrapping when there is no room. */
export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-3">{children}</div>;
}

export function TextValue({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return <Editable label={label} className={className} display={<span className="text-base font-medium">{value || "Unnamed"}</span>} edit={<TextField aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />} />;
}

/** A length that is text until clicked, and can be dragged. */
export function LenValue({ caption, label, mm, onCommit, min = 0, max, step = 1, invalid, warning }: { caption: string; label: string; mm: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; invalid?: string | null; warning?: string | null }) {
  const units = useStore((s) => s.doc.displayUnits);
  return (
    <Value caption={caption}>
      <Editable
        label={label}
        drag={{ value: mm, step: dragStepFor(step, units), min, max, onChange: onCommit }}
        display={formatLength(mm, units, 1)}
        edit={<LengthField label={label} value={mm} min={min} max={max} step={step} invalid={invalid} warning={warning} onCommit={onCommit} />}
      />
    </Value>
  );
}

export function PctValue({ caption, label, value, onCommit, min = 0, max = 100, step = 5 }: { caption: string; label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <Value caption={caption}>
      <Editable
        label={label}
        drag={{ value, step, min, max, onChange: onCommit }}
        display={`${value.toFixed(1)}%`}
        edit={<LengthField percent label={label} value={value} min={min} max={max} step={step} decimals={1} onCommit={onCommit} />}
      />
    </Value>
  );
}

export function DegValue({ caption, label, value, onCommit, min, max, step = 1 }: { caption: string; label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <Value caption={caption}>
      <Editable
        label={label}
        drag={{ value, step, min, max, onChange: onCommit }}
        display={`${value.toFixed(1)}°`}
        edit={<NumberField label={label} value={value} unit="deg" min={min} max={max} step={step} onCommit={onCommit} />}
      />
    </Value>
  );
}

/** A measure that is a percentage of the chord or a length: text until clicked, with a chip that swaps the unit (converting, not reinterpreting). */
export function MeasureValue({ caption, label, m, chordMm, onChange, step = 1 }: { caption: string; label: string; m: Measure; chordMm: number; onChange: (m: Measure) => void; step?: number }) {
  const units = useStore((s) => s.doc.displayUnits);
  const pct = m.unit === "pct";
  // Swap the unit, converting rather than reinterpreting: 25% of a 220 mm chord is 55 mm.
  const to = (unit: "pct" | "mm") => {
    if (unit === m.unit) return;
    const v = unit === "mm" ? (m.value / 100) * chordMm : chordMm === 0 ? 0 : (m.value / chordMm) * 100;
    onChange({ unit, value: Number(v.toFixed(3)) });
  };
  return (
    <div className="min-w-0">
      <div className="text-micro text-muted">{caption}</div>
      <Choice label={`${label} unit`} value={m.unit} options={[{ value: "pct", label: "Percentage" }, { value: "mm", label: "Units" }]} onChange={to} />
      <div className="mt-2 flex min-h-7 items-center text-sm font-medium">
        <Editable
          label={label}
          drag={{ value: m.value, step: pct ? step : dragStepFor(step, units), min: 0, onChange: (v) => onChange({ ...m, value: v }) }}
          display={pct ? `${m.value.toFixed(1)}%` : formatLength(m.value, units, 1)}
          edit={<LengthField percent={pct} label={label} value={m.value} min={0} step={pct ? step : step * 2} decimals={pct ? 1 : undefined} onCommit={(v) => onChange({ ...m, value: v })} />}
        />
      </div>
    </div>
  );
}

/** A choice between a few things, as buttons. `icon` draws a small picture of each. */
export function Choice<T extends string>({ label, caption, value, options, onChange }: { label: string; caption?: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="min-w-0">
      {caption && <div className="text-micro text-muted">{caption}</div>}
      <div role="group" aria-label={label} className="mt-1 flex w-fit max-w-full flex-wrap overflow-hidden rounded-sm border border-border-input">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`flex h-8 items-center gap-1.5 px-2.5 text-xs ${value === o.value ? "bg-selected text-on-selected" : "bg-input-bg text-muted hover:text-fg"}`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Less-used options, behind a disclosure. */
export function Advanced({ children, open: initial = false }: { children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    if (initial) setOpen(true);
  }, [initial]);
  return (
    <div className="mt-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted hover:text-fg">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "rotate-90" : ""}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        Advanced
      </button>
      {open && <div className="mt-2 grid gap-4 rounded-md bg-surface-sunken px-3 py-3">{children}</div>}
    </div>
  );
}

/** The feature on the panel's own first and last ribs: what it takes away (or adds) in its colour. */
export function Figure({ panel, pick, colour, adds }: { panel: Panel; pick: Pick; colour: string; adds?: boolean }) {
  const units = useStore((s) => s.doc.displayUnits);
  const ribs = useFeatureRibs(panel, pick);
  if (ribs.length === 0) return <p className="rounded-lg bg-surface px-4 py-6 text-center text-xs text-muted">No rib is touched by this yet, so there is nothing to draw it on.</p>;
  return (
    <div className="grid gap-2">
      {ribs.map((r, i) => (
        <RibDrawing key={r.ribId} rib={r} colour={colour} units={units} adds={adds} tall caption={`Rib ${r.index + 1}${ribs.length > 1 ? (i === 0 ? " (first)" : " (last)") : ""}`} />
      ))}
    </div>
  );
}

export const colourOf = (panel: Panel, pick: Pick) => featuresOf(panel).find((f) => f.pick.k === pick.k && ("id" in f.pick && "id" in pick ? f.pick.id === pick.id : true))?.colour ?? "var(--wb-geo-rib)";

/**
 * A feature's colour as a circle before its name, like the one on its card. Clicking it opens the colour dialog. "Standard" is
 * the part's own default colour, which `standard` supplies.
 */
export function ColourDot({ label, value, standard, onChange }: { label: string; value: Color; standard: string; onChange: (c: Color) => void }) {
  const [open, setOpen] = useState(false);
  const std = value === "standard";
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${std ? "standard" : value}. Change.`}
        title="Change the colour"
        onClick={() => setOpen(true)}
        className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-border-strong shadow-card hover:ring-2 hover:ring-accent"
        style={{ backgroundColor: std ? standard : value }}
      />
      {open && (
        <ColourDialog
          current={value}
          title={label}
          onCancel={() => setOpen(false)}
          onChoose={(c) => {
            setOpen(false);
            onChange(c);
          }}
        />
      )}
    </>
  );
}

/** The frame every feature shares: its name and kind, then the picture, then the values. */
export function Frame({ name, nameLabel, onName, kind, aside, dot, children }: { name: string; nameLabel: string; onName?: (v: string) => void; kind?: ReactNode; /** values shown at the top right, level with the name */ aside?: ReactNode; /** a colour circle before the name */ dot?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        {dot}
        <div className="min-w-0 flex-1">
          {onName ? <TextValue label={nameLabel} value={name} onChange={onName} /> : <span className="px-1.5 text-base font-medium">{name}</span>}
          {kind && <div className="px-1.5 text-xs text-muted">{kind}</div>}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap justify-end gap-x-6 gap-y-2" data-frame-aside>{aside}</div>}
      </div>
      {children}
    </div>
  );
}


/** A value picked from a short list, shown as text: click for the list. */
export function TypePicker<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Editable
      label={label}
      display={<span className="text-xs">{options.find((o) => o.value === value)?.label}</span>}
      edit={
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="h-ctl rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      }
    />
  );
}

