import type { AnimationAsset, FolderNode } from "./types";

/**
 * Secci\u00f3n = grupo: cada carpeta de la ra\u00edz de la biblioteca. `Piezas` y `Animaciones` conservan los
 * identificadores de siempre ("piece" y "animation") para no perder lo guardado; el resto usa
 * "group:<nombre>".
 */
export type AssetSection = string;

export interface AssetPlacement {
  section: AssetSection;
  categoryKey: string;
  categoryName: string;
}

export interface PhysicalCategory {
  key: string;
  name: string;
  section: AssetSection;
  count: number;
}

export interface LibraryGroup {
  section: AssetSection;
  /** Nombre de la carpeta tal cual est\u00e1 en el disco. */
  name: string;
  count: number;
}

const comparable = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

const pathParts = (relativePath: string) => relativePath.split(/[\\/]+/).filter(Boolean);

/** Solo el grupo Animaciones se muestra como animaci\u00f3n; todo lo dem\u00e1s se ve como pieza. */
export const isAnimationSection = (section: AssetSection | undefined) => section === "animation";

export function sectionForFolder(folderName: string): AssetSection {
  const name = comparable(folderName.trim());
  if (name === "piezas") return "piece";
  if (name === "animaciones") return "animation";
  return `group:${name}`;
}

const isCategoryFolder = (name: string) => {
  const value = comparable(name);
  return value === "categoria" || value === "categorias";
};

export function classifyAsset(relativePath: string): AssetPlacement {
  const parts = pathParts(relativePath);
  // Un archivo suelto en la ra\u00edz no pertenece a ning\u00fan grupo: se trata como antes, animaci\u00f3n sin categor\u00eda.
  if (parts.length < 2) return { section: "animation", categoryKey: "", categoryName: "" };
  const section = sectionForFolder(parts[0]);
  // Grupo\Categor\u00eda\<categor\u00eda>\...\archivo: la carpeta dentro de Categor\u00eda es la categor\u00eda.
  if (parts.length >= 4 && isCategoryFolder(parts[1])) {
    const categoryName = parts[2].trim();
    return { section, categoryName, categoryKey: `${section}:${comparable(categoryName)}` };
  }
  // Varios, archivos sueltos dentro del grupo o de Categor\u00eda: sin categor\u00eda.
  return { section, categoryKey: "", categoryName: "" };
}

/** Grupos para la lista fija de arriba: Piezas, Animaciones y despu\u00e9s el resto por nombre. */
export function collectLibraryGroups(assets: AnimationAsset[], folders: FolderNode[] = []): LibraryGroup[] {
  const groups = new Map<AssetSection, LibraryGroup>();
  for (const folder of folders) {
    const section = sectionForFolder(folder.name);
    if (!groups.has(section)) groups.set(section, { section, name: folder.name.trim(), count: 0 });
  }
  for (const asset of assets) {
    const parts = pathParts(asset.relativePath);
    const section = classifyAsset(asset.relativePath).section;
    const group = groups.get(section);
    if (group) group.count += 1;
    else groups.set(section, { section, name: parts.length > 1 ? parts[0] : "Animaciones", count: 1 });
  }
  const rank = (section: AssetSection) => (section === "piece" ? 0 : section === "animation" ? 1 : 2);
  return [...groups.values()].sort((left, right) =>
    rank(left.section) - rank(right.section) || left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

/**
 * Categor\u00edas f\u00edsicas de todos los grupos. Una carpeta dentro de Categor\u00eda sin ning\u00fan FBX, GLB ni
 * GLTF que la app pueda leer no aparece hasta que tenga alguno.
 */
export function collectPhysicalCategories(assets: AnimationAsset[], folders: FolderNode[] = []): PhysicalCategory[] {
  const categories = new Map<string, PhysicalCategory>();
  for (const group of folders) {
    const section = sectionForFolder(group.name);
    const categoryFolder = group.children.find((folder) => isCategoryFolder(folder.name));
    for (const folder of categoryFolder?.children ?? []) {
      if (!folder.animationCount) continue;
      const name = folder.name.trim();
      const key = `${section}:${comparable(name)}`;
      if (!categories.has(key)) categories.set(key, { key, name, section, count: 0 });
    }
  }
  for (const asset of assets) {
    const placement = classifyAsset(asset.relativePath);
    if (!placement.categoryKey) continue;
    const current = categories.get(placement.categoryKey);
    if (current) current.count += 1;
    else categories.set(placement.categoryKey, {
      key: placement.categoryKey,
      name: placement.categoryName,
      section: placement.section,
      count: 1,
    });
  }
  return [...categories.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }),
  );
}

export function findCompanionModelAsset(selected: AnimationAsset, assets: AnimationAsset[]): AnimationAsset | null {
  const selectedParts = pathParts(selected.relativePath);
  const normalizedSelected = selectedParts.map(comparable);
  const animationsIndex = normalizedSelected.lastIndexOf("animations");
  if (animationsIndex < 1) return null;

  const packageParts = normalizedSelected.slice(0, animationsIndex);
  const candidates = assets.filter((candidate) => {
    if (candidate.id === selected.id || isAnimationSection(classifyAsset(candidate.relativePath).section)) return false;
    const candidateParts = pathParts(candidate.relativePath).map(comparable);
    if (candidateParts.length <= packageParts.length) return false;
    if (!packageParts.every((part, index) => candidateParts[index] === part)) return false;
    return !candidateParts.slice(packageParts.length, -1).includes("animations");
  });

  const score = (candidate: AnimationAsset) => {
    const parts = pathParts(candidate.relativePath).map(comparable);
    const folders = parts.slice(packageParts.length, -1);
    const fileName = comparable(candidate.fileName);
    const modelFolderScore = folders.includes("mesh") ? 0 : folders.some((part) => part === "model" || part === "models") ? 10 : 30;
    const modelNameScore = /(^|[ _-])sk[ _-]?/.test(fileName) ? 0 : 5;
    return modelFolderScore + modelNameScore + folders.length;
  };

  return [...candidates].sort((left, right) => score(left) - score(right) || left.fileName.localeCompare(right.fileName, undefined, { sensitivity: "base", numeric: true }))[0] ?? null;
}
