/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { rebuild } from "../geometry";
import type { ProjectDoc } from "../domain/schema";

const api = {
  rebuild(doc: ProjectDoc) {
    return rebuild(doc);
  },
};

export type GeometryApi = typeof api;
Comlink.expose(api);
