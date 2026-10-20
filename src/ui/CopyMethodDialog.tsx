/** How a new panel should relate to the one before it. Smart is the default. */
import { useState } from "react";
import { COPY_METHODS, type CopyMethod } from "../domain/panelCopy";
import { Button, Dialog, Radio } from "./primitives";

/** Little plan-view sketches: root at the left, tip at the right, the join in the middle. */
function Sketch({ method }: { method: CopyMethod }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" as const };
  return (
    <svg width="132" height="52" viewBox="0 0 132 52" role="img" aria-hidden="true" className="shrink-0 text-muted">
      {/* the previous panel: wide at the root, narrower at the tip */}
      <path d="M6 10 L62 18 L62 34 L6 44 Z" {...stroke} />
      {method === "smart" && <path d="M66 18 L122 18 L122 34 L66 34 Z" {...stroke} strokeDasharray="3 2" />}
      {method === "mirror" && <path d="M66 18 L122 10 L122 44 L66 34 Z" {...stroke} strokeDasharray="3 2" />}
      {method === "direct" && <path d="M66 10 L122 18 L122 34 L66 44 Z" {...stroke} strokeDasharray="3 2" />}
      <path d="M64 4 V48" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1 3" />
    </svg>
  );
}

export function CopyMethodDialog({
  onChoose,
  onCancel,
  previousName,
}: {
  onChoose: (method: CopyMethod) => void;
  onCancel: () => void;
  previousName: string;
}) {
  const [method, setMethod] = useState<CopyMethod>("smart");
  return (
    <Dialog
      title="Add a panel"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onChoose(method)}>
            Add panel
          </Button>
        </>
      }
    >
      <div className="px-6 py-5">
        <p className="mb-4 text-sm text-muted">
          How should the new panel start out, compared with <strong className="text-fg">{previousName}</strong>?
          You can change anything afterwards.
        </p>
        <div role="radiogroup" aria-label="How the new panel starts" className="flex flex-col gap-4">
          {COPY_METHODS.map((m) => (
            <div key={m.id} className="flex items-start gap-4 rounded-md border border-border p-4">
              <Sketch method={m.id} />
              <div className="min-w-0">
                <Radio name="copy-method" checked={method === m.id} onChange={() => setMethod(m.id)}>
                  <span className="font-medium">{m.label}</span>
                  {m.id === "smart" && <span className="ml-2 text-micro text-muted">suggested</span>}
                </Radio>
                <p className="mt-1 text-xs text-muted">{m.summary}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
