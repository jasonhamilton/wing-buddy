/** Non-blocking messages. Nothing that is a warning or worse auto-dismisses. */
import { useCallback, useState } from "react";

export type Toast = { id: number; level: "info" | "warning" | "danger"; text: string; detail?: string };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      if (t.level === "info") setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

const BORDER = { info: "border-l-accent", warning: "border-l-warning", danger: "border-l-danger" };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-10 right-5 z-50 flex w-[min(420px,calc(100vw-40px))] flex-col gap-3" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-4 rounded-md border border-l-[3px] border-border bg-surface-raised px-5 py-4 shadow-pop ${BORDER[t.level]}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm">{t.text}</p>
            {t.detail && <p className="mt-1 text-micro text-muted">{t.detail}</p>}
          </div>
          <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
