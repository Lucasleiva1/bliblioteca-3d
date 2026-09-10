import { invoke } from "@tauri-apps/api/core";
import type { AnimationMetadata, AssetBytes, CatalogData, FolderContents, LibrarySnapshot } from "./types";

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
export const scanLibrary = (rootPath: string) => invoke<LibrarySnapshot>("scan_library", { rootPath });
export const listFolder = (path: string) => invoke<FolderContents>("list_folder", { path });
export const readAssetBytes = (path: string) => invoke<AssetBytes>("read_asset_bytes", { path });
export const openFolder = (path: string) => invoke<void>("open_folder", { path });
export const revealFile = (path: string) => invoke<void>("reveal_file", { path });
