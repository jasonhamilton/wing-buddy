/**
 * Geometry warnings live here rather
 * than in a modal that interrupts the edit that caused them.
 */
import { describeCheck } from "./checkLabels";
import { useState } from "react";
import { ops, useStore } from "../state/store";
import { Button } from "./primitives";

export function StatusBar() {
  const { doc, geometry, computing } = useStore();
  const [open, setOpen] = useState(false);
  // What the last press of Fix did, or why it did nothing; read out to a screen reader as well.
  const [fixNote, setFixNote] = useState<{ ok: boolean; text: string } | null>(null);
  const warnings = geometry?.warnings ?? [];
  const errors = warnings.filter((w) => w.level === "error").length;

  return (
    <>
      {open && warnings.length > 0 && (
        <div tabIndex={0} aria-label="Geometry warnings" className="wb-scroll max-h-56 overflow-auto border-t border-border bg-surface px-5 py-3">
          <ul className="space-y-2">
            {warnings.map((w, i) => (
              <li key={i} className={`flex items-start justify-between gap-3 border-l-[3px] pl-4 text-sm ${w.level === "error" ? "border-l-danger" : "border-l-warning"}`}>
                <span>
                  {(() => {
                    const d = describeCheck(doc, w);
                    return (
                      <>
                        {(d.panel || d.feature) && <span className="mr-2 font-medium uppercase tracking-[.05em] text-muted">{[d.panel, d.feature].filter(Boolean).join(" · ")}</span>}
                        {d.text}
                      </>
                    );
                  })()}
                </span>
                {w.fix && (
                  <Button
                    size="sm"
                    aria-label={`Fix: ${w.message}`}
                    onClick={() => {
                      const done = ops.fixCheck(w);
                      setFixNote(done ? { ok: true, text: done } : { ok: false, text: "That could not be fixed automatically. Open the panel to change it by hand." });
                    }}
                  >
                    Fix
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {fixNote && (
            <p role="status" className={`mt-2 text-sm ${fixNote.ok ? "text-muted" : "text-warning"}`}>
              {fixNote.text}
            </p>
          )}
        </div>
      )}
      <footer tabIndex={0} aria-label="Status" className="flex h-8 shrink-0 items-center gap-5 overflow-x-auto whitespace-nowrap border-t border-border bg-surface px-4 text-sm text-muted">
        {warnings.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`flex items-center gap-2 font-medium ${errors ? "text-danger" : "text-warning"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2.2 14.5 13.5h-13z" />
              <path d="M8 6.6v3M8 11.6v.1" />
            </svg>
            {errors ? `${errors} error${errors > 1 ? "s" : ""}` : `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
          </button>
        )}
        <span className="ml-auto">
          {computing ? "Recomputing…" : geometry ? `${geometry.ribs.length} ribs · ${geometry.tookMs.toFixed(0)}ms` : "—"}
        </span>
      </footer>
      <p className="sr-only" aria-live="polite">
        {computing ? "Recomputing geometry." : geometry ? `${geometry.ribs.length} ribs ready. ${warnings.length} warnings.` : ""}
      </p>
    </>
  );
}
