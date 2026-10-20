/**
 * Writes the project to local storage as it changes. Debounced so typing in a field is not
 * a write per keystroke, and flushed when the page is hidden or closed so the last edit
 * before a reload is never inside the debounce window.
 */
import { saveLocal } from "../io/localStore";
import { useStore } from "./store";

const DELAY_MS = 300;

export function startPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDoc = useStore.getState().doc;
  let lastDirty = useStore.getState().dirty;

  const write = () => {
    timer = null;
    const { doc, dirty } = useStore.getState();
    const r = saveLocal(doc, dirty);
    useStore.getState().setStorageProblem(r.ok ? null : r.reason);
  };

  const unsubscribe = useStore.subscribe((s) => {
    if (s.doc === lastDoc && s.dirty === lastDirty) return;
    lastDoc = s.doc;
    lastDirty = s.dirty;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, DELAY_MS);
  });

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      write();
    }
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

  // A first write, so a visitor's seed project is stored before they touch anything.
  write();
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
  };
}
