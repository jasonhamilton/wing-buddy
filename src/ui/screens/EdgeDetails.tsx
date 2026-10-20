/**
 * The details of leading and trailing edge stock. The leading edge is a rectangular strip or a round rod; the trailing edge is
 * a rectangular strip or a wedge that comes to a point. Under the values, the stock in section: square, to scale, panned and
 * zoomed with the mouse, and it keeps its window when the settings change, so the stock moves in the picture and the picture
 * does not move.
 */
import type { Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { edgeFitHeightMm, panelSections } from "../../geometry";
import { edgeParts, fitRodDiameterMm, isRod, rodOf, wedgeAngleDeg, wedgeHeightMm } from "../../geometry/edgeStock";
import { intersect } from "../../geometry/clipper";
import type { Path } from "../../geometry/types";
import { ops, useStore } from "../../state/store";
import { Button, Checkbox } from "../primitives";
import { CloseUp, type View, type Window } from "./CloseUp";
import { Choice, colourOf, DegValue, Frame, LenValue, Row, Section } from "./detailParts";
import { FeatureTopView } from "./FeatureTopView";
import type { Pick } from "./panelFeatures";

type Which = "leadingEdge" | "trailingEdge";
type Shape = "rectangle" | "triangle" | "round";

const ICONS: Record<Shape, string> = {
  rectangle: "M3 4h10v8H3z",
  triangle: "M3 12V4l10 8z",
  round: "M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z",
};

/** The shapes each edge offers, by name. An older file may hold another; it is shown while it is the one in use. */
const OFFERED: Record<Which, { value: Shape; label: string }[]> = {
  leadingEdge: [
    { value: "rectangle", label: "Rectangle" },
    { value: "round", label: "Rounded" },
  ],
  trailingEdge: [
    { value: "rectangle", label: "Rectangle" },
    { value: "triangle", label: "Wedge" },
  ],
};
const OLD: Record<Shape, string> = { rectangle: "Rectangle", triangle: "Wedge (old)", round: "Rounded (old)" };

/** The stock in section, with its size marked. */
function StockSection({ panel, which, colour, edge }: { panel: Panel; which: Which; colour: string; edge: Panel["leadingEdge"] }) {
  const doc = useStore((s) => s.doc);
  const units = useStore((s) => s.doc.displayUnits);
  const rib = useStore((s) => s.geometry?.ribs.find((r) => r.panelId === panel.id && r.index === 0));
  const index = doc.wing.panels.findIndex((p) => p.id === panel.id);
  const section = panelSections(doc)[index];
  const chord = panel.rootChordMm;
  const le = which === "leadingEdge";
  if (!section || !rib) return null;
  const surfaces = section(0);
  const parts = edgeParts({ ...edge, enabled: true }, which, chord, surfaces);
  if (!parts) return null;
  const rod = isRod(edge, which);
  const wedge = edge.shape === "triangle";
  const w = rod ? edge.widthMm : Math.min(edge.widthMm, chord);
  const len = (mm: number) => formatLength(mm, units, 1);

  // The window opens on the stock as it is now, and stays there while the settings change.
  const fit = (): Window => {
    const e = edge;
    const rodNow = isRod(e, which);
    const ww = rodNow ? e.widthMm : Math.min(e.widthMm, chord);
    const hh = rodNow ? e.widthMm : e.heightMm;
    const s0 = surfaces;
    const cx = le ? ww / 2 + (rodNow ? (e.setbackMm ?? 0) : 0) : chord - ww / 2;
    const cy = rodNow ? rodOf(e, chord, s0).cy : 0;
    return { cx, cy, size: Math.min(chord * 0.5, Math.max(hh * 1.6, ww * 2.4, 12)) };
  };

  const d = (path: Path) => path.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join("") + "Z";
  const blockTop = Math.max(...parts.block.map((p) => p.y));
  const blockBottom = Math.min(...parts.block.map((p) => p.y));
  const x0 = rod ? (edge.setbackMm ?? 0) : le ? 0 : chord - w;

  const dims = (v: View) => {
    const fs = 11 * v.perPx;
    const tick = 4 * v.perPx;
    const gap = 8 * v.perPx;
    const under = -(blockBottom - gap * 1.4);
    const side = le ? x0 - gap : chord + gap;
    return (
      <g>
        <g className="stroke-fg" strokeWidth="1" fill="none">
          <line x1={x0} x2={x0 + w} y1={under} y2={under} vectorEffect="non-scaling-stroke" />
          <line x1={x0} x2={x0} y1={under - tick} y2={under + tick} vectorEffect="non-scaling-stroke" />
          <line x1={x0 + w} x2={x0 + w} y1={under - tick} y2={under + tick} vectorEffect="non-scaling-stroke" />
          {!wedge && (
            <>
              <line x1={side} x2={side} y1={-blockTop} y2={-blockBottom} vectorEffect="non-scaling-stroke" />
              <line x1={side - tick} x2={side + tick} y1={-blockTop} y2={-blockTop} vectorEffect="non-scaling-stroke" />
              <line x1={side - tick} x2={side + tick} y1={-blockBottom} y2={-blockBottom} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </g>
        <text x={x0 + w / 2} y={under + tick + 2 * v.perPx} textAnchor="middle" dominantBaseline="hanging" fontSize={fs} className="fill-fg">
          {rod ? `Ø ${len(edge.widthMm)}` : `${len(edge.widthMm)} wide`}
        </text>
        {!wedge && (
          <text x={side + (le ? -tick - 2 * v.perPx : tick + 2 * v.perPx)} y={-(blockTop + blockBottom) / 2} textAnchor={le ? "end" : "start"} dominantBaseline="middle" fontSize={fs} className="fill-fg">
            {len(rod ? edge.widthMm : edge.heightMm)}
          </text>
        )}
        {wedge && (
          <text x={chord - w - gap} y={-blockTop - gap} textAnchor="end" fontSize={fs} className="fill-fg">
            {`${wedgeAngleDeg(w, edge.heightMm).toFixed(1)}° point`}
          </text>
        )}
      </g>
    );
  };

  return (
    <div>
      <CloseUp fit={fit} focus={{ x: rod ? x0 + w / 2 : x0 + w / 2, y: (blockTop + blockBottom) / 2 }} label={`Section of the ${le ? "leading" : "trailing"} edge stock`}>
        {(v) => (
          <>
            <path d={d(rib.silhouette)} className="fill-selected stroke-accent" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={d(parts.block)} style={{ fill: colour, fillOpacity: 0.28, stroke: colour }} strokeWidth="1.2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            {!rod && <path d={d(parts.shaped)} style={{ fill: colour, fillOpacity: 0.9 }} stroke="none" />}
            {/* a rod, like a block: the whole rod faint and dashed, and the part of it that is inside the airfoil solid, so what is and is not part of the airfoil can be told apart */}
            {rod && <path d={intersect([parts.block], [rib.silhouette]).map(d).join("")} style={{ fill: colour, fillOpacity: 0.9 }} stroke="none" />}
            {rod && <path d={d(rib.silhouette)} fill="none" className="stroke-accent" strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
            {dims(v)}
          </>
        )}
      </CloseUp>
      <p className="mt-2 text-micro text-muted">
        {rod ? (
          "The rod, in section: solid where it is inside the airfoil, dashed where it is outside it. Each rib begins at the middle of the rod, with a round bite taken for it to sit in."
        ) : (
          <>
            <span aria-hidden="true" className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ backgroundColor: colour, opacity: 0.9 }} /> what stays once it is carved to the airfoil
            <span aria-hidden="true" className="ml-3 mr-1 inline-block h-2 w-3 rounded-sm border border-dashed align-middle" style={{ borderColor: colour, backgroundColor: colour, opacity: 0.35 }} /> the block before carving
          </>
        )}{" "}
        Drag to move the view, scroll to zoom.
      </p>
      {parts.uncoveredMm > 0.05 && (
        <p className="mt-1 text-xs text-warning">
          The airfoil pokes out of the {rod ? "rod" : "block"} by {len(parts.uncoveredMm)}: {rod ? "make it bigger or move it, or press Fit to nose." : edge.shape === "triangle" ? "open the angle, or press Fit to wing." : "raise the height."}
        </p>
      )}
    </div>
  );
}

/** How far back from the nose the stock reaches at a rib, as the two ends of its stretch of the chord. */
function stockStretch(w: number, chord: number, key: Which, edge: Panel["leadingEdge"]): [number, number] {
  if (key === "leadingEdge") {
    const back = edge.shape === "round" ? (edge.setbackMm ?? 0) : 0;
    return [back, Math.min(chord, back + w)];
  }
  return [chord - w, chord];
}

export function EdgeDetail({ panel, which: w, edgeId }: { panel: Panel; which: "le" | "te"; /** one of the extra edge stocks, rather than the panel's own */ edgeId?: string }) {
  const key: Which = w === "le" ? "leadingEdge" : "trailingEdge";
  const extra = edgeId ? (panel.extraEdges ?? []).find((x) => x.id === edgeId) : undefined;
  const edge = extra ?? panel[key];
  const set = (patch: Partial<typeof edge>) =>
    extra
      ? ops.updatePanel(panel.id, { extraEdges: (panel.extraEdges ?? []).map((x) => (x.id === extra.id ? { ...x, ...patch } : x)) } as Partial<Panel>, "edge stock")
      : ops.updatePanel(panel.id, { [key]: { ...edge, ...patch } } as Partial<Panel>, "edge stock");
  const doc = useStore((s) => s.doc);
  const index = doc.wing.panels.findIndex((p) => p.id === panel.id);
  const section = panelSections(doc)[index];
  const name = extra ? extra.name : w === "le" ? "Leading edge stock" : "Trailing edge stock";
  const pick: Pick = extra ? { k: "edge", id: extra.id } : { k: w };
  const rod = isRod(edge, key);
  const wedge = edge.shape === "triangle";
  const angle = edge.angleDeg ?? wedgeAngleDeg(edge.widthMm, edge.heightMm);

  // The smallest block that covers the airfoil, with a millimetre to spare, rounded up to 0.5.
  const raw = edgeFitHeightMm(doc, panel.id, key, edge);
  const fitHeight = raw === null ? null : Math.ceil((raw + 1) * 2) / 2;

  const shapes = [...OFFERED[key]];
  if (!shapes.some((s) => s.value === edge.shape)) shapes.push({ value: edge.shape, label: OLD[edge.shape] });

  const choose = (shape: Shape) => {
    if (shape === edge.shape) return;
    if (shape === "round" && w === "le") {
      // a rod starts at the size that just covers the nose
      const d = section ? Number(fitRodDiameterMm(panel.rootChordMm, section(0)).toFixed(1)) : edge.widthMm;
      set({ shape, widthMm: d, heightMm: d, offsetMm: 0, setbackMm: 0 });
    } else if (shape === "triangle") {
      const a = Math.min(80, Math.max(1, wedgeAngleDeg(edge.widthMm, edge.heightMm) || 20));
      set({ shape, angleDeg: Number(a.toFixed(1)), heightMm: Number(wedgeHeightMm(edge.widthMm, a).toFixed(2)) });
    } else if (shape === "rectangle" && w === "le") {
      // a rectangle starts as tall as it must be to cover the airfoil (the same fit as the Fit height button)
      const covered = edgeFitHeightMm(doc, panel.id, key, { ...edge, shape });
      set(covered === null ? { shape } : { shape, heightMm: Math.ceil((covered + 1) * 2) / 2 });
    } else {
      set({ shape });
    }
  };

  return (
    <Frame name={name} nameLabel={`${name} name`} onName={extra ? (v) => ops.updatePanel(panel.id, { extraEdges: (panel.extraEdges ?? []).map((x) => (x.id === extra.id ? { ...x, name: v } : x)) }, "edge stock name") : undefined}>
      <Section title="Shape and size">
        <Choice
          label="Stock shape"
          caption={rod ? "Shape" : "Shape (the thick side meets the ribs)"}
          value={edge.shape}
          options={shapes.map((s) => ({
            value: s.value,
            label: s.label,
            icon: (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d={ICONS[s.value]} />
              </svg>
            ),
          }))}
          onChange={choose}
        />
        <div className="mt-4">
          <Row>
            {rod ? (
              <>
                <LenValue caption="Diameter" label="Stock diameter" mm={edge.widthMm} min={0.4} step={0.5} onCommit={(v) => set({ widthMm: v, heightMm: v })} />
                <LenValue caption="Back from the nose" label="Stock setback" mm={edge.setbackMm ?? 0} min={0} step={0.5} onCommit={(v) => set({ setbackMm: v })} />
                <LenValue caption="Up or down" label="Stock offset" mm={edge.offsetMm ?? 0} min={-20} max={20} step={0.25} onCommit={(v) => set({ offsetMm: v })} />
                <div className="self-end pb-0.5">
                  <Button
                    size="sm"
                    disabled={!section}
                    onClick={() => section && set({ widthMm: Number(fitRodDiameterMm(panel.rootChordMm, section(0), edge.setbackMm ?? 0, edge.offsetMm ?? 0).toFixed(1)), heightMm: Number(fitRodDiameterMm(panel.rootChordMm, section(0), edge.setbackMm ?? 0, edge.offsetMm ?? 0).toFixed(1)) })}
                  >
                    Fit to nose
                  </Button>
                </div>
              </>
            ) : wedge ? (
              <>
                <LenValue caption="Width" label="Stock width" mm={edge.widthMm} step={1} onCommit={(v) => set({ widthMm: v, heightMm: Number(wedgeHeightMm(v, angle).toFixed(2)) })} />
                <DegValue caption="Angle at the point" label="Wedge angle" value={Number(angle.toFixed(1))} min={1} max={80} step={0.5} onCommit={(a) => set({ angleDeg: a, heightMm: Number(wedgeHeightMm(edge.widthMm, a).toFixed(2)) })} />
                <div className="self-end pb-0.5">
                  <Button
                    size="sm"
                    disabled={fitHeight === null}
                    onClick={() => {
                      if (fitHeight === null) return;
                      const a = Math.min(80, Number(wedgeAngleDeg(edge.widthMm, fitHeight).toFixed(1)));
                      set({ angleDeg: a, heightMm: Number(wedgeHeightMm(edge.widthMm, a).toFixed(2)) });
                    }}
                  >
                    Fit to wing
                  </Button>
                </div>
              </>
            ) : (
              <>
                <LenValue caption="Width" label="Stock width" mm={edge.widthMm} step={1} onCommit={(v) => set({ widthMm: v })} />
                <LenValue caption="Height" label="Stock height" mm={edge.heightMm} step={1} onCommit={(v) => set({ heightMm: v })} />
                <div className="self-end pb-0.5">
                  <Button size="sm" disabled={fitHeight === null} onClick={() => fitHeight !== null && set({ heightMm: fitHeight })}>
                    Fit height to wing
                  </Button>
                </div>
              </>
            )}
          </Row>
        </div>
        <div className="mt-4">
          <Checkbox checked={edge.showCutStock !== false} onChange={(v) => set({ showCutStock: v })}>
            Show cut stock in the 3D view
          </Checkbox>
        </div>
      </Section>
      <FeatureTopView
        panel={panel}
        pick={pick}
        region={{
          // the stock along the whole edge, from the root to the tip: as far back as it reaches at each end
          points: [0, panel.lengthMm].flatMap((mm, i) => {
            const chord = panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * (panel.lengthMm > 0 ? mm / panel.lengthMm : 0);
            const w = Math.min(Math.max(edge.widthMm, 0), chord);
            const [x0, x1] = stockStretch(w, chord, key, edge);
            return i === 0 ? [{ mm, x: x0 }, { mm, x: x1 }] : [{ mm, x: x1 }, { mm, x: x0 }];
          }),
        }}
      />
      <Section title="The stock, in section">
        <StockSection panel={panel} which={key} colour={colourOf(panel, pick)} edge={edge} />
      </Section>
    </Frame>
  );
}
