import { Checkbox, Field, FieldGrid, NumberField, Radio } from "../primitives";
import { LengthField } from "../LengthField";
import type { Spar } from "../../domain/schema";

/** The hinge of an aileron: which side it is on, whether it is cut right off, the gap and the angles, and the walls. */
export function AileronFields({ aileron, onChange }: { aileron: NonNullable<Spar["aileron"]>; onChange: (a: NonNullable<Spar["aileron"]>) => void }) {
  const set = (patch: Partial<typeof aileron>) => onChange({ ...aileron, ...patch });
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="mb-3 text-micro font-medium uppercase tracking-[.07em] text-muted">Hinge</h4>
      <FieldGrid>
        <Field label="Hinge side:">
          <div role="radiogroup" aria-label="Hinge side" className="flex gap-6">
            <Radio name="ail-hinge" checked={aileron.hinge === "above"} onChange={() => set({ hinge: "above" })}>
              Above (cut from below)
            </Radio>
            <Radio name="ail-hinge" checked={aileron.hinge === "below"} onChange={() => set({ hinge: "below" })}>
              Below (cut from above)
            </Radio>
          </div>
        </Field>
        <Field label="Cut-off:" hint={aileron.cutOff ? "The rib comes out in two pieces, a wing and an aileron." : "One piece: the skin on the hinge side holds them together."}>
          <div role="radiogroup" aria-label="Cut-off" className="flex gap-6">
            <Radio name="ail-cutoff" checked={aileron.cutOff} onChange={() => set({ cutOff: true })}>
              Cut right off
            </Radio>
            <Radio name="ail-cutoff" checked={!aileron.cutOff} onChange={() => set({ cutOff: false })}>
              Keep attached
            </Radio>
          </div>
        </Field>
        <Field label="Gap:">
          <LengthField label="Gap width" value={aileron.widthMm} min={0} step={0.5} onCommit={(v) => set({ widthMm: v })} />
        </Field>
        <Field label="Cut depth:" hint="How far through a hinge that stays attached.">
          <LengthField percent label="Cut depth" disabled={aileron.cutOff} value={aileron.cutPct} min={1} max={99} step={5} decimals={1} onCommit={(v) => set({ cutPct: v })} />
        </Field>
        <Field label="Wing side angle:">
          <NumberField label="Angle on the wing side" unit="deg" value={aileron.alphaDeg} min={0} max={80} step={5} onCommit={(v) => set({ alphaDeg: v })} />
        </Field>
        <Field label="Aileron side angle:">
          <NumberField label="Angle on the aileron side" unit="deg" value={aileron.betaDeg} min={0} max={80} step={5} onCommit={(v) => set({ betaDeg: v })} />
        </Field>
      </FieldGrid>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <Checkbox checked={aileron.closeLE.enabled} onChange={(v) => set({ closeLE: { ...aileron.closeLE, enabled: v } })}>
            Close the wing's cut face
          </Checkbox>
          <div className="w-32">
            <LengthField label="Wing wall width" disabled={!aileron.closeLE.enabled} value={aileron.closeLE.widthMm} min={0.1} step={0.5} onCommit={(v) => set({ closeLE: { ...aileron.closeLE, widthMm: v } })} />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Checkbox checked={aileron.closeTE.enabled} onChange={(v) => set({ closeTE: { ...aileron.closeTE, enabled: v } })}>
            Close the aileron's cut face
          </Checkbox>
          <div className="w-32">
            <LengthField label="Aileron wall width" disabled={!aileron.closeTE.enabled} value={aileron.closeTE.widthMm} min={0.1} step={0.5} onCommit={(v) => set({ closeTE: { ...aileron.closeTE, widthMm: v } })} />
          </div>
        </div>
      </div>
    </div>
  );
}
