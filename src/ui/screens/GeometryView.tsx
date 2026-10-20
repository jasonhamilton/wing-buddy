/**
 * A panel's own geometry, drawn like the card in the list but larger: both airfoils side by side (root left,
 * tip right), the planform with its length, chords and sweep, and the dihedral. Nothing here is a form. Each
 * value is plain text until it is clicked; then it becomes a field, and goes back to text when you leave it.
 * Clicking an airfoil name opens the airfoil picker instead.
 */
import { useState, type ReactNode } from "react";
import { foilName } from "../../domain/airfoils";
import type { Airfoil, Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { LengthField } from "../LengthField";
import { NumberField, TextField } from "../primitives";
import { GutterRow, LengthCalcButton } from "./GutterRow";
import { PanelLengthCalculator } from "./PanelLengthCalculator";
import { Editable, Value } from "./Editable";
import { PlanformDrawing } from "./PlanformDrawing";
import { RibsSection } from "./RibsSection";
import { airfoilPath, foilEnds, sideView } from "./panelDrawings";

const twistText = (d: number) => `${Number(d.toFixed(2))}°`;

/* ----------------------------------------------------------------- airfoils */

function FoilEnd({
  panel,
  end,
  embedded,
  pad,
  note,
  disabled,
  chord,
  ratio,
}: {
  panel: Panel;
  end: "root" | "tip";
  embedded: Airfoil[];
  pad: number;
  note?: string;
  disabled?: boolean;
  /** the chord of this end, editable, shown at the top right of the foil */
  chord: ReactNode;
  /** this end's chord over the longer of the two, so the two foils are drawn to one scale */
  ratio: number;
}) {
  const openFoilPicker = useStore((s) => s.openFoilPicker);
  const foils = foilEnds(panel);
  const id = end === "root" ? foils.rootId : foils.tipId;
  const scale = end === "root" ? foils.rootScale : foils.tipScale;
  const twist = end === "root" ? panel.rootTwistDeg : panel.tipTwistDeg;
  const path = airfoilPath(id, embedded);
  const factor = scale !== 1 ? ` ×${Number(scale.toFixed(2))}` : "";
  const name = `${foilName(id, embedded)}${factor}`;
  const title = end === "root" ? "Root airfoil" : "Tip airfoil";
  const set = (patch: Partial<Panel>, label: string) => ops.updatePanel(panel.id, patch, label);

  return (
    <div className="min-w-0 rounded-lg bg-surface px-4 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h4 className="text-micro text-muted">{title}</h4>
        <Value caption="Length" align="right">
          {chord}
        </Value>
      </div>
      {path && (
        <svg viewBox={`-2 ${-10 - pad} 104 ${20 + 2 * pad}`} className="block max-h-40 w-full" aria-hidden="true">
          <path d={path} transform={`scale(${ratio}) rotate(${twist}) scale(1 ${scale})`} className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <button
          type="button"
          aria-label={`Change ${title.toLowerCase()}`}
          title={disabled ? note : `Change ${title.toLowerCase()}`}
          disabled={disabled}
          onClick={() => openFoilPicker(panel.id, end)}
          className="min-w-0 truncate rounded-sm px-1.5 py-0.5 font-mono text-sm font-medium underline decoration-dotted decoration-muted underline-offset-4 hover:bg-surface-sunken disabled:cursor-not-allowed disabled:no-underline disabled:hover:bg-transparent"
        >
          {name}
        </button>
        <Editable
          label={`${end} twist`}
          drag={{ value: twist, step: 0.1, onChange: (v) => set(end === "root" ? { rootTwistDeg: v } : { tipTwistDeg: v }, `${end} twist`) }}
          display={<span className="text-xs tabular-nums">Twist {twistText(twist)}</span>}
          edit={
            <NumberField
              label={`${title.replace("airfoil", "").trim()} twist`}
              value={twist}
              unit="deg"
              step={0.5}
              onCommit={(v) => set(end === "root" ? { rootTwistDeg: v } : { tipTwistDeg: v }, `${end} twist`)}
            />
          }
        />
      </div>
      {note && <p className="mt-1 text-micro text-muted">{note}</p>}
      {end === "tip" && panel.tipAirfoilId !== null && (
        <button type="button" onClick={() => set({ tipAirfoilId: null }, "tip airfoil")} className="mt-1 text-micro text-accent underline">
          Use the root airfoil here too
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- view */

export function GeometryView({ panel }: { panel: Panel }) {
  const index = useStore((s) => s.doc.wing.panels.findIndex((p) => p.id === panel.id));
  const embedded = useStore((s) => s.doc.airfoils);
  const units = useStore((s) => s.doc.displayUnits);
  const [calc, setCalc] = useState(false);
  const set = (patch: Partial<Panel>, label: string) => ops.updatePanel(panel.id, patch, label);
  const len = (mm: number) => formatLength(mm, units, 1);

  const linked = index > 0 && panel.airfoilLinkedToPrev;
  const pad = Math.min(40, Math.round(100 * Math.sin((Math.min(45, Math.max(Math.abs(panel.rootTwistDeg), Math.abs(panel.tipTwistDeg))) * Math.PI) / 180)));
  const side = sideView(
    { lengthMm: panel.lengthMm, rootChordMm: panel.rootChordMm, tipChordMm: panel.tipChordMm, dihedralDeg: panel.dihedralDeg },
    panel.lengthMm,
  );

  // The two foils are drawn to one scale: the longer chord fills the frame and the other is in proportion.
  const longest = Math.max(panel.rootChordMm, panel.tipChordMm, 1);
  const foilRatio = (chord: number) => Math.min(1, Math.max(0.05, chord / longest));

  // One drag step: a quarter inch, or ten millimetres.
  const lenStep = units === "in" ? 0.25 * 25.4 : 10;
  const rootChord = (
    <Editable
      label="root chord"
      drag={{ value: panel.rootChordMm, step: lenStep, min: 1, onChange: (v) => set({ rootChordMm: v }, "root chord") }}
      display={len(panel.rootChordMm)}
      edit={<LengthField label="Root chord" value={panel.rootChordMm} min={1} step={5} onCommit={(v) => set({ rootChordMm: v }, "root chord")} />}
    />
  );
  const tipChord = (
    <Editable
      label="tip chord"
      drag={{ value: panel.tipChordMm, step: lenStep, min: 1, onChange: (v) => set({ tipChordMm: v }, "tip chord") }}
      display={len(panel.tipChordMm)}
      edit={
        <LengthField
          label="Tip chord"
          value={panel.tipChordMm}
          min={0}
          step={5}
          invalid={panel.tipChordMm <= 0 ? "Tip chord must be greater than 0." : null}
          onCommit={(v) => set({ tipChordMm: v }, "tip chord")}
        />
      }
    />
  );
  // The same two chords again, at the top right of each foil, called length there.
  const foilLength = (end: "root" | "tip") => {
    const value = end === "root" ? panel.rootChordMm : panel.tipChordMm;
    const apply = (v: number) => set(end === "root" ? { rootChordMm: v } : { tipChordMm: v }, `${end} chord`);
    return (
      <Editable
        label={`${end} foil length`}
        drag={{ value, step: lenStep, min: 1, onChange: apply }}
        display={len(value)}
        edit={<LengthField label={`${end === "root" ? "Root" : "Tip"} foil length`} value={value} min={end === "root" ? 1 : 0} step={5} onCommit={apply} />}
      />
    );
  };
  const length = (
    <Editable
      label="panel length"
      drag={{ value: panel.lengthMm, step: lenStep, min: 1, onChange: (v) => set({ lengthMm: v }, "panel length") }}
      display={len(panel.lengthMm)}
      edit={
        <GutterRow action={<LengthCalcButton onClick={() => setCalc(true)} />}>
          <LengthField label="Panel length" value={panel.lengthMm} min={1} step={5} onCommit={(v) => set({ lengthMm: v }, "panel length")} />
        </GutterRow>
      }
    />
  );
  const sweep = (
    <Editable
      label="sweep"
      drag={{ value: panel.sweepMm, step: lenStep, onChange: (v) => set({ sweepMm: v }, "sweep") }}
      display={len(panel.sweepMm)}
      edit={<LengthField label="Sweep" value={panel.sweepMm} step={5} onCommit={(v) => set({ sweepMm: v }, "sweep")} />}
    />
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex items-center gap-2">
        <Editable
          label="panel name"
          display={<span className="text-base font-medium">{panel.name}</span>}
          edit={<TextField aria-label="Panel name" value={panel.name} onChange={(e) => set({ name: e.target.value }, "rename panel")} />}
          className="min-w-0 flex-1"
        />
      </div>

      <section aria-label="Airfoils" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FoilEnd panel={panel} end="root" embedded={embedded} pad={pad} chord={foilLength("root")} ratio={foilRatio(panel.rootChordMm)} disabled={linked} note={linked ? "From the previous panel's tip" : undefined} />
        <FoilEnd panel={panel} end="tip" embedded={embedded} pad={pad} chord={foilLength("tip")} ratio={foilRatio(panel.tipChordMm)} note={panel.tipAirfoilId === null ? "Same as the root" : undefined} />
      </section>

      <section aria-label="Planform" className="rounded-lg bg-surface px-4 py-3">
        <h4 className="mb-2 text-micro text-muted">Planform</h4>
        <div className="mb-2 flex justify-between gap-3">
          <Value caption="Length">{length}</Value>
          <Value caption="Sweep" align="right">{sweep}</Value>
        </div>
        <PlanformDrawing panel={panel} ribs />
        <div className="mt-2 flex justify-between gap-3">
          <Value caption="Root chord">{rootChord}</Value>
          <Value caption="Tip chord" align="right">{tipChord}</Value>
        </div>
      </section>

      <RibsSection panel={panel} />

      <section aria-label="Dihedral" className="rounded-lg bg-surface px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-micro text-muted">Dihedral</h4>
          <Editable
            label="dihedral"
            drag={{ value: panel.dihedralDeg, step: 0.1, min: -45, max: 45, onChange: (v) => set({ dihedralDeg: v }, "dihedral") }}
            display={<span className="text-sm font-medium">{`${panel.dihedralDeg.toFixed(1)}°`}</span>}
            edit={<NumberField label="Dihedral" value={panel.dihedralDeg} unit="deg" step={0.5} min={-45} max={45} onCommit={(v) => set({ dihedralDeg: v }, "dihedral")} />}
          />
        </div>
        <svg viewBox={`0 0 270 ${side.height}`} className="block max-h-32 w-full" role="img" aria-label={`${panel.name} side view, dihedral ${panel.dihedralDeg.toFixed(1)}°`}>
          <line x1="1" x2={side.x2} y1={side.baseline} y2={side.baseline} className="stroke-border-strong" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="1" x2={side.x2} y1={side.baseline} y2={side.y2} className="stroke-accent" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </section>

      {calc && (
        <PanelLengthCalculator
          panel={panel}
          onClose={() => setCalc(false)}
          onApply={(l, thickness, count) => {
            set({ lengthMm: l, ribThicknessMm: thickness, ribCountTarget: count }, "panel length");
            setCalc(false);
          }}
        />
      )}
    </div>
  );
}
