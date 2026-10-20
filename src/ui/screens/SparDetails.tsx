/**
 * The details of the three kinds of feature that run along the span: a spar, a joiner and an aileron cutter. Each is a
 * spar in the project, told apart by its type. Position first, then a top view of the panel with the feature along it, then
 * a close-up from the side of what it does to a rib, with the rest behind Advanced.
 */
import { useState, type ReactNode } from "react";
import { defaultAileron, defaultSpar } from "../../domain/doc";
import type { Panel, Spar } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { panelSections } from "../../geometry";
import { surfaceAt } from "../../geometry/airfoil";
import { ops, useStore } from "../../state/store";
import { LengthField } from "../LengthField";
import { Button, Checkbox } from "../primitives";
import { CloseUp, type View, type Window } from "./CloseUp";
import { Editable, Value } from "./Editable";
import { useFeatureRibs } from "./FeatureCard";
import { Advanced, Choice, ColourDot, colourOf, dragStepFor, Frame, LenValue, MeasureValue, Row, Section, TypePicker } from "./detailParts";
import { AileronFields } from "./AileronFields";
import { affectedRibs, isNotch } from "./panelFeatures";
import { PlanformDrawing } from "./PlanformDrawing";

type Set = (patch: Partial<Spar>, label?: string) => void;
const useSet = (panel: Panel, spar: Spar): Set => (patch, label) => ops.updateSpar(panel.id, spar.id, patch, label);

const isRound = (t: Spar["type"]) => t === "round" || t === "roundJoiner";

const pickOf = (spar: Spar) => ({ k: "spar" as const, id: spar.id });
const standardColour = (spar: Spar) => `var(--wb-geo-${spar.type === "webbing" ? "webbing" : "spar"})`;

/* ------------------------------------------------------------- shared parts */

/** The size of the feature at the top right of its details: a diameter for anything round, else width and height. */
function Size({ spar, set }: { spar: Spar; set: Set }) {
  const web = spar.type === "webbing";
  if (spar.type === "aileronCutter") return null;
  if (isRound(spar.type)) {
    return <LenValue caption="Diameter" label="Spar diameter" mm={(spar.radiusMm ?? 3) * 2} min={0.4} step={0.5} onCommit={(v) => set({ radiusMm: v / 2 }, "spar diameter")} />;
  }
  return (
    <>
      <LenValue caption={web ? "Thickness" : "Width"} label="Spar width" mm={spar.width?.start ?? (web ? 2 : 6)} min={0.2} step={web ? 0.5 : 1} onCommit={(v) => set({ width: { start: v, end: spar.width?.end ?? null } }, "spar width")} />
      {!web && <LenValue caption="Height" label="Spar height" mm={spar.height?.start ?? 3} min={0.2} step={0.5} onCommit={(v) => set({ height: { start: v, end: spar.height?.end ?? null } }, "spar height")} />}
    </>
  );
}

/** Where along the chord it sits: measured from the nose or the tail, as a percentage or a length. */
function Position({ panel, spar, set, children }: { panel: Panel; spar: Spar; set: Set; children?: ReactNode }) {
  const from = spar.distanceFrom === "LE" ? "leading edge" : "trailing edge";
  return (
    <Section title="Position">
      <Choice
        label="Spar measured from"
        caption="Measured from"
        value={spar.distanceFrom}
        options={[
          { value: "LE", label: "Leading edge" },
          { value: "TE", label: "Trailing edge" },
        ]}
        onChange={(d) => set({ distanceFrom: d }, "spar datum")}
      />
      <div className="mt-4">
        <Row>
          <MeasureValue caption={`From the ${from}`} label="Spar distance" m={spar.distance.start} chordMm={panel.rootChordMm} onChange={(start) => set({ distance: { ...spar.distance, start } }, "spar distance")} />
        </Row>
      </div>
      {children}
    </Section>
  );
}

/**
 * The panel from above, with the feature along it and the ribs it passes through marked. With `span`, where it starts and
 * ends are set under the drawing: Starts at on the left and Ends at on the right, each with its label above. Click a value to
 * type it, or drag it and the feature grows or shortens as you drag. With "Snap to rib" on, a drag lands on the nearest rib;
 * typing is always taken exactly.
 */
function TopView({ panel, spar, set, span }: { panel: Panel; spar: Spar; set: Set; span: boolean }) {
  const units = useStore((s) => s.doc.displayUnits);
  const [snap, setSnap] = useState(true);
  const len = panel.lengthMm;
  const ribs = [...panel.ribs].map((r) => r.positionMm).sort((a, b) => a - b);
  const ends = [
    { label: "Spar span start", caption: "Starts at", value: spar.spanStartMm, min: 0, max: Math.max(0, spar.spanEndMm - 1), apply: (v: number) => set({ spanStartMm: v }, "spar span"), align: "left" as const },
    { label: "Spar span end", caption: "Ends at", value: spar.spanEndMm, min: Math.min(len, spar.spanStartMm + 1), max: len, apply: (v: number) => set({ spanEndMm: v }, "spar span"), align: "right" as const },
  ];
  const bad = spar.spanEndMm <= spar.spanStartMm ? "The end must be past the start." : null;
  const past = spar.spanEndMm > len ? `Ends ${formatLength(spar.spanEndMm - len, units)} past the tip of this panel.` : null;
  return (
    <Section title="Top view">
      <div className="relative">
        <PlanformDrawing
          panel={panel}
          ribs
          maxHeight={300}
          spar={{ spar, colour: colourOf(panel, pickOf(spar)) }}
          highlight={new Set(affectedRibs(panel, pickOf(spar)))}
          handles={
            span
              ? {
                  snap: snap ? ribs : undefined,
                  start: { label: "Drag the start of the span", value: spar.spanStartMm, min: 0, max: Math.max(0, spar.spanEndMm - 1), onChange: (v) => set({ spanStartMm: v }, "spar span") },
                  end: { label: "Drag the end of the span", value: spar.spanEndMm, min: Math.min(len, spar.spanStartMm + 1), max: len, onChange: (v) => set({ spanEndMm: v }, "spar span") },
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
                // turned back on: both ends go to the closest rib, keeping the end past the start
                const near = (v: number) => ribs.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), ribs[0]);
                const a = near(spar.spanStartMm);
                let b = near(spar.spanEndMm);
                if (b <= a) b = ribs.find((r) => r > a) ?? b;
                if (a !== spar.spanStartMm || b !== spar.spanEndMm) set({ spanStartMm: a, spanEndMm: Math.max(b, a) }, "spar span");
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

/** Where the feature's cut is in the rib, in the rib's own frame: boxes and circles. */
type Cut = { x0: number; x1: number; y0: number; y1: number; round?: boolean };

function cutsOf(spar: Spar, xc: number, yTop: number, yBot: number): Cut[] {
  const oy = spar.offsetY?.start ?? 0;
  const cy = (yTop + yBot) / 2 + oy;
  if (isRound(spar.type)) {
    const r = spar.radiusMm ?? 3;
    return [{ x0: xc - r, x1: xc + r, y0: cy - r, y1: cy + r, round: true }];
  }
  const w = spar.width?.start ?? (spar.type === "webbing" ? 2 : 6);
  const h = spar.height?.start ?? 3;
  if (spar.type === "webbing") return [{ x0: xc - w / 2, x1: xc + w / 2, y0: yBot, y1: yTop }];
  if (spar.type === "cuboidJoiner") return [{ x0: xc - w / 2, x1: xc + w / 2, y0: cy - h / 2, y1: cy + h / 2 }];
  if (spar.type === "aileronCutter") return [];
  const x0 = xc - w / 2 - spar.gapForeMm;
  const x1 = xc + w / 2 + spar.gapAftMm;
  const out: Cut[] = [];
  if (spar.positionTop) out.push({ x0, x1, y0: yTop - h, y1: yTop });
  if (spar.positionBottom) out.push({ x0, x1, y0: yBot, y1: yBot + h });
  if (!spar.positionTop && !spar.positionBottom) out.push({ x0, x1, y0: cy - h / 2, y1: cy + h / 2 });
  return out;
}

/**
 * A close-up from the side of what the feature does to a rib: the section, the cut in the feature's colour, and the size of
 * the cut marked. Square and to scale; pan and zoom it, and it keeps its window when the settings change.
 */
function SideView({ panel, spar }: { panel: Panel; spar: Spar }) {
  const doc = useStore((s) => s.doc);
  const units = useStore((s) => s.doc.displayUnits);
  const index = doc.wing.panels.findIndex((p) => p.id === panel.id);
  const rib = useFeatureRibs(panel, pickOf(spar))[0];
  const colour = colourOf(panel, pickOf(spar));
  const section = panelSections(doc)[index];
  if (!rib || !section) return null;
  const sorted = [...panel.ribs].sort((a, b) => a.positionMm - b.positionMm);
  const at = sorted[rib.index]?.positionMm ?? 0;
  const t = panel.lengthMm === 0 ? 0 : at / panel.lengthMm;
  const chord = rib.chordMm;
  const lerp = (m: { unit: "pct" | "mm"; value: number }, e: { unit: "pct" | "mm"; value: number } | null) => {
    const v = e ? m.value + (e.value - m.value) * t : m.value;
    return m.unit === "pct" ? (v / 100) * chord : v;
  };
  const d = lerp(spar.distance.start, spar.distance.end);
  const xc = spar.distanceFrom === "LE" ? d : chord - d;
  const s = surfaceAt(section(at), chord === 0 ? 0 : Math.min(1, Math.max(0, xc / chord)));
  const yTop = s.upper * chord;
  const yBot = s.lower * chord;
  const cuts = cutsOf(spar, xc, yTop, yBot);
  const extent = Math.max(...cuts.map((c) => Math.max(c.x1 - c.x0, c.y1 - c.y0)), 0);
  const fit = (): Window => ({ cx: xc, cy: (yTop + yBot) / 2, size: Math.min(chord * 0.6, Math.max((yTop - yBot) * 1.9, extent * 3.2, 14)) });
  const ring = (path: { x: number; y: number }[]) => path.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join("") + "Z";
  const left = [...rib.outline, ...rib.holes].map(ring).join("");
  const len = (mm: number) => formatLength(mm, units, 1);

  const dims = (v: View) => {
    const fs = 11 * v.perPx;
    const tick = 4 * v.perPx;
    const out: ReactNode[] = [];
    cuts.forEach((c, i) => {
      const above = c.y0 + (c.y1 - c.y0) / 2 >= (yTop + yBot) / 2; // a notch in the top surface is measured above it, one in the bottom below
      const hy = above ? -(yTop + 5 * v.perPx) : -(yBot - 5 * v.perPx);
      const hx = c.x1 + 6 * v.perPx;
      out.push(
        <g key={i} className="stroke-fg" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
          {/* the width, along the chord */}
          <line x1={c.x0} x2={c.x1} y1={hy} y2={hy} vectorEffect="non-scaling-stroke" />
          <line x1={c.x0} x2={c.x0} y1={hy - tick} y2={hy + tick} vectorEffect="non-scaling-stroke" />
          <line x1={c.x1} x2={c.x1} y1={hy - tick} y2={hy + tick} vectorEffect="non-scaling-stroke" />
          {/* the height, up the side */}
          <line x1={hx} x2={hx} y1={-c.y0} y2={-c.y1} vectorEffect="non-scaling-stroke" />
          <line x1={hx - tick} x2={hx + tick} y1={-c.y0} y2={-c.y0} vectorEffect="non-scaling-stroke" />
          <line x1={hx - tick} x2={hx + tick} y1={-c.y1} y2={-c.y1} vectorEffect="non-scaling-stroke" />
        </g>,
        <text key={`w${i}`} x={(c.x0 + c.x1) / 2} y={hy + (above ? -2 : 2 + fs) * (above ? v.perPx * 1 : 1) + (above ? 0 : 0)} textAnchor="middle" fontSize={fs} className="fill-fg" dominantBaseline={above ? "auto" : "hanging"}>
          {c.round ? `Ø ${len(c.x1 - c.x0)}` : len(c.x1 - c.x0)}
        </text>,
        c.round ? null : (
          <text key={`h${i}`} x={hx + 6 * v.perPx} y={-(c.y0 + c.y1) / 2} fontSize={fs} className="fill-fg" dominantBaseline="middle">
            {len(c.y1 - c.y0)}
          </text>
        ),
      );
    });
    return out;
  };

  return (
    <Section title="Side view">
      <CloseUp fit={fit} focus={{ x: xc, y: cuts.length ? (cuts[0].y0 + cuts[0].y1) / 2 : (yTop + yBot) / 2 }} label={`Close-up of ${spar.name} in rib ${rib.index + 1}`}>
        {(v) => (
          <>
            <path d={ring(rib.silhouette)} style={{ fill: colour, fillOpacity: 0.9, stroke: colour }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path d={left} fillRule="evenodd" className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {dims(v)}
          </>
        )}
      </CloseUp>
      <p className="mt-2 text-micro text-muted">Rib {rib.index + 1}, from the side. Drag to move the view, scroll to zoom.</p>
    </Section>
  );
}

/* -------------------------------------------------------------------- spar */

/** A spar is round or cuboid. Webbing and notches are features of their own; an old rectangular spar keeps its name until changed. */
const SPAR_KINDS: { value: Spar["type"]; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "cuboid", label: "Cuboid" },
];

export function SparDetail({ panel, spar }: { panel: Panel; spar: Spar }) {
  const set = useSet(panel, spar);
  const webbing = spar.type === "webbing";
  const notch = isNotch(spar);

  return (
    <Frame
      name={spar.name}
      nameLabel="Spar name"
      onName={(v) => set({ name: v }, "spar name")}
      dot={<ColourDot label="Spar colour" value={spar.color} standard={standardColour(spar)} onChange={(c) => set({ color: c }, "spar colour")} />}
      kind={
        notch ? (
          <span>Notch</span>
        ) : webbing ? (
          <span>Webbing</span>
        ) : (
          <TypePicker
            label="spar type"
            value={spar.type}
            options={spar.type === "rectangle" ? [{ value: "rectangle" as const, label: "Rectangle" }, ...SPAR_KINDS] : SPAR_KINDS}
            onChange={(type) => set({ type }, "spar type")}
          />
        )
      }
      aside={<Size spar={spar} set={set} />}
    >
      <Position panel={panel} spar={spar} set={set} />

      <TopView panel={panel} spar={spar} set={set} span />
      <SideView panel={panel} spar={spar} />
      {webbing && <p className="px-1 text-xs text-muted">A web is a thin sheet that stands between the spars: it is a slot right across the rib.</p>}
    </Frame>
  );
}

/* ------------------------------------------------------------------ joiner */

export function JoinerDetail({ panel, spar }: { panel: Panel; spar: Spar }) {
  const set = useSet(panel, spar);
  const panels = useStore((s) => s.doc.wing.panels);
  const at = panels.findIndex((p) => p.id === panel.id);
  const first = at === 0;
  const last = at === panels.length - 1;
  // A joiner is a rod along the span that two panels, or the two wings, are joined with: it sits at one end of the panel and
  // reaches in by a length. Which end tells what it joins; the same rod has to be in the neighbour too.
  const end: "root" | "tip" | "other" = spar.spanStartMm <= 0.5 ? "root" : spar.spanEndMm >= panel.lengthMm - 0.5 ? "tip" : "other";
  const reach = Math.max(0, spar.spanEndMm - spar.spanStartMm);
  const setEnd = (e: "root" | "tip", by = reach || Math.min(50, panel.lengthMm)) => {
    const r = Math.min(by, panel.lengthMm);
    set(e === "root" ? { spanStartMm: 0, spanEndMm: r } : { spanStartMm: panel.lengthMm - r, spanEndMm: panel.lengthMm }, "joiner");
  };
  const neighbour = end === "root" ? panels[at - 1] : end === "tip" ? panels[at + 1] : undefined;
  const addMatching = () => {
    if (!neighbour) return;
    const n = defaultSpar(neighbour, `${spar.name} (matching)`, spar.type);
    Object.assign(n, {
      color: spar.color,
      distance: spar.distance,
      distanceFrom: spar.distanceFrom,
      radiusMm: spar.radiusMm,
      width: spar.width,
      height: spar.height,
      offsetY: spar.offsetY,
      // the same rod, reaching into the neighbour from the joint
      spanStartMm: end === "tip" ? 0 : Math.max(0, neighbour.lengthMm - reach),
      spanEndMm: end === "tip" ? Math.min(reach, neighbour.lengthMm) : neighbour.lengthMm,
    });
    ops.addSpar(neighbour.id, n);
  };

  return (
    <Frame
      name={spar.name}
      nameLabel="Spar name"
      onName={(v) => set({ name: v }, "spar name")}
      dot={<ColourDot label="Spar colour" value={spar.color} standard={standardColour(spar)} onChange={(c) => set({ color: c }, "spar colour")} />}
      kind={
        <TypePicker
          label="joiner type"
          value={spar.type}
          options={[
            { value: "roundJoiner", label: "Round joiner" },
            { value: "cuboidJoiner", label: "Cuboid joiner" },
          ]}
          onChange={(type) => set({ type }, "joiner type")}
        />
      }
      aside={<Size spar={spar} set={set} />}
    >
      <Position panel={panel} spar={spar} set={set} />

      <Section title="Joins">
        <Choice
          label="Joiner joins"
          caption="Joins this panel to"
          value={end}
          options={[
            { value: "root" as const, label: first ? "The other wing" : "The previous panel" },
            ...(last ? [] : [{ value: "tip" as const, label: "The next panel" }]),
            ...(end === "other" ? [{ value: "other" as const, label: "Part way along" }] : []),
          ]}
          onChange={(e) => e !== "other" && setEnd(e)}
        />
        <div className="mt-3">
          <Row>
            <LenValue caption="Reaches into this panel by" label="Joiner reach" mm={reach} min={1} max={panel.lengthMm} step={5} onCommit={(v) => setEnd(end === "tip" ? "tip" : "root", v)} />
          </Row>
        </div>
        {neighbour && (
          <Button size="sm" className="mt-2" onClick={addMatching}>
            {`Add the matching joiner to ${end === "root" ? "the previous" : "the next"} panel`}
          </Button>
        )}
      </Section>

      <TopView panel={panel} spar={spar} set={set} span={false} />
      <SideView panel={panel} spar={spar} />

      <Advanced>
        <Row>
          <LenValue caption="Up or down from the middle of the section" label="Joiner offset" mm={spar.offsetY?.start ?? 0} min={-50} max={50} step={0.5} onCommit={(v) => set({ offsetY: { start: v, end: spar.offsetY?.end ?? null } }, "joiner offset")} />
        </Row>
      </Advanced>
    </Frame>
  );
}

/* ----------------------------------------------------------------- aileron */

export function AileronDetail({ panel, spar }: { panel: Panel; spar: Spar }) {
  const set = useSet(panel, spar);
  return (
    <Frame
      name={spar.name}
      nameLabel="Spar name"
      onName={(v) => set({ name: v }, "spar name")}
      dot={<ColourDot label="Spar colour" value={spar.color} standard={standardColour(spar)} onChange={(c) => set({ color: c }, "spar colour")} />}
      kind="Aileron cutter"
    >
      <Position panel={panel} spar={spar} set={set} />
      <TopView panel={panel} spar={spar} set={set} span />
      <SideView panel={panel} spar={spar} />
      <Section title="Hinge">
        {spar.aileron ? (
          <AileronFields aileron={spar.aileron} onChange={(a) => set({ aileron: a }, "aileron")} />
        ) : (
          <p className="max-w-prose text-xs text-muted">
            This is the simple cutter: everything behind the hinge line leaves the rib.
            <Button size="sm" className="ml-3" onClick={() => set({ aileron: defaultAileron() }, "aileron")}>
              Add hinge settings
            </Button>
          </p>
        )}
      </Section>
      <Advanced>
        <Checkbox checked={spar.aileron === null} onChange={(v) => set({ aileron: v ? null : defaultAileron() }, "aileron")}>
          Simple cutter: everything behind the hinge line leaves the rib
        </Checkbox>
      </Advanced>
    </Frame>
  );
}
