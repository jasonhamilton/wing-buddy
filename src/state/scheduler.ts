/**
 * Runs the geometry rebuild off the main thread, with the previous result kept
 * on screen while a new one is in flight.
 *
 * Every job carries a sequence number; a result that arrives after a newer job
 * started is dropped. Without that, a slow rebuild of an old document can land
 * after a fast rebuild of the current one and show the user stale ribs.
 *
 * The worker is a progressive enhancement: if it cannot start (an old browser,
 * a blocked module worker), the same function runs synchronously instead. The
 * app stays correct, it just blocks for a few milliseconds.
 */
import * as Comlink from "comlink";
import type { ProjectDoc } from "../domain/schema";
import { rebuild as rebuildSync } from "../geometry";
import type { GeometryResult } from "../geometry/types";
import type { GeometryApi } from "../worker/geometry.worker";

let remote: Comlink.Remote<GeometryApi> | null = null;
let workerFailed = false;

function getRemote(): Comlink.Remote<GeometryApi> | null {
  if (workerFailed) return null;
  if (remote) return remote;
  try {
    const worker = new Worker(new URL("../worker/geometry.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("error", () => {
      workerFailed = true;
      remote = null;
    });
    remote = Comlink.wrap<GeometryApi>(worker);
    return remote;
  } catch {
    workerFailed = true;
    return null;
  }
}

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export type ScheduleOptions = {
  debounceMs?: number;
  onResult: (result: GeometryResult) => void;
  onStart?: () => void;
};

export function scheduleRebuild(doc: ProjectDoc, options: ScheduleOptions): void {
  const { debounceMs = 120, onResult, onStart } = options;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const mine = ++sequence;
    onStart?.();
    const api = getRemote();
    const run = api
      ? api.rebuild(doc as never)
      : Promise.resolve(rebuildSync(doc));
    void run
      .then((result) => {
        if (mine !== sequence) return; // a newer job has already started
        onResult(result as GeometryResult);
      })
      .catch(() => {
        if (mine !== sequence) return;
        workerFailed = true;
        remote = null;
        onResult(rebuildSync(doc));
      });
  }, debounceMs);
}

export function rebuildNow(doc: ProjectDoc): GeometryResult {
  return rebuildSync(doc);
}
