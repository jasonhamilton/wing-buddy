/**
 * The project, kept in this browser's local storage so a reload brings it back.
 *
 * This is the working copy, not an archive: clearing site data, a private window or a
 * different browser starts empty. A file written with Save is the copy that travels.
 * Two tabs share one slot and the last write wins; each tab keeps its own document in
 * memory, so neither changes the other until one of them reloads.
 */
import { ProjectDoc } from "../domain/schema";

export const STORAGE_KEY = "wingbuddy.project.v1";
const CORRUPT_KEY = "wingbuddy.project.unreadable";

type Stored = { v: 1; savedAt: string; dirty: boolean; doc: unknown };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked outright, as in some privacy modes
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: "unavailable" | "full" };

export function saveLocal(doc: ProjectDoc, dirty: boolean): SaveResult {
  const s = storage();
  if (!s) return { ok: false, reason: "unavailable" };
  const body: Stored = { v: 1, savedAt: new Date().toISOString(), dirty, doc };
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(body));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof DOMException && err.name === "QuotaExceededError" ? "full" : "unavailable" };
  }
}

/** The stored project, or null when there is none or it cannot be trusted. */
export function loadLocal(): { doc: ProjectDoc; dirty: boolean } | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const doc = ProjectDoc.safeParse(parsed.doc);
    if (parsed.v === 1 && doc.success) return { doc: doc.data, dirty: parsed.dirty === true };
  } catch {
    /* fall through to the quarantine below */
  }
  // Do not silently overwrite something we could not read: set it aside so it can be recovered.
  try {
    s.setItem(CORRUPT_KEY, raw);
    s.removeItem(STORAGE_KEY);
  } catch {
    /* nothing more can be done */
  }
  return null;
}

export function clearLocal(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
