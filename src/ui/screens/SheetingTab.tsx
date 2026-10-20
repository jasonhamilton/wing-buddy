/** The Sheeting tab: none, one standard sheet from the leading edge, or a list of named strips. */
import { useState } from "react";
import type { Measure, Panel, SheetStrip, Span } from "../../domain/schema";
import { defaultStrip } from "../../geometry/sheeting";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { ColourButton } from "../ColourButton";
import { LengthField } from "../LengthField";
import { Button, Checkbox, Empty, Field, FieldGrid, GroupBox, Radio, UnitToggle } from "../primitives";

/** A distance given as a percentage of the chord or in length, optionally with its own end value along the span. */
export function SpanField({
  label,
  span,
  chordMm,
  onChange,
  lengthLabel,
}: {
  label: string;
  span: Span;
  chordMm: number;
  onChange: (s: Span) => void;
  lengthLabel: string;
}) {
  const unit = span.start.unit;
  const separate = span.end !== null;
  const convert = (m: Measure, to: "pct" | "mm"): Measure =>
    m.unit === to ? m : { unit: to, value: Number((to === "mm" ? (m.value / 100) * chordMm : chordMm === 0 ? 0 : (m.value / chordMm) * 100).toFixed(3)) };
  return (
    <div className="grid gap-2">
      <div className="flex items-start gap-3">
        <LengthField
          className="flex-1"
          label={`${label} (start)`}
          percent={unit === "pct"}
          value={span.start.value}
          min={0}
          step={unit === "pct" ? 1 : 2}
          decimals={unit === "pct" ? 1 : undefined}
          onCommit={(v) => onChange({ ...span, start: { ...span.start, value: v } })}
        />
        <UnitToggle
          label={`${label} unit`}
          lengthLabel={lengthLabel}
          unit={unit}
          onChange={(u) => onChange({ start: convert(span.start, u), end: span.end ? convert(span.end, u) : null })}
        />
      </div>
      <Checkbox checked={separate} onChange={(v) => onChange({ ...span, end: v ? { ...span.start } : null })}>
        Separate end value
      </Checkbox>
      {separate && span.end && (
        <LengthField
          label={`${label} (end)`}
          percent={unit === "pct"}
          value={span.end.value}
          min={0}
          step={unit === "pct" ? 1 : 2}
          decimals={unit === "pct" ? 1 : undefined}
          onCommit={(v) => onChange({ ...span, end: { ...span.end!, value: v } })}
        />
      )}
    </div>
  );
}

export function StripEditor({ panel, strip }: { panel: Panel; strip: SheetStrip }) {
  const units = useStore((s) => s.doc.displayUnits);
  const set = (patch: Partial<SheetStrip>, label?: string) => ops.updateStrip(panel.id, strip.id, patch, label);
  const noSurface = !strip.applyAbove && !strip.applyBelow;
  return (
    <GroupBox title="Strip data">
      <FieldGrid>
        <Field label="Name:">
          <input
            aria-label="Strip name"
            value={strip.name}
            onChange={(e) => set({ name: e.target.value }, "strip name")}
            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
          />
        </Field>
        <Field label="Colour:">
          <ColourButton label="Strip colour" standardVar="--wb-geo-sheeting" value={strip.color} onChange={(c) => set({ color: c }, "strip colour")} />
        </Field>
        <Field label="Starting at:">
          <div className="flex gap-6">
            {(["LE", "TE"] as const).map((d) => (
              <Radio key={d} name={`strip-from-${strip.id}`} checked={strip.startingAt === d} onChange={() => set({ startingAt: d }, "strip datum")}>
                {d === "LE" ? "Leading edge" : "Trailing edge"}
              </Radio>
            ))}
          </div>
        </Field>
        <Field label="Distance:">
          <SpanField label="Strip distance" span={strip.distance} chordMm={panel.rootChordMm} lengthLabel={units} onChange={(distance) => set({ distance }, "strip distance")} />
        </Field>
        <Field label="Length:">
          <SpanField label="Strip length" span={strip.length} chordMm={panel.rootChordMm} lengthLabel={units} onChange={(length) => set({ length }, "strip length")} />
        </Field>
        <Field label="Thickness:">
          <LengthField label="Strip thickness" value={strip.thicknessMm} min={0.1} max={20} step={0.5} onCommit={(v) => set({ thicknessMm: v }, "strip thickness")} />
        </Field>
        <Field label="Span start:">
          <LengthField label="Strip span start" value={strip.spanStartMm} min={0} max={panel.lengthMm} step={5} onCommit={(v) => set({ spanStartMm: v }, "strip span")} />
        </Field>
        <Field label="Span end:" hint={strip.spanEndMm <= strip.spanStartMm ? undefined : `${formatLength(strip.spanEndMm - strip.spanStartMm, units, 0)} of span`}>
          <LengthField
            label="Strip span end"
            value={strip.spanEndMm}
            min={0}
            max={panel.lengthMm}
            step={5}
            invalid={strip.spanEndMm <= strip.spanStartMm ? "The end must be past the start." : null}
            onCommit={(v) => set({ spanEndMm: v }, "strip span")}
          />
        </Field>
      </FieldGrid>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={strip.applyAbove} onChange={(v) => set({ applyAbove: v }, "strip surface")}>Apply to the top surface</Checkbox>
        <Checkbox checked={strip.applyBelow} onChange={(v) => set({ applyBelow: v }, "strip surface")}>Apply to the bottom surface</Checkbox>
        <Checkbox checked={strip.capStrip} onChange={(v) => set({ capStrip: v }, "cap strip")}>Cap strip: one narrow strip on each rib</Checkbox>
      </div>
      {noSurface && <p className="mt-3 text-xs text-warning">This strip is on neither surface, so it does nothing.</p>}
    </GroupBox>
  );
}

export function SheetingTab({ panel }: { panel: Panel }) {
  const units = useStore((s) => s.doc.displayUnits);
  const [picked, setPicked] = useState<string | null>(null);
  const s = panel.sheeting;
  const strip = s.strips.find((x) => x.id === picked) ?? s.strips[0] ?? null;
  const std = s.standardLength ?? { unit: "pct" as const, value: 30 };
  const chord = panel.rootChordMm;

  const choose = (type: Panel["sheeting"]["type"]) =>
    ops.updateSheeting(
      panel.id,
      {
        type,
        // standard sheeting starts with a length and thickness rather than blanks
        ...(type === "standard" ? { standardLength: s.standardLength ?? { unit: "pct" as const, value: 30 }, standardThicknessMm: s.standardThicknessMm ?? 1.5 } : {}),
      },
      "sheeting type",
    );

  return (
    <>
      <GroupBox title="Type">
        <div role="radiogroup" aria-label="Sheeting type" className="flex flex-wrap gap-x-8 gap-y-2">
          <Radio name={`sheeting-${panel.id}`} checked={s.type === "none"} onChange={() => choose("none")}>None</Radio>
          <Radio name={`sheeting-${panel.id}`} checked={s.type === "standard"} onChange={() => choose("standard")}>Standard, from the leading edge</Radio>
          <Radio name={`sheeting-${panel.id}`} checked={s.type === "advanced"} onChange={() => choose("advanced")}>Advanced strips</Radio>
        </div>
        {s.type === "none" && <p className="mt-3 text-xs text-muted">No sheeting: the ribs are cut to the full airfoil.</p>}
      </GroupBox>

      {s.type === "standard" && (
        <GroupBox title="Standard sheeting">
          <p className="mb-4 max-w-prose text-xs text-muted">One sheet on the top and the bottom, from the leading edge back by the length below. The ribs are cut back by its thickness.</p>
          <FieldGrid>
            <Field label="Length:">
              <div className="flex items-start gap-3">
                <LengthField
                  className="flex-1"
                  label="Standard sheet length"
                  percent={std.unit === "pct"}
                  value={std.value}
                  min={1}
                  step={std.unit === "pct" ? 1 : 5}
                  decimals={std.unit === "pct" ? 1 : undefined}
                  onCommit={(v) => ops.updateSheeting(panel.id, { standardLength: { ...std, value: v } }, "standard sheet")}
                />
                <UnitToggle
                  label="Standard sheet length unit"
                  lengthLabel={units}
                  unit={std.unit}
                  onChange={(u) => {
                    if (u === std.unit) return;
                    const value = u === "mm" ? (std.value / 100) * chord : chord === 0 ? 0 : (std.value / chord) * 100;
                    ops.updateSheeting(panel.id, { standardLength: { unit: u, value: Number(value.toFixed(3)) } }, "standard sheet");
                  }}
                />
              </div>
            </Field>
            <Field label="Thickness:">
              <LengthField
                label="Standard sheet thickness"
                value={s.standardThicknessMm ?? 1.5}
                min={0.1}
                max={20}
                step={0.5}
                onCommit={(v) => ops.updateSheeting(panel.id, { standardThicknessMm: v }, "standard sheet")}
              />
            </Field>
          </FieldGrid>
        </GroupBox>
      )}

      {s.type === "advanced" && (
        <>
          <GroupBox title="Sheeting strips">
            <div className="mb-3 flex gap-3">
              <Button
                onClick={() => {
                  const n = defaultStrip(panel, `Strip ${s.strips.length + 1}`);
                  ops.addStrip(panel.id, n, strip?.id);
                  setPicked(n.id);
                }}
              >
                Add strip
              </Button>
              <Button variant="danger" disabled={!strip} onClick={() => strip && ops.removeStrip(panel.id, strip.id)}>
                Delete strip
              </Button>
            </div>
            {s.strips.length === 0 ? (
              <Empty title="No strips yet">Add one with the button above.</Empty>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {["Name", "Surfaces", "Span", "Colour"].map((h) => (
                        <th key={h} scope="col" className="h-ctl border-b border-border bg-surface-sunken px-3 text-left text-micro font-medium uppercase tracking-[.05em] text-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.strips.map((st) => {
                      const sel = st.id === strip?.id;
                      return (
                        <tr key={st.id} aria-selected={sel} className={sel ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"}>
                          <td className="h-ctl border-b border-border px-0">
                            <button type="button" aria-current={sel || undefined} onClick={() => setPicked(st.id)} className="block h-ctl w-full truncate px-3 text-left" title={st.name}>
                              {st.name}
                            </button>
                          </td>
                          <td className="h-ctl border-b border-border px-3 text-xs">
                            {[st.applyAbove && "top", st.applyBelow && "bottom"].filter(Boolean).join(" and ") || "none"}
                            {st.capStrip && " (cap)"}
                          </td>
                          <td className="h-ctl border-b border-border px-3 text-xs tabular-nums">
                            {formatLength(st.spanStartMm, units, 0)} – {formatLength(st.spanEndMm, units, 0)}
                          </td>
                          <td className="h-ctl border-b border-border px-3">
                            <span
                              role="img"
                              aria-label={st.color === "standard" ? "Standard colour" : `Colour ${st.color}`}
                              className="inline-block h-3.5 w-7 rounded-sm border border-border-strong align-middle"
                              style={{ backgroundColor: st.color === "standard" ? "var(--wb-geo-sheeting)" : st.color }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GroupBox>
          {strip && <StripEditor panel={panel} strip={strip} />}
        </>
      )}
    </>
  );
}
