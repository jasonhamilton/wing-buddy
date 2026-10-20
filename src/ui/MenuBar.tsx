/**
 * A menu bar: File, Edit and so on. Each is a button that opens a list; an item can open a
 * submenu that flies out beside it (or, on a phone, unfolds beneath it).
 *
 * Keyboard: Enter, Space or ArrowDown opens; arrows move; ArrowRight opens a submenu and
 * ArrowLeft or Escape closes it; Left and Right at the top level move between menus; Escape
 * closes and returns focus to the button; Tab leaves.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry =
  | { separator: true }
  | {
      label: string;
      /** a short note on the right, e.g. what Undo would undo */
      hint?: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect?: () => void;
      submenu?: MenuEntry[];
    };

type Item = Exclude<MenuEntry, { separator: true }>;
const isItem = (e: MenuEntry): e is Item => !("separator" in e);

const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(" ");

/** ⌘ on Apple platforms, Ctrl elsewhere. */
export const modKey = (): string =>
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform) ? "⌘" : "Ctrl+";

const itemsOf = (list: HTMLElement | null): HTMLElement[] =>
  list
    ? Array.from(list.querySelectorAll<HTMLElement>(":scope > [role=menuitem], :scope > div > [role=menuitem]"))
    : [];

function MenuList({
  entries,
  label,
  onClose,
  onEscape,
  edgeLeft,
  compact,
}: {
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
  /** called for Escape and ArrowLeft inside this list */
  onEscape: (reason: "escape" | "left" | "right") => void;
  /** open the flyouts to the left of their parent instead of the right */
  edgeLeft?: boolean;
  compact: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (i: number) => {
    const els = itemsOf(ref.current);
    if (els.length) els[(i + els.length) % els.length].focus();
  };
  const current = () => itemsOf(ref.current).indexOf(document.activeElement as HTMLElement);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={cx(
        "min-w-56 rounded-md border border-border bg-surface-raised py-1 shadow-pop",
        compact && "min-w-0",
      )}
      onKeyDown={(e) => {
        const els = itemsOf(ref.current);
        const i = current();
        // The entry index (separators count), not the position among buttons.
        const focused = i >= 0 ? els[i] : null;
        const item = focused?.dataset.sub === "1" ? Number(focused.dataset.idx) : -1;
        switch (e.key) {
          case "ArrowDown": focusAt(i + 1); break;
          case "ArrowUp": focusAt(i < 0 ? -1 : i - 1); break;
          case "Home": focusAt(0); break;
          case "End": focusAt(-1); break;
          case "ArrowRight":
            if (item >= 0) setOpen(item);
            else onEscape("right");
            break;
          case "ArrowLeft":
            onEscape("left");
            break;
          case "Escape":
            onEscape("escape");
            break;
          case "Tab":
            onClose();
            return;
          default:
            return;
        }
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {entries.map((entry, i) => {
        if (!isItem(entry)) return <hr key={i} className="my-1 border-border" role="separator" />;
        const sub = entry.submenu;
        const isOpen = open === i;
        return (
          <div key={entry.label} className="relative" onMouseLeave={() => !compact && isOpen && setOpen(null)}>
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="menuitem"
              data-sub={sub ? "1" : "0"}
              data-idx={i}
              aria-disabled={entry.disabled || undefined}
              aria-haspopup={sub ? "menu" : undefined}
              aria-expanded={sub ? isOpen : undefined}
              onMouseEnter={() => !compact && sub && setOpen(i)}
              onClick={() => {
                if (entry.disabled) return;
                if (sub) setOpen(isOpen ? null : i);
                else {
                  onClose();
                  entry.onSelect?.();
                }
              }}
              className={cx(
                "flex w-full items-center justify-between gap-8 px-4 py-2 text-left text-sm",
                entry.disabled
                  ? "cursor-not-allowed text-disabled"
                  : "text-fg hover:bg-selected hover:text-on-selected focus:bg-selected focus:text-on-selected",
              )}
            >
              <span>
                {entry.label}
                {entry.hint && (
                  <>
                    {" "}
                    <span className="ml-1 text-micro opacity-80">{entry.hint}</span>
                  </>
                )}
              </span>
              {sub ? (
                <span aria-hidden="true">{compact && isOpen ? "⌄" : "›"}</span>
              ) : entry.shortcut ? (
                <span className="font-mono text-micro opacity-80">{entry.shortcut}</span>
              ) : null}
            </button>
            {sub && isOpen && (
              <div
                className={cx(
                  compact ? "border-l-2 border-border pl-3" : "absolute top-0 z-10",
                  !compact && (edgeLeft ? "right-full -mr-1" : "left-full -ml-1"),
                )}
              >
                <FlyoutList
                  entries={sub}
                  label={entry.label}
                  onClose={onClose}
                  onBack={() => {
                    setOpen(null);
                    buttons.current[i]?.focus();
                  }}
                  compact={compact}
                  edgeLeft={edgeLeft}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A nested list: focuses its first item on mount, hands Left and Escape back to its parent. */
function FlyoutList({
  entries,
  label,
  onClose,
  onBack,
  compact,
  edgeLeft,
}: {
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
  onBack: () => void;
  compact: boolean;
  edgeLeft?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  return (
    <div ref={host}>
      <MenuList
        entries={entries}
        label={label}
        onClose={onClose}
        onEscape={(why) => (why === "right" ? undefined : onBack())}
        compact={compact}
        edgeLeft={edgeLeft}
      />
    </div>
  );
}

export function MenuBar({ menus }: { menus: { label: string; entries: MenuEntry[] }[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const [compact, setCompact] = useState(false);
  const [flip, setFlip] = useState(false);

  const close = useCallback((returnFocus = false) => {
    setOpenIdx((i) => {
      if (returnFocus && i !== null) triggers.current[i]?.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    if (openIdx === null) return;
    const away = (e: Event) => {
      if (!bar.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", away, true);
    window.addEventListener("resize", () => close());
    return () => document.removeEventListener("mousedown", away, true);
  }, [openIdx, close]);

  // Decide, when a menu opens, how its flyouts should lay out.
  useLayoutEffect(() => {
    if (openIdx === null) return;
    setCompact(window.innerWidth < 640);
    const r = triggers.current[openIdx]?.getBoundingClientRect();
    // a flyout needs about 15rem; flip it left when the right side cannot hold it
    setFlip(r ? r.left + 224 + 240 > window.innerWidth : false);
  }, [openIdx]);

  useEffect(() => {
    if (openIdx === null) return;
    const first = bar.current?.querySelector<HTMLElement>(`[data-menu="${openIdx}"] [role=menuitem]`);
    first?.focus();
  }, [openIdx]);

  return (
    <div ref={bar} className="flex items-center" role="group" aria-label="Menus">
      {menus.map((m, i) => (
        <div key={m.label} className="relative" data-menu={i}>
          <button
            ref={(el) => {
              triggers.current[i] = el;
            }}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openIdx === i}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            onMouseEnter={() => openIdx !== null && openIdx !== i && setOpenIdx(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpenIdx(i);
              } else if (openIdx !== null && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
                e.preventDefault();
                const next = (i + (e.key === "ArrowRight" ? 1 : menus.length - 1)) % menus.length;
                setOpenIdx(next);
                triggers.current[next]?.focus();
              }
            }}
            className={cx(
              "h-ctl shrink-0 rounded-sm px-5 text-sm text-fg hover:bg-surface-sunken",
              openIdx === i && "bg-selected text-on-selected hover:bg-selected",
            )}
          >
            {m.label}
          </button>
          {openIdx === i && (
            <div className="absolute left-0 top-full z-[60] mt-1">
              <MenuList
                entries={m.entries}
                label={m.label}
                onClose={() => close()}
                onEscape={(why) => {
                  if (why === "escape") close(true);
                  else if (why === "left" || why === "right") {
                    const next = (i + (why === "right" ? 1 : menus.length - 1)) % menus.length;
                    setOpenIdx(next);
                  }
                }}
                compact={compact}
                edgeLeft={flip}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
