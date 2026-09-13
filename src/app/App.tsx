import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Box,
  Boxes,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  ListFilter,
  Grid2X2,
  GripVertical,
  Heart,
  Camera,
  ImagePlus,
  Layers3,
  List,
  Moon,
  MoreVertical,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Viewer3D from "../engine/Viewer3D";
import { renderThumbnail } from "../engine/thumbnailRenderer";
import { createDatabaseBackup, deleteCategory, exportCatalog, getCatalogData, getCategoryOrganization, getDiagnostics, getInitialState, isDesktopRuntime, listenLibraryImports, listFolder, markThumbnailFailed, openFolder, openImportFolder, prepareLibraryStructure, restoreDatabaseBackup, revealFile, saveAnimationMetadata, saveCategory, saveCategoryOrganization, saveThumbnail, scanLibrary } from "../lib/api";
import { useThumbnailUrl } from "../lib/thumbnailImages";
import { ThumbnailQueue, type ThumbnailProgress, type ThumbnailResult } from "../lib/thumbnailQueue";
import { moveCategory, moveGroup, orderedCategoryKeys, reconcileCategoryOrganization, removeGroup } from "../lib/categoryOrganization";
import { formatBytes } from "../lib/format";
import { describeImportedFolder, importCategoryKey, mergeImportedAssets, sameLibraryRoot, type ImportNotice } from "../lib/importReports";
import { classifyAsset, collectLibraryGroups, collectPhysicalCategories, findCompanionModelAsset, isAnimationSection } from "../lib/librarySections";
import type { AnimationAsset, AnimationMetadata, CatalogData, CategoryOrganization, CategorySection, FolderContents, FolderNode, ImportReport, LibrarySnapshot, PendingImport } from "../lib/types";
import { thumbnailForAnimation } from "../lib/thumbnails";

const EMPTY_LIBRARY: LibrarySnapshot = { rootPath: "", folders: [], animations: [], scannedAt: 0 };
const EMPTY_CATALOG: CatalogData = { categories: [], metadata: [] };
const EMPTY_CATEGORY_ORGANIZATION: CategoryOrganization = { groups: [], categories: [] };
const CATALOG_PAGE_SIZE = 24;
const LEFT_MIN = 150;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 224;
const emptyMetadata = (assetId = ""): AnimationMetadata => ({ assetId, gameName: "", categoryId: "", subcategory: "", tags: "", description: "" });
type CategoryDragItem = { type: "category"; id: string; section: CategorySection } | { type: "group"; id: string; section: CategorySection };
type CategoryDropTarget = { type: "category" | "group" | "ungrouped"; id: string; position: "before" | "after" };
const EMPTY_THUMBNAIL_PROGRESS: ThumbnailProgress = { done: 0, total: 0, failed: 0, running: false, paused: false };

function AssetThumbnail({ asset, modified, animation }: { asset: AnimationAsset; modified: number; animation: boolean }) {
  const url = useThumbnailUrl(asset.path, modified);
  if (url) return <img className="generated-photo" src={url} alt={`Captura de ${asset.name}`} draggable={false} />;
  return animation ? <img src={thumbnailForAnimation(asset.fileName)} alt={`Boceto temporal de ${asset.name}`} loading="lazy" draggable={false} /> : <Box size={27} aria-hidden="true" />;
}
function BrandSettings({ onClose, onCatalogChange, onError }: { onClose: () => void; onCatalogChange: (value: CatalogData) => void; onError: (message: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem("biblioteca-3d-brand-name") || "Biblioteca 3D");
  const [logo, setLogo] = useState(() => localStorage.getItem("biblioteca-3d-brand-logo") || "");
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const [characterBones, setCharacterBonesState] = useState(() => localStorage.getItem("biblioteca-3d-character-bones") === "true");
  const [characterBody, setCharacterBodyState] = useState<"male" | "female">(() => localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
  const [autoplay, setAutoplayState] = useState(() => localStorage.getItem("biblioteca-3d-autoplay") !== "false");
  const [maintenanceNotice, setMaintenanceNotice] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [automaticUpdateCheck, setAutomaticUpdateCheckState] = useState(() => localStorage.getItem("biblioteca-3d-automatic-update-check") !== "false");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "current" | "available" | "downloading" | "error">("idle");
  const [updateNotice, setUpdateNotice] = useState("");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const automaticCheckStarted = useRef(false);

  const setAutomaticUpdateCheck = (value: boolean) => {
    setAutomaticUpdateCheckState(value);
    localStorage.setItem("biblioteca-3d-automatic-update-check", String(value));
  };
  const checkForUpdates = useCallback(async (silent = false) => {
    if (!isDesktopRuntime()) return;
    setUpdateStatus("checking");
    setUpdateProgress(0);
    if (!silent) setUpdateNotice("Buscando una versión nueva...");
    try {
      const update = await check({ timeout: 30_000 });
      setPendingUpdate(update);
      if (update) {
        setUpdateStatus("available");
        setUpdateNotice(`Versión ${update.version} disponible${update.body ? `: ${update.body}` : "."}`);
      } else {
        setUpdateStatus("current");
        setUpdateNotice("Biblioteca 3D está actualizada.");
      }
    } catch (value) {
      setPendingUpdate(null);
      setUpdateStatus("error");
      setUpdateNotice(`No se pudo comprobar la actualización: ${String(value)}`);
    }
  }, []);
  const installUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdateStatus("downloading");
    setUpdateProgress(0);
    setUpdateNotice(`Descargando Biblioteca 3D ${pendingUpdate.version}...`);
    let downloaded = 0;
    let total = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setUpdateProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        }
        if (event.event === "Finished") {
          setUpdateProgress(100);
          setUpdateNotice("Descarga completa. Cerrando para instalar la actualización...");
        }
      });
    } catch (value) {
      setUpdateStatus("error");
      setUpdateNotice(`No se pudo instalar la actualización: ${String(value)}`);
    }
  };
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void getVersion().then(setAppVersion).catch(() => setAppVersion(""));
    if (automaticUpdateCheck && !automaticCheckStarted.current) {
      automaticCheckStarted.current = true;
      void checkForUpdates(true);
    }
  }, [automaticUpdateCheck, checkForUpdates]);
  const saveName = (value: string) => {
    setName(value);
    localStorage.setItem("biblioteca-3d-brand-name", value);
    window.dispatchEvent(new Event("biblioteca-3d-brand-change"));
  };
  const setTheme = (value: "light" | "dark") => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("biblioteca-3d-theme", value);
    window.dispatchEvent(new Event("biblioteca-3d-theme-change"));
  };
  const setCharacterBones = (value: boolean) => {
    setCharacterBonesState(value);
    localStorage.setItem("biblioteca-3d-character-bones", String(value));
    window.dispatchEvent(new Event("biblioteca-3d-character-change"));
  };
  const setCharacterBody = (value: "male" | "female") => {
    setCharacterBodyState(value);
    localStorage.setItem("biblioteca-3d-character-body", value);
    window.dispatchEvent(new Event("biblioteca-3d-character-change"));
  };
  const setAutoplay = (value: boolean) => {
    setAutoplayState(value);
    localStorage.setItem("biblioteca-3d-autoplay", String(value));
    window.dispatchEvent(new Event("biblioteca-3d-character-change"));
  };
  const restoreBackup = async () => {
    const selected = await open({
      multiple: false,
      title: "Restaurar respaldo de Biblioteca 3D",
      filters: [{ name: "Respaldo SQLite", extensions: ["sqlite", "db"] }],
    });
    if (typeof selected !== "string") return;
    if (!window.confirm("Restaurar este respaldo reemplazara las categorias, metadatos y preferencias guardadas. Antes se creara una copia automatica del estado actual. Continuar?")) return;
    setMaintenanceNotice("Comprobando y restaurando respaldo...");
    try {
      const restored = await restoreDatabaseBackup(selected);
      onCatalogChange(restored);
      setMaintenanceNotice("Respaldo restaurado. Recargando Biblioteca 3D...");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (value) {
      setMaintenanceNotice("");
      onError(String(value));
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Ajustes" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Settings size={20} /><strong>Ajustes</strong></div><button onClick={onClose} title="Cerrar"><X size={18} /></button></header>
        <div className="settings-section">
          <div className="section-title"><Palette size={18} /><div><strong>Marca</strong><span>Podés cambiar el nombre y el logo sin modificar el producto técnico.</span></div></div>
          <label className="field-label">Nombre visible<input value={name} maxLength={40} onChange={(event) => saveName(event.target.value)} placeholder="Biblioteca 3D" /></label>
          <label className="logo-picker">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file || file.size > 5 * 1024 * 1024) return;
              const reader = new FileReader();
              reader.onload = () => {
                const value = String(reader.result || "");
                setLogo(value);
                localStorage.setItem("biblioteca-3d-brand-logo", value);
                window.dispatchEvent(new Event("biblioteca-3d-brand-change"));
              };
              reader.readAsDataURL(file);
            }} />
            {logo ? <img src={logo} alt="Logo actual" /> : <ImagePlus size={26} />}
            <span>{logo ? "Cambiar logo" : "Elegir logo"}</span>
          </label>
          {logo && <button className="danger-subtle" onClick={() => { setLogo(""); localStorage.removeItem("biblioteca-3d-brand-logo"); window.dispatchEvent(new Event("biblioteca-3d-brand-change")); }}>Quitar logo</button>}
        </div>
        <div className="settings-section">
          <div className="section-title"><Sparkles size={18} /><div><strong>Apariencia</strong><span>La preferencia se guarda automáticamente.</span></div></div>
          <div className="theme-buttons">
            <button className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon size={17} /> Oscuro</button>
            <button className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun size={17} /> Claro</button>
          </div>
        </div>
        <div className="settings-section">
          <div className="section-title"><Play size={18} /><div><strong>Reproduccion automatica</strong><span>Inicia la animacion al seleccionarla.</span></div></div>
          <div className="theme-buttons">
            <button className={autoplay ? "active" : ""} aria-pressed={autoplay} onClick={() => setAutoplay(true)}><Play size={17} /> Activada</button>
            <button className={!autoplay ? "active" : ""} aria-pressed={!autoplay} onClick={() => setAutoplay(false)}><Box size={17} /> Pausada</button>
          </div>
        </div>
        <div className="settings-section">
          <div className="section-title"><Box size={18} /><div><strong>Cuerpo humanoide</strong><span>Elegí la anatomía usada cuando la animación trae solamente huesos.</span></div></div>
          <div className="theme-buttons">
            <button className={characterBody === "male" ? "active" : ""} aria-pressed={characterBody === "male"} onClick={() => setCharacterBody("male")}><Box size={17} /> Masculino</button>
            <button className={characterBody === "female" ? "active" : ""} aria-pressed={characterBody === "female"} onClick={() => setCharacterBody("female")}><Box size={17} /> Femenino</button>
          </div>
        </div>
        <div className="settings-section">
          <div className="section-title"><ScanLine size={18} /><div><strong>Palitos del rig</strong><span>Podés ver el esqueleto dentro del mismo cuerpo transparente.</span></div></div>
          <div className="theme-buttons">
            <button className={characterBones ? "active" : ""} aria-pressed={characterBones} onClick={() => setCharacterBones(true)}><ScanLine size={17} /> Con palitos</button>
            <button className={!characterBones ? "active" : ""} aria-pressed={!characterBones} onClick={() => setCharacterBones(false)}><Box size={17} /> Sin palitos</button>
          </div>
        </div>
        <div className="settings-section">
          <div className="section-title"><Download size={18} /><div><strong>Actualizaciones</strong><span>Busca versiones firmadas publicadas oficialmente en GitHub.</span></div></div>
          <div className="update-card">
            <div><strong>Biblioteca 3D {appVersion ? `v${appVersion}` : ""}</strong><span>{updateNotice || "Podés comprobar ahora si existe una versión nueva."}</span></div>
            {updateStatus === "downloading" && <div className="update-progress" aria-label={`Descarga ${updateProgress}%`}><span style={{ width: `${updateProgress}%` }} /></div>}
            <div className="update-actions">
              <button onClick={() => void checkForUpdates()} disabled={updateStatus === "checking" || updateStatus === "downloading"}><RefreshCw className={updateStatus === "checking" ? "spin" : ""} size={16} /> {updateStatus === "checking" ? "Buscando…" : "Buscar actualizaciones"}</button>
              {pendingUpdate && <button className="update-install" onClick={() => void installUpdate()} disabled={updateStatus === "downloading"}><Download size={16} /> {updateStatus === "downloading" ? `Descargando ${updateProgress}%` : `Instalar v${pendingUpdate.version}`}</button>}
            </div>
            <label className="update-toggle"><input type="checkbox" checked={automaticUpdateCheck} onChange={(event) => setAutomaticUpdateCheck(event.target.checked)} /> Buscar automáticamente al abrir Ajustes</label>
          </div>
        </div>
        <div className="settings-section">
          <div className="section-title"><Database size={18} /><div><strong>Datos y respaldo</strong><span>Exporta metadatos para Godot o crea una copia local de la base.</span></div></div>
          <div className="maintenance-buttons">
            <button onClick={() => { setMaintenanceNotice(""); void exportCatalog().then((path) => setMaintenanceNotice("Catalogo exportado: " + path)).catch((value) => onError(String(value))); }}><Download size={16} /> Exportar JSON v0.1.5</button>
            <button onClick={() => { setMaintenanceNotice(""); void createDatabaseBackup().then((path) => setMaintenanceNotice("Respaldo creado: " + path)).catch((value) => onError(String(value))); }}><Database size={16} /> Crear respaldo</button>
            <button onClick={() => void restoreBackup()}><Upload size={16} /> Restaurar respaldo</button>
            <button onClick={() => { setMaintenanceNotice("Preparando diagnostico..."); void getDiagnostics().then((data) => setMaintenanceNotice("Version " + data.version + " | Biblioteca: " + (data.libraryAvailable ? data.libraryRoot : "no disponible") + " | " + data.animations + " elementos 3D | " + data.categories + " categorias | " + data.metadata + " metadatos | Base: " + data.databasePath)).catch((value) => { setMaintenanceNotice(""); onError(String(value)); }); }}><ScanLine size={16} /> Ver diagnostico</button>
          </div>
          {maintenanceNotice && <p className="maintenance-notice">{maintenanceNotice}</p>}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY_LIBRARY);
  const [folderContents, setFolderContents] = useState<FolderContents | null>(null);
  const [selected, setSelected] = useState<AnimationAsset | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"compact" | "grid" | "list">("compact");
  const [folderPanelOpen, setFolderPanelOpen] = useState(false);
  const [catalogOptionsOpen, setCatalogOptionsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [formatFilter, setFormatFilter] = useState<"all" | "fbx" | "glb" | "gltf" | "bvh">("all");
  const [sortOrder, setSortOrder] = useState<"name" | "modified" | "size">("name");
  const [catalogMode, setCatalogMode] = useState<string>("all");
  const [catalogPage, setCatalogPage] = useState(0);
  const [catalogData, setCatalogData] = useState<CatalogData>(EMPTY_CATALOG);
  const [categoryOrganization, setCategoryOrganization] = useState<CategoryOrganization>(EMPTY_CATEGORY_ORGANIZATION);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryAddOpen, setCategoryAddOpen] = useState(false);
  const [categoryCreateSection, setCategoryCreateSection] = useState<CategorySection | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [groupCreateSection, setGroupCreateSection] = useState<CategorySection | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupMenuId, setGroupMenuId] = useState("");
  const [categoryMenuId, setCategoryMenuId] = useState("");
  const [categoryDragItem, setCategoryDragItem] = useState<CategoryDragItem | null>(null);
  const [categoryDropTarget, setCategoryDropTarget] = useState<CategoryDropTarget | null>(null);
  const [assetDragId, setAssetDragId] = useState("");
  const [assetDropCategory, setAssetDropCategory] = useState("");
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState<AnimationMetadata>(() => emptyMetadata());
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataSaved, setMetadataSaved] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("biblioteca-3d-favorites") || "[]") as string[]); }
    catch { return new Set(); }
  });
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importNotices, setImportNotices] = useState<ImportNotice[]>([]);
  const [pendingImports, setPendingImports] = useState<PendingImport[]>([]);
  const libraryRootRef = useRef("");
  const [thumbnailProgress, setThumbnailProgress] = useState<ThumbnailProgress>(EMPTY_THUMBNAIL_PROGRESS);
  const [thumbnailResults, setThumbnailResults] = useState<Map<string, ThumbnailResult>>(() => new Map());
  const libraryAssetsRef = useRef<AnimationAsset[]>([]);
  const thumbnailQueueRef = useRef<ThumbnailQueue | null>(null);
  if (!thumbnailQueueRef.current) {
    thumbnailQueueRef.current = new ThumbnailQueue({
      render: (asset) => renderThumbnail(asset, findCompanionModelAsset(asset, libraryAssetsRef.current)),
      save: (asset, bytes) => saveThumbnail(asset.path, bytes),
      markFailed: (asset, reason) => markThumbnailFailed(asset.path, reason),
      onResult: (assetId, result) => setThumbnailResults((current) => new Map(current).set(assetId, result)),
      onProgress: setThumbnailProgress,
    });
  }
  const thumbnailQueue = thumbnailQueueRef.current;
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = Number(localStorage.getItem("biblioteca-3d-left-width"));
    return Number.isFinite(saved) && saved >= LEFT_MIN && saved <= LEFT_MAX ? Math.round(saved) : LEFT_DEFAULT;
  });
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem("biblioteca-3d-left-collapsed") === "true");
  const [brandRevision, setBrandRevision] = useState(0);
  const [characterBones, setCharacterBones] = useState(() => localStorage.getItem("biblioteca-3d-character-bones") === "true");
  const [characterBody, setCharacterBody] = useState<"male" | "female">(() => localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem("biblioteca-3d-autoplay") !== "false");
  const brandName = localStorage.getItem("biblioteca-3d-brand-name") || "Biblioteca 3D";
  const brandLogo = localStorage.getItem("biblioteca-3d-brand-logo") || "";

  useEffect(() => {
    if (!folderPanelOpen && !catalogOptionsOpen && !categoryAddOpen && !categoryCreateSection && !groupMenuId && !categoryMenuId) return;
    const closeMenus = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setFolderPanelOpen(false);
        setCatalogOptionsOpen(false);
        setCategoryAddOpen(false);
        setCategoryCreateSection(null);
        setCategoryDraft("");
        setGroupCreateSection(null);
        setGroupMenuId("");
        setCategoryMenuId("");
        setMetadataOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".library-current-wrap")) setFolderPanelOpen(false);
      if (!target?.closest(".catalog-filter-menu")) setCatalogOptionsOpen(false);
      if (!target?.closest(".category-add-menu")) {
        setCategoryAddOpen(false);
        setCategoryCreateSection(null);
        setCategoryDraft("");
        setGroupCreateSection(null);
      }
      if (!target?.closest(".category-group-menu")) setGroupMenuId("");
      if (!target?.closest(".manual-category-menu")) setCategoryMenuId("");
    };
    window.addEventListener("pointerdown", closeMenus);
    window.addEventListener("keydown", closeMenus);
    return () => {
      window.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("keydown", closeMenus);
    };
  }, [catalogOptionsOpen, categoryAddOpen, categoryCreateSection, categoryMenuId, folderPanelOpen, groupMenuId]);


  const loadFolder = useCallback(async (path: string) => {
    try {
      const contents = await listFolder(path);
      setFolderContents(contents);
      return true;
    } catch (folderError) {
      setError(String(folderError));
      return false;
    }
  }, []);

  const navigateFolder = useCallback(async (path: string) => {
    if (!await loadFolder(path)) return;
    setCatalogMode("folder");
    setFolderHistory((current) => {
      const next = [...current.slice(0, historyIndex + 1), path];
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [historyIndex, loadFolder]);

  useEffect(() => {
    const refreshBrand = () => setBrandRevision((value) => value + 1);
    const refreshCharacter = () => {
      setCharacterBones(localStorage.getItem("biblioteca-3d-character-bones") === "true");
      setCharacterBody(localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
      setAutoplay(localStorage.getItem("biblioteca-3d-autoplay") !== "false");
    };
    window.addEventListener("biblioteca-3d-brand-change", refreshBrand);
    window.addEventListener("biblioteca-3d-theme-change", refreshBrand);
    window.addEventListener("biblioteca-3d-character-change", refreshCharacter);
    // Lo que llega por Cargar Nuevo antes de terminar la carga inicial se guarda y se aplica
    // encima de esa carga, para no perderlo.
    let initialLoaded = false;
    const earlyReports: ImportReport[] = [];
    const applyImportReport = (report: ImportReport) => {
      if (!initialLoaded) return void earlyReports.push(report);
      if (!sameLibraryRoot(report.rootPath, libraryRootRef.current)) return;
      setPendingImports(report.pending);
      if (!report.imported.length) return;
      const incoming = report.imported.flatMap((folder) => folder.assets);
      setLibrary((current) => ({ ...current, animations: mergeImportedAssets(current.animations, incoming) }));
      libraryAssetsRef.current = mergeImportedAssets(libraryAssetsRef.current, incoming);
      thumbnailQueueRef.current?.add(incoming, true);
      setImportNotices((current) => [
        ...current,
        ...report.imported.map((folder, index) => ({ id: `${Date.now()}-${index}-${folder.name}`, text: describeImportedFolder(folder), categoryKey: importCategoryKey(folder) })),
      ]);
    };
    const importListener = listenLibraryImports(applyImportReport);
    void importListener.catch(() => undefined).then(() => getInitialState()).then((snapshot) => {
      libraryRootRef.current = snapshot.rootPath;
      setLibrary(snapshot);
      if (snapshot.rootPath) {
        const savedFolder = localStorage.getItem("biblioteca-3d-last-folder") || snapshot.rootPath;
        void loadFolder(savedFolder).then((loaded) => {
          const activeFolder = loaded ? savedFolder : snapshot.rootPath;
          if (!loaded) void loadFolder(snapshot.rootPath);
          setFolderHistory([activeFolder]);
          setHistoryIndex(0);
        });
        const savedSelection = localStorage.getItem("biblioteca-3d-last-selection");
        setSelected(snapshot.animations.find((asset) => asset.id === savedSelection) ?? snapshot.animations[0] ?? null);
      }
    }).catch((initialError) => setError(String(initialError))).finally(() => {
      setLoading(false);
      initialLoaded = true;
      earlyReports.splice(0).forEach(applyImportReport);
    });
    void getCatalogData().then(setCatalogData).catch((catalogError) => setError(String(catalogError)));
    return () => {
      void importListener.then((unlisten) => unlisten()).catch(() => undefined);
      window.removeEventListener("biblioteca-3d-brand-change", refreshBrand);
      window.removeEventListener("biblioteca-3d-theme-change", refreshBrand);
      window.removeEventListener("biblioteca-3d-character-change", refreshCharacter);
    };
  }, [loadFolder]);

  useEffect(() => {
    if (selected) localStorage.setItem("biblioteca-3d-last-selection", selected.id);
  }, [selected]);

  useEffect(() => {
    libraryRootRef.current = library.rootPath;
  }, [library.rootPath]);

  useEffect(() => {
    libraryAssetsRef.current = library.animations;
  }, [library.animations]);

  // Al abrir o reescanear la biblioteca, la fila pasa a ser todo lo que todavía no tiene captura.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    setThumbnailResults(new Map());
    thumbnailQueue.reset(library.animations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.rootPath, library.scannedAt, thumbnailQueue]);

  const showImportFolder = async (group: string) => {
    setError(null);
    try {
      await openImportFolder(group);
    } catch (importError) {
      setError(String(importError));
    }
  };

  useEffect(() => {
    if (!library.rootPath) {
      setCategoryOrganization(EMPTY_CATEGORY_ORGANIZATION);
      return;
    }
    void getCategoryOrganization(library.rootPath)
      .then(setCategoryOrganization)
      .catch((organizationError) => setError(String(organizationError)));
  }, [library.rootPath]);

  useEffect(() => {
    if (folderContents?.path) localStorage.setItem("biblioteca-3d-last-folder", folderContents.path);
  }, [folderContents?.path]);

  const metadataById = useMemo(() => new Map(catalogData.metadata.map((item) => [item.assetId, item])), [catalogData.metadata]);
  const placementById = useMemo(() => new Map(library.animations.map((asset) => [asset.id, classifyAsset(asset.relativePath)])), [library.animations]);
  const physicalCategories = useMemo(() => collectPhysicalCategories(library.animations, library.folders), [library.animations, library.folders]);
  const manualCategories = useMemo(() => catalogData.categories.map((category) => ({
    key: `manual:${category.id}`,
    name: category.name,
    section: category.section,
    count: library.animations.filter((asset) => metadataById.get(asset.id)?.categoryId === category.id).length,
  })), [catalogData.categories, library.animations, metadataById]);
  const navigationCategories = useMemo(() => [...physicalCategories, ...manualCategories], [manualCategories, physicalCategories]);
  const libraryGroups = useMemo(() => collectLibraryGroups(library.animations, library.folders), [library.animations, library.folders]);
  const groupName = useCallback(
    (section: CategorySection) => libraryGroups.find((group) => group.section === section)?.name ?? (section === "piece" ? "Piezas" : section === "animation" ? "Animaciones" : section.replace(/^group:/, "")),
    [libraryGroups],
  );
  const unclassifiedCount = useMemo(() => library.animations.filter((asset) => !placementById.get(asset.id)?.categoryKey && !metadataById.get(asset.id)?.categoryId).length, [library.animations, metadataById, placementById]);
  const activeNavigationCategory = catalogMode.startsWith("physical:") ? navigationCategories.find((category) => category.key === catalogMode.slice(9)) : undefined;
  const activeCategorySection: CategorySection | null = catalogMode.startsWith("section:") ? catalogMode.slice(8) : activeNavigationCategory?.section ?? null;
  // "Cargar nuevo" abre la bandeja del grupo que estás mirando; sin grupo elegido, la de Piezas.
  const importGroupName = activeCategorySection ? groupName(activeCategorySection) : groupName("piece");
  const organizedCategoryState = useMemo(
    () => reconcileCategoryOrganization(navigationCategories, categoryOrganization),
    [categoryOrganization, navigationCategories],
  );
  const categoryByKey = useMemo(() => new Map(navigationCategories.map((category) => [category.key, category])), [navigationCategories]);
  const normalizedCategoryQuery = categoryQuery.trim().toLocaleLowerCase();
  const activeSectionGroups = useMemo(() => activeCategorySection
    ? organizedCategoryState.groups
      .filter((group) => group.section === activeCategorySection)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }))
    : [], [activeCategorySection, organizedCategoryState.groups]);
  const ungroupedCategoryRows = useMemo(() => {
    if (!activeCategorySection) return [];
    return orderedCategoryKeys(organizedCategoryState, activeCategorySection, "")
      .map((key) => categoryByKey.get(key))
      .filter((category): category is NonNullable<typeof category> => Boolean(category))
      .filter((category) => !normalizedCategoryQuery || category.name.toLocaleLowerCase().includes(normalizedCategoryQuery));
  }, [activeCategorySection, categoryByKey, normalizedCategoryQuery, organizedCategoryState]);
  const groupedCategoryRows = useMemo(() => activeSectionGroups.map((group) => {
    const allCategories = orderedCategoryKeys(organizedCategoryState, group.section, group.id)
      .map((key) => categoryByKey.get(key))
      .filter((category): category is NonNullable<typeof category> => Boolean(category));
    const groupMatches = !normalizedCategoryQuery || group.name.toLocaleLowerCase().includes(normalizedCategoryQuery);
    return {
      group,
      allCategories,
      visibleCategories: groupMatches ? allCategories : allCategories.filter((category) => category.name.toLocaleLowerCase().includes(normalizedCategoryQuery)),
      visible: groupMatches || allCategories.some((category) => category.name.toLocaleLowerCase().includes(normalizedCategoryQuery)),
    };
  }).filter((row) => row.visible), [activeSectionGroups, categoryByKey, normalizedCategoryQuery, organizedCategoryState]);

  useEffect(() => {
    setMetadataDraft(selected ? metadataById.get(selected.id) ?? emptyMetadata(selected.id) : emptyMetadata());
    setMetadataSaved(false);
  }, [metadataById, selected]);

  const chooseLibrary = async () => {
    setError(null);
    try {
      if (!isDesktopRuntime()) return;
      const path = await open({ directory: true, multiple: false, title: "Elegir biblioteca 3D", defaultPath: library.rootPath || undefined });
      if (typeof path !== "string") return;
      setScanning(true);
      await prepareLibraryStructure(path);
      const snapshot = await scanLibrary(path);
      setLibrary(snapshot);
      setPendingImports([]);
      setImportNotices([]);
      setSelected(snapshot.animations[0] ?? null);
      await loadFolder(path);
      setFolderHistory([path]);
      setHistoryIndex(0);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  };

  const rescan = async () => {
    if (!library.rootPath) return void chooseLibrary();
    setScanning(true);
    setError(null);
    try {
      const snapshot = await scanLibrary(library.rootPath);
      setLibrary(snapshot);
      setSelected((current) => snapshot.animations.find((item) => item.id === current?.id) ?? snapshot.animations[0] ?? null);
      await loadFolder(folderContents?.path || library.rootPath);
    } catch (scanError) {
      setError(String(scanError));
    } finally {
      setScanning(false);
    }
  };

  const persistCategoryOrganization = async (next: CategoryOrganization) => {
    if (!library.rootPath) return;
    const prepared = reconcileCategoryOrganization(navigationCategories, next);
    const previous = categoryOrganization;
    setCategoryOrganization(prepared);
    setError(null);
    try {
      const saved = await saveCategoryOrganization(library.rootPath, prepared);
      setCategoryOrganization(saved);
    } catch (saveError) {
      setCategoryOrganization(previous);
      setError(String(saveError));
    }
  };

  const createManualCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!categoryCreateSection) return;
    const name = categoryDraft.trim();
    if (!name) return;
    if (catalogData.categories.some((category) => category.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) {
      setError("Ya existe una categoría con ese nombre.");
      return;
    }
    setError(null);
    try {
      const saved = await saveCategory("", name, categoryCreateSection);
      setCatalogData(saved);
      setCatalogMode(`section:${categoryCreateSection}`);
      setCategoryDraft("");
      setCategoryCreateSection(null);
    } catch (categoryError) {
      setError(String(categoryError));
    }
  };

  const renameManualCategory = async (categoryKey: string) => {
    const categoryId = categoryKey.startsWith("manual:") ? categoryKey.slice(7) : "";
    const category = catalogData.categories.find((item) => item.id === categoryId);
    if (!category) return;
    const name = window.prompt("Nuevo nombre de la categoría", category.name)?.trim();
    if (!name || name === category.name) return;
    setCategoryMenuId("");
    setError(null);
    try {
      setCatalogData(await saveCategory(category.id, name, category.section));
    } catch (categoryError) {
      setError(String(categoryError));
    }
  };

  const deleteManualCategory = async (categoryKey: string) => {
    const categoryId = categoryKey.startsWith("manual:") ? categoryKey.slice(7) : "";
    const category = catalogData.categories.find((item) => item.id === categoryId);
    if (!category || !window.confirm(`¿Eliminar la categoría “${category.name}”? Sus elementos quedarán sin esta categoría.`)) return;
    setCategoryMenuId("");
    setError(null);
    try {
      setCatalogData(await deleteCategory(category.id));
      if (catalogMode === `physical:${categoryKey}`) setCatalogMode(`section:${category.section}`);
    } catch (categoryError) {
      setError(String(categoryError));
    }
  };

  const assignAssetToManualCategory = async (assetId: string, categoryKey = "") => {
    const asset = library.animations.find((item) => item.id === assetId);
    if (!asset) return;
    const categoryId = categoryKey.startsWith("manual:") ? categoryKey.slice(7) : "";
    const category = categoryId ? catalogData.categories.find((item) => item.id === categoryId) : undefined;
    if (categoryId && !category) return;
    const assetSection = placementById.get(asset.id)?.section ?? "animation";
    if (category && category.section !== assetSection) {
      setError(`Este elemento es de ${groupName(assetSection)} y no se puede colocar en una categoría de ${groupName(category.section)}.`);
      return;
    }
    setError(null);
    try {
      const saved = await saveAnimationMetadata({ ...(metadataById.get(asset.id) ?? emptyMetadata(asset.id)), categoryId });
      setCatalogData((current) => ({ ...current, metadata: [...current.metadata.filter((item) => item.assetId !== saved.assetId), saved] }));
    } catch (categoryError) {
      setError(String(categoryError));
    } finally {
      setAssetDragId("");
      setAssetDropCategory("");
    }
  };

  const createCategoryGroup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupCreateSection) return;
    const name = groupDraft.trim();
    if (!name) return;
    const duplicated = organizedCategoryState.groups.some((group) => group.section === groupCreateSection && group.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
    if (duplicated) {
      setError("Ya existe un grupo con ese nombre en la sección.");
      return;
    }
    const sortOrder = organizedCategoryState.groups
      .filter((group) => group.section === groupCreateSection)
      .reduce((maximum, group) => Math.max(maximum, group.sortOrder), 0) + 10;
    const id = `group-${typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`;
    const next: CategoryOrganization = {
      groups: [...organizedCategoryState.groups, { id, section: groupCreateSection, name, sortOrder, collapsed: false }],
      categories: organizedCategoryState.categories,
    };
    setCatalogMode(`section:${groupCreateSection}`);
    setGroupDraft("");
    setGroupCreateSection(null);
    setCategoryAddOpen(false);
    void persistCategoryOrganization(next);
  };

  const renameCategoryGroup = (groupId: string) => {
    const group = organizedCategoryState.groups.find((item) => item.id === groupId);
    if (!group) return;
    const name = window.prompt("Nuevo nombre del grupo", group.name)?.trim();
    if (!name || name === group.name) return;
    const duplicated = organizedCategoryState.groups.some((item) => item.id !== group.id && item.section === group.section && item.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
    if (duplicated) return setError("Ya existe un grupo con ese nombre en la sección.");
    setGroupMenuId("");
    void persistCategoryOrganization({
      groups: organizedCategoryState.groups.map((item) => item.id === group.id ? { ...item, name } : item),
      categories: organizedCategoryState.categories,
    });
  };

  const deleteCategoryGroup = (groupId: string) => {
    const group = organizedCategoryState.groups.find((item) => item.id === groupId);
    if (!group || !window.confirm(`¿Eliminar el grupo “${group.name}”? Las categorías volverán a quedar sin grupo.`)) return;
    setGroupMenuId("");
    void persistCategoryOrganization(removeGroup(organizedCategoryState, groupId));
  };

  const toggleCategoryGroup = (groupId: string) => {
    void persistCategoryOrganization({
      groups: organizedCategoryState.groups.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group),
      categories: organizedCategoryState.categories,
    });
  };

  const beginCategoryDrag = (event: React.DragEvent, item: CategoryDragItem) => {
    setCategoryDragItem(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${item.type}:${item.id}`);
  };

  const markCategoryDropTarget = (event: React.DragEvent, type: CategoryDropTarget["type"], id: string) => {
    if (!categoryDragItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setCategoryDropTarget({ type, id, position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
  };

  const completeCategoryDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const dragged = categoryDragItem;
    const target = categoryDropTarget;
    setCategoryDragItem(null);
    setCategoryDropTarget(null);
    if (!dragged || !target) return;
    let next = organizedCategoryState;
    if (dragged.type === "group" && target.type === "group" && dragged.section === activeCategorySection) {
      const targetIndex = activeSectionGroups.findIndex((group) => group.id === target.id);
      const beforeId = target.position === "before" ? target.id : activeSectionGroups[targetIndex + 1]?.id || "";
      next = moveGroup(organizedCategoryState, dragged.section, dragged.id, beforeId);
    } else if (dragged.type === "category" && target.type === "group") {
      const targetGroup = organizedCategoryState.groups.find((group) => group.id === target.id);
      if (targetGroup?.section === dragged.section) next = moveCategory(organizedCategoryState, dragged.id, dragged.section, target.id);
    } else if (dragged.type === "category" && target.type === "category") {
      const targetLayout = organizedCategoryState.categories.find((entry) => entry.categoryKey === target.id);
      if (targetLayout?.section === dragged.section) {
        const keys = orderedCategoryKeys(organizedCategoryState, dragged.section, targetLayout.groupId);
        const targetIndex = keys.indexOf(target.id);
        const beforeKey = target.position === "before" ? target.id : keys[targetIndex + 1] || "";
        next = moveCategory(organizedCategoryState, dragged.id, dragged.section, targetLayout.groupId, beforeKey);
      }
    } else if (dragged.type === "category" && target.type === "ungrouped" && dragged.section === activeCategorySection) {
      next = moveCategory(organizedCategoryState, dragged.id, dragged.section, "");
    }
    if (next !== organizedCategoryState) void persistCategoryOrganization(next);
  };

  const categoryDropClass = (type: CategoryDropTarget["type"], id: string) => {
    if (categoryDropTarget?.type !== type || categoryDropTarget.id !== id) return "";
    return categoryDropTarget.position === "before" ? " drop-before" : " drop-after";
  };

  const autoScrollCategories = (event: React.DragEvent<HTMLDivElement>) => {
    if (!categoryDragItem && !assetDragId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = 42;
    if (event.clientY < bounds.top + edge) event.currentTarget.scrollBy({ top: -12 });
    else if (event.clientY > bounds.bottom - edge) event.currentTarget.scrollBy({ top: 12 });
  };

  const visibleAnimations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const inFolder = catalogMode === "favorites"
      ? library.animations.filter((asset) => favoriteIds.has(asset.id))
      : catalogMode === "unclassified"
        ? library.animations.filter((asset) => !placementById.get(asset.id)?.categoryKey && !metadataById.get(asset.id)?.categoryId)
        : catalogMode.startsWith("section:")
          ? library.animations.filter((asset) => placementById.get(asset.id)?.section === catalogMode.slice(8))
            : catalogMode.startsWith("physical:")
              ? catalogMode.slice(9).startsWith("manual:")
                ? library.animations.filter((asset) => metadataById.get(asset.id)?.categoryId === catalogMode.slice(16))
                : library.animations.filter((asset) => placementById.get(asset.id)?.categoryKey === catalogMode.slice(9))
              : catalogMode === "folder" && folderContents
                  ? folderContents.path.localeCompare(library.rootPath, undefined, { sensitivity: "accent" }) === 0
                    ? library.animations
                    : library.animations.filter((asset) => asset.directory.localeCompare(folderContents.path, undefined, { sensitivity: "accent" }) === 0)
                  : library.animations;
    const byFormat = formatFilter === "all" ? inFolder : inFolder.filter((asset) => asset.format === formatFilter);
    const bySearch = normalized ? byFormat.filter((asset) => {
      const metadata = metadataById.get(asset.id);
      const searchable = [asset.name, asset.fileName, asset.relativePath, metadata?.gameName, metadata?.subcategory, metadata?.tags, metadata?.description].filter(Boolean).join(" ");
      return searchable.toLocaleLowerCase().includes(normalized);
    }) : byFormat;
    return [...bySearch].sort((left, right) => {
      if (sortOrder === "modified") return right.modified - left.modified;
      if (sortOrder === "size") return right.size - left.size;
      const leftName = metadataById.get(left.id)?.gameName || left.name;
      const rightName = metadataById.get(right.id)?.gameName || right.name;
      return leftName.localeCompare(rightName, undefined, { sensitivity: "base", numeric: true });
    });
  }, [catalogMode, favoriteIds, folderContents, formatFilter, library.animations, metadataById, placementById, query, sortOrder]);

  const catalogPageCount = Math.max(1, Math.ceil(visibleAnimations.length / CATALOG_PAGE_SIZE));
  const pageAnimations = useMemo(
    () => visibleAnimations.slice(catalogPage * CATALOG_PAGE_SIZE, (catalogPage + 1) * CATALOG_PAGE_SIZE),
    [catalogPage, visibleAnimations],
  );

  // Las piezas que estás mirando en la columna derecha se fotografían primero.
  useEffect(() => {
    thumbnailQueue.prioritize(pageAnimations.map((asset) => asset.id));
  }, [pageAnimations, thumbnailQueue]);

  useEffect(() => {
    setCatalogPage(0);
  }, [catalogMode, formatFilter, query, sortOrder]);

  useEffect(() => {
    setCatalogPage((current) => Math.min(current, catalogPageCount - 1));
  }, [catalogPageCount]);

  useEffect(() => {
    if (!visibleAnimations.length) {
      if (catalogMode !== "all") setSelected(null);
      return;
    }
    if (!selected || !visibleAnimations.some((asset) => asset.id === selected.id)) {
      setSelected(visibleAnimations[0]);
    }
  }, [catalogMode, selected, visibleAnimations]);

  const saveCurrentMetadata = async () => {
    if (!selected) return;
    setMetadataSaving(true);
    setMetadataSaved(false);
    setError(null);
    try {
      const saved = await saveAnimationMetadata({ ...metadataDraft, assetId: selected.id });
      setCatalogData((current) => ({ ...current, metadata: [...current.metadata.filter((item) => item.assetId !== saved.assetId), saved] }));
      setMetadataSaved(true);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setMetadataSaving(false);
    }
  };

  const revealAnimation = async (asset: AnimationAsset) => {
    setError(null);
    setSelected(asset);
    try {
      await revealFile(asset.path);
    } catch (revealError) {
      setError(String(revealError));
    }
  };

  const toggleFavorite = (id: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("biblioteca-3d-favorites", JSON.stringify([...next]));
      return next;
    });
  };

  const goBack = async () => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    if (await loadFolder(folderHistory[nextIndex])) setHistoryIndex(nextIndex);
  };

  const goUp = async () => {
    if (!library.rootPath || !folderContents?.relativePath) return;
    const parts = folderContents.relativePath.split(/[\\/]/).filter(Boolean);
    parts.pop();
    const separator = library.rootPath.includes("\\") ? "\\" : "/";
    await navigateFolder(parts.length ? `${library.rootPath}${separator}${parts.join(separator)}` : library.rootPath);
  };

  const selectedIndex = selected ? visibleAnimations.findIndex((asset) => asset.id === selected.id) : -1;
  const selectedCompanionModel = useMemo(
    () => selected && !isAnimationSection(placementById.get(selected.id)?.section) ? findCompanionModelAsset(selected, library.animations) : null,
    [library.animations, placementById, selected],
  );
  const selectRelative = (offset: -1 | 1) => {
    const nextIndex = selectedIndex + offset;
    const next = visibleAnimations[nextIndex];
    if (next) {
      setSelected(next);
      setCatalogPage(Math.floor(nextIndex / CATALOG_PAGE_SIZE));
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable=true]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setFolderPanelOpen(false);
        setCatalogOptionsOpen(false);
        return;
      }
      if (editing || settingsOpen || metadataOpen) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        selectRelative(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        selectRelative(1);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    localStorage.setItem("biblioteca-3d-left-width", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem("biblioteca-3d-left-collapsed", String(leftCollapsed));
  }, [leftCollapsed]);

  const startLeftResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftCollapsed ? 0 : leftWidth;
    const onMove = (move: PointerEvent) => {
      const next = startWidth + (move.clientX - startX);
      if (next >= LEFT_MIN) setLeftCollapsed(false);
      setLeftWidth(Math.round(Math.min(LEFT_MAX, Math.max(LEFT_MIN, next))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing");
  };

  const renderCategory = (category: (typeof navigationCategories)[number]) => {
    const mode = "physical:" + category.key;
    const manual = category.key.startsWith("manual:");
    return (
      <div
        key={category.key}
        className={`category-sort-row${manual ? " manual" : ""}${categoryDragItem?.type === "category" && categoryDragItem.id === category.key ? " dragging" : ""}${assetDropCategory === category.key ? " asset-drop-target" : ""}${categoryDropClass("category", category.key)}`}
        draggable
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest(".manual-category-menu")) return event.preventDefault();
          beginCategoryDrag(event, { type: "category", id: category.key, section: category.section });
        }}
        onDragEnd={() => { setCategoryDragItem(null); setCategoryDropTarget(null); setAssetDropCategory(""); }}
        onDragOver={(event) => {
          if (assetDragId && manual) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setAssetDropCategory(category.key);
          } else markCategoryDropTarget(event, "category", category.key);
        }}
        onDrop={(event) => {
          if (assetDragId && manual) {
            event.preventDefault();
            void assignAssetToManualCategory(assetDragId, category.key);
          } else completeCategoryDrop(event);
        }}
        title={manual ? "Arrastrar para ordenar. Soltá una miniatura aquí para clasificarla." : "Categoría creada por una carpeta física. Arrastrar para ordenar."}
      >
        <GripVertical className="category-drag-handle" size={13} aria-hidden="true" />
        <button className={`nested-category ${catalogMode === mode ? "active" : ""}`} aria-pressed={catalogMode === mode} onClick={() => setCatalogMode(mode)}>
          {manual ? <Tags size={14} /> : <Folder size={14} />} <span>{category.name}</span> <small>{category.count}</small>
        </button>
        {manual && <div className="manual-category-menu">
          <button className="manual-category-more" draggable={false} onClick={() => setCategoryMenuId((current) => current === category.key ? "" : category.key)} title="Opciones de la categoría" aria-label={`Opciones de ${category.name}`} aria-expanded={categoryMenuId === category.key}><MoreVertical size={14} /></button>
          {categoryMenuId === category.key && <div className="manual-category-popover"><button onClick={() => void renameManualCategory(category.key)}><Pencil size={13} /> Renombrar</button><button className="danger" onClick={() => void deleteManualCategory(category.key)}><Trash2 size={13} /> Eliminar</button></div>}
        </div>}
      </div>
    );
  };

  const rootLabel = library.rootPath.split(/[\\/]/).filter(Boolean).at(-1) || "Sin biblioteca";
  void brandRevision;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">{brandLogo ? <img src={brandLogo} alt="Logo" /> : <Box size={25} />}<strong>{brandName}</strong></div>
        <div className="top-actions">
          <button className="primary" onClick={chooseLibrary}><FolderOpen size={17} /><span>{library.rootPath ? "Cambiar biblioteca" : "Elegir biblioteca"}</span></button>
          <button className="rescan-button" onClick={rescan} disabled={!library.rootPath || scanning} title="Reescanear ahora la biblioteca" aria-label="Reescanear ahora la biblioteca"><RefreshCw className={scanning ? "spin" : ""} size={17} /><span>{scanning ? "Escaneando…" : "Reescanear"}</span></button>
          <button className="rescan-button" onClick={() => void showImportFolder(importGroupName)} disabled={!library.rootPath} title={`Abrir ${importGroupName}\\Cargar Nuevo. Soltá ahí una carpeta y se carga sola como categoría de ${importGroupName}. Cada grupo tiene el suyo.`} aria-label={`Abrir la carpeta Cargar Nuevo de ${importGroupName}`}><FolderInput size={17} /><span>Cargar nuevo</span></button>
          {thumbnailProgress.total > 0 && (thumbnailProgress.running || thumbnailProgress.paused || thumbnailProgress.done < thumbnailProgress.total) && (
            <button
              className={`thumbnail-progress${thumbnailProgress.paused ? " paused" : ""}`}
              onClick={() => (thumbnailProgress.paused ? thumbnailQueue.resume() : thumbnailQueue.pause())}
              title={`${thumbnailProgress.paused ? "Capturas en pausa. Tocá para seguir." : "Generando capturas de piezas y animaciones. Tocá para pausar."}${thumbnailProgress.failed ? ` ${thumbnailProgress.failed} no se pudieron generar y conservan su imagen temporal.` : ""}`}
              aria-label={thumbnailProgress.paused ? "Seguir generando capturas" : "Pausar las capturas"}
            >
              {thumbnailProgress.paused ? <Play size={15} /> : <Pause size={15} />}
              <Camera size={15} aria-hidden="true" />
              <span>Capturas {thumbnailProgress.done} / {thumbnailProgress.total}</span>
              <i style={{ width: `${Math.round((thumbnailProgress.done / thumbnailProgress.total) * 100)}%` }} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="library-current-wrap">
          <button className={folderPanelOpen ? "library-current active" : "library-current"} title={library.rootPath || "Sin biblioteca"} onClick={() => setFolderPanelOpen((value) => !value)} disabled={!library.rootPath} aria-expanded={folderPanelOpen}><FolderOpen size={16} /><span><small>BIBLIOTECA ACTUAL</small><strong>{rootLabel}</strong></span><ChevronDown className={folderPanelOpen ? "open" : ""} size={14} /></button>
          {folderPanelOpen && library.rootPath && (
            <div className="library-popover" role="dialog" aria-label="Ubicación de la biblioteca">
              <small>UBICACIÓN</small>
              <p title={library.rootPath}>{library.rootPath}</p>
            </div>
          )}
        </div>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Ajustes"><Settings size={18} /></button>
      </header>
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)} title="Cerrar"><X size={16} /></button></div>}
      {importNotices.map((notice) => (
        <div className="import-banner imported" key={notice.id} role="status">
          <Check size={15} aria-hidden="true" />
          <span>{notice.text}</span>
          {notice.categoryKey && <button className="import-banner-action" onClick={() => { setCatalogMode(`physical:${notice.categoryKey}`); setImportNotices((current) => current.filter((item) => item.id !== notice.id)); }}>Ver</button>}
          <button onClick={() => setImportNotices((current) => current.filter((item) => item.id !== notice.id))} title="Cerrar" aria-label="Cerrar aviso"><X size={16} /></button>
        </div>
      ))}
      {pendingImports.length > 0 && (
        <div className="import-banner pending" role="status">
          <FolderInput size={15} aria-hidden="true" />
          <div className="import-banner-body">
            <strong>{pendingImports.length === 1 ? "1 elemento esperando en Cargar Nuevo" : `${pendingImports.length} elementos esperando en Cargar Nuevo`}</strong>
            <ul>{pendingImports.map((item) => <li key={`${item.groupName}/${item.name}`} className={item.waiting ? "waiting" : ""}><b>{item.groupName}\Cargar Nuevo\{item.name}</b>: {item.reason}{item.waiting ? "…" : ""}</li>)}</ul>
          </div>
          <button className="import-banner-action" onClick={() => void showImportFolder(pendingImports[0].groupName)}>Abrir carpeta</button>
          <button onClick={() => setPendingImports([])} title="Ocultar hasta el próximo cambio" aria-label="Ocultar aviso"><X size={16} /></button>
        </div>
      )}
      <section className={leftCollapsed ? "workspace left-collapsed" : "workspace"} style={{ "--left-w": leftCollapsed ? "0px" : `${leftWidth}px` } as React.CSSProperties}>
        <aside className="left-panel">
          <div className="panel-heading"><span>CATEGORÍAS</span><div className="panel-heading-actions"><small>{navigationCategories.length}</small></div></div>
          <div className="category-controls">
            <label className="category-search"><Search size={14} /><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Buscar" />{categoryQuery && <button onClick={() => setCategoryQuery("")} title="Limpiar búsqueda" aria-label="Limpiar búsqueda"><X size={13} /></button>}</label>
            <div className="category-add-menu category-split-button">
              <button className={categoryCreateSection ? "active category-create-trigger" : "category-create-trigger"} onClick={() => { setCategoryCreateSection(categoryCreateSection ? null : activeCategorySection ?? "animation"); setCategoryAddOpen(false); setGroupCreateSection(null); setCategoryDraft(""); }} title={library.rootPath ? "Nueva categoría" : "Elegí una biblioteca para crear categorías"} aria-label="Nueva categoría" aria-expanded={Boolean(categoryCreateSection)} disabled={!library.rootPath}><Plus size={15} /></button>
              <button className={categoryAddOpen ? "active category-group-trigger" : "category-group-trigger"} onClick={() => { setCategoryAddOpen((value) => !value); setCategoryCreateSection(null); setCategoryDraft(""); setGroupCreateSection(null); setGroupDraft(""); }} title={library.rootPath ? "Crear grupo" : "Elegí una biblioteca para crear grupos"} aria-label="Crear grupo" aria-expanded={categoryAddOpen} disabled={!library.rootPath}><ChevronDown size={12} /></button>
              {categoryCreateSection && <div className="category-add-popover">
                <form onSubmit={(event) => void createManualCategory(event)}>
                  <small>NUEVA CATEGORÍA</small>
                  <select value={categoryCreateSection} onChange={(event) => setCategoryCreateSection(event.target.value)} aria-label="Grupo de la categoría">{libraryGroups.map((group) => <option key={group.section} value={group.section}>{group.name}</option>)}</select>
                  <input autoFocus value={categoryDraft} maxLength={60} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Nombre de la categoría" />
                  <div><button type="button" onClick={() => { setCategoryCreateSection(null); setCategoryDraft(""); }}>Cancelar</button><button className="primary" type="submit" disabled={!categoryDraft.trim()}><Check size={13} /> Crear</button></div>
                </form>
              </div>}
              {categoryAddOpen && <div className="category-add-popover">
                {groupCreateSection ? <form onSubmit={createCategoryGroup}>
                  <small>SUBGRUPO DE {groupName(groupCreateSection).toLocaleUpperCase()}</small>
                  <input autoFocus value={groupDraft} maxLength={60} onChange={(event) => setGroupDraft(event.target.value)} placeholder="Nombre del grupo" />
                  <div><button type="button" onClick={() => { setGroupCreateSection(null); setGroupDraft(""); }}>Volver</button><button className="primary" type="submit" disabled={!groupDraft.trim()}>Crear</button></div>
                </form> : <>
                  {libraryGroups.map((group) => (
                    <button key={group.section} onClick={() => setGroupCreateSection(group.section)}>{isAnimationSection(group.section) ? <Play size={14} /> : <Box size={14} />}<span>Crear subgrupo en {group.name}</span></button>
                  ))}
                </>}
              </div>}
            </div>
          </div>
          <div className="smart-views category-navigation" onDragOver={autoScrollCategories}>
            <button className={catalogMode === "all" ? "active" : ""} aria-pressed={catalogMode === "all"} onClick={() => setCatalogMode("all")}><Box size={15} /> <span>Todo</span> <small>{library.animations.length}</small></button>
            <button
              className={`${catalogMode === "unclassified" ? "active" : ""}${assetDropCategory === "uncategorized" ? " asset-drop-target" : ""}`}
              aria-pressed={catalogMode === "unclassified"}
              onClick={() => setCatalogMode("unclassified")}
              onDragOver={(event) => { if (!assetDragId) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setAssetDropCategory("uncategorized"); }}
              onDrop={(event) => { if (!assetDragId) return; event.preventDefault(); void assignAssetToManualCategory(assetDragId); }}
              title="Ver elementos sin categoría. Soltá una miniatura aquí para quitarle su categoría manual."
            ><Sparkles size={15} /> <span>Sin categoría</span> <small>{unclassifiedCount}</small></button>
            {libraryGroups.map((group) => {
              const mode = `section:${group.section}`;
              const open = activeCategorySection === group.section;
              return (
                <button key={group.section} className={catalogMode === mode ? "active" : open ? "section-active" : ""} aria-pressed={open} onClick={() => setCatalogMode(mode)} title={`Grupo ${group.name}: sus categorías son las carpetas dentro de ${group.name}\\Categoría`}>
                  {group.section === "piece" ? <Box size={15} /> : isAnimationSection(group.section) ? <Play size={15} /> : <Boxes size={15} />} <span>{group.name}</span> <small>{group.count}</small>
                </button>
              );
            })}
            <button className={catalogMode === "favorites" ? "active" : ""} aria-pressed={catalogMode === "favorites"} onClick={() => setCatalogMode("favorites")}><Heart size={15} /> <span>Favoritas</span> <small>{favoriteIds.size}</small></button>
            {activeCategorySection && <div className="section-categories">
              <div className="category-divider"><span>CATEGORÍAS DE {groupName(activeCategorySection).toLocaleUpperCase()}</span></div>
              <div className={`ungrouped-drop${categoryDropClass("ungrouped", activeCategorySection)}`} onDragOver={(event) => markCategoryDropTarget(event, "ungrouped", activeCategorySection)} onDrop={completeCategoryDrop}>
                <span>SIN GRUPO</span><small>{ungroupedCategoryRows.reduce((total, category) => total + category.count, 0)}</small>
              </div>
              {ungroupedCategoryRows.map(renderCategory)}
              {groupedCategoryRows.map(({ group, allCategories, visibleCategories }) => (
                <div className="category-group" key={group.id}>
                  <div
                    className={`category-group-row${categoryDragItem?.type === "group" && categoryDragItem.id === group.id ? " dragging" : ""}${categoryDropClass("group", group.id)}`}
                    draggable
                    onDragStart={(event) => beginCategoryDrag(event, { type: "group", id: group.id, section: group.section })}
                    onDragEnd={() => { setCategoryDragItem(null); setCategoryDropTarget(null); }}
                    onDragOver={(event) => markCategoryDropTarget(event, "group", group.id)}
                    onDrop={completeCategoryDrop}
                  >
                    <GripVertical className="category-drag-handle" size={13} aria-hidden="true" />
                    <button className="category-group-main" onClick={() => toggleCategoryGroup(group.id)} aria-expanded={!group.collapsed}><ChevronRight className={group.collapsed ? "" : "open"} size={13} /><Layers3 size={14} /><span>{group.name}</span><small>{allCategories.reduce((total, category) => total + category.count, 0)}</small></button>
                    <div className="category-group-menu">
                      <button className="category-group-more" onClick={() => setGroupMenuId((current) => current === group.id ? "" : group.id)} title="Opciones del grupo" aria-label={`Opciones de ${group.name}`} aria-expanded={groupMenuId === group.id}><MoreVertical size={14} /></button>
                      {groupMenuId === group.id && <div className="category-group-popover"><button onClick={() => renameCategoryGroup(group.id)}><Pencil size={13} /> Renombrar</button><button className="danger" onClick={() => deleteCategoryGroup(group.id)}><Trash2 size={13} /> Eliminar grupo</button></div>}
                    </div>
                  </div>
                  {(!group.collapsed || normalizedCategoryQuery) && <div className="category-group-items">{visibleCategories.map(renderCategory)}{!allCategories.length && <div className="category-group-empty">Arrastrá categorías a este grupo</div>}</div>}
                </div>
              ))}
              {!navigationCategories.some((category) => category.section === activeCategorySection) && !activeSectionGroups.length && <div className="category-empty">Creá una categoría con el botón + o agregá una carpeta dentro de {groupName(activeCategorySection)}\Categoría.</div>}
              {normalizedCategoryQuery && !ungroupedCategoryRows.length && !groupedCategoryRows.length && <div className="category-empty">No hay categorías ni grupos que coincidan.</div>}
            </div>}
          </div>
          <div className="category-status"><span>{visibleAnimations.length} visibles</span></div>
        </aside>
        <div className="panel-resizer" onPointerDown={startLeftResize} role="separator" aria-orientation="vertical" aria-label="Ajustar el ancho de la columna de categorías">
          <button className="resizer-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={() => setLeftCollapsed((value) => !value)} title={leftCollapsed ? "Mostrar categorías" : "Ocultar categorías"} aria-label={leftCollapsed ? "Mostrar categorías" : "Ocultar categorías"} aria-expanded={!leftCollapsed}>
            {leftCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        </div>
        <section className="center-column">
          <Viewer3D asset={selected} companionModel={selectedCompanionModel} assetKind={selected && !isAnimationSection(placementById.get(selected.id)?.section ?? "animation") ? "piece" : "animation"} characterBody={characterBody} characterBones={characterBones} autoplay={autoplay} onPrevious={() => selectRelative(-1)} onNext={() => selectRelative(1)} canPrevious={selectedIndex > 0} canNext={selectedIndex >= 0 && selectedIndex < visibleAnimations.length - 1} onReveal={() => selected && void revealAnimation(selected)} onEditMetadata={() => { if (!selected) return; setMetadataSaved(false); setMetadataOpen(true); }} />
        </section>
        <aside className="right-panel">
          <div className="catalog-tools">
            <div className="catalog-filter-menu">
              <button className={catalogOptionsOpen || formatFilter !== "all" || sortOrder !== "name" ? "active" : ""} aria-expanded={catalogOptionsOpen} onClick={() => setCatalogOptionsOpen((value) => !value)} title="Filtrar y ordenar"><ListFilter size={15} /></button>
              {catalogOptionsOpen && <div className="catalog-filter-popover">
                <label>Formato<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)}>
                  <option value="all">Todos</option><option value="fbx">FBX</option><option value="glb">GLB</option><option value="gltf">GLTF</option><option value="bvh">BVH</option>
                </select></label>
                <label>Orden<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
                  <option value="name">Nombre</option><option value="modified">Recientes</option><option value="size">Tamaño</option>
                </select></label>
              </div>}
            </div>
            <label><Search size={16} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar piezas y animaciones..." />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</label>
            <button className={view === "compact" ? "active" : ""} aria-pressed={view === "compact"} onClick={() => setView("compact")} title="Compacto"><Grid2X2 size={15} /></button>
            <button className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grilla"><Box size={15} /></button>
            <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} title="Lista"><List size={15} /></button>
          </div>
          <div className={`animation-list ${view}`}>
            {pageAnimations.map((asset) => (
              <article
                className={`${selected?.id === asset.id ? "animation-card selected" : "animation-card"}${assetDragId === asset.id ? " dragging" : ""}`}
                key={asset.id}
                role="button"
                tabIndex={0}
                draggable
                aria-label={asset.name}
                title="Arrastrá esta miniatura hacia una categoría para clasificarla"
                onDragStart={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return event.preventDefault();
                  setAssetDragId(asset.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", `asset:${asset.id}`);
                }}
                onDragEnd={() => { setAssetDragId(""); setAssetDropCategory(""); }}
                onClick={() => setSelected(asset)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(asset); } }}
              >
                <div className={`animation-thumb format-${asset.format} generated-thumb`}><AssetThumbnail asset={asset} modified={thumbnailResults.get(asset.id)?.thumbnailModified ?? asset.thumbnailModified} animation={isAnimationSection(placementById.get(asset.id)?.section)} /><span>{asset.format.toUpperCase()}</span></div>
                <div className="animation-meta"><strong title={asset.fileName}>{metadataById.get(asset.id)?.gameName || asset.name}</strong><span>{isAnimationSection(placementById.get(asset.id)?.section) ? "Animación" : "Pieza"} ·{metadataById.get(asset.id)?.gameName ? `${asset.name} · ` : ""}{formatBytes(asset.size)} · {asset.format.toUpperCase()}</span></div>
                <div className="animation-actions">
                  <button draggable={false} className={favoriteIds.has(asset.id) ? "favorite active" : "favorite"} aria-pressed={favoriteIds.has(asset.id)} onClick={(event) => { event.stopPropagation(); toggleFavorite(asset.id); }} title={favoriteIds.has(asset.id) ? "Quitar de favoritas" : "Agregar a favoritas"} aria-label={favoriteIds.has(asset.id) ? "Quitar de favoritas" : "Agregar a favoritas"}><Heart size={15} fill={favoriteIds.has(asset.id) ? "currentColor" : "none"} /></button>
                </div>
              </article>
            ))}
            {!visibleAnimations.length && <div className="catalog-empty"><Box size={30} /><strong>{library.rootPath ? "No hay elementos en esta sección" : "Tu biblioteca aparecerá acá"}</strong><span>Formatos: FBX, GLB, GLTF y BVH</span></div>}
          </div>
          <footer className="catalog-footer">
            <span>{visibleAnimations.length} {visibleAnimations.length === 1 ? "elemento" : "elementos"}</span>
            {catalogPageCount > 1 && <div className="catalog-pages">
              <button onClick={() => setCatalogPage((page) => Math.max(0, page - 1))} disabled={catalogPage === 0} title="Página anterior"><ChevronLeft size={13} /></button>
              <span>{catalogPage + 1} / {catalogPageCount}</span>
              <button onClick={() => setCatalogPage((page) => Math.min(catalogPageCount - 1, page + 1))} disabled={catalogPage >= catalogPageCount - 1} title="Página siguiente"><ChevronRight size={13} /></button>
            </div>}
          </footer>
        </aside>
      </section>
      {metadataOpen && selected && <div className="modal-backdrop" role="presentation" onMouseDown={() => setMetadataOpen(false)}>
        <section className="metadata-modal" role="dialog" aria-modal="true" aria-label="Metadatos de la animación" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><strong>Metadatos</strong><span title={selected.fileName}>{selected.fileName}</span></div>
            <button className="icon-button" onClick={() => setMetadataOpen(false)} title="Cerrar" aria-label="Cerrar metadatos"><X size={18} /></button>
          </header>
          <form className="metadata-editor" onSubmit={(event) => { event.preventDefault(); void saveCurrentMetadata(); }}>
            <label>Nombre para juego<input autoFocus value={metadataDraft.gameName} maxLength={120} placeholder={selected.name} onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, gameName: event.target.value })); }} /></label>
            <label>Subcategoría<input value={metadataDraft.subcategory} maxLength={80} placeholder="Ej.: Escudo" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, subcategory: event.target.value })); }} /></label>
            <label>Etiquetas<input value={metadataDraft.tags} maxLength={400} placeholder="hit, combate, escudo" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, tags: event.target.value })); }} /></label>
            <label className="metadata-description">Descripción<textarea value={metadataDraft.description} maxLength={2000} placeholder="Describí qué hace esta animación" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, description: event.target.value })); }} /></label>
            <div className="metadata-actions"><button className="metadata-save" type="submit" disabled={metadataSaving}><Save size={15} /> {metadataSaving ? "Guardando…" : "Guardar metadatos"}</button>{metadataSaved && <span>Guardado</span>}</div>
          </form>
        </section>
      </div>}
      {settingsOpen && <BrandSettings onClose={() => setSettingsOpen(false)} onCatalogChange={setCatalogData} onError={setError} />}
    </main>
  );
}
