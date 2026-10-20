/**
 * UI primitives.
 * Tokens only — no raw hex, no raw pixel sizes.
 */
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { parseNumber } from "../../domain/units";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

const BTN_VARIANT = {
  primary: "bg-accent text-on-accent border-transparent hover:brightness-110",
  secondary: "bg-surface-raised text-fg border-border-input hover:bg-surface-sunken",
  ghost: "bg-transparent text-fg border-transparent hover:bg-surface-sunken",
  danger: "bg-danger text-white border-transparent hover:brightness-110",
};
const BTN_SIZE = { sm: "h-[24px] px-3 text-xs", md: "h-ctl px-5 text-sm", lg: "h-[38px] px-6 text-base" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center gap-3 rounded-sm border font-medium whitespace-nowrap",
        "transition-[background-color,filter] disabled:cursor-not-allowed",
        "disabled:border-border disabled:bg-surface-sunken disabled:text-disabled",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity=".3" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconButton({
  label,
  pressed,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        "inline-flex h-ctl w-ctl items-center justify-center rounded-sm border border-transparent",
        "text-fg hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-disabled",
        pressed && "bg-selected text-on-selected border-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- TextField */

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="text"
        className={cx(
          "h-ctl w-full min-w-0 rounded-sm border border-border-input bg-input-bg px-3 text-sm text-fg",
          "placeholder:text-disabled disabled:bg-input-bg-disabled disabled:text-disabled",
          "disabled:cursor-not-allowed",
          className,
        )}
        {...rest}
      />
    );
  },
);

/* ------------------------------------------------------------- NumberField */

export type NumberFieldProps = {
  value: number;
  onCommit: (value: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
  invalid?: string | null;
  warning?: string | null;
  label?: string;
  id?: string;
  className?: string;
  /** Reads what was typed, as a number in this field's own unit. Defaults to a plain number. */
  parse?: (text: string) => number | null;
  /** How the value is written in the field. Defaults to a fixed number of decimals. */
  format?: (value: number) => string;
};

/**
 * Deliberately not <input type="number">: that eats commas, scroll-wheels the
 * value by accident and cannot carry a unit suffix. Commits on blur and Enter,
 * reverts on Escape, and never clamps mid-typing — "1" on the way to "150"
 * has to survive.
 */
export function NumberField({
  value,
  onCommit,
  unit,
  step = 1,
  min,
  max,
  decimals = 2,
  disabled,
  invalid,
  warning,
  label,
  id,
  className,
  parse = parseNumber,
  format,
}: NumberFieldProps) {
  const show = useCallback((v: number) => (format ? format(v) : v.toFixed(decimals)), [format, decimals]);
  const auto = useId();
  const fieldId = id ?? auto;
  const msgId = `${fieldId}-msg`;
  const [text, setText] = useState(() => show(value));
  const [editing, setEditing] = useState(false);
  // Escape blurs the field, and blur commits. Without this flag the revert
  // would commit the very value it is meant to throw away.
  const reverting = useRef(false);

  useEffect(() => {
    if (!editing) setText(show(value));
  }, [value, show, editing]);

  const clamp = useCallback(
    (v: number) => {
      let out = v;
      if (min !== undefined) out = Math.max(min, out);
      if (max !== undefined) out = Math.min(max, out);
      return out;
    },
    [min, max],
  );

  const commit = useCallback(() => {
    setEditing(false);
    if (reverting.current) {
      reverting.current = false;
      setText(show(value));
      return;
    }
    // Text that is exactly what the field was already showing is not an edit. Without this, a
    // rounded display (9.055in for 230mm) would be committed as 229.997mm just by clicking
    // into the field and out again.
    if (text === show(value)) return;
    const parsed = parse(text);
    if (parsed === null) {
      setText(show(value));
      return;
    }
    const next = clamp(parsed);
    setText(show(next));
    if (next !== value) onCommit(next);
  }, [text, value, show, clamp, onCommit, parse]);

  const bump = (dir: 1 | -1, multiplier = 1) => {
    if (disabled) return;
    const base = parse(text) ?? value;
    const next = clamp(Number((base + dir * step * multiplier).toFixed(6)));
    setText(show(next));
    onCommit(next);
  };

  return (
    <div className={className}>
      <div className="flex h-ctl min-w-0 items-stretch">
        <input
          id={fieldId}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid || warning ? msgId : undefined}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setEditing(true);
            setText(e.target.value);
          }}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              // Revert the field. Crucially, stop here: without this the dialog's
              // own Escape handler fires too and the user loses every edit in it.
              e.preventDefault();
              e.stopPropagation();
              reverting.current = true;
              setEditing(false);
              setText(show(value));
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(1, e.shiftKey ? 10 : 1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(-1, e.shiftKey ? 10 : 1);
            }
          }}
          className={cx(
            "h-ctl min-w-0 flex-1 rounded-l-sm border border-r-0 border-border-input bg-input-bg",
            "px-2 text-right text-sm text-fg tabular-nums",
            "disabled:bg-input-bg-disabled disabled:text-disabled disabled:cursor-not-allowed",
            invalid && "border-danger",
            !invalid && warning && "border-warning",
          )}
        />
        {unit !== undefined && (
          <span
            className={cx(
              "flex w-9 shrink-0 items-center justify-center border-y border-border-input bg-input-bg font-mono text-xs",
              disabled ? "bg-input-bg-disabled text-disabled" : "text-muted",
              invalid && "border-danger",
              !invalid && warning && "border-warning",
            )}
          >
            {unit}
          </span>
        )}
        <span
          className={cx(
            "flex w-[16px] shrink-0 flex-col overflow-hidden rounded-r-sm border border-border-input bg-surface",
            invalid && "border-danger",
            !invalid && warning && "border-warning",
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onClick={() => bump(1)}
            className="flex min-h-0 flex-1 items-center justify-center border-b border-border p-0 text-[7px] leading-none text-muted hover:bg-surface-sunken hover:text-fg disabled:text-disabled"
          >
            ▲
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onClick={() => bump(-1)}
            className="flex min-h-0 flex-1 items-center justify-center p-0 text-[7px] leading-none text-muted hover:bg-surface-sunken hover:text-fg disabled:text-disabled"
          >
            ▼
          </button>
        </span>
      </div>
      {(invalid || warning) && (
        <p id={msgId} className={cx("mt-1 text-micro", invalid ? "text-danger" : "text-warning")}>
          {invalid ?? warning}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Form row */

/**
 * A labelled form row. When the child is a single control that has no id of its
 * own, the label is bound to it automatically — relying on every call site to
 * remember an htmlFor is how unlabelled inputs ship.
 */
export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  const auto = useId();
  const bindable =
    !htmlFor &&
    isValidElement<{ id?: string; "aria-label"?: string }>(children) &&
    !children.props.id &&
    !children.props["aria-label"];
  const id = htmlFor ?? (bindable ? auto : undefined);
  const content = bindable
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: auto })
    : children;

  return (
    <>
      <label
        htmlFor={id}
        // With a hint underneath, centre on the control, not on the control plus its hint.
        className={cx("flex items-center justify-end text-right text-sm text-fg", hint && "h-ctl self-start")}
      >
        {label}
      </label>
      <div className="min-w-0">
        {content}
        {hint && <p className="mt-1 text-micro text-muted">{hint}</p>}
      </div>
    </>
  );
}

export function FieldGrid({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <div className={cx("grid items-center gap-x-5 gap-y-3", compact ? "grid-cols-[88px_1fr]" : "grid-cols-[128px_1fr]")}>{children}</div>;
}

/* ------------------------------------------------------- Checkbox / Radio */

export function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cx("inline-flex min-h-ctl cursor-pointer items-center gap-3 text-sm", disabled && "cursor-not-allowed text-disabled")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="wb-check"
      />
      {children}
    </label>
  );
}

export function Radio({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cx("inline-flex min-h-ctl cursor-pointer items-center gap-3 text-sm", disabled && "cursor-not-allowed text-disabled")}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="wb-check wb-radio" />
      {children}
    </label>
  );
}

/** The %/mm pair. Switching unit converts the value rather than reinterpreting it. */
export function UnitToggle({
  unit,
  onChange,
  disabled,
  label,
  lengthLabel = "mm",
}: {
  unit: "pct" | "mm";
  onChange: (u: "pct" | "mm") => void;
  disabled?: boolean;
  label: string;
  /** what to call the absolute option: "mm" or "in" (the stored unit is millimetres either way) */
  lengthLabel?: string;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-ctl shrink-0 overflow-hidden rounded-sm border border-border-input">
      {(["pct", "mm"] as const).map((u) => (
        <label
          key={u}
          className={cx(
            "flex cursor-pointer items-center border-r border-border-input px-3 font-mono text-xs last:border-r-0",
            unit === u ? "bg-accent text-on-accent" : "bg-input-bg text-muted",
            disabled && "cursor-not-allowed bg-input-bg-disabled text-disabled",
          )}
        >
          <input
            type="radio"
            name={name}
            checked={unit === u}
            disabled={disabled}
            onChange={() => onChange(u)}
            className="sr-only"
          />
          {u === "pct" ? "%" : lengthLabel}
        </label>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  size = "md",
  label,
}: {
  tabs: { id: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  return (
    <div
      role="tablist"
      aria-label={label}
      tabIndex={0}
      className="flex gap-px overflow-x-auto border-b border-border [scrollbar-width:none]"
    >
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          disabled={t.disabled}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            let j = i;
            do {
              j = (j + d + tabs.length) % tabs.length;
            } while (tabs[j].disabled && j !== i);
            onChange(tabs[j].id);
            refs.current[tabs[j].id]?.focus();
          }}
          className={cx(
            "shrink-0 whitespace-nowrap border-b-2 border-transparent px-5 disabled:cursor-not-allowed disabled:text-disabled",
            size === "sm" ? "h-[26px] text-xs" : "h-[34px] text-sm",
            value === t.id ? "border-b-accent font-medium text-fg" : "text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Dialog */

/** Open dialogs, innermost last, so Escape closes only the one on top. */
const openDialogs: symbol[] = [];

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  large,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** twice the standard width, for lists and tables */
  large?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("input,button,select,[tabindex]");
    first?.focus();
    const me = Symbol("dialog");
    openDialogs.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openDialogs[openDialogs.length - 1] === me) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openDialogs.splice(openDialogs.indexOf(me), 1);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-pop",
          wide ? "max-w-[1416px]" : large ? "max-w-4xl" : "max-w-md",
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4 text-sm font-semibold">
          {title}
          <IconButton label="Close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-4 border-t border-border bg-surface px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- ContextMenu */

export type MenuItem = {
  label: string;
  onSelect?: () => void;
  /** Disabled items stay in the list and reachable, with the reason beside them. */
  disabled?: boolean;
  reason?: string;
  /** Opens a second list in place of this one, with a Back item on top. */
  submenu?: MenuItem[];
  /** The choice that is in force now: filled in the accent colour, ticked, and the one the menu opens on. Hover stays the lighter tint, so the two read apart. */
  current?: boolean;
};

/**
 * A menu opened at a point: right-click, the Menu key, or a visible button.
 * Arrow keys move, Enter picks, Escape or ArrowLeft steps back, Tab leaves.
 * Escape is swallowed here so a menu inside a dialog does not close the dialog.
 */
export function ContextMenu({
  label,
  items,
  x,
  y,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<{ title: string; items: MenuItem[] }[]>([]);
  const view = trail.length ? trail[trail.length - 1] : { title: label, items };
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, trail]);

  useEffect(() => {
    (ref.current?.querySelector<HTMLElement>('[role="menuitem"][aria-current="true"]') ?? ref.current?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
  }, [trail]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", away, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const back = () => (trail.length ? setTrail(trail.slice(0, -1)) : onClose());
  const rows: MenuItem[] = trail.length ? [{ label: "Back", onSelect: back }, ...view.items] : view.items;

  const move = (to: number) => {
    const els = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (els?.length) els[(to + els.length) % els.length].focus();
  };
  const here = () =>
    Array.from(ref.current?.querySelectorAll('[role="menuitem"]') ?? []).indexOf(document.activeElement as Element);

  const choose = (it: MenuItem) => {
    if (it.disabled) return;
    if (it.submenu) setTrail([...trail, { title: it.label, items: it.submenu }]);
    else {
      onClose();
      it.onSelect?.();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={view.title}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[60] min-w-48 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface-raised py-1 shadow-pop"
      onKeyDown={(e) => {
        const k = e.key;
        if (k === "ArrowDown") move(here() + 1);
        else if (k === "ArrowUp") move(here() - 1);
        else if (k === "Home") move(0);
        else if (k === "End") move(-1);
        else if (k === "ArrowLeft" && trail.length) back();
        else if (k === "ArrowRight") {
          const it = rows[here()];
          if (it?.submenu) choose(it);
        } else if (k === "Escape") back();
        else if (k === "Tab") onClose();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {rows.map((it, i) => (
        <button
          key={`${view.title}-${i}`}
          type="button"
          role="menuitem"
          aria-disabled={it.disabled || undefined}
          aria-haspopup={it.submenu ? "menu" : undefined}
          aria-current={it.current ? "true" : undefined}
          onClick={() => choose(it)}
          className={cx(
            "flex w-full items-center justify-between gap-6 px-4 py-2 text-left text-sm",
            it.disabled
              ? "cursor-not-allowed text-disabled"
              : it.current
                ? "bg-accent font-medium text-on-accent focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-on-accent"
                : "text-fg hover:bg-selected hover:text-on-selected focus:bg-selected focus:text-on-selected",
          )}
        >
          <span>{it.label}</span>
          {it.current ? (
            <span aria-hidden="true">✓</span>
          ) : it.submenu ? (
            <span aria-hidden="true">›</span>
          ) : it.disabled && it.reason ? (
            <span className="text-micro text-muted">{it.reason}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong px-6 py-8 text-center text-sm text-muted">
      <strong className="mb-1 block font-medium text-fg">{title}</strong>
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-micro font-medium uppercase tracking-[.07em] text-muted">{children}</p>;
}

export function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}
