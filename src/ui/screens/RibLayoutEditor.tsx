/**
 * The rib layout of a panel. The distribution is linear unless the user picks another: exponential and chord
 * proportional each have one number, and custom hands the positions to the rib table. Thickness and half ribs are
 * the panel's own value for every rib unless the user sets them rib by rib. In the table each value is text until
 * clicked, and anything that differs from what the layout would give is marked in orange. Shared by the full panel
 * window (as a form) and the builder's wing geometry view.
 */
import { useEffect, useState } from "react";
import type { Panel, RibLayout } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { calculatedPositions, chordAtMm, ribLayoutOf } from "../../geometry/ribDistribution";
import { ops, useStore } from "../../state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { LengthField } from "../LengthField";
import { Button, Checkbox, Field, FieldGrid, NumberField, type MenuItem } from "../primitives";
import { Editable } from "./Editable";

export type Distribution = RibLayout["distribution"];

export const DISTRIBUTIONS: { value: Distribution; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "exponential", label: "Exponential" },
  { value: "chord", label: "Chord proportional" },
  { value: "custom", label: "Custom" },
];
export const distributionLabel = (d: Distribution) => DISTRIBUTIONS.find((x) => x.value === d)!.label;

export const BIAS_HINT = "0 is even. Positive moves the ribs toward the root, negative toward the tip.";
export const PROPORTIONALITY_HINT = "0 ignores the chord. 1 spaces ribs in proportion to it, so they sit closer where it is narrow. 2 goes further. Negative does the opposite.";

export const chordsDiffer = (panel: Panel) => Math.abs(panel.rootChordMm - panel.tipChordMm) > 0.01;

/** What the layout is and how to change it, with the question that has to be answered before custom positions are thrown away. */
export function useRibLayout(panel: Panel) {
  const layout = ribLayoutOf(panel);
  const [asking, setAsking] = useState<Distribution | null>(null);
  const set = (patch: Partial<RibLayout>, label = "rib layout", also: Partial<Panel> = {}) => ops.updatePanel(panel.id, { ribLayout: { ...layout, ...patch }, ...also }, label);

  /** Take the ribs as they are and make their positions the user's. The shape they were made from is kept, to mark changes against. */
  const customize = () => {
    const d = layout.distribution;
    set(
      { distribution: "custom", bias: d === "exponential" ? layout.bias : 0, chordProportionality: d === "chord" ? layout.chordProportionality : 0 },
      "rib layout",
      { ribCountTarget: Math.max(2, panel.ribs.length) },
    );
  };

  const choose = (d: Distribution) => {
    if (d === layout.distribution) return;
    if (d === "custom") return customize();
    if (layout.distribution === "custom") return setAsking(d); // leaving custom replaces the table's positions
    set({ distribution: d });
  };

  const setThicknessCustom = (on: boolean) => set({ vary: { ...layout.vary, thickness: on } }, "rib thickness");
  const setHalfRibs = (on: boolean) => set({ vary: { ...layout.vary, half: on } }, "half ribs");

  const confirm = asking && (
    <ConfirmDialog
      title="Replace the custom ribs?"
      confirmLabel="Replace them"
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const d = asking;
        setAsking(null);
        set({ distribution: d });
      }}
    >
      <p>
        Changing to <strong>{distributionLabel(asking)}</strong> will place the ribs again and throw away the positions you set in the table.
      </p>
      <p className="mt-3 text-muted">You can bring them back with Edit ▸ Undo.</p>
    </ConfirmDialog>
  );
  return { layout, set, choose, customize, setThicknessCustom, setHalfRibs, confirm };
}

/** The items of the distribution menu. Chord proportional is only offered when the chord changes along the panel. */
export function distributionItems(panel: Panel, choose: (d: Distribution) => void, current: Distribution): MenuItem[] {
  return DISTRIBUTIONS.map((d) =>
    d.value === "chord" && !chordsDiffer(panel)
      ? { label: d.label, disabled: true, reason: "same chord at both ends" }
      : { label: d.label, onSelect: () => choose(d.value), current: d.value === current },
  );
}

/**
 * The rib table in a section of its own that opens and closes. It opens by itself when something in it becomes the
 * user's to set, and can be opened on a linear layout to read the positions.
 */
/**
 * Half ribs, in an Advanced section of their own above the rib table. A front half rib keeps the part ahead of its
 * cut line and a rear half rib the part behind its own, each measured from the nose; the table's Type column and the
 * buttons that fill it appear once half ribs are switched on.
 */
export function HalfRibsAdvanced({ panel, layout, setHalfRibs }: { panel: Panel; layout: RibLayout; setHalfRibs: (on: boolean) => void }) {
  const on = layout.vary.half;
  const [open, setOpen] = useState(on);
  useEffect(() => {
    if (on) setOpen(true);
  }, [on]);
  const rearPct = panel.halfRibRearCutPct ?? panel.halfRibCutPct;

  return (
    <div className="mt-7">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "rotate-90" : ""}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        Advanced
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-surface-sunken px-3 py-3">
          <Checkbox checked={on} onChange={setHalfRibs}>
            Half ribs
          </Checkbox>
          {on && (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <section aria-label="Front half ribs" className="rounded-md border border-border bg-surface px-3 py-3">
                  <h5 className="text-sm font-medium">Front half</h5>
                  <p className="mb-3 mt-0.5 text-xs text-muted">Keeps the part ahead of the cut.</p>
                  <FieldGrid>
                    <Field label="Cut at:">
                      <LengthField percent label="Front half cut line" value={panel.halfRibCutPct} min={5} max={95} step={5} decimals={1} onCommit={(v) => ops.updatePanel(panel.id, { halfRibCutPct: v }, "front half rib cut")} />
                    </Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Button onClick={() => ops.alternateHalfRibs(panel.id, "front")} disabled={panel.ribs.length < 3}>
                      Alternate front half ribs
                    </Button>
                  </div>
                </section>
                <section aria-label="Rear half ribs" className="rounded-md border border-border bg-surface px-3 py-3">
                  <h5 className="text-sm font-medium">Rear half</h5>
                  <p className="mb-3 mt-0.5 text-xs text-muted">Keeps the part behind the cut.</p>
                  <FieldGrid>
                    <Field label="Cut at:">
                      <LengthField percent label="Rear half cut line" value={rearPct} min={5} max={95} step={5} decimals={1} onCommit={(v) => ops.updatePanel(panel.id, { halfRibRearCutPct: v }, "rear half rib cut")} />
                    </Field>
                  </FieldGrid>
                  <div className="mt-3">
                    <Button onClick={() => ops.alternateHalfRibs(panel.id, "rear")} disabled={panel.ribs.length < 3}>
                      Alternate rear half ribs
                    </Button>
                  </div>
                </section>
              </div>
              <div className="mt-3">
                <Button onClick={() => ops.clearHalfRibs(panel.id)} disabled={!panel.ribs.some((r) => r.half)}>
                  Make all ribs full
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function RibTableSection({ panel, layout }: { panel: Panel; layout: RibLayout }) {
  const mine = layout.distribution === "custom" || layout.vary.thickness || layout.vary.half;
  const [open, setOpen] = useState(mine);
  useEffect(() => {
    if (mine) setOpen(true);
  }, [mine]);

  return (
    <div className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? "rotate-90" : ""}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        Rib table
        <span className="font-normal">({panel.ribs.length} ribs)</span>
      </button>
      {open && (
        <div className="mt-2">
          <p className="mb-3 text-xs text-muted">{mine ? "Click a value to change it, or drag it left and right." : "Where the layout puts each rib. Choose Custom to change them."}</p>
          <RibTable panel={panel} layout={layout} />
        </div>
      )}
    </div>
  );
}

export function RibLayoutEditor({ panel }: { panel: Panel }) {
  const units = useStore((s) => s.doc.displayUnits);
  const { layout, set, choose, setThicknessCustom, setHalfRibs, confirm } = useRibLayout(panel);
  const custom = layout.distribution === "custom";
  const pitch = panel.ribCountTarget < 2 ? panel.lengthMm : panel.lengthMm / (panel.ribCountTarget - 1);
  const tight = pitch < 8;
  const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);
  const first = sorted.length > 1 ? sorted[1].positionMm - sorted[0].positionMm : 0;
  const last = sorted.length > 1 ? sorted[sorted.length - 1].positionMm - sorted[sorted.length - 2].positionMm : 0;

  return (
    <>
      <FieldGrid>
        <Field label="Distribution:">
          <select
            aria-label="Rib distribution"
            value={layout.distribution}
            onChange={(e) => choose(e.target.value as Distribution)}
            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
          >
            {DISTRIBUTIONS.map((d) => (
              <option key={d.value} value={d.value} disabled={d.value === "chord" && !chordsDiffer(panel)}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        {!custom && (
          <Field label="No. of ribs:">
            <NumberField
              label="Number of ribs"
              value={panel.ribCountTarget}
              decimals={0}
              min={2}
              max={200}
              step={1}
              warning={tight ? `${formatLength(pitch, units, 1)} between ribs — that is very tight.` : null}
              onCommit={(v) => ops.updatePanel(panel.id, { ribCountTarget: Math.round(v) }, "rib count")}
            />
          </Field>
        )}
        {layout.distribution === "exponential" && (
          <Field label="Exponential bias:" hint={BIAS_HINT}>
            <NumberField label="Exponential bias" value={layout.bias} decimals={1} min={-3} max={3} step={0.1} onCommit={(v) => set({ bias: v })} />
          </Field>
        )}
        {layout.distribution === "chord" && (
          <Field label="Chord proportionality:" hint={PROPORTIONALITY_HINT}>
            <NumberField label="Chord proportionality" value={layout.chordProportionality} decimals={1} min={-2} max={2} step={0.1} onCommit={(v) => set({ chordProportionality: v })} />
          </Field>
        )}
        {!layout.vary.thickness && (
          <Field label="Rib thickness:">
            <LengthField label="Rib thickness" value={panel.ribThicknessMm} min={0.4} step={0.5} onCommit={(v) => ops.updatePanel(panel.id, { ribThicknessMm: v }, "rib thickness")} />
          </Field>
        )}
      </FieldGrid>
      <div className="mt-3">
        <Checkbox checked={layout.vary.thickness} onChange={setThicknessCustom}>
          Set each rib's thickness in the table
        </Checkbox>
      </div>

      {!custom && (
        <p className="mt-3 text-xs text-muted" data-rib-summary>
          {panel.ribs.length} ribs, {formatLength(first, units, 1)} apart at the root and {formatLength(last, units, 1)} at the tip (the chord is {formatLength(chordAtMm(panel, 0), units, 0)} to {formatLength(chordAtMm(panel, panel.lengthMm), units, 0)}).
        </p>
      )}

      <HalfRibsAdvanced panel={panel} layout={layout} setHalfRibs={setHalfRibs} />
      <RibTableSection panel={panel} layout={layout} />
      {confirm}
    </>
  );
}

/**
 * The ribs, one row each. A value is text until it is clicked, then a field until you leave it. In a custom layout
 * anything that differs from the calculated layout, or from the panel's own thickness, is marked in light orange.
 */
export function RibTable({ panel, layout }: { panel: Panel; layout: RibLayout }) {
  const { selection, select, geometry } = useStore();
  const units = useStore((s) => s.doc.displayUnits);
  const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);
  const warnings = geometry?.warnings ?? [];
  const posEdit = layout.distribution === "custom";
  // One drag step: a millimetre, or a twentieth of an inch.
  const posStep = units === "in" ? 0.05 * 25.4 : 1;
  const thickEdit = layout.vary.thickness;
  const halfEdit = layout.vary.half;
  const editable = posEdit || thickEdit || halfEdit;
  // What each rib would be if nothing had been touched, to say what has been.
  const calc = calculatedPositions({ ...panel, ribCountTarget: sorted.length });
  const moved = (i: number) => posEdit && Math.abs(sorted[i].positionMm - calc[i]) > 0.01;
  const thicker = (i: number) => thickEdit && Math.abs(sorted[i].thicknessMm - panel.ribThicknessMm) > 1e-6;
  const halved = (i: number) => halfEdit && !!sorted[i].half;
  const changedCount = sorted.filter((_, i) => moved(i) || thicker(i) || halved(i)).length;
  const mark = (on: boolean) => (on ? "bg-changed shadow-[inset_3px_0_0_0_var(--wb-changed-edge)]" : "");
  const half = (h: "front" | "rear" | null | undefined) => (h === "front" ? "Front half" : h === "rear" ? "Rear half" : "Full");

  const columns = ["Rib", "Position", thickEdit && "Thickness", halfEdit && "Type"].filter(Boolean) as string[];

  return (
    <>
      {posEdit && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => ops.addRib(panel.id, selection.ribId ?? undefined)}>Add rib</Button>
          <Button variant="danger" disabled={!selection.ribId || panel.ribs.length <= 2} onClick={() => selection.ribId && ops.removeRib(panel.id, selection.ribId)}>
            Delete rib
          </Button>
          {panel.ribs.length <= 2 && <p className="text-micro text-muted">A panel needs at least two ribs.</p>}
        </div>
      )}

      <div tabIndex={0} aria-label="Rib table" className="wb-scroll max-h-80 overflow-auto rounded-lg border border-border-strong bg-surface-raised">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Rib stations for {panel.name}. Position is measured from the root.</caption>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((h, i) => (
                <th key={h} scope="col" className={`h-7 border-b border-border-strong bg-surface-sunken px-3 text-micro font-medium uppercase tracking-[.06em] text-muted ${i === 0 || h === "Type" ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((rib, i) => {
              const sel = selection.ribId === rib.id;
              const bad = warnings.some((w) => w.ribId === rib.id);
              const base = "h-7 border-b border-border px-1 py-0";
              return (
                <tr
                  key={rib.id}
                  aria-selected={sel}
                  data-changed={moved(i) || thicker(i) || halved(i) ? "true" : undefined}
                  onFocusCapture={() => select({ ribId: rib.id })}
                  onClick={() => select({ ribId: rib.id })}
                  className={`${sel ? "outline outline-1 -outline-offset-1 outline-accent" : ""} hover:bg-surface-sunken/60`}
                >
                  <th scope="row" className={`${base} px-3 text-left font-mono text-micro font-normal ${bad ? "text-danger" : "text-muted"}`}>
                    Rib {i + 1}
                  </th>
                  <td className={`${base} text-right tabular-nums ${mark(moved(i))}`} data-changed={moved(i) || undefined} title={moved(i) ? "Moved from where the layout puts it" : undefined}>
                    {posEdit ? (
                      <Editable
                        cell
                        label={`Rib ${i + 1} position`}
                        // a rib cannot be dragged past its neighbours: that would swap rows under the pointer
                        drag={{
                          value: rib.positionMm,
                          step: posStep,
                          min: i > 0 ? sorted[i - 1].positionMm + 0.1 : 0,
                          max: i < sorted.length - 1 ? sorted[i + 1].positionMm - 0.1 : panel.lengthMm,
                          onChange: (v) => ops.updateRib(panel.id, rib.id, { positionMm: v }),
                        }}
                        display={formatLength(rib.positionMm, units, 2)}
                        edit={<LengthField label={`Rib ${i + 1} position`} value={rib.positionMm} min={0} max={panel.lengthMm} step={5} onCommit={(v) => ops.updateRib(panel.id, rib.id, { positionMm: v })} />}
                      />
                    ) : (
                      <span className="block px-2">{formatLength(rib.positionMm, units, 2)}</span>
                    )}
                  </td>
                  {thickEdit && (
                    <td className={`${base} text-right tabular-nums ${mark(thicker(i))}`} data-changed={thicker(i) || undefined} title={thicker(i) ? "Different from the panel's rib thickness" : undefined}>
                      <Editable
                        cell
                        label={`Rib ${i + 1} thickness`}
                        drag={{ value: rib.thicknessMm, step: 0.5, min: 0.4, onChange: (v) => ops.updateRib(panel.id, rib.id, { thicknessMm: v }) }}
                        display={formatLength(rib.thicknessMm, units, 2)}
                        edit={<LengthField label={`Rib ${i + 1} thickness`} value={rib.thicknessMm} min={0.4} step={0.5} onCommit={(v) => ops.updateRib(panel.id, rib.id, { thicknessMm: v })} />}
                      />
                    </td>
                  )}
                  {halfEdit && (
                    <td className={`${base} ${mark(halved(i))}`} data-changed={halved(i) || undefined} title={halved(i) ? "A half rib" : undefined}>
                      <Editable
                        cell
                        label={`Rib ${i + 1} type`}
                        display={<span className="block text-left">{half(rib.half)}</span>}
                        edit={
                          <select
                            aria-label={`Rib ${i + 1} type`}
                            value={rib.half ?? "full"}
                            onChange={(e) => ops.setRibHalf(panel.id, rib.id, e.target.value === "full" ? null : (e.target.value as "front" | "rear"))}
                            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
                          >
                            <option value="full">Full</option>
                            <option value="front">Front half</option>
                            <option value="rear">Rear half</option>
                          </select>
                        }
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <p className="mt-2 flex items-center gap-2 text-micro text-muted" data-change-legend>
          <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm bg-changed shadow-[inset_3px_0_0_0_var(--wb-changed-edge)]" />
          {changedCount === 0 ? "Orange marks what you change." : `${changedCount} ${changedCount === 1 ? "rib differs" : "ribs differ"} from what the layout gives.`}
        </p>
      )}

    </>
  );
}
