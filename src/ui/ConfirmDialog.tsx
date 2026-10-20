/** A yes/no question that must be answered. Cancel is where focus starts. */
import type { ReactNode } from "react";
import { Button, Dialog } from "./primitives";

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="max-w-prose px-6 py-5 text-sm">{children}</div>
    </Dialog>
  );
}
