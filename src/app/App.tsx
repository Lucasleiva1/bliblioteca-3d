import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Box,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Grid2X2,
  Heart,
  ImagePlus,
  List,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import Viewer3D from "../engine/Viewer3D";
import { getCatalogData, getInitialState, isDesktopRuntime, listFolder, openFolder, revealFile, saveAnimationMetadata, scanLibrary } from "../lib/api";
import type { AnimationAsset, AnimationMetadata, CatalogData, FolderContents, FolderNode, LibrarySnapshot } from "../lib/types";
import { thumbnailForAnimation } from "../lib/thumbnails";

const EMPTY_LIBRARY: LibrarySnapshot = { rootPath: "", folders: [], animations: [], scannedAt: 0 };
const EMPTY_CATALOG: CatalogData = { categories: [], metadata: [] };
const emptyMetadata = (assetId = ""): AnimationMetadata => ({ assetId, gameName: "", categoryId: "", subcategory: "", tags: "", description: "" });

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function FolderBranch({ node, currentPath, onOpen }: { node: FolderNode; currentPath: string; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const active = node.path.localeCompare(currentPath, undefined, { sensitivity: "accent" }) === 0;
  return (
    <div className="folder-branch">
      <div className={active ? "folder-row active" : "folder-row"}>
        <button className="tree-chevron" onClick={() => setExpanded((value) => !value)} disabled={!node.children.length} aria-label={expanded ? "Plegar carpeta" : "Desplegar carpeta"}>
          {node.children.length ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}
        </button>
        <button className="folder-name" onClick={() => onOpen(node.path)} onDoubleClick={() => setExpanded(true)} title={node.path}>
          {active ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{node.name}</span>
          <small>{node.animationCount}</small>
        </button>
      </div>
      {expanded && node.children.length > 0 && (
        <div className="folder-children">
          {node.children.map((child) => <FolderBranch key={child.path} node={child} currentPath={currentPath} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

function BrandSettings({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem("biblioteca-3d-brand-name") || "Biblioteca 3D");
  const [logo, setLogo] = useState(() => localStorage.getItem("biblioteca-3d-brand-logo") || "");
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const [characterBones, setCharacterBonesState] = useState(() => localStorage.getItem("biblioteca-3d-character-bones") !== "false");
  const [characterBody, setCharacterBodyState] = useState<"male" | "female">(() => localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
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
  const [catalogMode, setCatalogMode] = useState<string>("folder");
  const [catalogData, setCatalogData] = useState<CatalogData>(EMPTY_CATALOG);
  const [bottomTab, setBottomTab] = useState<"files" | "metadata">("files");
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
  const [brandRevision, setBrandRevision] = useState(0);
  const [characterBones, setCharacterBones] = useState(() => localStorage.getItem("biblioteca-3d-character-bones") !== "false");
  const [characterBody, setCharacterBody] = useState<"male" | "female">(() => localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
  const brandName = localStorage.getItem("biblioteca-3d-brand-name") || "Biblioteca 3D";
  const brandLogo = localStorage.getItem("biblioteca-3d-brand-logo") || "";

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
      setCharacterBones(localStorage.getItem("biblioteca-3d-character-bones") !== "false");
      setCharacterBody(localStorage.getItem("biblioteca-3d-character-body") === "female" ? "female" : "male");
    };
    window.addEventListener("biblioteca-3d-brand-change", refreshBrand);
    window.addEventListener("biblioteca-3d-theme-change", refreshBrand);
    window.addEventListener("biblioteca-3d-character-change", refreshCharacter);
    void getInitialState().then((snapshot) => {
      setLibrary(snapshot);
      if (snapshot.rootPath) {
        void loadFolder(snapshot.rootPath);
        setFolderHistory([snapshot.rootPath]);
        setHistoryIndex(0);
      }
    }).catch((initialError) => setError(String(initialError))).finally(() => setLoading(false));
    void getCatalogData().then(setCatalogData).catch((catalogError) => setError(String(catalogError)));
    return () => {
      window.removeEventListener("biblioteca-3d-brand-change", refreshBrand);
      window.removeEventListener("biblioteca-3d-theme-change", refreshBrand);
      window.removeEventListener("biblioteca-3d-character-change", refreshCharacter);
    };
  }, [loadFolder]);

  const metadataById = useMemo(() => new Map(catalogData.metadata.map((item) => [item.assetId, item])), [catalogData.metadata]);

  useEffect(() => {
    setMetadataDraft(selected ? metadataById.get(selected.id) ?? emptyMetadata(selected.id) : emptyMetadata());
    setMetadataSaved(false);
  }, [metadataById, selected]);

  const chooseLibrary = async () => {
    setError(null);
    try {
      if (!isDesktopRuntime()) return;
      const path = await open({ directory: true, multiple: false, title: "Elegir biblioteca de animaciones 3D", defaultPath: library.rootPath || undefined });
      if (typeof path !== "string") return;
      setScanning(true);
      const snapshot = await scanLibrary(path);
      setLibrary(snapshot);
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

  const visibleAnimations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const inFolder = catalogMode === "favorites"
      ? library.animations.filter((asset) => favoriteIds.has(asset.id))
      : catalogMode === "unclassified"
        ? library.animations.filter((asset) => !metadataById.get(asset.id)?.categoryId)
        : catalogMode.startsWith("category:")
          ? library.animations.filter((asset) => metadataById.get(asset.id)?.categoryId === catalogMode.slice(9))
        : folderContents
          ? folderContents.path.localeCompare(library.rootPath, undefined, { sensitivity: "accent" }) === 0
            ? library.animations
            : library.animations.filter((asset) => asset.directory.localeCompare(folderContents.path, undefined, { sensitivity: "accent" }) === 0)
          : library.animations;
    return normalized ? inFolder.filter((asset) => {
      const metadata = metadataById.get(asset.id);
      return `${asset.name} ${asset.fileName} ${asset.relativePath} ${metadata?.gameName ?? ""} ${metadata?.subcategory ?? ""} ${metadata?.tags ?? ""} ${metadata?.description ?? ""}`.toLocaleLowerCase().includes(normalized);
    }) : inFolder;
  }, [catalogMode, favoriteIds, folderContents, library.animations, metadataById, query]);

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

  const rootLabel = library.rootPath.split(/[\\/]/).filter(Boolean).at(-1) || "Sin biblioteca";
  void brandRevision;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">{brandLogo ? <img src={brandLogo} alt="Logo" /> : <Box size={25} />}<strong>{brandName}</strong></div>
        <div className="top-actions">
          <button className="primary" onClick={chooseLibrary}><FolderOpen size={17} /><span>{library.rootPath ? "Cambiar biblioteca" : "Elegir biblioteca"}</span></button>
          <button onClick={rescan} disabled={!library.rootPath || scanning} title="Rescanear biblioteca"><RefreshCw className={scanning ? "spin" : ""} size={17} /><span>Rescanear</span></button>
        </div>
        <div className="library-current" title={library.rootPath}><small>BIBLIOTECA ACTUAL</small><strong>{rootLabel}</strong></div>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Ajustes"><Settings size={18} /></button>
      </header>
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)} title="Cerrar"><X size={16} /></button></div>}
      <section className="workspace">
        <aside className="left-panel">
          <div className="panel-heading"><span>CARPETAS</span><small>{library.folders.length}</small></div>
          <button className={folderContents?.path === library.rootPath && catalogMode === "folder" ? "root-folder active" : "root-folder"} onClick={() => library.rootPath && navigateFolder(library.rootPath)} disabled={!library.rootPath}>
            <FolderOpen size={17} /><span>{rootLabel}</span><small>{library.animations.length}</small>
          </button>
          <div className="folder-tree">
            {library.folders.map((node) => <FolderBranch key={node.path} node={node} currentPath={catalogMode === "folder" ? folderContents?.path || library.rootPath : ""} onOpen={navigateFolder} />)}
          </div>
          {!library.rootPath && !loading && <div className="panel-empty"><Folder size={27} /><span>Elegí una carpeta para ver su estructura.</span></div>}
          <div className="smart-views">
            <span>COLECCIONES</span>
            <button className={catalogMode === "favorites" ? "active" : ""} aria-pressed={catalogMode === "favorites"} onClick={() => setCatalogMode("favorites")}><Heart size={15} /> Favoritas <small>{favoriteIds.size}</small></button>
            <button className={catalogMode === "unclassified" ? "active" : ""} aria-pressed={catalogMode === "unclassified"} onClick={() => setCatalogMode("unclassified")}><Sparkles size={15} /> Sin clasificar <small>{library.animations.filter((asset) => !metadataById.get(asset.id)?.categoryId).length}</small></button>
            {catalogData.categories.map((category) => {
              const mode = `category:${category.id}`;
              const count = library.animations.filter((asset) => metadataById.get(asset.id)?.categoryId === category.id).length;
              return <button key={category.id} className={catalogMode === mode ? "active" : ""} aria-pressed={catalogMode === mode} onClick={() => setCatalogMode(mode)}><Box size={14} /> {category.name} <small>{count}</small></button>;
            })}
          </div>
        </aside>
        <section className="center-column">
          <div className="breadcrumb">
            <button onClick={goBack} disabled={historyIndex <= 0} title="Volver a la carpeta anterior"><ArrowLeft size={15} /></button>
            <button onClick={goUp} disabled={!folderContents?.relativePath} title="Subir una carpeta"><ArrowUp size={15} /></button>
            <Folder size={15} />
            <span>{folderContents?.relativePath ? `${rootLabel}  /  ${folderContents.relativePath.replaceAll("\\", "  /  ")}` : rootLabel}</span>
            {folderContents?.path && <button onClick={() => openFolder(folderContents.path)} title="Abrir esta carpeta en Windows"><FolderOpen size={15} /></button>}
          </div>
          <Viewer3D asset={selected} characterBody={characterBody} characterBones={characterBones} />
        </section>
        <aside className="right-panel">
          <div className="catalog-tools">
            <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar animaciones..." />{query && <button onClick={() => setQuery("")}><X size={14} /></button>}</label>
            <button className={view === "compact" ? "active" : ""} aria-pressed={view === "compact"} onClick={() => setView("compact")} title="Compacto"><Grid2X2 size={15} /></button>
            <button className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grilla"><Box size={15} /></button>
            <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")} title="Lista"><List size={15} /></button>
          </div>
          <div className={`animation-list ${view}`}>
            {visibleAnimations.map((asset) => (
              <article className={selected?.id === asset.id ? "animation-card selected" : "animation-card"} key={asset.id} role="button" tabIndex={0} aria-label={asset.name} onClick={() => setSelected(asset)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(asset); } }}>
                <div className={`animation-thumb format-${asset.format}`}><img src={thumbnailForAnimation(asset.fileName)} alt={`Boceto de ${asset.name}`} loading="lazy" /><span>{asset.format.toUpperCase()}</span></div>
                <div className="animation-meta"><strong title={asset.fileName}>{metadataById.get(asset.id)?.gameName || asset.name}</strong><span>{metadataById.get(asset.id)?.gameName ? `${asset.name} · ` : ""}{formatBytes(asset.size)} · {asset.format.toUpperCase()}</span></div>
                <button className={favoriteIds.has(asset.id) ? "favorite active" : "favorite"} aria-pressed={favoriteIds.has(asset.id)} onClick={(event) => { event.stopPropagation(); toggleFavorite(asset.id); }} title={favoriteIds.has(asset.id) ? "Quitar de favoritas" : "Agregar a favoritas"} aria-label={favoriteIds.has(asset.id) ? "Quitar de favoritas" : "Agregar a favoritas"}><Heart size={16} fill={favoriteIds.has(asset.id) ? "currentColor" : "none"} /></button>
              </article>
            ))}
            {!visibleAnimations.length && <div className="catalog-empty"><Box size={30} /><strong>{library.rootPath ? "No hay animaciones en esta carpeta" : "Tu biblioteca aparecerá acá"}</strong><span>Formatos: FBX, GLB y GLTF</span></div>}
          </div>
          <footer>{visibleAnimations.length} {visibleAnimations.length === 1 ? "animación" : "animaciones"}</footer>
        </aside>
        <section className="bottom-files">
          <header>
            <div className="bottom-tabs">
              <button className={bottomTab === "files" ? "active" : ""} aria-pressed={bottomTab === "files"} onClick={() => setBottomTab("files")}><FolderOpen size={15} /> Archivos</button>
              <button className={bottomTab === "metadata" ? "active" : ""} aria-pressed={bottomTab === "metadata"} onClick={() => setBottomTab("metadata")}><Sparkles size={15} /> Metadatos</button>
              <span>{bottomTab === "files" ? folderContents?.relativePath || rootLabel : selected?.fileName || "Elegí una animación"}</span>
            </div>
            {bottomTab === "files" && <button onClick={() => folderContents?.path && openFolder(folderContents.path)} disabled={!folderContents?.path} title="Abrir carpeta en Windows"><FolderOpen size={17} /></button>}
          </header>
          {bottomTab === "files" ? (
            <div className="file-table">
              <div className="file-row table-head"><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span>Modificado</span><span /></div>
              {(folderContents?.entries ?? []).map((entry) => <div className="file-row" key={entry.path} onDoubleClick={() => entry.kind === "folder" ? navigateFolder(entry.path) : entry.kind === "animation" && setSelected(library.animations.find((asset) => asset.path === entry.path) ?? null)}>
                <span>{entry.kind === "folder" ? <Folder size={15} /> : <Box size={15} />}<strong>{entry.name}</strong></span>
                <span>{entry.kind === "folder" ? "Carpeta" : entry.extension.replace(".", "").toUpperCase() || "Archivo"}</span>
                <span>{entry.kind === "folder" ? "—" : formatBytes(entry.size)}</span>
                <span>{entry.modified ? new Date(entry.modified * 1000).toLocaleDateString("es-AR") : "—"}</span>
                <button onClick={() => entry.kind === "folder" ? openFolder(entry.path) : revealFile(entry.path)} title="Mostrar en Windows"><FolderOpen size={14} /></button>
              </div>)}
              {!folderContents?.entries.length && <div className="files-empty">Esta carpeta está vacía.</div>}
            </div>
          ) : selected ? (
            <form className="metadata-editor" onSubmit={(event) => { event.preventDefault(); void saveCurrentMetadata(); }}>
              <label>Nombre para juego<input value={metadataDraft.gameName} maxLength={120} placeholder={selected.name} onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, gameName: event.target.value })); }} /></label>
              <label>Categoría<select value={metadataDraft.categoryId} onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, categoryId: event.target.value })); }}><option value="">Sin clasificar</option>{catalogData.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
              <label>Subcategoría<input value={metadataDraft.subcategory} maxLength={80} placeholder="Ej.: Escudo" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, subcategory: event.target.value })); }} /></label>
              <label>Etiquetas<input value={metadataDraft.tags} maxLength={400} placeholder="hit, combate, escudo" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, tags: event.target.value })); }} /></label>
              <label className="metadata-description">Descripción<textarea value={metadataDraft.description} maxLength={2000} placeholder="Describí qué hace esta animación" onChange={(event) => { setMetadataSaved(false); setMetadataDraft((current) => ({ ...current, description: event.target.value })); }} /></label>
              <div className="metadata-actions"><button className="metadata-save" type="submit" disabled={metadataSaving}><Save size={15} /> {metadataSaving ? "Guardando…" : "Guardar metadatos"}</button>{metadataSaved && <span>Guardado</span>}</div>
            </form>
          ) : <div className="files-empty">Elegí una animación para editar sus metadatos.</div>}
        </section>
      </section>
      {settingsOpen && <BrandSettings onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
