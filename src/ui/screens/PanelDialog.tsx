/** S05–S13: the wing panel definition dialog. */
import { useMemo, useState } from "react";
import { foilMetrics, foilName, listFoils } from "../../domain/airfoils";
import { defaultAileron, defaultSpar } from "../../domain/doc";
import { edgeFitHeightMm } from "../../geometry";
import { alignWith, copyOf, moveToMaxThickness, neighbour } from "../../domain/sparOps";
import type { Panel, Spar } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  FieldGrid,
  GroupBox,
  NumberField,
  Radio,
  Tabs,
  TextField,
  UnitToggle,
  Empty, ContextMenu, type MenuItem } from "../primitives";
import { ColourButton } from "../ColourButton";
import { LengthField } from "../LengthField";
import { Panel2D, RibView } from "../viewport/Canvas2D";
import { GutterRow, LengthCalcButton } from "./GutterRow";
import { PanelLengthCalculator } from "./PanelLengthCalculator";
import { RibLayoutEditor } from "./RibLayoutEditor";
import { ConstructionTab } from "./ConstructionTab";
import { SheetingTab } from "./SheetingTab";

const TABS = [
  { id: "base", label: "Base Data" },
  { id: "ribs", label: "Ribs" },
  { id: "spars", label: "Spars" },
  { id: "le", label: "Leading Edge" },
  { id: "te", label: "Trailing Edge" },
  { id: "sheeting", label: "Sheeting" },
  { id: "construction", label: "Construction" },
] as const;

export const SPAR_TYPES: { id: Spar["type"]; label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "round", label: "Round" },
  { id: "webbing", label: "Webbing" },
  { id: "roundJoiner", label: "Round joiner" },
  { id: "cuboid", label: "Cuboid" },
  { id: "cuboidJoiner", label: "Cuboid joiner" },
  { id: "aileronCutter", label: "Aileron cutter" },
];

export function PanelDialog({ panel, onImportAirfoil }: { panel: Panel; onImportAirfoil: (target: "root" | "tip") => void }) {
  const { doc, dialogTab, setDialogTab, closePanelDialog, geometry, selection, select } = useStore();
  const [calcOpen, setCalcOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; returnTo: HTMLElement | null } | null>(null);
  const [filter, setFilter] = useState("");
  const units = doc.displayUnits;

  const foils = useMemo(() => listFoils(doc.airfoils), [doc.airfoils]);
  const shown = useMemo(
    () => foils.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())),
    [foils, filter],
  );
  const panelRibs = geometry?.ribs.filter((r) => r.panelId === panel.id) ?? [];
  const activeRib = panelRibs.find((r) => r.ribId === selection.ribId) ?? panelRibs[0] ?? null;
  const set = (patch: Partial<Panel>, label?: string) => ops.updatePanel(panel.id, patch, label);

  const spar = panel.spars.find((s) => s.id === selection.sparId) ?? panel.spars[0] ?? null;

  const sparMenu = (target: Spar): MenuItem[] => {
    const panels = doc.wing.panels;
    const at = panels.findIndex((p) => p.id === panel.id);
    const neighbourSpars = (dir: "previous" | "next"): MenuItem => {
      const other = panels[dir === "previous" ? at - 1 : at + 1];
      const word = dir === "previous" ? "previous" : "next";
      const label = `Match a spar in the ${word} panel`;
      if (!other) return { label, disabled: true, reason: `no ${word} panel` };
      if (other.spars.length === 0) return { label, disabled: true, reason: `${other.name} has no spars` };
      return {
        label,
        submenu: other.spars.map((src) => ({
          label: src.name,
          onSelect: () => ops.updateSpar(panel.id, target.id, alignWith(target, src, dir), `match ${word} spar`),
        })),
      };
    };
    const thickest = moveToMaxThickness(panel, target, doc.airfoils);
    return [
      { label: "Add in front", onSelect: () => ops.addSpar(panel.id, neighbour(panel, target, "front", `Spar ${panel.spars.length + 1}`), target.id) },
      { label: "Add behind", onSelect: () => ops.addSpar(panel.id, neighbour(panel, target, "behind", `Spar ${panel.spars.length + 1}`), target.id) },
      { label: "Duplicate", onSelect: () => ops.addSpar(panel.id, copyOf(target), target.id) },
      { label: "Delete", onSelect: () => ops.removeSpar(panel.id, target.id) },
      thickest
        ? { label: "Move to thickest point", onSelect: () => ops.updateSpar(panel.id, target.id, thickest, "move spar to thickest point") }
        : { label: "Move to thickest point", disabled: true, reason: "airfoil not found" },
      neighbourSpars("previous"),
      neighbourSpars("next"),
    ];
  };
  const openSparMenu = (target: Spar, x: number, y: number, returnTo: HTMLElement | null) => {
    select({ sparId: target.id });
    setMenu({ x, y, items: sparMenu(target), returnTo });
  };
  const closeMenu = () => {
    menu?.returnTo?.focus();
    setMenu(null);
  };

  return (
    <Dialog
      wide
      title={`Wing panel definition — ${panel.name}`}
      onClose={closePanelDialog}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            Changes apply as you type. Close when you are done.
          </span>
          <Button variant="primary" onClick={closePanelDialog}>
            Done
          </Button>
        </>
      }
    >
      <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[minmax(380px,50%)_minmax(0,1fr)]">
        {/* ---------------------------------------------------------- form */}
        <div className="flex min-h-0 flex-col border-r border-border">
          <Tabs tabs={TABS as never} value={dialogTab as never} onChange={(t) => setDialogTab(t)} label="Panel data" />
          <div tabIndex={0} aria-label="Panel settings" className="wb-scroll min-h-0 flex-1 overflow-auto p-6">
            {dialogTab === "base" && (
              <>
                <GroupBox title="Panel data">
                  {/* two halves on a desktop: the shape of the panel on the left, its size and angles on the right */}
                  <div className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
                    <FieldGrid compact>
                      <Field label="Name:" htmlFor="p-name">
                        <GutterRow>
                          <TextField id="p-name" value={panel.name} onChange={(e) => set({ name: e.target.value }, "rename panel")} />
                        </GutterRow>
                      </Field>
                      <Field label="Root chord:">
                        <GutterRow>
                          <LengthField label="Root chord" value={panel.rootChordMm} min={1} step={5} onCommit={(v) => set({ rootChordMm: v }, "root chord")} />
                        </GutterRow>
                      </Field>
                      <Field label="Tip chord:">
                        <GutterRow>
                          <LengthField
                            label="Tip chord"
                            value={panel.tipChordMm}
                            min={0}
                            step={5}
                            invalid={panel.tipChordMm <= 0 ? "Tip chord must be greater than 0." : null}
                            onCommit={(v) => set({ tipChordMm: v }, "tip chord")}
                          />
                        </GutterRow>
                      </Field>
                      <Field label="Sweep:" hint={`${sweepAngle(panel).toFixed(2)}°`}>
                        <GutterRow>
                          <LengthField label="Sweep" value={panel.sweepMm} step={5} onCommit={(v) => set({ sweepMm: v }, "sweep")} />
                        </GutterRow>
                      </Field>
                    </FieldGrid>
                    <FieldGrid compact>
                      <Field label="Length:">
                        <GutterRow action={<LengthCalcButton onClick={() => setCalcOpen(true)} />}>
                          <LengthField label="Panel length" value={panel.lengthMm} min={1} step={5} onCommit={(v) => set({ lengthMm: v }, "panel length")} />
                        </GutterRow>
                      </Field>
                      <Field label="Dihedral:">
                        <GutterRow>
                          <NumberField label="Dihedral" value={panel.dihedralDeg} unit="deg" step={0.5} min={-45} max={45} onCommit={(v) => set({ dihedralDeg: v }, "dihedral")} />
                        </GutterRow>
                      </Field>
                      <Field label="Root twist:">
                        <GutterRow>
                          <NumberField label="Root twist" value={panel.rootTwistDeg} unit="deg" step={0.5} onCommit={(v) => set({ rootTwistDeg: v }, "root twist")} />
                        </GutterRow>
                      </Field>
                      <Field label="Tip twist:">
                        <GutterRow>
                          <NumberField label="Tip twist" value={panel.tipTwistDeg} unit="deg" step={0.5} onCommit={(v) => set({ tipTwistDeg: v }, "tip twist")} />
                        </GutterRow>
                      </Field>
                    </FieldGrid>
                  </div>
                </GroupBox>

                <GroupBox title="Airfoil">
                  <AirfoilPicker panel={panel} foils={foils} shown={shown} filter={filter} setFilter={setFilter} onImport={onImportAirfoil} />
                </GroupBox>

                <GroupBox title="Blending and smoothing">
                  <AirfoilOptions panel={panel} />
                </GroupBox>

                <GroupBox title="Rib alignment">
                  <div className="flex flex-wrap gap-6">
                    {(["none", "top", "bottom"] as const).map((m) => (
                      <Radio key={m} name="align" checked={panel.ribAlign === m} onChange={() => set({ ribAlign: m }, "rib alignment")}>
                        {m === "none" ? "Don't align ribs" : m === "top" ? "Top align" : "Bottom align"}
                      </Radio>
                    ))}
                  </div>
                </GroupBox>
              </>
            )}

            {dialogTab === "ribs" && (
              <>
                <GroupBox title="Panel ribs">
                  <RibLayoutEditor panel={panel} />
                </GroupBox>

                <GroupBox title="Building tabs">
                  <BuildingTabsEditor panel={panel} />
                </GroupBox>
              </>
            )}

            {dialogTab === "spars" && (
              <>
                <GroupBox title="Spars">
                  <div className="mb-3 flex gap-3">
                    <Button onClick={() => ops.addSpar(panel.id, defaultSpar(panel, `Spar ${panel.spars.length + 1}`), spar?.id)}>
                      Add spar
                    </Button>
                    <Button variant="danger" disabled={!spar} onClick={() => spar && ops.removeSpar(panel.id, spar.id)}>
                      Delete spar
                    </Button>
                    <Button
                      aria-haspopup="menu"
                      disabled={!spar}
                      onClick={(e) => {
                        if (!spar) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        openSparMenu(spar, r.left, r.bottom + 4, e.currentTarget);
                      }}
                    >
                      Spar actions…
                    </Button>
                  </div>
                  {panel.spars.length === 0 ? (
                    <Empty title="No spars yet">Add one with the button above.</Empty>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            <th className="h-ctl border-b border-border bg-surface-sunken px-3 text-left text-micro font-medium uppercase tracking-[.05em] text-muted">Name</th>
                            <th className="h-ctl border-b border-border bg-surface-sunken px-3 text-left text-micro font-medium uppercase tracking-[.05em] text-muted">Type</th>
                            <th className="h-ctl border-b border-border bg-surface-sunken px-3 text-left text-micro font-medium uppercase tracking-[.05em] text-muted">Colour</th>
                            <th className="h-ctl border-b border-border bg-surface-sunken px-3 text-right text-micro font-medium uppercase tracking-[.05em] text-muted">Span</th>
                          </tr>
                        </thead>
                        <tbody>
                          {panel.spars.map((s) => {
                            const sel = s.id === spar?.id;
                            return (
                              <tr
                                key={s.id}
                                onClick={() => select({ sparId: s.id })}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  openSparMenu(s, e.clientX, e.clientY, e.currentTarget.querySelector("button"));
                                }}
                                aria-selected={sel}
                                className={`cursor-pointer ${sel ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"}`}
                              >
                                <td className="h-ctl border-b border-border px-0">
                                  <button
                                    type="button"
                                    aria-current={sel || undefined}
                                    onFocus={() => select({ sparId: s.id })}
                                    onKeyDown={(e) => {
                                      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                                        e.preventDefault();
                                        const r = e.currentTarget.getBoundingClientRect();
                                        openSparMenu(s, r.left + 16, r.bottom, e.currentTarget);
                                      }
                                    }}
                                    title={s.name}
                                    className="block h-ctl w-full truncate px-3 text-left"
                                  >
                                    {s.name}
                                  </button>
                                </td>
                                <td className="h-ctl border-b border-border px-3">{SPAR_TYPES.find((t) => t.id === s.type)?.label}</td>
                                <td className="h-ctl border-b border-border px-3">
                                  <span
                                    role="img"
                                    aria-label={s.color === "standard" ? "Standard colour" : `Colour ${s.color}`}
                                    className="inline-block h-3.5 w-7 rounded-sm border border-border-strong align-middle"
                                    style={{ backgroundColor: s.color === "standard" ? "var(--wb-geo-spar)" : s.color }}
                                  />
                                </td>
                                <td className="h-ctl border-b border-border px-3 text-right tabular-nums">
                                  {formatLength(s.spanStartMm, units, 0)} – {formatLength(s.spanEndMm, units, 0)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </GroupBox>

                {spar && <SparEditor panel={panel} spar={spar} />}
              </>
            )}

            {(dialogTab === "le" || dialogTab === "te") && <EdgeEditor panel={panel} which={dialogTab} />}

            {dialogTab === "sheeting" && <SheetingTab panel={panel} />}

            {dialogTab === "construction" && <ConstructionTab panel={panel} />}
          </div>
        </div>

        {/* ------------------------------------------------------- preview */}
        <div className="grid min-h-[320px] min-w-0 grid-rows-[1fr_auto]">
          <Panel2D title={`Rib preview — ${panel.name}`}>
            {activeRib ? (
              <RibView rib={activeRib} label={`Rib ${activeRib.index + 1} · chord ${formatLength(activeRib.chordMm, units, 1)}`} />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
                No ribs generated yet. Open the Ribs tab and press Generate ribs.
              </div>
            )}
          </Panel2D>
          <div className="border-t border-border bg-surface p-4">
            <p className="text-micro uppercase tracking-[.07em] text-muted">Ribs in this panel</p>
            <div tabIndex={0} aria-label="Rib selector" className="wb-scroll mt-2 flex gap-2 overflow-x-auto pb-1">
              {panelRibs.map((r) => (
                <button
                  key={r.ribId}
                  type="button"
                  onClick={() => select({ ribId: r.ribId })}
                  aria-pressed={r.ribId === activeRib?.ribId}
                  className={`h-ctl shrink-0 rounded-sm border px-3 font-mono text-micro ${
                    r.ribId === activeRib?.ribId
                      ? "border-accent bg-selected text-on-selected"
                      : "border-border-input bg-input-bg text-muted hover:text-fg"
                  }`}
                >
                  R{r.index + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {menu && <ContextMenu label="Spar actions" items={menu.items} x={menu.x} y={menu.y} onClose={closeMenu} />}

      {calcOpen && (
        <PanelLengthCalculator
          panel={panel}
          onClose={() => setCalcOpen(false)}
          onApply={(len, thickness, count) => {
            set({ lengthMm: len, ribThicknessMm: thickness, ribCountTarget: count }, "panel length");
            setCalcOpen(false);
          }}
        />
      )}
    </Dialog>
  );
}

function sweepAngle(panel: Panel): number {
  return panel.lengthMm === 0 ? 0 : (Math.atan(panel.sweepMm / panel.lengthMm) * 180) / Math.PI;
}

export function SparEditor({ panel, spar }: { panel: Panel; spar: Spar }) {
  const units = useStore((s) => s.doc.displayUnits);
  const set = (patch: Partial<Spar>, label?: string) => ops.updateSpar(panel.id, spar.id, patch, label);
  const round = spar.type === "round" || spar.type === "roundJoiner";

  return (
    <GroupBox title="Spar data">
      <FieldGrid>
        <Field label="Name:">
          <TextField aria-label="Spar name" value={spar.name} onChange={(e) => set({ name: e.target.value }, "spar name")} />
        </Field>
        <Field label="Type:">
          <select
            value={spar.type}
            onChange={(e) => {
              const type = e.target.value as Spar["type"];
              // An aileron needs its hinge settings; start them sensibly rather than leaving them blank.
              set({ type, ...(type === "aileronCutter" && !spar.aileron ? { aileron: defaultAileron() } : {}) }, "spar type");
            }}
            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg"
            aria-label="Spar type"
          >
            {SPAR_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Colour:">
          <ColourButton label="Spar colour" value={spar.color} onChange={(c) => set({ color: c }, "spar colour")} />
        </Field>
        <Field label="Measured from:">
          <div className="flex gap-6">
            {(["LE", "TE"] as const).map((d) => (
              <Radio key={d} name={`from-${spar.id}`} checked={spar.distanceFrom === d} onChange={() => set({ distanceFrom: d }, "spar datum")}>
                {d === "LE" ? "Leading edge" : "Trailing edge"}
              </Radio>
            ))}
          </div>
        </Field>
        <Field label="Distance:">
          <div className="flex items-start gap-3">
            <LengthField
              className="flex-1"
              label="Distance from the datum edge"
              value={spar.distance.start.value}
              percent={spar.distance.start.unit === "pct"}
              step={spar.distance.start.unit === "pct" ? 1 : 2}
              onCommit={(v) => set({ distance: { ...spar.distance, start: { ...spar.distance.start, value: v } } }, "spar distance")}
            />
            <UnitToggle
              label="Distance unit"
              lengthLabel={units}
              unit={spar.distance.start.unit}
              onChange={(u) => {
                // Convert rather than reinterpret: 25% of a 220mm chord is 55mm.
                const chord = panel.rootChordMm;
                const v =
                  u === "mm"
                    ? (spar.distance.start.value / 100) * chord
                    : chord === 0
                      ? 0
                      : (spar.distance.start.value / chord) * 100;
                set({ distance: { ...spar.distance, start: { value: Number(v.toFixed(3)), unit: u } } }, "spar distance unit");
              }}
            />
          </div>
        </Field>
        <Field label="Span start:">
          <LengthField label="Span start" value={spar.spanStartMm} min={0} max={panel.lengthMm} step={5} onCommit={(v) => set({ spanStartMm: v }, "spar span")} />
        </Field>
        <Field label="Span end:" hint={`Ribs ${ribRange(panel, spar)}`}>
          <LengthField
            label="Span end"
            value={spar.spanEndMm}
            min={0}
            step={5}
            invalid={spar.spanEndMm <= spar.spanStartMm ? "The end must be past the start." : null}
            warning={spar.spanEndMm > panel.lengthMm ? `Ends ${formatLength(spar.spanEndMm - panel.lengthMm, units)} past the tip of this panel.` : null}
            onCommit={(v) => set({ spanEndMm: v }, "spar span")}
          />
        </Field>
        {spar.type === "aileronCutter" ? null : round ? (
          <Field label="Radius:">
            <LengthField label="Radius" value={spar.radiusMm ?? 3} min={0.2} step={0.5} onCommit={(v) => set({ radiusMm: v }, "spar radius")} />
          </Field>
        ) : (
          <>
            <Field label="Width:">
              <LengthField label="Width" value={spar.width?.start ?? 6} min={0.2} step={1} onCommit={(v) => set({ width: { start: v, end: spar.width?.end ?? null } }, "spar width")} />
            </Field>
            <Field label="Height:">
              <LengthField label="Height" value={spar.height?.start ?? 3} min={0.2} step={0.5} onCommit={(v) => set({ height: { start: v, end: spar.height?.end ?? null } }, "spar height")} />
            </Field>
          </>
        )}
      </FieldGrid>
      {spar.type === "aileronCutter" && spar.aileron && (
        <AileronFields aileron={spar.aileron} onChange={(aileron) => set({ aileron }, "aileron")} />
      )}
      {spar.type === "aileronCutter" && !spar.aileron && (
        <p className="mt-4 max-w-prose text-xs text-muted">
          This is the simple cutter: everything behind the hinge line leaves the rib. Add hinge settings for a
          hinge, a gap and close-off walls.
          <Button size="sm" className="ml-3" onClick={() => set({ aileron: defaultAileron() }, "aileron")}>
            Add hinge settings
          </Button>
        </p>
      )}
      {!round && spar.type !== "aileronCutter" && (
        <div className="mt-4 flex flex-wrap gap-6">
          <Checkbox checked={spar.positionTop} onChange={(v) => set({ positionTop: v }, "spar position")}>
            Notch the top surface
          </Checkbox>
          <Checkbox checked={spar.positionBottom} onChange={(v) => set({ positionBottom: v }, "spar position")}>
            Notch the bottom surface
          </Checkbox>
        </div>
      )}
    </GroupBox>
  );
}

export function ribRange(panel: Panel, spar: Spar): string {
  const inside = panel.ribs
    .map((r, i) => ({ i, pos: r.positionMm }))
    .filter((r) => r.pos >= spar.spanStartMm - 1e-6 && r.pos <= spar.spanEndMm + 1e-6);
  if (inside.length === 0) return "none at this span";
  return `${inside[0].i + 1} – ${inside[inside.length - 1].i + 1}`;
}

/** `inUseToggle` is the checkbox that switches the stock on; the builder adds and removes stock from its list instead. */
export function EdgeEditor({ panel, which, inUseToggle = true }: { panel: Panel; which: "le" | "te"; inUseToggle?: boolean }) {
  const edge = which === "le" ? panel.leadingEdge : panel.trailingEdge;
  const key = which === "le" ? "leadingEdge" : "trailingEdge";
  const set = (patch: Partial<typeof edge>) => ops.updatePanel(panel.id, { [key]: { ...edge, ...patch } } as Partial<Panel>, "edge stock");
  const wholeDoc = useStore((s) => s.doc);
  // The smallest block that covers the airfoil, with a millimetre to spare, rounded up to 0.5.
  const raw = edgeFitHeightMm(wholeDoc, panel.id, key);
  const fit = raw === null ? null : Math.ceil((raw + 1) * 2) / 2;

  return (
    <GroupBox title={which === "le" ? "Leading edge stock" : "Trailing edge stock"}>
      <p className="mb-4 max-w-prose text-xs text-muted">
        A block of balsa or spruce the ribs butt against. The ribs are shortened by its width. In the
        3D view the part that follows the airfoil is solid and the excess you carve away is a pale ghost.
        The block should be tall enough to cover the airfoil; the shape sets how it is cut before carving.
      </p>
      {inUseToggle && (
        <div className="mb-4">
          <Checkbox checked={edge.enabled} onChange={(v) => set({ enabled: v })}>
            Use {which === "le" ? "leading" : "trailing"} edge stock
          </Checkbox>
        </div>
      )}
      <FieldGrid>
        <Field label="Shape:" hint="The thick side is the side that meets the ribs.">
          <select
            aria-label="Stock shape"
            disabled={!edge.enabled}
            value={edge.shape}
            onChange={(e) => set({ shape: e.target.value as typeof edge.shape })}
            className="h-ctl w-full rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg disabled:bg-input-bg-disabled disabled:text-disabled"
          >
            <option value="rectangle">Rectangular strip</option>
            <option value="triangle">Tapered wedge</option>
            <option value="round">Rounded edge</option>
          </select>
        </Field>
        <Field label="Width:">
          <LengthField label="Stock width" disabled={!edge.enabled} value={edge.widthMm} min={0} step={1} onCommit={(v) => set({ widthMm: v })} />
        </Field>
        <Field label="Height:">
          <LengthField label="Stock height" disabled={!edge.enabled} value={edge.heightMm} min={0} step={1} onCommit={(v) => set({ heightMm: v })} />
          <Button
            size="sm"
            className="mt-2"
            disabled={!edge.enabled || fit === null}
            onClick={() => fit !== null && set({ heightMm: fit })}
          >
            Fit height to wing
          </Button>
        </Field>
      </FieldGrid>
    </GroupBox>
  );
}


/**
 * S05 airfoil section: pick the section for the root rib and, optionally, a
 * different one for the tip, with a thickness factor on each. The engine
 * interpolates between whatever the two ends say.
 */
function AirfoilPicker({
  panel,
  foils,
  shown,
  filter,
  setFilter,
  onImport,
}: {
  onImport: (target: "root" | "tip") => void;
  panel: Panel;
  foils: ReturnType<typeof listFoils>;
  shown: ReturnType<typeof listFoils>;
  filter: string;
  setFilter: (v: string) => void;
}) {
  const embedded = useStore((s) => s.doc.airfoils);
  const index = useStore((s) => s.doc.wing.panels.findIndex((p) => p.id === panel.id));
  const [target, setTarget] = useState<"root" | "tip">("root");
  const hasTip = panel.tipAirfoilId !== null;
  const set = (patch: Partial<Panel>, label?: string) => ops.updatePanel(panel.id, patch, label);
  // The first panel has nothing before it to link to.
  const canLink = index > 0;
  const linked = canLink && panel.airfoilLinkedToPrev;
  // A linked panel starts on the previous panel's tip, so only its tip is for choosing.
  const effectiveTarget = linked ? "tip" : target;

  const activeId = effectiveTarget === "root" ? panel.rootAirfoilId : (panel.tipAirfoilId ?? panel.rootAirfoilId);
  const shownMetrics = foilMetrics(activeId, embedded);

  const pick = (id: string) => {
    if (effectiveTarget === "root") set({ rootAirfoilId: id }, "airfoil");
    else set({ tipAirfoilId: id }, "tip airfoil");
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-2" role="radiogroup" aria-label="Which rib the airfoil list applies to">
        <Radio name={`foil-target-${panel.id}`} checked={effectiveTarget === "root"} disabled={linked} onChange={() => setTarget("root")}>
          Root rib
        </Radio>
        <Radio
          name={`foil-target-${panel.id}`}
          checked={effectiveTarget === "tip"}
          onChange={() => {
            setTarget("tip");
            if (!hasTip) set({ tipAirfoilId: panel.rootAirfoilId }, "tip airfoil");
          }}
        >
          Tip rib
        </Radio>
        <Button size="sm" onClick={() => onImport(effectiveTarget)}>
          Import airfoil…
        </Button>
        {hasTip && (
          <Button
            size="sm"
            onClick={() => {
              set({ tipAirfoilId: null }, "tip airfoil");
              setTarget("root");
            }}
          >
            Use the root section at the tip
          </Button>
        )}
      </div>

      <FieldGrid>
        <Field label="Root section:">
          <p className="text-sm text-fg">
            {foilName(panel.rootAirfoilId, embedded)}
            {linked && <span className="ml-2 text-micro text-muted">from the previous panel</span>}
          </p>
        </Field>
        <Field label="Root thickness:">
          <NumberField
            label="Root thickness factor"
            disabled={linked}
            value={panel.rootAirfoilScale}
            min={0.2}
            max={3}
            step={0.05}
            onCommit={(v) => set({ rootAirfoilScale: v }, "root thickness factor")}
          />
        </Field>
        <Field label="Tip section:">
          <p className="text-sm text-fg">
            {hasTip ? foilName(panel.tipAirfoilId!, embedded) : `${foilName(panel.rootAirfoilId, embedded)} (same as root)`}
          </p>
        </Field>
        <Field label="Tip thickness:">
          <NumberField
            label="Tip thickness factor"
            value={panel.tipAirfoilScale}
            min={0.2}
            max={3}
            step={0.05}
            onCommit={(v) => set({ tipAirfoilScale: v }, "tip thickness factor")}
          />
        </Field>
      </FieldGrid>

      <div className="mt-4 mb-3">
        <TextField
          placeholder="Filter airfoils"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter airfoils"
        />
      </div>
      <p className="mb-2 text-micro text-muted" aria-live="polite">
        {shown.length} of {foils.length} airfoils &middot; choosing one sets the{" "}
        {effectiveTarget === "root" ? "root" : "tip"} rib
      </p>
      <div tabIndex={0} aria-label="Airfoil list" className="wb-scroll max-h-44 overflow-auto rounded-md border border-border">
        {shown.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-muted">
            Nothing matches “{filter}”. Import a .dat file from the toolbar to add your own.
          </p>
        ) : (
          <ul>
            {shown.map((f) => {
              const active = activeId === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => pick(f.id)}
                    className={`flex h-ctl w-full items-center justify-between px-4 text-left text-sm ${
                      active ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"
                    }`}
                    aria-pressed={active}
                  >
                    <span className={f.imported ? "italic" : ""}>{f.name}</span>
                    <span className="text-micro text-muted">{f.imported ? "imported" : f.note}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {shownMetrics && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
          <div className="flex justify-between">
            <dt>Thickness</dt>
            <dd className="tabular-nums text-fg">
              {(shownMetrics.thicknessPct * (effectiveTarget === "root" ? panel.rootAirfoilScale : panel.tipAirfoilScale)).toFixed(1)}%
            </dd>
          </div>
          <div className="flex justify-between"><dt>at</dt><dd className="tabular-nums text-fg">{shownMetrics.maxThicknessAtPct.toFixed(1)}%</dd></div>
          <div className="flex justify-between"><dt>Camber</dt><dd className="tabular-nums text-fg">{shownMetrics.camberPct.toFixed(1)}%</dd></div>
          <div className="flex justify-between"><dt>at</dt><dd className="tabular-nums text-fg">{shownMetrics.maxCamberAtPct.toFixed(1)}%</dd></div>
        </dl>
      )}
    </>
  );
}

/** How a panel's sections are used: blended through the previous panel, and the nose smoothed. */
function AirfoilOptions({ panel }: { panel: Panel }) {
  const index = useStore((s) => s.doc.wing.panels.findIndex((p) => p.id === panel.id));
  const set = (patch: Partial<Panel>, label?: string) => ops.updatePanel(panel.id, patch, label);
  const canLink = index > 0;
  const linked = canLink && panel.airfoilLinkedToPrev;
  return (
    <>
      <div className="mb-4">
        <Checkbox checked={linked} disabled={!canLink} onChange={(v) => set({ airfoilLinkedToPrev: v }, "airfoil link")}>
          Blend smoothly through the previous panel
        </Checkbox>
        <p className="mt-1 max-w-prose text-micro text-muted">
          {canLink
            ? "This panel starts on the section the previous one ends on, and the sections either side of the join are joined by one smooth curve instead of two straight blends."
            : "The first panel has nothing before it to blend with."}
        </p>
      </div>
      <div className="mb-4">
        <Checkbox
          checked={panel.noseSmoothing.enabled}
          onChange={(v) => set({ noseSmoothing: { ...panel.noseSmoothing, enabled: v } }, "nose smoothing")}
        >
          Smooth the nose of the ribs
        </Checkbox>
        <p className="mt-1 max-w-prose text-micro text-muted">
          Evens out a lumpy leading edge, for example from a section traced off a drawing, without changing its shape.
        </p>
      </div>
      <FieldGrid>
        <Field label="Smooth back to:" hint="Percentage of the chord, 1 to 30.">
          <LengthField
            percent
            label="Nose smoothing extent"
            disabled={!panel.noseSmoothing.enabled}
            value={panel.noseSmoothing.extentPct}
            min={1}
            max={30}
            step={1}
            decimals={1}
            onCommit={(v) => set({ noseSmoothing: { ...panel.noseSmoothing, extentPct: v } }, "nose smoothing")}
          />
        </Field>
      </FieldGrid>
    </>
  );
}


/**
 * S06 building tabs: stubs that hang past the section so a rib can be pinned
 * flat to a board while the wing is glued, then snapped off.
 */
export function BuildingTabsEditor({ panel, inUseToggle = true }: { panel: Panel; inUseToggle?: boolean }) {
  const t = panel.buildingTabs;
  const set = (patch: Partial<typeof t>) =>
    ops.updatePanel(panel.id, { buildingTabs: { ...t, ...patch } }, "building tabs");
  const off = !t.enabled;

  return (
    <>
      <p className="mb-4 max-w-prose text-xs text-muted">
        Extra material on the rib, outside the airfoil, so it can be pinned to a flat board while
        the wing is glued. Snap them off afterwards.
      </p>
      {inUseToggle && (
        <div className="mb-4">
          <Checkbox checked={t.enabled} onChange={(v) => set({ enabled: v })}>
            Add building tabs to every rib
          </Checkbox>
        </div>
      )}

      <fieldset className="mb-4 flex flex-wrap gap-x-8 gap-y-1" disabled={off}>
        <legend className="sr-only">Which tabs</legend>
        <Checkbox checked={t.below} onChange={(v) => set({ below: v })} disabled={off}>
          Below the rib
        </Checkbox>
        <Checkbox checked={t.above} onChange={(v) => set({ above: v })} disabled={off}>
          Above the rib
        </Checkbox>
        <Checkbox checked={t.fore} onChange={(v) => set({ fore: v })} disabled={off}>
          Near the leading edge
        </Checkbox>
        <Checkbox checked={t.aft} onChange={(v) => set({ aft: v })} disabled={off}>
          Near the trailing edge
        </Checkbox>
        <Checkbox checked={t.holes} onChange={(v) => set({ holes: v })} disabled={off}>
          Pin hole in each tab
        </Checkbox>
      </fieldset>

      <FieldGrid>
        <Field label="Stick out by:">
          <LengthField
            label="Tab extension"
            disabled={off}
            value={t.extendMm}
            min={0.5}
            step={1}
            onCommit={(v) => set({ extendMm: v })}
          />
        </Field>
        <Field label="Margin at the sides:">
          <LengthField
            label="Tab margin at the sides: a pin hole is the tab width less twice this"
            disabled={off}
            value={t.sidesMm}
            min={0}
            step={0.5}
            onCommit={(v) => set({ sidesMm: v })}
          />
        </Field>
        <Field label="Fore tab from LE:">
          <LengthField
            label="Fore tab distance from the leading edge"
            disabled={off || !t.fore}
            value={t.fromLE.value}
            percent={t.fromLE.unit === "pct"}
            min={0}
            step={1}
            onCommit={(v) => set({ fromLE: { ...t.fromLE, value: v } })}
          />
        </Field>
        <Field label="Fore tab width:">
          <LengthField
            label="Fore tab width"
            disabled={off || !t.fore}
            value={t.widthLE}
            min={1}
            step={1}
            onCommit={(v) => set({ widthLE: v })}
          />
        </Field>
        <Field label="Aft tab from TE:">
          <LengthField
            label="Aft tab distance from the trailing edge"
            disabled={off || !t.aft}
            value={t.fromTE.value}
            percent={t.fromTE.unit === "pct"}
            min={0}
            step={1}
            onCommit={(v) => set({ fromTE: { ...t.fromTE, value: v } })}
          />
        </Field>
        <Field label="Aft tab width:">
          <LengthField
            label="Aft tab width"
            disabled={off || !t.aft}
            value={t.widthTE}
            min={1}
            step={1}
            onCommit={(v) => set({ widthTE: v })}
          />
        </Field>
      </FieldGrid>
      {t.enabled && !t.below && !t.above && (
        <p className="mt-3 text-micro text-warning">Pick above, below or both, or no tabs are cut.</p>
      )}
    </>
  );
}


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
