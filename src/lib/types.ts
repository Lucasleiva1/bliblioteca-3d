export type AnimationFormat = "fbx" | "glb" | "gltf";

export interface FolderNode {
  name: string;
  path: string;
  relativePath: string;
  children: FolderNode[];
  animationCount: number;
}

export interface AnimationAsset {
  id: string;
  name: string;
  fileName: string;
  path: string;
  relativePath: string;
  directory: string;
  format: AnimationFormat;
  size: number;
  modified: number;
  /** Fecha de la miniatura vigente en `_cache`; 0 si falta o quedó vieja. */
  thumbnailModified: number;
  /** La miniatura ya falló para esta versión del archivo. */
  thumbnailFailed: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: "folder" | "animation" | "file";
  extension: string;
  size: number;
  modified: number;
}

export interface LibrarySnapshot {
  rootPath: string;
  folders: FolderNode[];
  animations: AnimationAsset[];
  scannedAt: number;
}

export interface FolderContents {
  path: string;
  relativePath: string;
  entries: FolderEntry[];
}

export interface AssetPackage {
  bytes: ArrayBuffer;
  directory: string;
  /** Imágenes cercanas a un FBX, para encontrar texturas guardadas con rutas de otra computadora. */
  textures: string[];
  resources: Array<{
    uri: string;
    bytes: ArrayBuffer;
    mimeType: string;
  }>;
}

export interface Category {
  id: string;
  name: string;
  section: CategorySection;
  sortOrder: number;
}

export interface AnimationMetadata {
  assetId: string;
  gameName: string;
  categoryId: string;
  subcategory: string;
  tags: string;
  description: string;
}

export interface CatalogData {
  categories: Category[];
  metadata: AnimationMetadata[];
}

/** Grupo al que pertenece una categoría: "piece", "animation" o "group:<nombre de carpeta>". */
export type CategorySection = string;

export interface ImportedFolder {
  name: string;
  categoryName: string;
  /** Carpeta del grupo donde entró (Piezas, Animaciones, contruccion...). */
  groupName: string;
  /** Solo lo que entra al grupo Animaciones cuenta como animación. */
  animation: boolean;
  merged: boolean;
  assets: AnimationAsset[];
}

export interface PendingImport {
  /** Grupo cuya carpeta Cargar Nuevo tiene este elemento esperando. */
  groupName: string;
  name: string;
  reason: string;
  waiting: boolean;
}

export interface ImportReport {
  rootPath: string;
  imported: ImportedFolder[];
  pending: PendingImport[];
}

export interface CategoryGroup {
  id: string;
  section: CategorySection;
  name: string;
  sortOrder: number;
  collapsed: boolean;
}

export interface PhysicalCategoryLayout {
  categoryKey: string;
  section: CategorySection;
  groupId: string;
  sortOrder: number;
}

export interface CategoryOrganization {
  groups: CategoryGroup[];
  categories: PhysicalCategoryLayout[];
}

export interface FileMutation {
  oldId: string;
  newId: string;
  newPath: string;
}

export interface Diagnostics {
  version: string;
  databasePath: string;
  libraryRoot: string;
  libraryAvailable: boolean;
  animations: number;
  categories: number;
  metadata: number;
}
