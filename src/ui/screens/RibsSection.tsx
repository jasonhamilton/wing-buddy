/**
 * The rib controls of the wing geometry view, shown inside the planform section, which draws the ribs across
 * the planform (thickness as line weight, half ribs short). One row of values you click or drag: how many, how thick
 * (with a gear to set each rib's thickness in the table), and the distribution, with the one number its option needs.
 * Under it the rib table, in a section of its own. The same layout the full panel window edits as a form.
 */
import { useState, type ReactNode } from "react";
import type { Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { ops, useStore } from "../../state/store";
import { RibsViewport } from "../viewport/RibsViewport";
import { LengthField } from "../LengthField";
import { ContextMenu, IconButton, NumberField } from "../primitives";
import { Editable, Value } from "./Editable";
import { distributionItems, distributionLabel, HalfRibsAdvanced, RibTableSection, useRibLayout } from "./RibLayoutEditor";

const GEAR = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" />
  </svg>
);
const CARET = (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6l5 5 5-5" />
  </svg>
);

type Open = { kind: "distribution" | "thickness"; x: number; y: number } | null;

export function RibsSection({ panel }: { panel: Panel }) {
  const units = useStore((s) => s.doc.displayUnits);
  const geometry = useStore((s) => s.geometry);
  const ribId = useStore((s) => s.selection.ribId);
  const { layout, set, choose, setThicknessCustom, setHalfRibs, confirm } = useRibLayout(panel);
  const [menu, setMenu] = useState<Open>(null);
  const custom = layout.distribution === "custom";
  const setPanel = (patch: Partial<Panel>, label: string) => ops.updatePanel(panel.id, patch, label);
  const openMenu = (kind: "distribution" | "thickness") => (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, x: r.left, y: r.bottom + 4 });
  };

  const count: ReactNode = !custom ? (
    <Editable
      label="number of ribs"
      drag={{ value: panel.ribCountTarget, step: 1, min: 2, max: 200, onChange: (v) => setPanel({ ribCountTarget: Math.round(v) }, "rib count") }}
      display={panel.ribs.length}
      edit={<NumberField label="Number of ribs" value={panel.ribCountTarget} decimals={0} min={2} max={200} step={1} onCommit={(v) => setPanel({ ribCountTarget: Math.round(v) }, "rib count")} />}
    />
  ) : (
    <span className="px-1.5" title="Set by the rib table">
      {panel.ribs.length}
    </span>
  );

  return (
    <section aria-label="Ribs" className="rounded-lg bg-surface px-4 py-3">
      <h4 className="mb-2 text-micro text-muted">Ribs</h4>
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <Value caption="Ribs">{count}</Value>

        <Value caption="Thickness">
          <span className="flex items-center gap-1">
            {layout.vary.thickness ? (
              <span className="px-1.5" title="Set rib by rib in the table">
                Custom
              </span>
            ) : (
              <Editable
                label="rib thickness"
                drag={{ value: panel.ribThicknessMm, step: 0.5, min: 0.4, onChange: (v) => setPanel({ ribThicknessMm: v }, "rib thickness") }}
                display={formatLength(panel.ribThicknessMm, units, 1)}
                edit={<LengthField label="Rib thickness" value={panel.ribThicknessMm} min={0.4} step={0.5} onCommit={(v) => setPanel({ ribThicknessMm: v }, "rib thickness")} />}
              />
            )}
            <IconButton label="Thickness options" className="h-6 w-6 text-muted hover:text-fg" onClick={openMenu("thickness")}>
              {GEAR}
            </IconButton>
          </span>
        </Value>

        <Value caption="Distribution">
          <button
            type="button"
            aria-haspopup="menu"
            aria-label={`Distribution, ${distributionLabel(layout.distribution)}`}
            onClick={openMenu("distribution")}
            className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-surface-sunken"
          >
            {distributionLabel(layout.distribution)}
            {CARET}
          </button>
        </Value>

        {layout.distribution === "linear" && (
          <Value caption="Spacing">
            <span className="px-1.5" title="The distance between neighbouring ribs">
              {formatLength(panel.ribs.length > 1 ? panel.lengthMm / (panel.ribs.length - 1) : panel.lengthMm, units, 1)}
            </span>
          </Value>
        )}
        {layout.distribution === "exponential" && (
          <Value caption="Exponential bias">
            <Editable
              label="exponential bias"
              drag={{ value: layout.bias, step: 0.1, min: -3, max: 3, onChange: (v) => set({ bias: v }) }}
              display={layout.bias.toFixed(1)}
              edit={<NumberField label="Exponential bias" value={layout.bias} decimals={1} min={-3} max={3} step={0.1} onCommit={(v) => set({ bias: v })} />}
            />
          </Value>
        )}
        {layout.distribution === "chord" && (
          <Value caption="Chord proportionality">
            <Editable
              label="chord proportionality"
              drag={{ value: layout.chordProportionality, step: 0.1, min: -2, max: 2, onChange: (v) => set({ chordProportionality: v }) }}
              display={layout.chordProportionality.toFixed(1)}
              edit={<NumberField label="Chord proportionality" value={layout.chordProportionality} decimals={1} min={-2} max={2} step={0.1} onCommit={(v) => set({ chordProportionality: v })} />}
            />
          </Value>
        )}
      </div>

      <div className="mt-5">
        <RibsViewport result={geometry} panelId={panel.id} selectedRibId={ribId} />
      </div>

      <HalfRibsAdvanced panel={panel} layout={layout} setHalfRibs={setHalfRibs} />
      <RibTableSection panel={panel} layout={layout} />
      {confirm}

      {menu && (
        <ContextMenu
          label={menu.kind === "distribution" ? "Rib distribution" : "Rib thickness"}
          items={
            menu.kind === "distribution"
              ? distributionItems(panel, choose, layout.distribution)
              : [
                  { label: "Equal", onSelect: () => setThicknessCustom(false), current: !layout.vary.thickness },
                  { label: "Custom", onSelect: () => setThicknessCustom(true), current: layout.vary.thickness },
                ]
          }
          x={menu.x}
          y={menu.y}
          onClose={() => {
            const kind = menu.kind;
            setMenu(null);
            document.querySelector<HTMLElement>(kind === "distribution" ? 'button[aria-label^="Distribution,"]' : 'button[aria-label="Thickness options"]')?.focus();
          }}
        />
      )}
    </section>
  );
}
