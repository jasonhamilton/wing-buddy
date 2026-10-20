/** The airfoil library: look through the sections, import one, delete one you imported, choose one for a panel. */
import { useEffect, useMemo, useRef, useState } from "react";
import { foilMetrics, foilName, listFoils } from "../../domain/airfoils";
import { ops, useStore } from "../../state/store";
import { Button, Dialog, TextField } from "../primitives";
import { airfoilPath } from "./panelDrawings";

export function AirfoilLibraryDialog({ onImport }: { onImport: () => void }) {
  const { doc, foilPicker, closeFoilPicker } = useStore();
  const panel = doc.wing.panels.find((p) => p.id === foilPicker?.panelId) ?? null;
  const target = foilPicker?.target ?? "root";
  const currentId = panel ? (target === "root" ? panel.rootAirfoilId : (panel.tipAirfoilId ?? panel.rootAirfoilId)) : "";

  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState(currentId);
  const [note, setNote] = useState("");

  const foils = useMemo(() => listFoils(doc.airfoils), [doc.airfoils]);
  const shown = foils.filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const entry = foils.find((f) => f.id === picked) ?? null;

  // A section that has just been imported is the one to look at.
  const known = useRef(new Set(doc.airfoils.map((a) => a.id)));
  useEffect(() => {
    const fresh = doc.airfoils.find((a) => !known.current.has(a.id));
    known.current = new Set(doc.airfoils.map((a) => a.id));
    if (fresh) {
      setPicked(fresh.id);
      setFilter("");
    }
  }, [doc.airfoils]);

  if (!panel) return null;

  const users = doc.wing.panels.flatMap((p) => [
    ...(p.rootAirfoilId === picked ? [`${p.name} root`] : []),
    ...(p.tipAirfoilId === picked ? [`${p.name} tip`] : []),
  ]);
  const metrics = entry ? foilMetrics(entry.id, doc.airfoils) : null;
  const path = entry ? airfoilPath(entry.id, doc.airfoils) : null;
  const canDelete = !!entry?.imported && users.length === 0;

  return (
    <Dialog
      large
      title="Airfoil library"
      onClose={closeFoilPicker}
      footer={
        <>
          <Button onClick={onImport}>Import airfoil…</Button>
          <Button
            variant="danger"
            disabled={!canDelete}
            title={!entry?.imported ? "Built-in sections stay in the library" : users.length ? `In use by ${users.join(", ")}` : undefined}
            onClick={() => {
              if (!entry) return;
              ops.deleteAirfoil(entry.id);
              setNote(`Deleted ${entry.name}. Edit ▸ Undo brings it back.`);
              setPicked(currentId);
            }}
          >
            Delete
          </Button>
          <span role="status" className="mr-auto self-center text-xs text-muted">
            {note}
          </span>
          <Button onClick={closeFoilPicker}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!entry}
            onClick={() => {
              if (!entry) return;
              ops.updatePanel(panel.id, target === "root" ? { rootAirfoilId: entry.id } : { tipAirfoilId: entry.id }, target === "root" ? "airfoil" : "tip airfoil");
              closeFoilPicker();
            }}
          >
            {`Use for the ${target}`}
          </Button>
        </>
      }
    >
      <div className="grid min-h-[360px] grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex min-h-0 flex-col border-b border-border p-4 sm:border-b-0 sm:border-r">
          <TextField aria-label="Filter airfoils" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul aria-label="Airfoils" className="wb-scroll mt-3 max-h-[320px] min-h-0 flex-1 overflow-auto rounded-md border border-border">
            {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted">No airfoil matches that.</li>}
            {shown.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  aria-pressed={f.id === picked}
                  onClick={() => setPicked(f.id)}
                  onDoubleClick={() => {
                    setPicked(f.id);
                    ops.updatePanel(panel.id, target === "root" ? { rootAirfoilId: f.id } : { tipAirfoilId: f.id }, target === "root" ? "airfoil" : "tip airfoil");
                    closeFoilPicker();
                  }}
                  className={`flex h-ctl w-full items-center justify-between gap-3 border-b border-border px-3 text-left text-sm ${
                    f.id === picked ? "bg-selected text-on-selected" : "hover:bg-surface-sunken"
                  }`}
                >
                  <span className="truncate">{f.name}</span>
                  {f.imported && <span className="shrink-0 text-micro uppercase tracking-[.05em] text-muted">imported</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-5" aria-label="Selected airfoil">
          {entry ? (
            <>
              <h3 className="text-base font-medium">{foilName(entry.id, doc.airfoils)}</h3>
              <p className="mb-3 text-xs text-muted">{entry.imported ? "Imported into this project" : (entry.note ?? "Built in")}</p>
              {path && (
                <svg viewBox="-3 -22 106 44" className="block w-full rounded-md border border-border bg-viewport" role="img" aria-label={`${entry.name} drawn at full size`}>
                  <line x1="0" x2="100" y1="0" y2="0" className="stroke-border-strong" strokeWidth="0.4" strokeDasharray="2 2" />
                  <path d={path} className="fill-selected stroke-accent" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              {metrics && (
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <dt className="text-muted">Thickness</dt>
                  <dd className="text-right tabular-nums">{metrics.thicknessPct.toFixed(1)}% at {metrics.maxThicknessAtPct.toFixed(0)}%</dd>
                  <dt className="text-muted">Camber</dt>
                  <dd className="text-right tabular-nums">{metrics.camberPct.toFixed(1)}% at {metrics.maxCamberAtPct.toFixed(0)}%</dd>
                  <dt className="text-muted">Used by</dt>
                  <dd className="text-right">{users.length ? users.join(", ") : "nothing yet"}</dd>
                </dl>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Pick an airfoil from the list to see it here.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
