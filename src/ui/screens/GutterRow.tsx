/** An input with a fixed gutter on its right. Every row has the gutter, so inputs line up whether or not one holds a button. */
import type { ReactNode } from "react";
import { IconButton } from "../primitives";

export function GutterRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <span className="flex w-ctl shrink-0 justify-center">{action}</span>
    </div>
  );
}

/** The small button that opens the rib-count length calculator. */
export function LengthCalcButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Work the length back from a rib count" onClick={onClick} className="border-border-input bg-input-bg">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
        <path d="M5.5 4.5h5M5.5 8h1M9.5 8h1M5.5 11h1M9.5 11h1" />
      </svg>
    </IconButton>
  );
}
