/** The Construction tab: rib combs (and, beside them, lightening holes). */
import { useState } from "react";
import type { Panel, RibComb } from "../../domain/schema";
import { defaultComb } from "../../geometry/combs";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { ColourButton } from "../ColourButton";
import { LengthField } from "../LengthField";
import { Button, Checkbox, Empty, Field, FieldGrid, GroupBox, NumberField, Radio, Tabs } from "../primitives";
import { SpanField } from "./SheetingTab";

export function CombEditor({ panel, comb }: { panel: Panel; comb: RibComb }) {
  const units = useStore((s) => s.doc.displayUnits);
  const set = (patch: Partial<RibComb>, label?: string) => ops.updateComb(panel.id, comb.id, patch, label);
  return (
    <GroupBox title="Comb data">
      <FieldGrid>
        <Field label="Name:">
          <input
            aria-label="Comb name"
            value={comb.name}
            onChange={(e) => set({ name: e.target.value }, "comb name")}
            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
          />
        </Field>
        <Field label="Side:">
          <div role="radiogroup" aria-label="Comb side" className="flex gap-6">
            {(["above", "below"] as const).map((t) => (
              <Radio key={t} name={`comb-side-${comb.id}`} checked={comb.type === t} onChange={() => set({ type: t }, "comb side")}>
                {t === "above" ? "Above (top surface)" : "Below (bottom surface)"}
              </Radio>
            ))}
          </div>
        </Field>
        <Field label="Colour:">
          <ColourButton label="Comb colour" standardVar="--wb-geo-comb" value={comb.color} onChange={(c) => set({ color: c }, "comb colour")} />
        </Field>
        <Field label="Distance from:">
          <div role="radiogroup" aria-label="Comb datum" className="flex gap-6">
            {(["LE", "TE"] as const).map((d) => (
              <Radio key={d} name={`comb-from-${comb.id}`} checked={comb.distanceFrom === d} onChange={() => set({ distanceFrom: d }, "comb datum")}>
                {d === "LE" ? "Leading edge" : "Trailing edge"}
              </Radio>
            ))}
          </div>
        </Field>
        <Field label="Distance:">
          <SpanField label="Comb distance" span={comb.distance} chordMm={panel.rootChordMm} lengthLabel={units} onChange={(distance) => set({ distance }, "comb distance")} />
        </Field>
        <Field label="Angle:" hint="90° stands square to the chord">
          <NumberField label="Comb angle" value={comb.angleDeg} unit="deg" min={30} max={150} step={1} onCommit={(v) => set({ angleDeg: v }, "comb angle")} />
        </Field>
        <Field label="Width:">
          <LengthField label="Comb width" value={comb.widthMm} min={0.1} max={50} step={0.5} onCommit={(v) => set({ widthMm: v }, "comb width")} />
        </Field>
        <Field label="Extend:" hint={comb.asTabs ? "Not used when the comb is only tabs" : "How far the wall stands proud of the surface"}>
          <LengthField label="Comb extend" value={comb.extendMm} min={0} max={100} step={0.5} disabled={comb.asTabs} onCommit={(v) => set({ extendMm: v }, "comb extend")} />
        </Field>
        <Field label="Cut into rib:">
          <LengthField label="Cut into rib" percent value={comb.cutIntoRibPct} min={0} max={100} step={5} decimals={1} onCommit={(v) => set({ cutIntoRibPct: v }, "comb cut")} />
        </Field>
        <Field label="Gap (fore):">
          <LengthField label="Comb gap fore" value={comb.gapForeMm} min={0} max={20} step={0.1} onCommit={(v) => set({ gapForeMm: v }, "comb gap")} />
        </Field>
        <Field label="Gap (aft):">
          <LengthField label="Comb gap aft" value={comb.gapAftMm} min={0} max={20} step={0.1} onCommit={(v) => set({ gapAftMm: v }, "comb gap")} />
        </Field>
        <Field label="Needle adjustment:" hint="Extra slot depth for the needle or pin that sets the comb">
          <LengthField label="Needle adjustment" value={comb.needleAdjustmentMm} min={0} max={20} step={0.1} onCommit={(v) => set({ needleAdjustmentMm: v }, "comb needle")} />
        </Field>
        <Field label="Slit height:" hint="How far the teeth reach below the slot floor">
          <LengthField label="Slit height" value={comb.slitHeightMm} min={0} max={50} step={0.5} onCommit={(v) => set({ slitHeightMm: v }, "comb slit")} />
        </Field>
        <Field label="Slit adjust:" hint="Extra room in each slit, beyond the rib's thickness">
          <LengthField label="Slit adjust" value={comb.slitAdjustMm} min={0} max={10} step={0.1} onCommit={(v) => set({ slitAdjustMm: v }, "comb slit")} />
        </Field>
        <Field label="Span start:">
          <LengthField label="Comb span start" value={comb.spanStartMm} min={0} max={panel.lengthMm} step={5} onCommit={(v) => set({ spanStartMm: v }, "comb span")} />
        </Field>
        <Field label="Span end:">
          <LengthField
            label="Comb span end"
            value={comb.spanEndMm}
            min={0}
            max={panel.lengthMm}
            step={5}
            invalid={comb.spanEndMm <= comb.spanStartMm ? "The end must be past the start." : null}
            onCommit={(v) => set({ spanEndMm: v }, "comb span")}
          />
        </Field>
      </FieldGrid>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={comb.asTabs} onChange={(v) => set({ asTabs: v }, "comb tabs")}>As tabs: a short block at each rib, no wall between</Checkbox>
        <Checkbox checked={comb.leveled} onChange={(v) => set({ leveled: v }, "comb leveled")}>Leveled: every slot as deep as the shallowest</Checkbox>
      </div>
    </GroupBox>
  );
}

function RibCombs({ panel }: { panel: Panel }) {
  const units = useStore((s) => s.doc.displayUnits);
  const [picked, setPicked] = useState<string | null>(null);
  const comb = panel.ribCombs.find((c) => c.id === picked) ?? panel.ribCombs[0] ?? null;
  const ribNumber = (mm: number, last: boolean) => {
    const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);
    const inside = sorted.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) => r.positionMm >= (comb?.spanStartMm ?? 0) - 1e-6 && r.positionMm <= (comb?.spanEndMm ?? 0) + 1e-6);
    void mm;
    return inside.length === 0 ? "–" : String((last ? inside[inside.length - 1] : inside[0]).n);
  };
  return (
    <>
      <GroupBox title="Combs">
        <div className="mb-3 flex gap-3">
          <Button
            onClick={() => {
              const n = defaultComb(panel, `Comb ${panel.ribCombs.length + 1}`, panel.ribCombs.length % 2 === 0 ? "below" : "above");
              ops.addComb(panel.id, n, comb?.id);
              setPicked(n.id);
            }}
          >
            Add comb
          </Button>
          <Button variant="danger" disabled={!comb} onClick={() => comb && ops.removeComb(panel.id, comb.id)}>
            Delete comb
          </Button>
        </div>
        {panel.ribCombs.length === 0 ? (
          <Empty title="No combs yet">A comb is a wall along the span that the ribs slot into. Add one with the button above.</Empty>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Name", "Side", "Span", "Colour"].map((h) => (
                    <th key={h} scope="col" className="h-ctl border-b border-border bg-surface-sunken px-3 text-left text-micro font-medium uppercase tracking-[.05em] text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {panel.ribCombs.map((c) => {
                  const sel = c.id === comb?.id;
                  return (
                    <tr key={c.id} aria-selected={sel} className={sel ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"}>
                      <td className="h-ctl border-b border-border px-0">
                        <button type="button" aria-current={sel || undefined} onClick={() => setPicked(c.id)} className="block h-ctl w-full truncate px-3 text-left" title={c.name}>
                          {c.name}
                        </button>
                      </td>
                      <td className="h-ctl border-b border-border px-3 text-xs">{c.type === "above" ? "Above" : "Below"}</td>
                      <td className="h-ctl border-b border-border px-3 text-xs tabular-nums">
                        {formatLength(c.spanStartMm, units, 0)} – {formatLength(c.spanEndMm, units, 0)}
                      </td>
                      <td className="h-ctl border-b border-border px-3">
                        <span
                          role="img"
                          aria-label={c.color === "standard" ? "Standard colour" : `Colour ${c.color}`}
                          className="inline-block h-3.5 w-7 rounded-sm border border-border-strong align-middle"
                          style={{ backgroundColor: c.color === "standard" ? "var(--wb-geo-comb)" : c.color }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {comb && (
          <p className="mt-2 text-xs text-muted" aria-label="Ribs the comb crosses">
            Crosses ribs {ribNumber(0, false)} to {ribNumber(0, true)}.
          </p>
        )}
      </GroupBox>
      {comb && <CombEditor panel={panel} comb={comb} />}
    </>
  );
}

export function LighteningHoles({ panel }: { panel: Panel }) {
  const h = panel.lighteningHoles;
  const set = (patch: Partial<typeof h>, label?: string) => ops.updateHoles(panel.id, patch, label);
  const on = h.type !== "none";
  return (
    <>
      <GroupBox title="Type">
        <div role="radiogroup" aria-label="Lightening hole type" className="flex flex-wrap gap-x-8 gap-y-2">
          <Radio name={`holes-${panel.id}`} checked={h.type === "none"} onChange={() => set({ type: "none" }, "lightening holes type")}>None</Radio>
          <Radio name={`holes-${panel.id}`} checked={h.type === "standard"} onChange={() => set({ type: "standard" }, "lightening holes type")}>Standard</Radio>
        </div>
        {!on && <p className="mt-3 text-xs text-muted">No holes: the web of each rib is left solid.</p>}
      </GroupBox>
      {on && (
        <GroupBox title="Standard holes">
          <p className="mb-4 max-w-prose text-xs text-muted">
            Holes through the web of each rib, between the nose and tail margins, kept clear of spars, edge stock and the surfaces.
          </p>
          <FieldGrid>
            <Field label="Width (minimum):" hint="A gap narrower than this gets no hole">
              <LengthField label="Hole width minimum" value={h.minWidthMm} min={1} max={500} step={1} onCommit={(v) => set({ minWidthMm: v }, "hole width")} />
            </Field>
            <Field label="Width (maximum):" hint="A wider gap is divided into several holes">
              <LengthField label="Hole width maximum" value={h.maxWidthMm} min={1} max={500} step={1} onCommit={(v) => set({ maxWidthMm: v }, "hole width")} />
            </Field>
            <Field label="Distance between holes:">
              <LengthField label="Distance between holes" value={h.minDistanceMm} min={0} max={100} step={0.5} onCommit={(v) => set({ minDistanceMm: v }, "hole spacing")} />
            </Field>
            <Field label="Distance from edge:" hint="Kept from the surface, inside any sheeting">
              <LengthField label="Hole distance from edge" value={h.distanceFromEdgeMm} min={0} max={50} step={0.5} onCommit={(v) => set({ distanceFromEdgeMm: v }, "hole edge")} />
            </Field>
            <Field label="Margin from nose:">
              <LengthField label="Hole margin from nose" value={h.minDistanceFromLEMm} min={0} max={500} step={1} onCommit={(v) => set({ minDistanceFromLEMm: v }, "hole margin")} />
            </Field>
            <Field label="Margin from tail:">
              <LengthField label="Hole margin from tail" value={h.minDistanceFromTEMm} min={0} max={500} step={1} onCommit={(v) => set({ minDistanceFromTEMm: v }, "hole margin")} />
            </Field>
            <Field label="Support width:" hint="Material left beside each spar">
              <LengthField label="Hole support width" value={h.supportWidthMm} min={0} max={100} step={0.5} onCommit={(v) => set({ supportWidthMm: v }, "hole support")} />
            </Field>
            <Field label="Roundness:">
              <LengthField label="Hole roundness" percent value={h.roundnessPct} min={0} max={100} step={5} decimals={0} disabled={!h.roundCorners} onCommit={(v) => set({ roundnessPct: v }, "hole roundness")} />
            </Field>
            <Field label="Smoothness:" hint="Points on each rounded corner">
              <NumberField label="Hole smoothness" value={h.smoothnessPoints} min={2} max={32} step={1} decimals={0} disabled={!h.roundCorners} onCommit={(v) => set({ smoothnessPoints: Math.round(v) }, "hole smoothness")} />
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <Checkbox checked={h.roundCorners} onChange={(v) => set({ roundCorners: v }, "hole corners")}>Round the corners</Checkbox>
          </div>
        </GroupBox>
      )}
    </>
  );
}

const SUB = [
  { id: "combs", label: "Rib comb" },
  { id: "holes", label: "Lightening holes" },
] as const;

export function ConstructionTab({ panel }: { panel: Panel }) {
  const [sub, setSub] = useState<string>("combs");
  return (
    <>
      <Tabs tabs={SUB as never} value={sub as never} onChange={(t) => setSub(t)} label="Construction helpers" />
      {sub === "combs" && <RibCombs panel={panel} />}
      {sub === "holes" && <LighteningHoles panel={panel} />}
    </>
  );
}
