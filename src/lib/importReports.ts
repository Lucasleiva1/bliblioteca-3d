import { classifyAsset } from "./librarySections";
import type { AnimationAsset, ImportedFolder } from "./types";

export interface ImportNotice {
  id: string;
  text: string;
  categoryKey: string;
}

/** Suma a la lista solo lo que llegó por Cargar Nuevo, sin volver a escanear la biblioteca. */
export function mergeImportedAssets(animations: AnimationAsset[], incoming: AnimationAsset[]): AnimationAsset[] {
  if (!incoming.length) return animations;
  const incomingById = new Map(incoming.map((asset) => [asset.id, asset]));
  const kept = animations.map((asset) => incomingById.get(asset.id) ?? asset);
  const known = new Set(animations.map((asset) => asset.id));
  return [...kept, ...incoming.filter((asset) => !known.has(asset.id))];
}

const comparableRoot = (value: string) =>
  value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();

export function sameLibraryRoot(left: string, right: string) {
  return comparableRoot(left) === comparableRoot(right);
}

export function describeImportedFolder(folder: ImportedFolder): string {
  const count = folder.assets.length;
  const noun = folder.animation ? (count === 1 ? "animación nueva" : "animaciones nuevas") : (count === 1 ? "pieza nueva" : "piezas nuevas");
  const where = `${folder.groupName} › Categoría › ${folder.categoryName}`;
  return folder.merged
    ? `“${folder.name}” se sumó a la categoría que ya existía (${where}): ${count} ${noun}.`
    : `“${folder.name}” se cargó como categoría nueva (${where}): ${count} ${noun}.`;
}

export function importCategoryKey(folder: ImportedFolder): string {
  const first = folder.assets[0];
  return first ? classifyAsset(first.relativePath).categoryKey : "";
}
