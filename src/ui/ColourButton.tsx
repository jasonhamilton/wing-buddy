/** A swatch that shows a colour and opens the colour dialog. "Standard" means the part's own default colour. */
import { useState } from "react";
import type { Color } from "../domain/schema";
import { ColourDialog } from "./ColourDialog";

export function ColourButton({
  label,
  value,
  onChange,
  standardVar = "--wb-geo-spar",
}: {
  /** what this colour is for, e.g. "Spar colour" */
  label: string;
  value: Color;
  onChange: (c: Color) => void;
  /** the design token the standard colour comes from */
  standardVar?: string;
}) {
  const [open, setOpen] = useState(false);
  const standard = value === "standard";
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${standard ? "standard" : value}. Change.`}
        onClick={() => setOpen(true)}
        className="flex h-ctl items-center gap-3 rounded-sm border border-border-input bg-input-bg px-2 text-sm text-fg hover:bg-surface-sunken"
      >
        <span
          aria-hidden="true"
          className="h-4 w-8 rounded-sm border border-border-strong"
          style={{ backgroundColor: standard ? `var(${standardVar})` : value }}
        />
        <span>{standard ? "Standard" : value}</span>
      </button>
      {open && (
        <ColourDialog
          current={value}
          title={`${label}`}
          onCancel={() => setOpen(false)}
          onChoose={(c) => {
            setOpen(false);
            onChange(c);
          }}
        />
      )}
    </>
  );
}
