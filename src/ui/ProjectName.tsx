/** The project's name in the header: click it, type, Enter. Escape discards. */
import { useEffect, useRef, useState } from "react";

export const MAX_NAME = 100;

export function ProjectName({
  name,
  changed,
  onRename,
}: {
  name: string;
  /** edited since it was last exported or loaded */
  changed: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Escape blurs the field and a blur commits; this says the blur is a cancel.
  const cancelling = useRef(false);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  const finish = (commit: boolean, viaKeyboard: boolean) => {
    // The input unmounts, and not every browser fires a blur for that, so a flag left set by
    // Escape would swallow the next edit's blur. Always start the next edit clean.
    cancelling.current = false;
    const next = text.trim().slice(0, MAX_NAME);
    if (commit && next && next !== name) onRename(next);
    refocus.current = viaKeyboard;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={input}
        type="text"
        aria-label="Project name"
        value={text}
        maxLength={MAX_NAME}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true, true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelling.current = true; // Escape blurs the field first; that blur is not a commit
            finish(false, true);
          }
        }}
        onBlur={() => {
          if (cancelling.current) cancelling.current = false;
          else if (editing) finish(true, false);
        }}
        className="h-ctl w-[min(20rem,45vw)] min-w-0 rounded-sm border border-border-input bg-input-bg px-2 text-right text-sm text-fg"
      />
    );
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        title={name}
        aria-label={`Project name: ${name}. Click to rename.`}
        aria-describedby={changed ? "project-changed-note" : undefined}
        onClick={() => {
          cancelling.current = false;
          setText(name);
          setEditing(true);
        }}
        className="h-ctl min-w-0 max-w-[min(20rem,45vw)] truncate rounded-sm px-2 text-xs text-muted hover:bg-surface-sunken hover:text-fg"
      >
        {name}
        {changed && <span aria-hidden="true"> •</span>}
      </button>
      {changed && (
        <span id="project-changed-note" className="sr-only">
          Changed since it was last exported.
        </span>
      )}
    </>
  );
}
