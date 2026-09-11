import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { unpackAssetPackage } from "./assetPackage";
import type { AnimationMetadata, CatalogData, CategoryOrganization, Diagnostics, FileMutation, FolderContents, ImportReport, LibrarySnapshot } from "./types";

const EMPTY_LIBRARY: LibrarySnapshot = { rootPath: "", folders: [], animations: [], scannedAt: 0 };
const EMPTY_CATALOG: CatalogData = { categories: [], metadata: [] };
const EMPTY_CATEGORY_ORGANIZATION: CategoryOrganization = { groups: [], categories: [] };

export const isDesktopRuntime = () =>
  typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__);

export const getInitialState = () =>
  isDesktopRuntime() ? invoke<LibrarySnapshot>("get_initial_state") : Promise.resolve(EMPTY_LIBRARY);
export const getCatalogData = () =>
  isDesktopRuntime() ? invoke<CatalogData>("get_catalog_data") : Promise.resolve(EMPTY_CATALOG);
export const getCategoryOrganization = (rootPath: string) =>
  isDesktopRuntime() ? invoke<CategoryOrganization>("get_category_organization", { rootPath }) : Promise.resolve(EMPTY_CATEGORY_ORGANIZATION);
export const saveCategoryOrganization = (rootPath: string, organization: CategoryOrganization) =>
  isDesktopRuntime() ? invoke<CategoryOrganization>("save_category_organization", { rootPath, organization }) : Promise.resolve(organization);
export const saveAnimationMetadata = (metadata: AnimationMetadata) =>
  isDesktopRuntime() ? invoke<AnimationMetadata>("save_animation_metadata", { metadata }) : Promise.resolve(metadata);
export const saveCategory = (categoryId: string, name: string, section: string) =>
  isDesktopRuntime() ? invoke<CatalogData>("save_category", { categoryId, name, section }) : Promise.resolve(EMPTY_CATALOG);
export const deleteCategory = (categoryId: string) =>
  isDesktopRuntime() ? invoke<CatalogData>("delete_category", { categoryId }) : Promise.resolve(EMPTY_CATALOG);
export const reorderCategories = (categoryIds: string[]) =>
  isDesktopRuntime() ? invoke<CatalogData>("reorder_categories", { categoryIds }) : Promise.resolve(EMPTY_CATALOG);
export const exportCatalog = () => invoke<string>("export_catalog");
export const createDatabaseBackup = () => invoke<string>("create_database_backup");
export const getDiagnostics = () => invoke<Diagnostics>("get_diagnostics");
export const restoreDatabaseBackup = (backupPath: string) => invoke<CatalogData>("restore_database_backup", { backupPath });
export const scanLibrary = (rootPath: string) => invoke<LibrarySnapshot>("scan_library", { rootPath });
export const prepareLibraryStructure = (rootPath: string) => invoke<void>("prepare_library_structure", { rootPath });
export const openImportFolder = (group: string) => invoke<void>("open_import_folder", { group });
export const listenLibraryImports = (handler: (report: ImportReport) => void): Promise<UnlistenFn> =>
  isDesktopRuntime() ? listen<ImportReport>("library-import", (event) => handler(event.payload)) : Promise.resolve(() => undefined);
export const listFolder = (path: string) => invoke<FolderContents>("list_folder", { path });
export const createFolder = (parentPath: string, name: string) => invoke<FolderContents>("create_folder", { parentPath, name });
export const renameAsset = (path: string, newName: string) => invoke<FileMutation>("rename_asset", { path, newName });
export const copyAsset = (path: string, destination: string) => invoke<FileMutation>("copy_asset", { path, destination });
export const moveAsset = (path: string, destination: string) => invoke<FileMutation>("move_asset", { path, destination });
export const readAssetPackage = async (path: string) => unpackAssetPackage(await invoke<ArrayBuffer>("read_asset_package", { path }));
export const saveThumbnail = (path: string, bytes: Uint8Array) => invoke<number>("save_thumbnail", { path, bytes: Array.from(bytes) });
export const markThumbnailFailed = (path: string, reason: string) => invoke<void>("mark_thumbnail_failed", { path, reason });
export const readThumbnail = (path: string) => invoke<ArrayBuffer>("read_thumbnail", { path });
export const openFolder = (path: string) => invoke<void>("open_folder", { path });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
