/**
 * The details of the features other than spars and edge stock, set out like the wing geometry page: a picture of the feature
 * on the panel's own ribs, and the few values that matter as text you click or drag. Everything used less often waits behind
 * an Advanced section. The same fields the full panel window edits as a form.
 */
import type { Measure, Panel, RibComb, SheetStrip } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { ColourButton } from "../ColourButton";
import { Checkbox, NumberField } from "../primitives";
import { Editable, Value } from "./Editable";
import { Advanced, Choice, colourOf, DegValue, Figure, Frame, LenValue, MeasureValue, PctValue, Row, Section } from "./detailParts";
import { along, stripBand } from "../../geometry/sheeting";
import { FeatureTopView } from "./FeatureTopView";
import type { Pick } from "./panelFeatures";

/** The panel's chord at a station along the span, and how far along the panel (0 to 1) that is. */
const chordAt = (panel: Panel, mm: number) => panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * (panel.lengthMm > 0 ? mm / panel.lengthMm : 0);
const tAt = (panel: Panel, mm: number) => (panel.lengthMm > 0 ? mm / panel.lengthMm : 0);

/* ---------------------------------------------------------------- sheeting */

export function SheetDetail({ panel }: { panel: Panel }) {
  const s = panel.sheeting;
  const std: Measure = s.standardLength ?? { unit: "pct", value: 30 };
  const pick: Pick = { k: "sheet" };
  return (
    <Frame name="Standard sheeting" nameLabel="Sheeting name" kind="One sheet, top and bottom, from the leading edge">
      <Figure panel={panel} pick={pick} colour={colourOf(panel, pick)} />
      <FeatureTopView
        panel={panel}
        pick={pick}
        region={{
          points: [0, panel.lengthMm].flatMap((mm, i) => {
            const x1 = Math.min(chordAt(panel, mm), std.unit === "pct" ? (std.value / 100) * chordAt(panel, mm) : std.value);
            return i === 0 ? [{ mm, x: 0 }, { mm, x: x1 }] : [{ mm, x: x1 }, { mm, x: 0 }];
          }),
        }}
      />
      <Section title="Sheet">
        <Row>
          <LenValue caption="Thickness" label="Standard sheet thickness" mm={s.standardThicknessMm ?? 1.5} min={0.1} max={20} step={0.5} onCommit={(v) => ops.updateSheeting(panel.id, { standardThicknessMm: v }, "standard sheet")} />
          <MeasureValue caption="Length from the nose" label="Standard sheet length" m={std} chordMm={panel.rootChordMm} step={1} onChange={(m) => ops.updateSheeting(panel.id, { standardLength: m }, "standard sheet")} />
        </Row>
        <p className="mt-3 max-w-prose text-xs text-muted">The ribs are cut back by the sheet's thickness.</p>
      </Section>
    </Frame>
  );
}

export function StripDetail({ panel, strip }: { panel: Panel; strip: SheetStrip }) {
  const units = useStore((s) => s.doc.displayUnits);
  const set = (patch: Partial<SheetStrip>, label?: string) => ops.updateStrip(panel.id, strip.id, patch, label);
  const noSurface = !strip.applyAbove && !strip.applyBelow;
  const pick: Pick = { k: "strip", id: strip.id };
  const chord = panel.rootChordMm;
  return (
    <Frame name={strip.name} nameLabel="Strip name" onName={(v) => set({ name: v }, "strip name")} kind={strip.capStrip ? "Cap strip" : "Sheeting strip"}>
      <Figure panel={panel} pick={pick} colour={colourOf(panel, pick)} />
      <FeatureTopView
        panel={panel}
        pick={pick}
        region={(() => {
          // the band the strip covers at each end of its span: a strip at a datum with a length, drawn as the area it covers
          const at = (mm: number) => {
            const pos = Math.min(strip.spanEndMm, Math.max(strip.spanStartMm, mm));
            const b = stripBand(strip, chordAt(panel, pos), tAt(panel, pos), pos);
            return b ? { x0: b.x0, x1: b.x1 } : { x0: 0, x1: 0 };
          };
          const a = at(strip.spanStartMm);
          const z = at(strip.spanEndMm);
          return { points: [{ mm: strip.spanStartMm, x: a.x0 }, { mm: strip.spanEndMm, x: z.x0 }, { mm: strip.spanEndMm, x: z.x1 }, { mm: strip.spanStartMm, x: a.x1 }] };
        })()}
        span={{
          start: strip.spanStartMm,
          end: strip.spanEndMm,
          set: (start, end) => set({ spanStartMm: start, spanEndMm: end }, "strip span"),
          chordPos: (mm) => {
            const pos = Math.min(strip.spanEndMm, Math.max(strip.spanStartMm, mm));
            const b = stripBand(strip, chordAt(panel, pos), tAt(panel, pos), pos);
            return b ? (b.x0 + b.x1) / 2 : 0;
          },
        }}
      />
      <Section title="Strip">
        <Choice
          label="Strip starting at"
          caption="Measured from"
          value={strip.startingAt}
          options={[
            { value: "LE", label: "Leading edge" },
            { value: "TE", label: "Trailing edge" },
          ]}
          onChange={(d) => set({ startingAt: d }, "strip datum")}
        />
        <div className="mt-4">
          <Row>
            <MeasureValue caption="Distance" label="Strip distance" m={strip.distance.start} chordMm={chord} onChange={(start) => set({ distance: { ...strip.distance, start } }, "strip distance")} />
            <MeasureValue caption="Length" label="Strip length" m={strip.length.start} chordMm={chord} onChange={(start) => set({ length: { ...strip.length, start } }, "strip length")} />
            <LenValue caption="Thickness" label="Strip thickness" mm={strip.thicknessMm} min={0.1} max={20} step={0.5} onCommit={(v) => set({ thicknessMm: v }, "strip thickness")} />
          </Row>
        </div>
        {noSurface && <p className="mt-3 text-xs text-warning">This strip is on neither surface, so it does nothing.</p>}
      </Section>
      <Advanced>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox checked={strip.applyAbove} onChange={(v) => set({ applyAbove: v }, "strip surface")}>
            Apply to the top surface
          </Checkbox>
          <Checkbox checked={strip.applyBelow} onChange={(v) => set({ applyBelow: v }, "strip surface")}>
            Apply to the bottom surface
          </Checkbox>
          <Checkbox checked={strip.capStrip} onChange={(v) => set({ capStrip: v }, "cap strip")}>
            Cap strip: one narrow strip on each rib
          </Checkbox>
        </div>
        <Checkbox checked={strip.distance.end !== null} onChange={(v) => set({ distance: { ...strip.distance, end: v ? { ...strip.distance.start } : null } }, "strip distance")}>
          A different distance at the tip
        </Checkbox>
        {strip.distance.end && <MeasureValue caption="Distance at the tip" label="Strip distance at the tip" m={strip.distance.end} chordMm={chord} onChange={(end) => set({ distance: { ...strip.distance, end } }, "strip distance")} />}
        <Checkbox checked={strip.length.end !== null} onChange={(v) => set({ length: { ...strip.length, end: v ? { ...strip.length.start } : null } }, "strip length")}>
          A different length at the tip
        </Checkbox>
        {strip.length.end && <MeasureValue caption="Length at the tip" label="Strip length at the tip" m={strip.length.end} chordMm={chord} onChange={(end) => set({ length: { ...strip.length, end } }, "strip length")} />}
        <Row>
          <LenValue caption="Starts along the span" label="Strip span start" mm={strip.spanStartMm} max={panel.lengthMm} step={5} onCommit={(v) => set({ spanStartMm: v }, "strip span")} />
          <LenValue
            caption={strip.spanEndMm > strip.spanStartMm ? `Ends (${formatLength(strip.spanEndMm - strip.spanStartMm, units, 0)} of span)` : "Ends"}
            label="Strip span end"
            mm={strip.spanEndMm}
            max={panel.lengthMm}
            step={5}
            invalid={strip.spanEndMm <= strip.spanStartMm ? "The end must be past the start." : null}
            onCommit={(v) => set({ spanEndMm: v }, "strip span")}
          />
        </Row>
        <div>
          <div className="mb-1 text-micro text-muted">Colour</div>
          <ColourButton label="Strip colour" standardVar="--wb-geo-sheeting" value={strip.color} onChange={(c) => set({ color: c }, "strip colour")} />
        </div>
      </Advanced>
    </Frame>
  );
}

/* --------------------------------------------------------------- rib combs */

export function CombDetail({ panel, comb }: { panel: Panel; comb: RibComb }) {
  const set = (patch: Partial<RibComb>, label?: string) => ops.updateComb(panel.id, comb.id, patch, label);
  const pick: Pick = { k: "comb", id: comb.id };
  const chord = panel.rootChordMm;
  return (
    <Frame name={comb.name} nameLabel="Comb name" onName={(v) => set({ name: v }, "comb name")} kind="Rib comb">
      <Figure panel={panel} pick={pick} colour={colourOf(panel, pick)} />
      <FeatureTopView
        panel={panel}
        pick={pick}
        region={(() => {
          // the comb is a wall at its distance from the datum, as wide as the comb is
          const centre = (mm: number) => {
            const c = chordAt(panel, mm);
            const d = along(comb.distance, c, tAt(panel, mm));
            return comb.distanceFrom === "LE" ? d : c - d;
          };
          const w = Math.max(comb.widthMm, 1) / 2;
          const a = centre(comb.spanStartMm);
          const z = centre(comb.spanEndMm);
          return { points: [{ mm: comb.spanStartMm, x: a - w }, { mm: comb.spanEndMm, x: z - w }, { mm: comb.spanEndMm, x: z + w }, { mm: comb.spanStartMm, x: a + w }] };
        })()}
        span={{
          start: comb.spanStartMm,
          end: comb.spanEndMm,
          set: (start, end) => set({ spanStartMm: start, spanEndMm: end }, "comb span"),
          chordPos: (mm) => {
            const c = chordAt(panel, mm);
            const d = along(comb.distance, c, tAt(panel, mm));
            return comb.distanceFrom === "LE" ? d : c - d;
          },
        }}
      />
      <Section title="Comb">
        <Choice
          label="Comb side"
          caption="Side"
          value={comb.type}
          options={[
            { value: "above", label: "Top surface" },
            { value: "below", label: "Bottom surface" },
          ]}
          onChange={(t) => set({ type: t }, "comb side")}
        />
        <div className="mt-4">
          <Row>
            <MeasureValue caption={`From the ${comb.distanceFrom === "LE" ? "leading" : "trailing"} edge`} label="Comb distance" m={comb.distance.start} chordMm={chord} onChange={(start) => set({ distance: { ...comb.distance, start } }, "comb distance")} />
            <LenValue caption="Width" label="Comb width" mm={comb.widthMm} min={0.1} max={50} step={0.5} onCommit={(v) => set({ widthMm: v }, "comb width")} />
            <PctValue caption="Cut into the rib" label="Cut into rib" value={comb.cutIntoRibPct} onCommit={(v) => set({ cutIntoRibPct: v }, "comb cut")} />
          </Row>
        </div>
      </Section>
      <Advanced>
        <Choice
          label="Comb datum"
          caption="Distance from"
          value={comb.distanceFrom}
          options={[
            { value: "LE", label: "Leading edge" },
            { value: "TE", label: "Trailing edge" },
          ]}
          onChange={(d) => set({ distanceFrom: d }, "comb datum")}
        />
        <Row>
          <DegValue caption="Angle (90° is square to the chord)" label="Comb angle" value={comb.angleDeg} min={30} max={150} onCommit={(v) => set({ angleDeg: v }, "comb angle")} />
          <LenValue caption="Extend" label="Comb extend" mm={comb.extendMm} max={100} step={0.5} onCommit={(v) => set({ extendMm: v }, "comb extend")} />
          <LenValue caption="Gap fore" label="Comb gap fore" mm={comb.gapForeMm} max={20} step={0.1} onCommit={(v) => set({ gapForeMm: v }, "comb gap")} />
          <LenValue caption="Gap aft" label="Comb gap aft" mm={comb.gapAftMm} max={20} step={0.1} onCommit={(v) => set({ gapAftMm: v }, "comb gap")} />
        </Row>
        <Row>
          <LenValue caption="Needle adjustment" label="Needle adjustment" mm={comb.needleAdjustmentMm} max={20} step={0.1} onCommit={(v) => set({ needleAdjustmentMm: v }, "comb needle")} />
          <LenValue caption="Slit height" label="Slit height" mm={comb.slitHeightMm} max={50} step={0.5} onCommit={(v) => set({ slitHeightMm: v }, "comb slit")} />
          <LenValue caption="Slit adjust" label="Slit adjust" mm={comb.slitAdjustMm} max={10} step={0.1} onCommit={(v) => set({ slitAdjustMm: v }, "comb slit")} />
        </Row>
        <Row>
          <LenValue caption="Starts along the span" label="Comb span start" mm={comb.spanStartMm} max={panel.lengthMm} step={5} onCommit={(v) => set({ spanStartMm: v }, "comb span")} />
          <LenValue caption="Ends" label="Comb span end" mm={comb.spanEndMm} max={panel.lengthMm} step={5} invalid={comb.spanEndMm <= comb.spanStartMm ? "The end must be past the start." : null} onCommit={(v) => set({ spanEndMm: v }, "comb span")} />
        </Row>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox checked={comb.asTabs} onChange={(v) => set({ asTabs: v }, "comb tabs")}>
            As tabs: a short block at each rib, no wall between
          </Checkbox>
          <Checkbox checked={comb.leveled} onChange={(v) => set({ leveled: v }, "comb leveled")}>
            Leveled: every slot as deep as the shallowest
          </Checkbox>
        </div>
        <div>
          <div className="mb-1 text-micro text-muted">Colour</div>
          <ColourButton label="Comb colour" standardVar="--wb-geo-comb" value={comb.color} onChange={(c) => set({ color: c }, "comb colour")} />
        </div>
      </Advanced>
    </Frame>
  );
}

/* --------------------------------------------------------- lightening holes */

export function HolesDetail({ panel }: { panel: Panel }) {
  const h = panel.lighteningHoles;
  const set = (patch: Partial<typeof h>, label?: string) => ops.updateHoles(panel.id, patch, label);
  const pick: Pick = { k: "holes" };
  return (
    <Frame name="Lightening holes" nameLabel="Holes name" kind="Holes through the web of each rib">
      <Figure panel={panel} pick={pick} colour={colourOf(panel, pick)} />
      <Section title="Holes">
        <Row>
          <LenValue caption="Smallest hole" label="Hole width minimum" mm={h.minWidthMm} min={1} max={500} step={1} onCommit={(v) => set({ minWidthMm: v }, "hole width")} />
          <LenValue caption="Largest hole" label="Hole width maximum" mm={h.maxWidthMm} min={1} max={500} step={1} onCommit={(v) => set({ maxWidthMm: v }, "hole width")} />
          <LenValue caption="Between holes" label="Distance between holes" mm={h.minDistanceMm} max={100} step={0.5} onCommit={(v) => set({ minDistanceMm: v }, "hole spacing")} />
          <LenValue caption="From the surface" label="Hole distance from edge" mm={h.distanceFromEdgeMm} max={50} step={0.5} onCommit={(v) => set({ distanceFromEdgeMm: v }, "hole edge")} />
        </Row>
        <p className="mt-3 max-w-prose text-xs text-muted">A gap narrower than the smallest hole gets none; a wider one is divided into equal holes no wider than the largest.</p>
      </Section>
      <Advanced>
        <Row>
          <LenValue caption="Margin from the nose" label="Hole margin from nose" mm={h.minDistanceFromLEMm} max={500} step={1} onCommit={(v) => set({ minDistanceFromLEMm: v }, "hole margin")} />
          <LenValue caption="Margin from the tail" label="Hole margin from tail" mm={h.minDistanceFromTEMm} max={500} step={1} onCommit={(v) => set({ minDistanceFromTEMm: v }, "hole margin")} />
          <LenValue caption="Support beside each spar" label="Hole support width" mm={h.supportWidthMm} max={100} step={0.5} onCommit={(v) => set({ supportWidthMm: v }, "hole support")} />
        </Row>
        <Checkbox checked={h.roundCorners} onChange={(v) => set({ roundCorners: v }, "hole corners")}>
          Round the corners
        </Checkbox>
        {h.roundCorners && (
          <Row>
            <PctValue caption="Roundness" label="Hole roundness" value={h.roundnessPct} step={5} onCommit={(v) => set({ roundnessPct: v }, "hole roundness")} />
            <Value caption="Smoothness (points on each corner)">
              <Editable
                label="hole smoothness"
                drag={{ value: h.smoothnessPoints, step: 1, min: 2, max: 32, onChange: (v) => set({ smoothnessPoints: Math.round(v) }, "hole smoothness") }}
                display={h.smoothnessPoints}
                edit={<NumberField label="Hole smoothness" value={h.smoothnessPoints} min={2} max={32} step={1} decimals={0} onCommit={(v) => set({ smoothnessPoints: Math.round(v) }, "hole smoothness")} />}
              />
            </Value>
          </Row>
        )}
      </Advanced>
    </Frame>
  );
}

/* ----------------------------------------------------------- building tabs */

/** A switch that reads as a button, for the four places a tab can go. */
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`h-8 rounded-sm border px-3 text-xs ${on ? "border-accent bg-selected text-on-selected" : "border-border-input bg-input-bg text-muted hover:text-fg"}`}
    >
      {label}
    </button>
  );
}

export function TabsDetail({ panel }: { panel: Panel }) {
  const t = panel.buildingTabs;
  const set = (patch: Partial<typeof t>) => ops.updatePanel(panel.id, { buildingTabs: { ...t, ...patch } }, "building tabs");
  const pick: Pick = { k: "tabs" };
  const chord = panel.rootChordMm;
  return (
    <Frame name="Building tabs" nameLabel="Tabs name" kind="Stubs that pin each rib to the building board">
      <Figure panel={panel} pick={pick} colour={colourOf(panel, pick)} adds />
      <Section title="Where the tabs go">
        <div role="group" aria-label="Tab places" className="flex flex-wrap gap-2">
          <Toggle label="Below the rib" on={t.below} onChange={(v) => set({ below: v })} />
          <Toggle label="Above the rib" on={t.above} onChange={(v) => set({ above: v })} />
          <Toggle label="Near the leading edge" on={t.fore} onChange={(v) => set({ fore: v })} />
          <Toggle label="Near the trailing edge" on={t.aft} onChange={(v) => set({ aft: v })} />
        </div>
        {!t.below && !t.above && <p className="mt-3 text-xs text-warning">Pick above, below or both, or no tabs are cut.</p>}
        <div className="mt-4">
          <Row>
            <LenValue caption="Stick out by" label="Tab extension" mm={t.extendMm} min={0.5} step={1} onCommit={(v) => set({ extendMm: v })} />
            {t.fore && <LenValue caption="Fore tab width" label="Fore tab width" mm={t.widthLE} min={1} step={1} onCommit={(v) => set({ widthLE: v })} />}
            {t.aft && <LenValue caption="Aft tab width" label="Aft tab width" mm={t.widthTE} min={1} step={1} onCommit={(v) => set({ widthTE: v })} />}
          </Row>
        </div>
      </Section>
      <Advanced>
        <Row>
          {t.fore && <MeasureValue caption="Fore tab from the leading edge" label="Fore tab distance from the leading edge" m={t.fromLE} chordMm={chord} onChange={(m) => set({ fromLE: m })} />}
          {t.aft && <MeasureValue caption="Aft tab from the trailing edge" label="Aft tab distance from the trailing edge" m={t.fromTE} chordMm={chord} onChange={(m) => set({ fromTE: m })} />}
        </Row>
        <Checkbox checked={t.holes} onChange={(v) => set({ holes: v })}>
          Pin hole in each tab
        </Checkbox>
      </Advanced>
    </Frame>
  );
}
