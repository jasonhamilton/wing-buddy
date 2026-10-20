/** Resolves airfoil ids to resampled sections, with a cache. */
import { BUILTIN_FOILS, naca4 } from "../data/naca";
import { metrics, toSurfaces } from "../geometry/airfoil";
import type { AirfoilMetrics, Surfaces } from "../geometry/types";
import type { Airfoil } from "./schema";

export type FoilEntry = {
  id: string;
  name: string;
  imported: boolean;
  note?: string;
};

const cache = new Map<string, Surfaces>();

export function builtinList(): FoilEntry[] {
  return BUILTIN_FOILS.map((f) => ({ id: f.id, name: f.name, imported: false, note: f.note }));
}

export function listFoils(embedded: Airfoil[]): FoilEntry[] {
  // Imported sections come first: they are the ones the user just went to the trouble of
  // bringing in, and at the bottom of a long list they look as though nothing happened.
  const byName = (a: FoilEntry, b: FoilEntry) => a.name.localeCompare(b.name);
  return [
    ...embedded.map((a) => ({ id: a.id, name: a.name, imported: true })).sort(byName),
    ...builtinList().sort(byName),
  ];
}

export function resolveSurfaces(id: string, embedded: Airfoil[]): Surfaces | null {
  const hit = cache.get(id);
  if (hit) return hit;

  const builtin = BUILTIN_FOILS.find((f) => f.id === id);
  if (builtin) {
    const s = toSurfaces(naca4(builtin.code));
    cache.set(id, s);
    return s;
  }

  const custom = embedded.find((a) => a.id === id);
  if (custom?.points && custom.points.length >= 20) {
    const s = toSurfaces(custom.points.map(([x, y]) => ({ x, y })));
    cache.set(id, s);
    return s;
  }
  return null;
}

export function foilMetrics(id: string, embedded: Airfoil[]): AirfoilMetrics | null {
  const s = resolveSurfaces(id, embedded);
  return s ? metrics(s) : null;
}

export function foilName(id: string, embedded: Airfoil[]): string {
  return (
    BUILTIN_FOILS.find((f) => f.id === id)?.name ??
    embedded.find((a) => a.id === id)?.name ??
    "(missing airfoil)"
  );
}

export function invalidateFoil(id: string) {
  cache.delete(id);
}
