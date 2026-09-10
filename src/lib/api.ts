import { invoke } from "@tauri-apps/api/core";
import type { AnimationMetadata, AssetBytes, CatalogData, Diagnostics, FileMutation, FolderContents, LibrarySnapshot } from "./types";

const EMPTY_LIBRARY: LibrarySnapshot = { rootPath: "", folders: [], animations: [], scannedAt: 0 };
const EMPTY_CATALOG: CatalogData = { categories: [], metadata: [] };

export const isDesktopRuntime = () =>
  typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__);

export const getInitialState = () =>
  isDesktopRuntime() ? invoke<LibrarySnapshot>("get_initial_state") : Promise.resolve(EMPTY_LIBRARY);
export const getCatalogData = () =>
  isDesktopRuntime() ? invoke<CatalogData>("get_catalog_data") : Promise.resolve(EMPTY_CATALOG);
export const saveAnimationMetadata = (metadata: AnimationMetadata) =>
  isDesktopRuntime() ? invoke<AnimationMetadata>("save_animation_metadata", { metadata }) : Promise.resolve(metadata);
export const saveCategory = (categoryId: string, name: string) =>
  isDesktopRuntime() ? invoke<CatalogData>("save_category", { categoryId, name }) : Promise.resolve(EMPTY_CATALOG);
export const deleteCategory = (categoryId: string) =>
  isDesktopRuntime() ? invoke<CatalogData>("delete_category", { categoryId }) : Promise.resolve(EMPTY_CATALOG);
export const reorderCategories = (categoryIds: string[]) =>
  isDesktopRuntime() ? invoke<CatalogData>("reorder_categories", { categoryIds }) : Promise.resolve(EMPTY_CATALOG);
export const exportCatalog = () => invoke<string>("export_catalog");
export const createDatabaseBackup = () => invoke<string>("create_database_backup");
export const getDiagnostics = () => invoke<Diagnostics>("get_diagnostics");
export const restoreDatabaseBackup = (backupPath: string) => invoke<CatalogData>("restore_database_backup", { backupPath });
export const scanLibrary = (rootPath: string) => invoke<LibrarySnapshot>("scan_library", { rootPath });
export const listFolder = (path: string) => invoke<FolderContents>("list_folder", { path });
export const createFolder = (parentPath: string, name: string) => invoke<FolderContents>("create_folder", { parentPath, name });
export const renameAsset = (path: string, newName: string) => invoke<FileMutation>("rename_asset", { path, newName });
export const copyAsset = (path: string, destination: string) => invoke<FileMutation>("copy_asset", { path, destination });
export const moveAsset = (path: string, destination: string) => invoke<FileMutation>("move_asset", { path, destination });
export const readAssetBytes = (path: string) => invoke<AssetBytes>("read_asset_bytes", { path });
export const openFolder = (path: string) => invoke<void>("open_folder", { path });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
