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

export interface AssetBytes {
  bytes: number[];
  directory: string;
  resources: Array<{
    uri: string;
    bytes: number[];
    mimeType: string;
  }>;
}

export interface Category {
  id: string;
  name: string;
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
