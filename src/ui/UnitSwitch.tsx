/** mm | in, in the header. The choice is saved with the project; stored values are always millimetres. */
import { ops, useStore } from "../state/store";
import type { DisplayUnits } from "../domain/units";

const OPTIONS: { id: DisplayUnits; short: string; name: string }[] = [
  { id: "mm", short: "mm", name: "Millimetres" },
  { id: "in", short: "in", name: "Inches" },
];

export function UnitSwitch() {
  const units = useStore((s) => s.doc.displayUnits);
  return (
    <div role="radiogroup" aria-label="Display units" className="inline-flex h-ctl shrink-0 overflow-hidden rounded-sm border border-border-input">
      {OPTIONS.map((o) => (
        <label
          key={o.id}
          className={`flex cursor-pointer items-center border-r border-border-input px-3 font-mono text-xs last:border-r-0 focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-accent ${
            units === o.id ? "bg-accent text-on-accent" : "bg-input-bg text-muted hover:text-fg"
          }`}
        >
          <input
            type="radio"
            name="display-units"
            checked={units === o.id}
            onChange={() => ops.setDisplayUnits(o.id)}
            className="sr-only"
          />
          <span className="sr-only">{o.name}</span>
          <span aria-hidden="true">{o.short}</span>
        </label>
      ))}
    </div>
  );
}
