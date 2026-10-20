/**
 * Project files.
 *
 * The File System Access API is Chromium-only, so the download/upload path is
 * the one that has to feel finished; the handle-based path is the bonus. OPFS
 * The working copy lives in local storage (see localStore.ts); a file is the copy that travels.
 */
import { ProjectDoc } from "../domain/schema";

export const FILE_EXT = ".wingbuddy.json";

export function serialise(doc: ProjectDoc): string {
  return JSON.stringify(doc, null, 2);
}

export class ProjectLoadError extends Error {}

export function deserialise(text: string): ProjectDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectLoadError("That file is not valid JSON, so it is not a Wing Buddy project.");
  }
  const parsed = ProjectDoc.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ProjectLoadError(
      `This file does not match the project format: ${first.path.join(".") || "root"} — ${first.message}.`,
    );
  }
  return parsed.data;
}

export function download(data: string | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    // Attached while open: some browsers do not deliver the change event for an input
    // that was never in the document.
    input.style.display = "none";
    document.body.appendChild(input);
    const done = (f: File | null) => {
      input.remove();
      resolve(f);
    };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.oncancel = () => done(null);
    input.click();
  });
}
