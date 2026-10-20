/** S14: work the panel length back from the ribs you intend to cut. */
import { useState } from "react";
import type { Panel } from "../../domain/schema";
import { formatLength } from "../../domain/units";
import { useStore } from "../../state/store";
import { Button, Dialog, Field, FieldGrid, NumberField } from "../primitives";
import { LengthField } from "../LengthField";

export function PanelLengthCalculator({
  panel,
  onClose,
  onApply,
}: {
  panel: Panel;
  onClose: () => void;
  onApply: (lengthMm: number, thicknessMm: number, count: number) => void;
}) {
  const units = useStore((s) => s.doc.displayUnits);
  const [thickness, setThickness] = useState(panel.ribThicknessMm);
  const [count, setCount] = useState(panel.ribCountTarget);
  const [pitch, setPitch] = useState(
    panel.ribCountTarget > 1 ? panel.lengthMm / (panel.ribCountTarget - 1) : 45,
  );

  // Rib centres are `pitch` apart, so the panel spans (n-1) gaps plus one rib.
  const length = Math.max(0, (count - 1) * pitch + thickness);

  return (
    <Dialog
      title="Panel length calculator"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onApply(Number(length.toFixed(3)), thickness, Math.round(count))}>
            Use this length
          </Button>
        </>
      }
    >
      <div className="p-6">
        <p className="mb-5 max-w-prose text-sm text-muted">
          Enter the ribs you want and this works out how long the panel has to be. Applying it also sets the
          rib thickness and count — you still press Generate ribs to cut them.
        </p>
        <FieldGrid>
          <Field label="Rib thickness:">
            <LengthField label="Rib thickness" value={thickness} min={0.4} step={0.5} onCommit={setThickness} />
          </Field>
          <Field label="No. of ribs:">
            <NumberField label="Number of ribs" value={count} decimals={0} min={2} max={200} step={1} onCommit={(v) => setCount(Math.round(v))} />
          </Field>
          <Field label="Between ribs:">
            <LengthField label="Distance between ribs" value={pitch} min={1} step={5} onCommit={setPitch} />
          </Field>
        </FieldGrid>
        <p className="mt-6 text-sm">
          Panel length{" "}
          <strong className="font-mono tabular-nums">{formatLength(length, units)}</strong>{" "}
          <span className="text-muted">
            / {units === "mm" ? formatLength(length, "in") : formatLength(length, "mm", 1)}
          </span>
        </p>
      </div>
    </Dialog>
  );
}
