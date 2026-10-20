/** The sample plans that ship with the app, in public/samples: an index, and one project file per plane. */
import type { ProjectDoc } from "../domain/schema";
import { wingStats } from "../domain/doc";
import { deserialise } from "./projectFile";

export type SamplePlan = { name: string; file: string; doc: ProjectDoc; spanMm: number; areaDm2: number };

type Fetch = (url: string) => Promise<{ ok: boolean; text(): Promise<string>; json(): Promise<unknown> }>;

/** Reads the index and every plan in it. A plan that cannot be read is left out rather than failing the list. */
export async function loadSamples(fetcher: Fetch = (u) => fetch(u), base = "samples/"): Promise<SamplePlan[]> {
  const res = await fetcher(`${base}index.json`);
  if (!res.ok) throw new Error("The list of sample plans could not be found.");
  const index = (await res.json()) as { plans?: { name: string; file: string }[] };
  const out: SamplePlan[] = [];
  for (const entry of index.plans ?? []) {
    try {
      const r = await fetcher(`${base}${entry.file}`);
      if (!r.ok) continue;
      // The plane's own name replaces the long source path the file was saved with.
      const doc = { ...deserialise(await r.text()), name: entry.name };
      const s = wingStats(doc);
      out.push({ name: entry.name, file: entry.file, doc, spanMm: s.spanMm, areaDm2: s.areaDm2 });
    } catch {
      /* skip it */
    }
  }
  return out;
}
