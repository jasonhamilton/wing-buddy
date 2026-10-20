/** File ▸ Sample plans: a list of ready-made wings to open, with their span and area. */
import { useEffect, useState } from "react";
import { formatArea, formatLength } from "../domain/units";
import { loadSamples, type SamplePlan } from "../io/samples";
import { useStore } from "../state/store";
import { Button, Dialog } from "./primitives";

export function SamplePlansDialog({ onLoad, onClose }: { onLoad: (plan: SamplePlan) => void; onClose: () => void }) {
  const units = useStore((s) => s.doc.displayUnits);
  const [plans, setPlans] = useState<SamplePlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadSamples()
      .then((p) => live && setPlans(p))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const chosen = plans?.find((p) => p.file === picked) ?? null;
  return (
    <Dialog
      title="Sample plans"
      large
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && onLoad(chosen)}>
            Load plan
          </Button>
        </>
      }
    >
      <div className="px-6 py-5 text-sm">
        <p className="mb-4 text-muted">Wings drawn from published plans. Pick one to open it as your project.</p>
        {failed ? (
          <p role="alert" className="text-danger">The sample plans could not be loaded. Check your connection and try again.</p>
        ) : plans === null ? (
          <p role="status" className="text-muted">Loading the plans…</p>
        ) : plans.length === 0 ? (
          <p className="text-muted">There are no sample plans yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table aria-label="Sample plans" className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Plane", "Span", "Area"].map((h, i) => (
                    <th key={h} scope="col" className={`h-ctl border-b border-border bg-surface-sunken px-3 text-micro font-medium uppercase tracking-[.05em] text-muted ${i ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const sel = p.file === picked;
                  return (
                    <tr key={p.file} aria-selected={sel} className={sel ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"}>
                      <td className="h-ctl border-b border-border px-0">
                        <button
                          type="button"
                          aria-pressed={sel}
                          onClick={() => setPicked(p.file)}
                          onDoubleClick={() => onLoad(p)}
                          className="block h-ctl w-full truncate px-3 text-left"
                          title={p.name}
                        >
                          {p.name}
                        </button>
                      </td>
                      <td className="h-ctl border-b border-border px-3 text-right tabular-nums">{formatLength(p.spanMm, units, units === "in" ? 1 : 0)}</td>
                      <td className="h-ctl border-b border-border px-3 text-right tabular-nums">{formatArea(p.areaDm2, units)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
