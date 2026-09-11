#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{backup::Backup, params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        mpsc::{self, RecvTimeoutError},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use walkdir::{DirEntry, WalkDir};

const TECHNICAL_DIR: &str = "_biblioteca-3d";
/// Carpeta que vive junto a cada modelo con sus miniaturas; viaja con la carpeta si se mueve o copia.
const CACHE_DIR: &str = "_cache";
const THUMBNAIL_SUFFIX: &str = ".webp";
const THUMBNAIL_FAILED_SUFFIX: &str = ".fallo.txt";
const MAX_THUMBNAIL_BYTES: usize = 2 * 1024 * 1024;
const TEXTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tga", "webp", "bmp"];
const MAX_TEXTURE_CANDIDATES: usize = 4_000;
const MAX_TEXTURE_SEARCH_ENTRIES: usize = 30_000;
const DEFAULT_LIBRARY_ROOT: &str = r"D:\biblioteca-3d";
const ANIMATION_EXTENSIONS: &[&str] = &["fbx", "glb", "gltf"];
const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;
/// Cada grupo (carpeta de la raíz de la biblioteca) tiene su propia bandeja con este nombre.
const IMPORT_DIR: &str = "Cargar Nuevo";
const VARIOS_DIR: &str = "Varios";
/// El único grupo cuyo contenido se trata como animación; los demás se tratan como piezas.
const ANIMATIONS_GROUP: &str = "Animaciones";
const IMPORT_EVENT: &str = "library-import";
/// Silencio que se espera después del último cambio antes de procesar la carga.
const IMPORT_QUIET: Duration = Duration::from_secs(2);
/// Reintento mientras Windows todavía está copiando o usando algún archivo.
const IMPORT_RETRY: Duration = Duration::from_secs(3);
const LIBRARY_STRUCTURE: &[&[&str]] = &[
    &["Piezas", "Categoría"],
    &["Piezas", "Varios"],
    &["Piezas", IMPORT_DIR],
    &["Animaciones", "Categoría"],
    &["Animaciones", "Varios"],
    &["Animaciones", IMPORT_DIR],
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderNode {
    name: String,
    path: String,
    relative_path: String,
    children: Vec<FolderNode>,
    animation_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationAsset {
    id: String,
    name: String,
    file_name: String,
    path: String,
    relative_path: String,
    directory: String,
    format: String,
    size: u64,
    modified: i64,
    /// Fecha de la miniatura vigente en `_cache`; 0 si falta o quedó vieja.
    thumbnail_modified: i64,
    /// La miniatura ya falló para esta versión del archivo y no se reintenta.
    thumbnail_failed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshot {
    root_path: String,
    folders: Vec<FolderNode>,
    animations: Vec<AnimationAsset>,
    scanned_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderEntry {
    name: String,
    path: String,
    relative_path: String,
    kind: String,
    extension: String,
    size: u64,
    modified: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderContents {
    path: String,
    relative_path: String,
    entries: Vec<FolderEntry>,
}

#[derive(Debug)]
struct AssetResource {
    uri: String,
    bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Category {
    id: String,
    name: String,
    section: String,
    sort_order: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationMetadata {
    asset_id: String,
    game_name: String,
    category_id: String,
    subcategory: String,
    tags: String,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogData {
    categories: Vec<Category>,
    metadata: Vec<AnimationMetadata>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryGroup {
    id: String,
    section: String,
    name: String,
    sort_order: i64,
    collapsed: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicalCategoryLayout {
    category_key: String,
    section: String,
    group_id: String,
    sort_order: i64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryOrganization {
    groups: Vec<CategoryGroup>,
    categories: Vec<PhysicalCategoryLayout>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMutation {
    old_id: String,
    new_id: String,
    new_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFolder {
    name: String,
    category_name: String,
    /// Carpeta del grupo donde entró la carga (Piezas, Animaciones, contruccion...).
    group_name: String,
    animation: bool,
    merged: bool,
    assets: Vec<AnimationAsset>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingImport {
    group_name: String,
    name: String,
    reason: String,
    waiting: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    root_path: String,
    imported: Vec<ImportedFolder>,
    pending: Vec<PendingImport>,
}

enum ImportOutcome {
    Imported(ImportedFolder),
    Waiting(String),
}

#[derive(Default)]
struct ImportWatcherState {
    active: Mutex<Option<ActiveImportWatcher>>,
}

struct ActiveImportWatcher {
    root_key: String,
    _watcher: RecommendedWatcher,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
    version: String,
    database_path: String,
    library_root: String,
    library_available: bool,
    animations: usize,
    categories: usize,
    metadata: usize,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn modified_time(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn normalized_path(path: &Path) -> String {
    path_string(path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn stable_id(path: &Path) -> String {
    let mut hash = Sha256::new();
    hash.update(normalized_path(path).as_bytes());
    format!("{:x}", hash.finalize())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn is_animation(path: &Path) -> bool {
    ANIMATION_EXTENSIONS.contains(&extension(path).as_str())
}

fn resource_mime_type(path: &Path) -> String {
    match extension(path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ktx2" => "image/ktx2",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn collect_gltf_resources(
    root: &Path,
    file: &Path,
    bytes: &[u8],
) -> Result<Vec<AssetResource>, String> {
    let document: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("El archivo GLTF no contiene JSON válido: {error}"))?;
    let mut uris = Vec::new();
    for section in ["buffers", "images"] {
        if let Some(items) = document.get(section).and_then(serde_json::Value::as_array) {
            for item in items {
                if let Some(uri) = item.get("uri").and_then(serde_json::Value::as_str) {
                    if !uri.starts_with("data:")
                        && !uri.starts_with("http:")
                        && !uri.starts_with("https:")
                        && !uri.starts_with("blob:")
                    {
                        uris.push((uri.to_string(), section == "images"));
                    }
                }
            }
        }
    }
    let mut nearby: Option<Vec<String>> = None;

    let directory = file
        .parent()
        .ok_or("El GLTF no tiene carpeta contenedora")?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("No se pudo resolver la biblioteca: {error}"))?;
    let root_key = normalized_path(&canonical_root);
    let mut seen = HashSet::new();
    let mut resources = Vec::new();
    let mut total_size = bytes.len() as u64;
    for (uri, is_image) in uris {
        if !seen.insert(uri.clone()) {
            continue;
        }
        let uri_path = Path::new(&uri);
        if uri_path.is_absolute() || uri.contains('?') || uri.contains('#') {
            if is_image {
                continue;
            }
            return Err(format!(
                "La dependencia usa una ruta no local o no admitida: {uri}"
            ));
        }
        let resolved = match directory.join(uri_path).canonicalize() {
            Ok(resolved) => resolved,
            // Una imagen faltante no impide ver la pieza: se busca por nombre en las carpetas
            // vecinas y, si no aparece, la pieza se dibuja sin esa textura.
            Err(_) if is_image => {
                let candidates = nearby.get_or_insert_with(|| nearby_textures(root, file));
                match closest_texture(uri_path, directory, candidates)
                    .and_then(|path| path.canonicalize().ok())
                {
                    Some(found) => found,
                    None => continue,
                }
            }
            Err(error) => return Err(format!("Falta la dependencia {uri}: {error}")),
        };
        let candidate_key = normalized_path(&resolved);
        if candidate_key != root_key && !candidate_key.starts_with(&format!("{root_key}/")) {
            return Err(format!(
                "La dependencia intenta salir de la biblioteca: {uri}"
            ));
        }
        if !resolved.is_file() {
            return Err(format!("La dependencia no es un archivo: {uri}"));
        }
        let resource_bytes = fs::read(&resolved)
            .map_err(|error| format!("No se pudo leer la dependencia {uri}: {error}"))?;
        total_size += resource_bytes.len() as u64;
        if total_size > MAX_ASSET_BYTES {
            return Err(format!(
                "El GLTF y sus dependencias superan el límite inicial de {} MB",
                MAX_ASSET_BYTES / 1024 / 1024
            ));
        }
        resources.push(AssetResource {
            uri,
            mime_type: resource_mime_type(&resolved),
            bytes: resource_bytes,
        });
    }
    Ok(resources)
}

fn is_allowed_entry(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .is_none_or(|name| !is_hidden_library_dir(name))
        && !(entry.file_type().is_dir() && is_import_dir(entry.path()))
}

/// Carpetas internas que la biblioteca nunca muestra como contenido.
fn is_hidden_library_dir(name: &str) -> bool {
    name.eq_ignore_ascii_case(TECHNICAL_DIR) || name.eq_ignore_ascii_case(CACHE_DIR)
}

fn thumbnail_paths(model: &Path) -> Option<(PathBuf, PathBuf)> {
    let file_name = model.file_name()?.to_str()?;
    let cache = model.parent()?.join(CACHE_DIR);
    Some((
        cache.join(format!("{file_name}{THUMBNAIL_SUFFIX}")),
        cache.join(format!("{file_name}{THUMBNAIL_FAILED_SUFFIX}")),
    ))
}

/// La miniatura guarda la misma fecha que su modelo; si el modelo cambia, deja de coincidir.
fn matches_model_date(cached: &Path, model_modified: i64) -> Option<i64> {
    let metadata = fs::metadata(cached).ok()?;
    let cached_modified = modified_time(&metadata);
    ((cached_modified - model_modified).abs() <= 2 && metadata.len() > 0).then_some(cached_modified)
}

fn thumbnail_state(model: &Path, model_modified: i64) -> (i64, bool) {
    let Some((thumbnail, failed)) = thumbnail_paths(model) else {
        return (0, false);
    };
    match matches_model_date(&thumbnail, model_modified) {
        Some(modified) => (modified, false),
        None => (0, matches_model_date(&failed, model_modified).is_some()),
    }
}

/// `<grupo>\Cargar Nuevo` es una bandeja de entrada: lo que está ahí todavía no forma parte de la
/// biblioteca, así que el escaneo general no lo lista. Como cualquier carpeta de la raíz puede ser
/// un grupo, se reconoce por el nombre.
fn is_import_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(IMPORT_DIR))
}

/// Grupos de la biblioteca: cada carpeta de la raíz, salvo las internas de la app.
fn library_groups(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut groups = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        })
        .filter(|entry| !is_hidden_library_dir(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    groups.sort_by_key(|path| {
        path.file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
    });
    groups
}

fn is_animations_group(group: &Path) -> bool {
    group
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(ANIMATIONS_GROUP))
}

fn group_name(group: &Path) -> String {
    group
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Cada grupo lleva `Categoría`, `Varios` y `Cargar Nuevo`. Se respeta la variante que ya exista
/// (por ejemplo `Categoria` sin tilde) para no crear carpetas duplicadas.
fn ensure_group_structure(root: &Path) {
    for group in library_groups(root) {
        let wanted = [
            category_container(&group),
            existing_child(&group, VARIOS_DIR).unwrap_or_else(|| group.join(VARIOS_DIR)),
            existing_child(&group, IMPORT_DIR).unwrap_or_else(|| group.join(IMPORT_DIR)),
        ];
        for directory in wanted {
            if let Err(error) = fs::create_dir_all(&directory) {
                eprintln!("No se pudo crear {}: {error}", directory.display());
            }
        }
    }
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo preparar la carpeta de datos: {error}"))?;
    Ok(directory.join("biblioteca-3d.sqlite"))
}

fn migrate_legacy_seeded_categories(connection: &Connection) -> Result<(), String> {
    let folder_categories_only = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'folder_categories_only_v1'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if folder_categories_only {
        return Ok(());
    }
    let categories_were_seeded = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE key = 'categories_seeded')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if categories_were_seeded {
        connection
            .execute_batch(
                "UPDATE animation_metadata SET category_id = '';
                 DELETE FROM categories;
                 DELETE FROM settings WHERE key = 'categories_seeded';",
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO settings(key, value) VALUES('folder_categories_only_v1', '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS settings (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS categories (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL UNIQUE,
               section TEXT NOT NULL DEFAULT 'animation',
               sort_order INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS animation_metadata (
               asset_id TEXT PRIMARY KEY,
               game_name TEXT NOT NULL DEFAULT '',
               category_id TEXT NOT NULL DEFAULT '',
               subcategory TEXT NOT NULL DEFAULT '',
               tags TEXT NOT NULL DEFAULT '',
               description TEXT NOT NULL DEFAULT '',
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS category_groups (
               root_path TEXT NOT NULL,
               id TEXT NOT NULL,
               section TEXT NOT NULL,
               name TEXT NOT NULL,
               lower_name TEXT NOT NULL,
               sort_order INTEGER NOT NULL DEFAULT 0,
               collapsed INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY(root_path, id),
               UNIQUE(root_path, section, lower_name)
             );
             CREATE TABLE IF NOT EXISTS physical_category_layout (
               root_path TEXT NOT NULL,
               category_key TEXT NOT NULL,
               section TEXT NOT NULL,
               group_id TEXT NOT NULL DEFAULT '',
               sort_order INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY(root_path, category_key)
             );
",
        )
        .map_err(|error| error.to_string())?;
    let categories_have_section = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('categories') WHERE name = 'section')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if !categories_have_section {
        connection
            .execute(
                "ALTER TABLE categories ADD COLUMN section TEXT NOT NULL DEFAULT 'animation'",
                [],
            )
            .map_err(|error| format!("No se pudo actualizar la tabla de categorías: {error}"))?;
    }
    migrate_legacy_seeded_categories(&connection)?;
    Ok(connection)
}

fn saved_root(app: &AppHandle) -> Result<String, String> {
    open_database(app)?
        .query_row(
            "SELECT value FROM settings WHERE key = 'library_root'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or_default())
        .map_err(|error| error.to_string())
}

fn save_root(app: &AppHandle, root: &Path) -> Result<(), String> {
    open_database(app)?
        .execute(
            "INSERT INTO settings(key, value) VALUES('library_root', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![path_string(root)],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn catalog_data(app: &AppHandle) -> Result<CatalogData, String> {
    let connection = open_database(app)?;
    let mut category_statement = connection
        .prepare(
            "SELECT id, name, section, sort_order FROM categories ORDER BY section, sort_order, name COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let categories = category_statement
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                section: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut metadata_statement = connection
        .prepare(
            "SELECT asset_id, game_name, category_id, subcategory, tags, description
             FROM animation_metadata ORDER BY asset_id",
        )
        .map_err(|error| error.to_string())?;
    let metadata = metadata_statement
        .query_map([], |row| {
            Ok(AnimationMetadata {
                asset_id: row.get(0)?,
                game_name: row.get(1)?,
                category_id: row.get(2)?,
                subcategory: row.get(3)?,
                tags: row.get(4)?,
                description: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(CatalogData {
        categories,
        metadata,
    })
}

fn category_organization_root(app: &AppHandle, root_path: String) -> Result<String, String> {
    let root = validate_root(Path::new(&root_path))?;
    let saved = saved_root(app)?;
    if saved.is_empty() || normalized_path(Path::new(&saved)) != normalized_path(&root) {
        return Err("La organización no corresponde a la biblioteca activa".to_string());
    }
    Ok(normalized_path(&root))
}

fn load_category_organization(
    app: &AppHandle,
    root_key: &str,
) -> Result<CategoryOrganization, String> {
    let connection = open_database(app)?;
    let mut group_statement = connection
        .prepare(
            "SELECT id, section, name, sort_order, collapsed
             FROM category_groups WHERE root_path = ?1
             ORDER BY section, sort_order, name COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let groups = group_statement
        .query_map(params![root_key], |row| {
            Ok(CategoryGroup {
                id: row.get(0)?,
                section: row.get(1)?,
                name: row.get(2)?,
                sort_order: row.get(3)?,
                collapsed: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut category_statement = connection
        .prepare(
            "SELECT category_key, section, group_id, sort_order
             FROM physical_category_layout WHERE root_path = ?1
             ORDER BY section, group_id, sort_order, category_key",
        )
        .map_err(|error| error.to_string())?;
    let categories = category_statement
        .query_map(params![root_key], |row| {
            Ok(PhysicalCategoryLayout {
                category_key: row.get(0)?,
                section: row.get(1)?,
                group_id: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(CategoryOrganization { groups, categories })
}

#[tauri::command]
fn get_category_organization(
    app: AppHandle,
    root_path: String,
) -> Result<CategoryOrganization, String> {
    let root_key = category_organization_root(&app, root_path)?;
    load_category_organization(&app, &root_key)
}

#[tauri::command]
fn save_category_organization(
    app: AppHandle,
    root_path: String,
    organization: CategoryOrganization,
) -> Result<CategoryOrganization, String> {
    let root_key = category_organization_root(&app, root_path)?;
    let mut group_sections = HashMap::new();
    let mut group_names = HashSet::new();
    let mut clean_groups = Vec::new();
    for group in organization.groups {
        let id = clean_field(group.id, 100, "El identificador del grupo")?;
        let name = clean_field(group.name, 60, "El nombre del grupo")?;
        if id.is_empty() || name.is_empty() {
            return Err("Cada grupo necesita identificador y nombre".to_string());
        }
        if !is_valid_section(&group.section) {
            return Err("La sección del grupo no es válida".to_string());
        }
        if group_sections
            .insert(id.clone(), group.section.clone())
            .is_some()
        {
            return Err("Hay grupos repetidos".to_string());
        }
        let lower_name = name.to_lowercase();
        if !group_names.insert(format!("{}:{lower_name}", group.section)) {
            return Err("Ya existe un grupo con ese nombre en la sección".to_string());
        }
        clean_groups.push((CategoryGroup { id, name, ..group }, lower_name));
    }
    let mut category_keys = HashSet::new();
    let mut clean_categories = Vec::new();
    for category in organization.categories {
        let category_key = clean_field(category.category_key, 180, "La clave de categoría")?;
        let group_id = clean_field(category.group_id, 100, "El grupo de categoría")?;
        if !is_valid_section(&category.section) {
            return Err("La sección de categoría no es válida".to_string());
        }
        if !category_key.starts_with(&format!("{}:", category.section))
            && !category_key.starts_with("manual:")
        {
            return Err("La clave de categoría no coincide con su sección".to_string());
        }
        if !category_keys.insert(category_key.clone()) {
            return Err("Hay categorías repetidas en la organización".to_string());
        }
        if !group_id.is_empty() && group_sections.get(&group_id) != Some(&category.section) {
            return Err("El grupo no pertenece a la misma sección que la categoría".to_string());
        }
        clean_categories.push(PhysicalCategoryLayout {
            category_key,
            group_id,
            ..category
        });
    }

    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM physical_category_layout WHERE root_path = ?1",
            params![&root_key],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM category_groups WHERE root_path = ?1",
            params![&root_key],
        )
        .map_err(|error| error.to_string())?;
    for (group, lower_name) in clean_groups {
        transaction
            .execute(
                "INSERT INTO category_groups(root_path, id, section, name, lower_name, sort_order, collapsed)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![&root_key, group.id, group.section, group.name, lower_name, group.sort_order, i64::from(group.collapsed)],
            )
            .map_err(|error| format!("No se pudo guardar el grupo: {error}"))?;
    }
    for category in clean_categories {
        transaction
            .execute(
                "INSERT INTO physical_category_layout(root_path, category_key, section, group_id, sort_order)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                params![&root_key, category.category_key, category.section, category.group_id, category.sort_order],
            )
            .map_err(|error| format!("No se pudo guardar el orden de categorías: {error}"))?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    load_category_organization(&app, &root_key)
}

/// Secciones = grupos: "piece" (Piezas), "animation" (Animaciones) o "group:<carpeta>" para los demás.
fn is_valid_section(section: &str) -> bool {
    section == "piece"
        || section == "animation"
        || section
            .strip_prefix("group:")
            .is_some_and(|name| !name.trim().is_empty() && name.chars().count() <= 120)
}

fn clean_field(value: String, maximum: usize, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.chars().count() > maximum {
        return Err(format!("{label} supera el máximo de {maximum} caracteres"));
    }
    Ok(value)
}

#[tauri::command]
fn save_category(
    app: AppHandle,
    category_id: String,
    name: String,
    section: String,
) -> Result<CatalogData, String> {
    let name = clean_field(name, 60, "El nombre de la categoria")?;
    if name.is_empty() {
        return Err("La categoria necesita un nombre".to_string());
    }
    let category_id = clean_field(category_id, 80, "El identificador de categoria")?;
    let section = clean_field(section, 130, "La sección de la categoría")?;
    if !is_valid_section(&section) {
        return Err("La sección de la categoría no es válida".to_string());
    }
    let connection = open_database(&app)?;
    if category_id.is_empty() {
        let mut hash = Sha256::new();
        hash.update(format!("{}:{}", name.to_lowercase(), now()).as_bytes());
        let id = format!("custom-{:x}", hash.finalize())
            .chars()
            .take(24)
            .collect::<String>();
        let next_order = connection
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE section = ?1",
                params![&section],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO categories(id, name, section, sort_order) VALUES(?1, ?2, ?3, ?4)",
                params![id, name, section, next_order],
            )
            .map_err(|error| format!("No se pudo crear la categoria: {error}"))?;
    } else {
        let changed = connection
            .execute(
                "UPDATE categories SET name = ?2, section = ?3 WHERE id = ?1",
                params![category_id, name, section],
            )
            .map_err(|error| format!("No se pudo renombrar la categoria: {error}"))?;
        if changed == 0 {
            return Err("La categoria ya no existe".to_string());
        }
    }
    catalog_data(&app)
}

#[tauri::command]
fn delete_category(app: AppHandle, category_id: String) -> Result<CatalogData, String> {
    let category_id = clean_field(category_id, 80, "El identificador de categoria")?;
    if category_id.is_empty() {
        return Err("La categoria no es valida".to_string());
    }
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE animation_metadata SET category_id = '' WHERE category_id = ?1",
            params![&category_id],
        )
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "DELETE FROM categories WHERE id = ?1",
            params![&category_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("La categoria ya no existe".to_string());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    catalog_data(&app)
}

#[tauri::command]
fn reorder_categories(app: AppHandle, category_ids: Vec<String>) -> Result<CatalogData, String> {
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (index, category_id) in category_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE categories SET sort_order = ?2 WHERE id = ?1",
                params![category_id, (index as i64 + 1) * 10],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    catalog_data(&app)
}

fn validate_entry_name(value: String) -> Result<String, String> {
    let value = clean_field(value, 180, "El nombre")?;
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains(':')
        || value.contains('*')
        || value.contains('?')
        || value.contains('"')
        || value.contains('<')
        || value.contains('>')
        || value.contains('|')
    {
        return Err("El nombre contiene caracteres no permitidos por Windows".to_string());
    }
    Ok(value)
}

fn migrate_metadata_id(app: &AppHandle, old_id: &str, new_id: &str) -> Result<(), String> {
    if old_id == new_id {
        return Ok(());
    }
    open_database(app)?
        .execute(
            "UPDATE OR REPLACE animation_metadata SET asset_id = ?2 WHERE asset_id = ?1",
            params![old_id, new_id],
        )
        .map_err(|error| {
            format!("El archivo cambio, pero no se pudo migrar su metadata: {error}")
        })?;
    Ok(())
}

fn validate_root(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!(
            "La carpeta no existe o la unidad no está conectada: {}",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!(
            "La ubicación elegida no es una carpeta: {}",
            path.display()
        ));
    }
    fs::read_dir(path).map_err(|error| format!("Windows no permite leer esta carpeta: {error}"))?;
    path.canonicalize()
        .map_err(|error| format!("No se pudo resolver la carpeta: {error}"))
}

fn resolve_inside_root(app: &AppHandle, candidate: &Path) -> Result<(PathBuf, PathBuf), String> {
    let root_value = saved_root(app)?;
    if root_value.is_empty() {
        return Err("Todavía no hay una biblioteca elegida".to_string());
    }
    let root = validate_root(Path::new(&root_value))?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("La ruta ya no está disponible: {error}"))?;
    let root_key = normalized_path(&root);
    let candidate_key = normalized_path(&resolved);
    if candidate_key != root_key && !candidate_key.starts_with(&format!("{root_key}/")) {
        return Err("La ruta solicitada está fuera de la biblioteca activa".to_string());
    }
    Ok((root, resolved))
}

fn collect_assets(root: &Path) -> Vec<AnimationAsset> {
    let mut animations = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(is_allowed_entry)
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() || !is_animation(entry.path()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        animations.push(build_asset(root, entry.path(), &metadata));
    }
    animations.sort_by_key(|animation| animation.name.to_lowercase());
    animations
}

fn build_asset(root: &Path, path: &Path, metadata: &fs::Metadata) -> AnimationAsset {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("archivo")
        .to_string();
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Sin nombre")
        .to_string();
    let relative_path = path
        .strip_prefix(root)
        .map(path_string)
        .unwrap_or_else(|_| file_name.clone());
    let modified = modified_time(metadata);
    let (thumbnail_modified, thumbnail_failed) = thumbnail_state(path, modified);
    AnimationAsset {
        id: stable_id(path),
        name,
        file_name,
        path: path_string(path),
        relative_path,
        directory: path
            .parent()
            .map(path_string)
            .unwrap_or_else(|| path_string(root)),
        format: extension(path),
        size: metadata.len(),
        modified,
        thumbnail_modified,
        thumbnail_failed,
    }
}

fn build_folder_node(root: &Path, directory: &Path) -> Result<FolderNode, String> {
    let mut children = Vec::new();
    let mut direct_count = 0usize;
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("No se pudo leer {}: {error}", directory.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(is_hidden_library_dir)
            || is_import_dir(&path)
        {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() && !file_type.is_symlink() {
            if let Ok(child) = build_folder_node(root, &path) {
                children.push(child);
            }
        } else if file_type.is_file() && is_animation(&path) {
            direct_count += 1;
        }
    }
    children.sort_by_key(|child| child.name.to_lowercase());
    let animation_count = direct_count
        + children
            .iter()
            .map(|child| child.animation_count)
            .sum::<usize>();
    Ok(FolderNode {
        name: directory
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Biblioteca")
            .to_string(),
        path: path_string(directory),
        relative_path: directory
            .strip_prefix(root)
            .map(path_string)
            .unwrap_or_default(),
        children,
        animation_count,
    })
}

fn build_snapshot(root: &Path) -> Result<LibrarySnapshot, String> {
    let animations = collect_assets(root);
    let folders = build_folder_node(root, root)?.children;
    Ok(LibrarySnapshot {
        root_path: path_string(root),
        folders,
        animations,
        scanned_at: now(),
    })
}

fn ensure_library_structure(root: &Path) -> Result<(), String> {
    for segments in LIBRARY_STRUCTURE {
        let mut directory = root.to_path_buf();
        for segment in *segments {
            directory.push(segment);
        }
        fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "No se pudo crear la estructura {}: {error}",
                directory.display()
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
fn prepare_library_structure(root_path: String) -> Result<(), String> {
    let root = validate_root(Path::new(&root_path))?;
    ensure_library_structure(&root)
}

/// Busca un hijo sin distinguir mayúsculas, como hace Windows, para respetar el nombre ya existente.
fn existing_child(directory: &Path, name: &str) -> Option<PathBuf> {
    let wanted = name.to_lowercase();
    fs::read_dir(directory)
        .ok()?
        .flatten()
        .find(|entry| entry.file_name().to_string_lossy().to_lowercase() == wanted)
        .map(|entry| entry.path())
}

fn category_container(section_dir: &Path) -> PathBuf {
    ["Categoría", "Categorías", "Categoria", "Categorias"]
        .iter()
        .map(|name| section_dir.join(name))
        .find(|path| path.is_dir())
        .unwrap_or_else(|| section_dir.join("Categoría"))
}

/// Un archivo está listo cuando nadie más lo tiene abierto: mientras Windows lo copia, la apertura
/// exclusiva falla.
fn is_file_ready(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .is_ok()
    }
    #[cfg(not(windows))]
    {
        fs::File::open(path).is_ok()
    }
}

fn is_windows_leftover(name: &str) -> bool {
    name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db")
}

/// Rutas relativas de todo lo que hay que mover (no solo los modelos: los GLTF necesitan sus
/// `.bin` y texturas al lado).
fn collect_import_files(source: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(source).follow_links(false).min_depth(1) {
        let entry = entry
            .map_err(|error| format!("No se pudo leer el contenido de la carpeta: {error}"))?;
        if entry.file_type().is_dir() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|_| "Se encontró una ruta inesperada dentro de la carpeta".to_string())?;
        files.push(relative.to_path_buf());
    }
    files.sort();
    Ok(files)
}

fn describe_paths(paths: &[&PathBuf]) -> String {
    let listed = paths
        .iter()
        .take(4)
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    if paths.len() > 4 {
        format!("{listed} y {} más", paths.len() - 4)
    } else {
        listed
    }
}

/// Mueve archivo por archivo dentro de una categoría existente. Si algo falla a mitad de camino,
/// devuelve lo ya movido a su lugar para que la carpeta no quede partida en dos.
fn merge_import_files(
    source: &Path,
    target: &Path,
    files: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for relative in files {
        let from = source.join(relative);
        let to = target.join(relative);
        let result = if to.exists() {
            Err(format!(
                "apareció {} en la categoría mientras se cargaba",
                relative.display()
            ))
        } else {
            to.parent()
                .map_or(Ok(()), fs::create_dir_all)
                .and_then(|_| fs::rename(&from, &to))
                .map_err(|error| format!("no se pudo mover {}: {error}", relative.display()))
        };
        if let Err(reason) = result {
            for (original, current) in moved.iter().rev() {
                let _ = fs::rename(current, original);
            }
            return Err(format!(
                "No se movió nada: {reason}. Lo que ya se había movido volvió a Cargar Nuevo"
            ));
        }
        moved.push((from, to));
    }
    for entry in WalkDir::new(source)
        .contents_first(true)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() {
            let _ = fs::remove_dir(entry.path());
        }
    }
    Ok(moved.into_iter().map(|(_, to)| to).collect())
}

fn import_folder(root: &Path, section_dir: &Path, source: &Path) -> Result<ImportOutcome, String> {
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or("El nombre de la carpeta no es válido")?;
    if name.trim().is_empty() || name.eq_ignore_ascii_case(TECHNICAL_DIR) {
        return Err("Este nombre de carpeta no puede usarse como categoría".to_string());
    }
    let files = collect_import_files(source)?;
    if files.is_empty() {
        return Err("La carpeta está vacía. Se cargará cuando lleguen los archivos".to_string());
    }
    if !files.iter().any(|file| is_animation(file)) {
        return Err("La carpeta no tiene archivos FBX, GLB ni GLTF".to_string());
    }
    if let Some(busy) = files.iter().find(|file| !is_file_ready(&source.join(file))) {
        return Ok(ImportOutcome::Waiting(format!(
            "Esperando que termine de copiarse {}",
            busy.display()
        )));
    }

    let container = category_container(section_dir);
    fs::create_dir_all(&container)
        .map_err(|error| format!("No se pudo preparar la carpeta Categoría: {error}"))?;
    let existing = existing_child(&container, &name);
    let merged = existing.is_some();
    let target = existing.unwrap_or_else(|| container.join(&name));
    let moved = if merged {
        if !target.is_dir() {
            return Err(format!(
                "Ya existe un archivo llamado “{name}” dentro de Categoría"
            ));
        }
        let conflicts = files
            .iter()
            .filter(|file| {
                target.join(file).exists()
                    || file.ancestors().skip(1).any(|folder| {
                        !folder.as_os_str().is_empty() && target.join(folder).is_file()
                    })
            })
            .collect::<Vec<_>>();
        if !conflicts.is_empty() {
            return Err(format!(
                "No se movió nada: la categoría ya tiene {}",
                describe_paths(&conflicts)
            ));
        }
        merge_import_files(source, &target, &files)?
    } else {
        if let Err(error) = fs::rename(source, &target) {
            return Ok(ImportOutcome::Waiting(format!(
                "Windows todavía está usando la carpeta ({error})"
            )));
        }
        files.iter().map(|file| target.join(file)).collect()
    };

    let mut assets = moved
        .iter()
        .filter(|path| is_animation(path))
        .filter_map(|path| {
            fs::metadata(path)
                .ok()
                .map(|metadata| build_asset(root, path, &metadata))
        })
        .collect::<Vec<_>>();
    assets.sort_by_key(|asset| asset.name.to_lowercase());
    Ok(ImportOutcome::Imported(ImportedFolder {
        category_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&name)
            .to_string(),
        name,
        group_name: group_name(section_dir),
        animation: is_animations_group(section_dir),
        merged,
        assets,
    }))
}

fn import_dir_of(group: &Path) -> PathBuf {
    existing_child(group, IMPORT_DIR).unwrap_or_else(|| group.join(IMPORT_DIR))
}

/// Revisa únicamente las carpetas `Cargar Nuevo` de cada grupo; nunca recorre el resto de la biblioteca.
fn process_pending_imports(root: &Path) -> ImportReport {
    let mut report = ImportReport {
        root_path: path_string(root),
        ..ImportReport::default()
    };
    for section_dir in library_groups(root) {
        let group = group_name(&section_dir);
        let import_dir = import_dir_of(&section_dir);
        if let Err(error) = fs::create_dir_all(&import_dir) {
            report.pending.push(PendingImport {
                group_name: group,
                name: IMPORT_DIR.to_string(),
                reason: format!("No se pudo preparar la carpeta: {error}"),
                waiting: false,
            });
            continue;
        }
        let Ok(entries) = fs::read_dir(&import_dir) else {
            continue;
        };
        let mut entries = entries.flatten().collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                if !is_windows_leftover(&name) {
                    report.pending.push(PendingImport {
                        group_name: group.clone(),
                        name,
                        reason: "Archivo suelto: ponelo dentro de una carpeta con el nombre de la categoría".to_string(),
                        waiting: false,
                    });
                }
                continue;
            }
            match import_folder(root, &section_dir, &path) {
                Ok(ImportOutcome::Imported(folder)) => report.imported.push(folder),
                Ok(ImportOutcome::Waiting(reason)) => report.pending.push(PendingImport {
                    group_name: group.clone(),
                    name,
                    reason,
                    waiting: true,
                }),
                Err(reason) => report.pending.push(PendingImport {
                    group_name: group.clone(),
                    name,
                    reason,
                    waiting: false,
                }),
            }
        }
    }
    report
}

fn run_import_loop(app: AppHandle, root: PathBuf, changes: mpsc::Receiver<()>) {
    // La primera pasada procesa lo que haya quedado pendiente con la app cerrada.
    let mut due = Some(Instant::now() + IMPORT_QUIET);
    let mut last_pending: Vec<PendingImport> = Vec::new();
    loop {
        let wait = due
            .map(|at| at.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3600));
        match changes.recv_timeout(wait) {
            Ok(()) => {
                due = Some(Instant::now() + IMPORT_QUIET);
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if due.is_none_or(|at| Instant::now() < at) {
            continue;
        }
        let report = process_pending_imports(&root);
        due = report
            .pending
            .iter()
            .any(|item| item.waiting)
            .then(|| Instant::now() + IMPORT_RETRY);
        if !report.imported.is_empty() || report.pending != last_pending {
            last_pending = report.pending.clone();
            let _ = app.emit(IMPORT_EVENT, &report);
        }
    }
}

fn start_import_watcher(app: AppHandle, root: PathBuf) -> Result<RecommendedWatcher, String> {
    let (sender, receiver) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = sender.send(());
        }
    })
    .map_err(|error| format!("No se pudo crear el vigilante: {error}"))?;
    for group in library_groups(&root) {
        let import_dir = import_dir_of(&group);
        fs::create_dir_all(&import_dir)
            .map_err(|error| format!("No se pudo crear {}: {error}", import_dir.display()))?;
        watcher
            .watch(&import_dir, RecursiveMode::Recursive)
            .map_err(|error| format!("No se pudo vigilar {}: {error}", import_dir.display()))?;
    }
    std::thread::spawn(move || run_import_loop(app, root, receiver));
    Ok(watcher)
}

/// Deja un único vigilante apuntado a la biblioteca activa. Si cambia la biblioteca o aparece un
/// grupo nuevo en la raíz, el anterior se descarta (su hilo termina solo) y se arma otro.
fn ensure_import_watcher(app: &AppHandle, root: &Path) {
    let state = app.state::<ImportWatcherState>();
    let mut active = state
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root_key = std::iter::once(normalized_path(root))
        .chain(
            library_groups(root)
                .iter()
                .map(|group| normalized_path(group)),
        )
        .collect::<Vec<_>>()
        .join("|");
    if active
        .as_ref()
        .is_some_and(|watcher| watcher.root_key == root_key)
    {
        return;
    }
    *active = None;
    match start_import_watcher(app.clone(), root.to_path_buf()) {
        Ok(watcher) => {
            *active = Some(ActiveImportWatcher {
                root_key,
                _watcher: watcher,
            })
        }
        Err(reason) => {
            let _ = app.emit(
                IMPORT_EVENT,
                ImportReport {
                    root_path: path_string(root),
                    imported: Vec::new(),
                    pending: vec![PendingImport {
                        group_name: String::new(),
                        name: IMPORT_DIR.to_string(),
                        reason,
                        waiting: false,
                    }],
                },
            );
        }
    }
}

#[tauri::command]
fn open_import_folder(app: AppHandle, group: String) -> Result<(), String> {
    let root_value = saved_root(&app)?;
    if root_value.is_empty() {
        return Err("Todavía no hay una biblioteca elegida".to_string());
    }
    let root = validate_root(Path::new(&root_value))?;
    let group = validate_entry_name(group)?;
    let group_dir = existing_child(&root, &group)
        .filter(|path| path.is_dir() && !is_hidden_library_dir(&group))
        .ok_or_else(|| format!("No existe el grupo {group} en la biblioteca"))?;
    let import_dir = import_dir_of(&group_dir);
    fs::create_dir_all(&import_dir)
        .map_err(|error| format!("No se pudo crear la carpeta Cargar Nuevo: {error}"))?;
    let explorer_path = plain_path(&import_dir);
    Command::new("explorer.exe")
        .arg(&explorer_path)
        .spawn()
        .map_err(|error| format!("No se pudo abrir la carpeta: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_initial_state(app: AppHandle) -> Result<LibrarySnapshot, String> {
    let saved = saved_root(&app)?;
    let root = if saved.is_empty() && Path::new(DEFAULT_LIBRARY_ROOT).is_dir() {
        let default_root = validate_root(Path::new(DEFAULT_LIBRARY_ROOT))?;
        save_root(&app, &default_root)?;
        path_string(&default_root)
    } else {
        saved
    };
    if root.is_empty() || !Path::new(&root).is_dir() {
        return Ok(LibrarySnapshot {
            root_path: root,
            folders: Vec::new(),
            animations: Vec::new(),
            scanned_at: 0,
        });
    }
    let root = validate_root(Path::new(&root))?;
    ensure_group_structure(&root);
    let snapshot = build_snapshot(&root)?;
    allow_library_assets(&app, &root);
    ensure_import_watcher(&app, &root);
    Ok(snapshot)
}

#[tauri::command]
fn get_catalog_data(app: AppHandle) -> Result<CatalogData, String> {
    catalog_data(&app)
}

#[tauri::command]
fn save_animation_metadata(
    app: AppHandle,
    metadata: AnimationMetadata,
) -> Result<AnimationMetadata, String> {
    let cleaned = AnimationMetadata {
        asset_id: clean_field(metadata.asset_id, 128, "El identificador")?,
        game_name: clean_field(metadata.game_name, 120, "El nombre para juego")?,
        category_id: clean_field(metadata.category_id, 80, "La categoría")?,
        subcategory: clean_field(metadata.subcategory, 80, "La subcategoría")?,
        tags: clean_field(metadata.tags, 400, "Las etiquetas")?,
        description: clean_field(metadata.description, 2_000, "La descripción")?,
    };
    if cleaned.asset_id.is_empty() {
        return Err("La animación no tiene un identificador válido".to_string());
    }
    let connection = open_database(&app)?;
    if !cleaned.category_id.is_empty() {
        let exists = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1)",
                params![&cleaned.category_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Err("La categoría elegida ya no existe".to_string());
        }
    }
    connection
        .execute(
            "INSERT INTO animation_metadata(
               asset_id, game_name, category_id, subcategory, tags, description, updated_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(asset_id) DO UPDATE SET
               game_name = excluded.game_name,
               category_id = excluded.category_id,
               subcategory = excluded.subcategory,
               tags = excluded.tags,
               description = excluded.description,
               updated_at = excluded.updated_at",
            params![
                &cleaned.asset_id,
                &cleaned.game_name,
                &cleaned.category_id,
                &cleaned.subcategory,
                &cleaned.tags,
                &cleaned.description,
                now()
            ],
        )
        .map_err(|error| format!("No se pudieron guardar los metadatos: {error}"))?;
    Ok(cleaned)
}

#[tauri::command]
fn export_catalog(app: AppHandle) -> Result<String, String> {
    let root_value = saved_root(&app)?;
    let root = validate_root(Path::new(&root_value))?;
    let snapshot = build_snapshot(&root)?;
    let catalog = catalog_data(&app)?;
    let metadata_by_id = catalog
        .metadata
        .iter()
        .map(|item| (item.asset_id.as_str(), item))
        .collect::<HashMap<_, _>>();
    let animations = snapshot
        .animations
        .iter()
        .map(|asset| {
            let metadata = metadata_by_id.get(asset.id.as_str());
            serde_json::json!({
                "id": asset.id,
                "fileName": asset.file_name,
                "relativePath": asset.relative_path,
                "format": asset.format,
                "gameName": metadata.map(|item| item.game_name.as_str()).unwrap_or(""),
                "categoryId": metadata.map(|item| item.category_id.as_str()).unwrap_or(""),
                "subcategory": metadata.map(|item| item.subcategory.as_str()).unwrap_or(""),
                "tags": metadata.map(|item| item.tags.as_str()).unwrap_or(""),
                "description": metadata.map(|item| item.description.as_str()).unwrap_or("")
            })
        })
        .collect::<Vec<_>>();
    let document = serde_json::json!({
        "schemaVersion": 1,
        "applicationVersion": env!("CARGO_PKG_VERSION"),
        "generatedAt": now(),
        "root": path_string(&root),
        "categories": catalog.categories,
        "animations": animations
    });
    let technical = root.join(TECHNICAL_DIR);
    fs::create_dir_all(&technical)
        .map_err(|error| format!("No se pudo preparar la carpeta tecnica: {error}"))?;
    let output = technical.join(format!("animations-v{}.json", env!("CARGO_PKG_VERSION")));
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| format!("No se pudo generar el JSON: {error}"))?;
    fs::write(&output, bytes)
        .map_err(|error| format!("No se pudo escribir el catalogo: {error}"))?;
    Ok(path_string(&output))
}

#[tauri::command]
fn create_database_backup(app: AppHandle) -> Result<String, String> {
    let source = database_path(&app)?;
    if !source.is_file() {
        return Err("Todavia no existe una base de datos para respaldar".to_string());
    }
    let backup_directory = source
        .parent()
        .ok_or("La base de datos no tiene carpeta")?
        .join("backups");
    fs::create_dir_all(&backup_directory)
        .map_err(|error| format!("No se pudo preparar la carpeta de respaldos: {error}"))?;
    let target = backup_directory.join(format!(
        "biblioteca-3d-backup-v{}-{}.sqlite",
        env!("CARGO_PKG_VERSION"),
        now()
    ));
    fs::copy(&source, &target).map_err(|error| format!("No se pudo crear el respaldo: {error}"))?;
    Ok(path_string(&target))
}

#[tauri::command]
fn get_diagnostics(app: AppHandle) -> Result<Diagnostics, String> {
    let library_root = saved_root(&app)?;
    let root = PathBuf::from(&library_root);
    let library_available = root.is_dir();
    let animations = if library_available {
        build_snapshot(&validate_root(&root)?)?.animations.len()
    } else {
        0
    };
    let catalog = catalog_data(&app)?;
    Ok(Diagnostics {
        version: env!("CARGO_PKG_VERSION").to_string(),
        database_path: path_string(&database_path(&app)?),
        library_root,
        library_available,
        animations,
        categories: catalog.categories.len(),
        metadata: catalog.metadata.len(),
    })
}

#[tauri::command]
fn restore_database_backup(app: AppHandle, backup_path: String) -> Result<CatalogData, String> {
    let backup_path = PathBuf::from(backup_path);
    if !backup_path.is_file() {
        return Err("El respaldo seleccionado no existe".to_string());
    }
    let extension = backup_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "sqlite" && extension != "db" {
        return Err("El archivo seleccionado no es un respaldo SQLite".to_string());
    }

    let backup_path = backup_path
        .canonicalize()
        .map_err(|error| format!("No se pudo validar el respaldo: {error}"))?;
    let active_path = database_path(&app)?;
    if active_path
        .canonicalize()
        .ok()
        .is_some_and(|path| path == backup_path)
    {
        return Err("Selecciona una copia distinta de la base activa".to_string());
    }

    let source = Connection::open_with_flags(&backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("No se pudo abrir el respaldo: {error}"))?;
    let integrity = source
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("No se pudo comprobar el respaldo: {error}"))?;
    if integrity != "ok" {
        return Err(format!("El respaldo esta danado: {integrity}"));
    }
    for table in ["settings", "categories", "animation_metadata"] {
        let exists = source
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                params![table],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("No se pudo comprobar la estructura: {error}"))?;
        if !exists {
            return Err(format!(
                "El respaldo no contiene la tabla requerida: {table}"
            ));
        }
    }

    let safety_copy = create_database_backup(app.clone())?;
    let mut destination = open_database(&app)?;
    {
        let backup = Backup::new(&source, &mut destination)
            .map_err(|error| format!("No se pudo iniciar la restauracion: {error}"))?;
        backup
            .run_to_completion(8, Duration::from_millis(10), None)
            .map_err(|error| format!("No se pudo restaurar la base: {error}"))?;
    }
    drop(destination);
    open_database(&app)?;
    let restored = catalog_data(&app)?;
    eprintln!("Copia previa a la restauracion: {safety_copy}");
    Ok(restored)
}

#[tauri::command]
async fn scan_library(app: AppHandle, root_path: String) -> Result<LibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validate_root(Path::new(&root_path))?;
        ensure_group_structure(&root);
        let snapshot = build_snapshot(&root)?;
        save_root(&app, &root)?;
        allow_library_assets(&app, &root);
        ensure_import_watcher(&app, &root);
        Ok(snapshot)
    })
    .await
    .map_err(|error| format!("El escaneo se interrumpió: {error}"))?
}

#[tauri::command]
fn list_folder(app: AppHandle, path: String) -> Result<FolderContents, String> {
    let (root, directory) = resolve_inside_root(&app, Path::new(&path))?;
    if !directory.is_dir() {
        return Err("La ruta solicitada no es una carpeta".to_string());
    }
    let mut entries = Vec::new();
    for item in
        fs::read_dir(&directory).map_err(|error| format!("No se pudo abrir la carpeta: {error}"))?
    {
        let Ok(item) = item else { continue };
        let item_path = item.path();
        if item_path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(is_hidden_library_dir)
        {
            continue;
        }
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let metadata = item.metadata().ok();
        let kind = if file_type.is_dir() {
            "folder"
        } else if is_animation(&item_path) {
            "animation"
        } else {
            "file"
        };
        entries.push(FolderEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: path_string(&item_path),
            relative_path: item_path
                .strip_prefix(&root)
                .map(path_string)
                .unwrap_or_default(),
            kind: kind.to_string(),
            extension: if file_type.is_dir() {
                String::new()
            } else {
                format!(".{}", extension(&item_path))
            },
            size: metadata.as_ref().map(fs::Metadata::len).unwrap_or(0),
            modified: metadata.as_ref().map(modified_time).unwrap_or(0),
        });
    }
    entries.sort_by(|left, right| {
        let left_rank = if left.kind == "folder" { 0 } else { 1 };
        let right_rank = if right.kind == "folder" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(FolderContents {
        path: path_string(&directory),
        relative_path: directory
            .strip_prefix(&root)
            .map(path_string)
            .unwrap_or_default(),
        entries,
    })
}

#[tauri::command]
fn create_folder(
    app: AppHandle,
    parent_path: String,
    name: String,
) -> Result<FolderContents, String> {
    let (_, parent) = resolve_inside_root(&app, Path::new(&parent_path))?;
    if !parent.is_dir() {
        return Err("La ubicacion elegida no es una carpeta".to_string());
    }
    let name = validate_entry_name(name)?;
    let target = parent.join(name);
    if target.exists() {
        return Err("Ya existe un archivo o carpeta con ese nombre".to_string());
    }
    fs::create_dir(&target).map_err(|error| format!("No se pudo crear la carpeta: {error}"))?;
    list_folder(app, parent_path)
}

#[tauri::command]
fn rename_asset(app: AppHandle, path: String, new_name: String) -> Result<FileMutation, String> {
    let (_, source) = resolve_inside_root(&app, Path::new(&path))?;
    if !source.is_file() || !is_animation(&source) {
        return Err("Solo se pueden renombrar animaciones desde esta accion".to_string());
    }
    let new_name = validate_entry_name(new_name)?;
    let old_extension = extension(&source);
    if extension(Path::new(&new_name)) != old_extension {
        return Err(format!(
            "El nombre debe conservar la extension .{old_extension}"
        ));
    }
    let target = source
        .parent()
        .ok_or("El archivo no tiene carpeta")?
        .join(new_name);
    if target.exists() {
        return Err("Ya existe una animacion con ese nombre".to_string());
    }
    let old_id = stable_id(&source);
    fs::rename(&source, &target)
        .map_err(|error| format!("No se pudo renombrar la animacion: {error}"))?;
    let new_id = stable_id(&target);
    migrate_metadata_id(&app, &old_id, &new_id)?;
    Ok(FileMutation {
        old_id,
        new_id,
        new_path: path_string(&target),
    })
}

#[tauri::command]
fn copy_asset(app: AppHandle, path: String, destination: String) -> Result<FileMutation, String> {
    let (_, source) = resolve_inside_root(&app, Path::new(&path))?;
    let (_, destination) = resolve_inside_root(&app, Path::new(&destination))?;
    if !source.is_file() || !is_animation(&source) || !destination.is_dir() {
        return Err("El origen o el destino no son validos".to_string());
    }
    if extension(&source) == "gltf" {
        return Err("Para evitar romper dependencias compartidas, la copia fisica de GLTF queda bloqueada; usa GLB, FBX o una carpeta autocontenida".to_string());
    }
    let file_name = source.file_name().ok_or("El archivo no tiene nombre")?;
    let target = destination.join(file_name);
    if target.exists() {
        return Err("Ya existe un archivo con ese nombre en el destino".to_string());
    }
    fs::copy(&source, &target)
        .map_err(|error| format!("No se pudo copiar la animacion: {error}"))?;
    Ok(FileMutation {
        old_id: stable_id(&source),
        new_id: stable_id(&target),
        new_path: path_string(&target),
    })
}

#[tauri::command]
fn move_asset(app: AppHandle, path: String, destination: String) -> Result<FileMutation, String> {
    let (_, source) = resolve_inside_root(&app, Path::new(&path))?;
    let (_, destination) = resolve_inside_root(&app, Path::new(&destination))?;
    if !source.is_file() || !is_animation(&source) || !destination.is_dir() {
        return Err("El origen o el destino no son validos".to_string());
    }
    if extension(&source) == "gltf" {
        return Err("Para evitar romper dependencias compartidas, mueve la carpeta autocontenida del GLTF desde Windows".to_string());
    }
    let target = destination.join(source.file_name().ok_or("El archivo no tiene nombre")?);
    if target.exists() {
        return Err("Ya existe un archivo con ese nombre en el destino".to_string());
    }
    let old_id = stable_id(&source);
    fs::rename(&source, &target)
        .map_err(|error| format!("No se pudo mover la animacion: {error}"))?;
    let new_id = stable_id(&target);
    migrate_metadata_id(&app, &old_id, &new_id)?;
    Ok(FileMutation {
        old_id,
        new_id,
        new_path: path_string(&target),
    })
}

/// Ruta sin el prefijo `\\?\` que agrega `canonicalize`, tal como la entiende el visor web.
fn plain_path(path: &Path) -> String {
    let value = path_string(path);
    match value.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => value,
    }
}

/// Carpeta desde donde buscar texturas de un FBX: la suya y hasta dos niveles arriba, sin salir
/// de la carpeta de la categoría (`Piezas\Categoría\<nombre>`).
fn texture_search_base(root: &Path, model: &Path) -> PathBuf {
    let mut base = model.parent().unwrap_or(root).to_path_buf();
    for _ in 0..2 {
        let Some(parent) = base.parent() else { break };
        let depth = parent
            .strip_prefix(root)
            .map(|relative| relative.components().count())
            .unwrap_or(0);
        if depth < 3 {
            break;
        }
        base = parent.to_path_buf();
    }
    base
}

/// Imágenes que hay alrededor de un FBX. Muchos FBX guardan la textura con la ruta de la
/// computadora del autor; con esta lista el visor la encuentra por nombre en las carpetas vecinas.
fn nearby_textures(root: &Path, model: &Path) -> Vec<String> {
    let mut images = Vec::new();
    for entry in WalkDir::new(texture_search_base(root, model))
        .follow_links(false)
        .max_depth(5)
        .into_iter()
        .filter_entry(is_allowed_entry)
        .take(MAX_TEXTURE_SEARCH_ENTRIES)
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file()
            && TEXTURE_EXTENSIONS.contains(&extension(entry.path()).as_str())
        {
            images.push(plain_path(entry.path()));
            if images.len() >= MAX_TEXTURE_CANDIDATES {
                break;
            }
        }
    }
    images
}

/// Entre las imágenes cercanas con el mismo nombre de archivo, la que comparte más carpetas con el modelo.
fn closest_texture(
    wanted: &Path,
    model_directory: &Path,
    candidates: &[String],
) -> Option<PathBuf> {
    let name = wanted.file_name()?.to_str()?.to_lowercase();
    let directory = plain_path(model_directory)
        .replace('\\', "/")
        .to_lowercase();
    let shared_prefix = |candidate: &str| {
        let candidate = candidate.replace('\\', "/").to_lowercase();
        candidate
            .split('/')
            .zip(directory.split('/'))
            .take_while(|(left, right)| left == right)
            .count()
    };
    candidates
        .iter()
        .filter(|candidate| {
            Path::new(candidate)
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|file| file.to_lowercase() == name)
        })
        .max_by_key(|candidate| shared_prefix(candidate))
        .map(PathBuf::from)
}

fn allow_library_assets(app: &AppHandle, root: &Path) {
    if let Err(error) = app.asset_protocol_scope().allow_directory(root, true) {
        eprintln!(
            "No se pudo habilitar la lectura de texturas en {}: {error}",
            root.display()
        );
    }
}

/// Empaqueta el modelo y sus dependencias en binario puro: 4 bytes con el largo de la cabecera
/// JSON, la cabecera, el modelo y cada dependencia en orden. Evita mandar los bytes como una lista
/// de números en JSON, que pesa varias veces más que el archivo.
fn pack_asset(
    directory: &str,
    bytes: &[u8],
    resources: &[AssetResource],
    textures: &[String],
) -> Result<Vec<u8>, String> {
    let header = serde_json::json!({
        "directory": directory,
        "textures": textures,
        "mainLength": bytes.len(),
        "resources": resources
            .iter()
            .map(|resource| serde_json::json!({
                "uri": resource.uri,
                "mimeType": resource.mime_type,
                "length": resource.bytes.len(),
            }))
            .collect::<Vec<_>>(),
    });
    let header = serde_json::to_vec(&header)
        .map_err(|error| format!("No se pudo preparar el modelo: {error}"))?;
    let resource_bytes = resources
        .iter()
        .map(|resource| resource.bytes.len())
        .sum::<usize>();
    let mut package = Vec::with_capacity(4 + header.len() + bytes.len() + resource_bytes);
    package.extend_from_slice(&(header.len() as u32).to_le_bytes());
    package.extend_from_slice(&header);
    package.extend_from_slice(bytes);
    for resource in resources {
        package.extend_from_slice(&resource.bytes);
    }
    Ok(package)
}

#[tauri::command]
async fn read_asset_package(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, file) = resolve_inside_root(&app, Path::new(&path))?;
        if !file.is_file() || !is_animation(&file) {
            return Err(
                "El archivo no es una animación FBX, GLB o GLTF válida para la biblioteca"
                    .to_string(),
            );
        }
        let metadata = file
            .metadata()
            .map_err(|error| format!("No se pudo leer el archivo: {error}"))?;
        if metadata.len() > MAX_ASSET_BYTES {
            return Err(format!(
                "El archivo supera el límite inicial de {} MB",
                MAX_ASSET_BYTES / 1024 / 1024
            ));
        }
        let bytes = fs::read(&file)
            .map_err(|error| format!("No se pudo abrir {}: {error}", file.display()))?;
        let resources = if extension(&file) == "gltf" {
            collect_gltf_resources(&root, &file, &bytes)?
        } else {
            Vec::new()
        };
        let textures = if extension(&file) == "fbx" {
            nearby_textures(&root, &file)
        } else {
            Vec::new()
        };
        let directory = file
            .parent()
            .map(plain_path)
            .unwrap_or_default()
            .replace('\\', "/");
        pack_asset(&directory, &bytes, &resources, &textures).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|error| format!("La lectura se interrumpió: {error}"))?
}

fn resolve_model(app: &AppHandle, path: &str) -> Result<(PathBuf, fs::Metadata), String> {
    let (_, file) = resolve_inside_root(app, Path::new(path))?;
    if !file.is_file() || !is_animation(&file) {
        return Err("La miniatura solo puede pertenecer a un FBX, GLB o GLTF".to_string());
    }
    let metadata = file
        .metadata()
        .map_err(|error| format!("No se pudo leer el archivo: {error}"))?;
    Ok((file, metadata))
}

/// Escribe en `_cache` junto al modelo y le pone al archivo la misma fecha del modelo, que es lo
/// que después indica que la miniatura sigue vigente.
fn write_cached_file(
    model: &Path,
    model_metadata: &fs::Metadata,
    target: &Path,
    bytes: &[u8],
) -> Result<i64, String> {
    let cache = target.parent().ok_or("La miniatura no tiene carpeta")?;
    fs::create_dir_all(cache)
        .map_err(|error| format!("No se pudo crear {}: {error}", cache.display()))?;
    let temporary = target.with_extension("tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("No se pudo guardar la miniatura: {error}"))?;
    let model_date = model_metadata
        .modified()
        .map_err(|error| format!("No se pudo leer la fecha de {}: {error}", model.display()))?;
    let stamped = fs::OpenOptions::new()
        .write(true)
        .open(&temporary)
        .and_then(|file| file.set_modified(model_date));
    if let Err(error) = stamped.and_then(|_| fs::rename(&temporary, target)) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("No se pudo guardar la miniatura: {error}"));
    }
    Ok(modified_time(model_metadata))
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

#[tauri::command]
fn save_thumbnail(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<i64, String> {
    if !is_webp(&bytes) || bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err("La miniatura recibida no es una imagen WebP válida".to_string());
    }
    let (model, metadata) = resolve_model(&app, &path)?;
    let (thumbnail, failed) =
        thumbnail_paths(&model).ok_or("El archivo no tiene un nombre válido")?;
    let modified = write_cached_file(&model, &metadata, &thumbnail, &bytes)?;
    let _ = fs::remove_file(failed);
    Ok(modified)
}

#[tauri::command]
fn mark_thumbnail_failed(app: AppHandle, path: String, reason: String) -> Result<(), String> {
    let (model, metadata) = resolve_model(&app, &path)?;
    let (_, failed) = thumbnail_paths(&model).ok_or("El archivo no tiene un nombre válido")?;
    let reason = clean_field(reason, 2_000, "El motivo")?;
    write_cached_file(
        &model,
        &metadata,
        &failed,
        format!("No se pudo generar la miniatura: {reason}\n").as_bytes(),
    )?;
    Ok(())
}

#[tauri::command]
fn read_thumbnail(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let (model, _) = resolve_model(&app, &path)?;
    let (thumbnail, _) = thumbnail_paths(&model).ok_or("El archivo no tiene un nombre válido")?;
    fs::read(&thumbnail)
        .map(tauri::ipc::Response::new)
        .map_err(|error| format!("No se pudo leer la miniatura: {error}"))
}

#[tauri::command]
fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let (_, directory) = resolve_inside_root(&app, Path::new(&path))?;
    let target = if directory.is_dir() {
        directory
    } else {
        directory
            .parent()
            .map(Path::to_path_buf)
            .ok_or("El archivo no tiene carpeta")?
    };
    Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map_err(|error| format!("No se pudo abrir la carpeta: {error}"))?;
    Ok(())
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let (_, file) = resolve_inside_root(&app, Path::new(&path))?;
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&file)
        .spawn()
        .map_err(|error| format!("No se pudo mostrar el archivo: {error}"))?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ImportWatcherState::default())
        .setup(|app| {
            let existing_window = app.get_webview_window("main");
            let window = match existing_window {
                Some(window) => window,
                None => {
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("Biblioteca 3D")
                        .inner_size(1420.0, 900.0)
                        .min_inner_size(900.0, 650.0)
                        .build()?
                }
            };
            window.show()?;
            window.set_focus()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            get_catalog_data,
            get_category_organization,
            save_category_organization,
            save_animation_metadata,
            save_category,
            delete_category,
            reorder_categories,
            export_catalog,
            create_database_backup,
            get_diagnostics,
            restore_database_backup,
            prepare_library_structure,
            open_import_folder,
            scan_library,
            list_folder,
            create_folder,
            rename_asset,
            copy_asset,
            move_asset,
            read_asset_package,
            save_thumbnail,
            mark_thumbnail_failed,
            read_thumbnail,
            open_folder,
            reveal_file
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo ejecutar Biblioteca 3D");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn migration_database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE categories(id TEXT PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE animation_metadata(asset_id TEXT PRIMARY KEY, category_id TEXT NOT NULL DEFAULT '');",
        ).unwrap();
        connection
    }

    #[test]
    fn indexes_every_animation_as_a_separate_item_and_ignores_technical_cache() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("Mixamo")).unwrap();
        fs::create_dir_all(root.join(TECHNICAL_DIR)).unwrap();
        fs::write(root.join("Mixamo").join("Idle.fbx"), b"one").unwrap();
        fs::write(root.join("Mixamo").join("Attack.glb"), b"two").unwrap();
        fs::write(root.join(TECHNICAL_DIR).join("ghost.fbx"), b"cache").unwrap();
        let assets = collect_assets(root);
        assert_eq!(assets.len(), 2);
        assert_eq!(
            assets
                .iter()
                .map(|asset| asset.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Attack", "Idle"]
        );
    }

    #[test]
    fn folder_tree_counts_descendant_animations() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("Combate").join("Espada")).unwrap();
        fs::write(root.join("Combate").join("Block.fbx"), b"a").unwrap();
        fs::write(
            root.join("Combate").join("Espada").join("Attack.gltf"),
            b"b",
        )
        .unwrap();
        let node = build_folder_node(root, &root.join("Combate")).unwrap();
        assert_eq!(node.animation_count, 2);
        assert_eq!(node.children[0].animation_count, 1);
    }

    #[test]
    fn gltf_local_dependencies_are_collected_once() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let file = root.join("personaje.gltf");
        fs::write(root.join("datos.bin"), b"buffer").unwrap();
        fs::write(root.join("textura.png"), b"image").unwrap();
        let json = br#"{
          "asset":{"version":"2.0"},
          "buffers":[{"uri":"datos.bin","byteLength":6}],
          "images":[{"uri":"textura.png"},{"uri":"textura.png"}]
        }"#;
        fs::write(&file, json).unwrap();
        let resources = collect_gltf_resources(root, &file, json).unwrap();
        assert_eq!(resources.len(), 2);
        assert_eq!(resources[0].uri, "datos.bin");
        assert_eq!(resources[1].mime_type, "image/png");
    }

    #[test]
    fn gltf_missing_images_are_found_nearby_or_skipped_but_missing_buffers_fail() {
        let temp = tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let kit = root
            .join("Piezas")
            .join("Categoría")
            .join("ciudad")
            .join("Kit");
        fs::create_dir_all(kit.join("glTF")).unwrap();
        fs::create_dir_all(kit.join("Texturas")).unwrap();
        fs::write(kit.join("glTF").join("pared.bin"), b"buffer").unwrap();
        fs::write(kit.join("Texturas").join("T_Trim_01_Normal.png"), b"png").unwrap();
        let file = kit.join("glTF").join("pared.gltf");
        let json = br#"{
          "asset":{"version":"2.0"},
          "buffers":[{"uri":"pared.bin","byteLength":6}],
          "images":[{"uri":"T_Trim_01_Normal.png"},{"uri":"T_Decals.png"}]
        }"#;
        fs::write(&file, json).unwrap();

        let resources = collect_gltf_resources(&root, &file, json).unwrap();

        assert_eq!(
            resources
                .iter()
                .map(|resource| resource.uri.as_str())
                .collect::<Vec<_>>(),
            vec!["pared.bin", "T_Trim_01_Normal.png"]
        );
        assert_eq!(resources[1].bytes, b"png");

        let broken =
            br#"{"asset":{"version":"2.0"},"buffers":[{"uri":"falta.bin","byteLength":6}]}"#;
        assert!(collect_gltf_resources(&root, &file, broken)
            .unwrap_err()
            .contains("falta.bin"));
    }

    #[test]
    fn gltf_dependency_cannot_escape_the_library() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("biblioteca");
        fs::create_dir_all(&root).unwrap();
        fs::write(temp.path().join("afuera.bin"), b"secret").unwrap();
        let file = root.join("escape.gltf");
        let json = br#"{
          "asset":{"version":"2.0"},
          "buffers":[{"uri":"../afuera.bin","byteLength":6}]
        }"#;
        fs::write(&file, json).unwrap();
        let error = collect_gltf_resources(&root, &file, json).unwrap_err();
        assert!(error.contains("salir de la biblioteca"));
    }

    #[test]
    fn creates_the_expected_library_structure_without_touching_existing_content() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("pack existente")).unwrap();
        fs::write(root.join("pack existente").join("idle.fbx"), b"asset").unwrap();
        ensure_library_structure(root).unwrap();
        for segments in LIBRARY_STRUCTURE {
            let expected = segments
                .iter()
                .fold(root.to_path_buf(), |path, segment| path.join(segment));
            assert!(expected.is_dir());
        }
        assert_eq!(
            fs::read(root.join("pack existente").join("idle.fbx")).unwrap(),
            b"asset"
        );
    }

    fn import_library() -> (tempfile::TempDir, PathBuf) {
        let temp = tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        ensure_library_structure(&root).unwrap();
        (temp, root)
    }

    fn inbox(root: &Path) -> PathBuf {
        root.join("Piezas").join(IMPORT_DIR)
    }

    #[test]
    fn new_import_folder_becomes_a_category_and_reports_only_its_assets() {
        let (_temp, root) = import_library();
        fs::create_dir_all(root.join("Piezas").join("Categoría").join("armas")).unwrap();
        fs::write(
            root.join("Piezas")
                .join("Categoría")
                .join("armas")
                .join("vieja.glb"),
            b"old",
        )
        .unwrap();
        let source = inbox(&root).join("Armas medievales");
        fs::create_dir_all(source.join("texturas")).unwrap();
        fs::write(source.join("espada.fbx"), b"fbx").unwrap();
        fs::write(source.join("escudo.gltf"), b"{}").unwrap();
        fs::write(source.join("texturas").join("escudo.png"), b"png").unwrap();

        let report = process_pending_imports(&root);

        assert!(report.pending.is_empty(), "{:?}", report.pending);
        assert_eq!(report.imported.len(), 1);
        let imported = &report.imported[0];
        assert_eq!(imported.category_name, "Armas medievales");
        assert!(!imported.merged);
        assert_eq!(
            imported
                .assets
                .iter()
                .map(|asset| asset.name.as_str())
                .collect::<Vec<_>>(),
            vec!["escudo", "espada"]
        );
        let target = root
            .join("Piezas")
            .join("Categoría")
            .join("Armas medievales");
        assert!(target.join("texturas").join("escudo.png").is_file());
        assert!(!source.exists());
        let scanned = collect_assets(&root)
            .into_iter()
            .find(|asset| asset.file_name == "espada.fbx")
            .unwrap();
        assert_eq!(scanned.id, imported.assets[1].id);
    }

    #[test]
    fn every_root_folder_is_a_group_with_its_folders_and_existing_spelling_is_respected() {
        let (_temp, root) = import_library();
        fs::create_dir_all(root.join("contruccion").join("Categoria").join("Kit")).unwrap();
        fs::create_dir_all(root.join(TECHNICAL_DIR)).unwrap();

        ensure_group_structure(&root);

        let names = library_groups(&root)
            .iter()
            .map(|group| group_name(group))
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Animaciones", "contruccion", "Piezas"]);
        let construction = root.join("contruccion");
        assert!(construction.join("Categoria").join("Kit").is_dir());
        assert!(
            !fs::read_dir(&construction)
                .unwrap()
                .flatten()
                .any(|entry| entry.file_name() == "Categoría"),
            "no debe duplicar Categoria"
        );
        assert!(construction.join(VARIOS_DIR).is_dir());
        assert!(construction.join(IMPORT_DIR).is_dir());
        assert!(root.join("Animaciones").join(IMPORT_DIR).is_dir());
    }

    #[test]
    fn each_group_imports_from_its_own_inbox() {
        let (_temp, root) = import_library();
        fs::create_dir_all(root.join("contruccion").join("Categoria")).unwrap();
        ensure_group_structure(&root);
        let pack = root.join("contruccion").join(IMPORT_DIR).join("Nuevo Kit");
        fs::create_dir_all(&pack).unwrap();
        fs::write(pack.join("pared.fbx"), b"fbx").unwrap();
        let moves = root.join("Animaciones").join(IMPORT_DIR).join("Combate");
        fs::create_dir_all(&moves).unwrap();
        fs::write(moves.join("golpe.fbx"), b"fbx").unwrap();

        let report = process_pending_imports(&root);

        assert!(report.pending.is_empty(), "{:?}", report.pending);
        let by_group = report
            .imported
            .iter()
            .map(|folder| {
                (
                    folder.group_name.as_str(),
                    folder.category_name.as_str(),
                    folder.animation,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            by_group,
            vec![
                ("Animaciones", "Combate", true),
                ("contruccion", "Nuevo Kit", false)
            ]
        );
        assert!(root
            .join("contruccion")
            .join("Categoria")
            .join("Nuevo Kit")
            .join("pared.fbx")
            .is_file());
        assert!(root
            .join("Animaciones")
            .join("Categoría")
            .join("Combate")
            .join("golpe.fbx")
            .is_file());
        assert_eq!(
            report.imported[1].assets[0]
                .relative_path
                .replace('\\', "/"),
            "contruccion/Categoria/Nuevo Kit/pared.fbx"
        );
    }

    #[test]
    fn group_sections_are_validated() {
        assert!(is_valid_section("piece"));
        assert!(is_valid_section("animation"));
        assert!(is_valid_section("group:contruccion"));
        assert!(!is_valid_section("group:"));
        assert!(!is_valid_section("otra"));
    }

    #[test]
    fn repeated_category_merges_without_overwriting() {
        let (_temp, root) = import_library();
        let existing = root.join("Piezas").join("Categoría").join("armas");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("hacha.fbx"), b"original").unwrap();
        let source = inbox(&root).join("Armas");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("lanza.fbx"), b"nueva").unwrap();

        let report = process_pending_imports(&root);

        assert_eq!(report.imported.len(), 1);
        assert!(report.imported[0].merged);
        assert_eq!(report.imported[0].category_name, "armas");
        assert_eq!(report.imported[0].assets.len(), 1);
        assert_eq!(fs::read(existing.join("hacha.fbx")).unwrap(), b"original");
        assert_eq!(fs::read(existing.join("lanza.fbx")).unwrap(), b"nueva");
        assert!(!source.exists());
    }

    #[test]
    fn conflicting_import_moves_nothing() {
        let (_temp, root) = import_library();
        let existing = root.join("Piezas").join("Categoría").join("armas");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("hacha.fbx"), b"original").unwrap();
        let source = inbox(&root).join("armas");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("arco.fbx"), b"arco").unwrap();
        fs::write(source.join("hacha.fbx"), b"distinta").unwrap();

        let report = process_pending_imports(&root);

        assert!(report.imported.is_empty());
        assert_eq!(report.pending.len(), 1);
        assert!(report.pending[0].reason.contains("hacha.fbx"));
        assert!(!report.pending[0].waiting);
        assert_eq!(fs::read(existing.join("hacha.fbx")).unwrap(), b"original");
        assert!(!existing.join("arco.fbx").exists());
        assert!(source.join("arco.fbx").is_file());
        assert!(source.join("hacha.fbx").is_file());
    }

    #[test]
    fn loose_files_and_folders_without_models_stay_pending() {
        let (_temp, root) = import_library();
        fs::write(inbox(&root).join("suelto.fbx"), b"fbx").unwrap();
        fs::write(inbox(&root).join("desktop.ini"), b"ini").unwrap();
        fs::create_dir_all(inbox(&root).join("Solo texturas")).unwrap();
        fs::write(
            inbox(&root).join("Solo texturas").join("madera.png"),
            b"png",
        )
        .unwrap();
        fs::create_dir_all(inbox(&root).join("Vacia")).unwrap();

        let report = process_pending_imports(&root);

        assert!(report.imported.is_empty());
        let names = report
            .pending
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Solo texturas", "suelto.fbx", "Vacia"]);
        assert!(inbox(&root).join("suelto.fbx").is_file());
        assert!(inbox(&root)
            .join("Solo texturas")
            .join("madera.png")
            .is_file());
        assert!(!root
            .join("Piezas")
            .join("Categoría")
            .join("Solo texturas")
            .exists());
    }

    #[test]
    fn general_scan_ignores_the_import_inbox() {
        let (_temp, root) = import_library();
        fs::create_dir_all(inbox(&root).join("Pendiente")).unwrap();
        fs::write(inbox(&root).join("Pendiente").join("casco.glb"), b"glb").unwrap();
        fs::write(root.join("Piezas").join("Varios").join("mesa.glb"), b"glb").unwrap();

        let assets = collect_assets(&root);
        let folders = build_folder_node(&root, &root).unwrap();

        assert_eq!(
            assets
                .iter()
                .map(|asset| asset.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["mesa.glb"]
        );
        let pieces = folders
            .children
            .iter()
            .find(|folder| folder.name == "Piezas")
            .unwrap();
        assert!(pieces
            .children
            .iter()
            .all(|folder| folder.name != IMPORT_DIR));
    }

    fn stamp_like(target: &Path, model: &Path) {
        let date = fs::metadata(model).unwrap().modified().unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(target)
            .unwrap()
            .set_modified(date)
            .unwrap();
    }

    #[test]
    fn thumbnail_is_valid_only_while_it_keeps_the_model_date() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let model = root.join("escopeta.fbx");
        fs::write(&model, b"fbx").unwrap();
        let (thumbnail, failed) = thumbnail_paths(&model).unwrap();
        assert_eq!(thumbnail, root.join(CACHE_DIR).join("escopeta.fbx.webp"));

        let model_modified = modified_time(&fs::metadata(&model).unwrap());
        assert_eq!(thumbnail_state(&model, model_modified), (0, false));

        fs::create_dir_all(root.join(CACHE_DIR)).unwrap();
        fs::write(&failed, b"rota").unwrap();
        stamp_like(&failed, &model);
        assert_eq!(thumbnail_state(&model, model_modified), (0, true));

        fs::write(&thumbnail, b"RIFF....WEBPdata").unwrap();
        stamp_like(&thumbnail, &model);
        assert_eq!(
            thumbnail_state(&model, model_modified),
            (model_modified, false)
        );

        let edited = fs::metadata(&model).unwrap().modified().unwrap() + Duration::from_secs(60);
        fs::OpenOptions::new()
            .write(true)
            .open(&model)
            .unwrap()
            .set_modified(edited)
            .unwrap();
        let edited_modified = modified_time(&fs::metadata(&model).unwrap());
        assert_eq!(thumbnail_state(&model, edited_modified), (0, false));
    }

    #[test]
    fn cache_folders_never_appear_as_library_content() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("armas").join(CACHE_DIR)).unwrap();
        fs::write(root.join("armas").join("escopeta.fbx"), b"fbx").unwrap();
        fs::write(
            root.join("armas").join(CACHE_DIR).join("escopeta.fbx.webp"),
            b"img",
        )
        .unwrap();
        fs::write(root.join("armas").join(CACHE_DIR).join("copia.glb"), b"glb").unwrap();

        let assets = collect_assets(root);
        let node = build_folder_node(root, &root.join("armas")).unwrap();

        assert_eq!(assets.len(), 1);
        assert!(node.children.is_empty());
        assert_eq!(node.animation_count, 1);
    }

    #[test]
    fn imported_folder_keeps_its_cache_next_to_the_models() {
        let (_temp, root) = import_library();
        let source = inbox(&root).join("Escopetas");
        fs::create_dir_all(source.join(CACHE_DIR)).unwrap();
        fs::write(source.join("corta.fbx"), b"fbx").unwrap();
        fs::write(
            source.join(CACHE_DIR).join("corta.fbx.webp"),
            b"RIFF....WEBPdata",
        )
        .unwrap();
        stamp_like(
            &source.join(CACHE_DIR).join("corta.fbx.webp"),
            &source.join("corta.fbx"),
        );

        let report = process_pending_imports(&root);

        assert_eq!(report.imported.len(), 1);
        let asset = &report.imported[0].assets[0];
        assert!(
            asset.thumbnail_modified > 0,
            "la miniatura que ya venía debe reutilizarse"
        );
        assert!(root
            .join("Piezas")
            .join("Categoría")
            .join("Escopetas")
            .join(CACHE_DIR)
            .join("corta.fbx.webp")
            .is_file());
    }

    #[test]
    fn asset_package_keeps_model_and_dependencies_in_order() {
        let resources = vec![
            AssetResource {
                uri: "datos.bin".into(),
                bytes: b"BIN".to_vec(),
                mime_type: "application/octet-stream".into(),
            },
            AssetResource {
                uri: "textura.png".into(),
                bytes: b"PNGDATA".to_vec(),
                mime_type: "image/png".into(),
            },
        ];
        let package = pack_asset(
            "D:/biblioteca",
            b"MODEL",
            &resources,
            &["D:/biblioteca/tex.png".to_string()],
        )
        .unwrap();
        let header_length = u32::from_le_bytes(package[0..4].try_into().unwrap()) as usize;
        let header: serde_json::Value =
            serde_json::from_slice(&package[4..4 + header_length]).unwrap();
        assert_eq!(header["mainLength"], 5);
        assert_eq!(header["textures"][0], "D:/biblioteca/tex.png");
        assert_eq!(header["resources"][1]["length"], 7);
        assert_eq!(&package[4 + header_length..], b"MODELBINPNGDATA");
    }

    #[test]
    fn fbx_textures_are_searched_in_neighbour_folders_without_leaving_the_category() {
        let temp = tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let kit = root
            .join("Piezas")
            .join("Categoría")
            .join("ciudad")
            .join("Downtown Kit");
        fs::create_dir_all(kit.join("Exports").join("FBX (Unity)")).unwrap();
        fs::create_dir_all(kit.join("Exports").join("glTF (Godot)")).unwrap();
        fs::create_dir_all(kit.join("Exports").join("FBX (Unity)").join(CACHE_DIR)).unwrap();
        fs::create_dir_all(root.join("Piezas").join("Categoría").join("otra")).unwrap();
        let model = kit.join("Exports").join("FBX (Unity)").join("pared.fbx");
        fs::write(&model, b"fbx").unwrap();
        fs::write(
            kit.join("Exports")
                .join("glTF (Godot)")
                .join("T_RedBrick_BaseColor.png"),
            b"png",
        )
        .unwrap();
        fs::write(
            kit.join("Exports")
                .join("FBX (Unity)")
                .join(CACHE_DIR)
                .join("pared.fbx.webp"),
            b"img",
        )
        .unwrap();
        fs::write(
            root.join("Piezas")
                .join("Categoría")
                .join("otra")
                .join("ajena.png"),
            b"png",
        )
        .unwrap();

        assert_eq!(texture_search_base(&root, &model), kit);
        let textures = nearby_textures(&root, &model);
        assert_eq!(textures.len(), 1, "{textures:?}");
        assert!(textures[0].ends_with("T_RedBrick_BaseColor.png"));
        assert!(!textures[0].starts_with(r"\\?\"));
    }

    #[test]
    fn texture_search_stays_in_the_model_folder_for_shallow_files() {
        let temp = tempdir().unwrap();
        let root = temp.path();
        let model = root.join("Piezas").join("Varios").join("mesa.fbx");
        assert_eq!(
            texture_search_base(root, &model),
            root.join("Piezas").join("Varios")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\D:\biblioteca-3d\x.png")),
            r"D:\biblioteca-3d\x.png"
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share")),
            r"\\?\UNC\server\share"
        );
    }

    #[test]
    fn only_real_webp_images_are_accepted_as_thumbnails() {
        assert!(is_webp(b"RIFF\x10\x00\x00\x00WEBPVP8 "));
        assert!(!is_webp(b"\x89PNG\r\n\x1a\n0000"));
    }

    #[test]
    fn migration_preserves_manual_categories() {
        let connection = migration_database();
        connection
            .execute(
                "INSERT INTO categories(id, name) VALUES('manual', 'Correr')",
                [],
            )
            .unwrap();
        migrate_legacy_seeded_categories(&connection).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_removes_only_marked_seed_categories() {
        let connection = migration_database();
        connection
            .execute_batch(
                "INSERT INTO categories(id, name) VALUES('seed', 'Walk');
             INSERT INTO animation_metadata(asset_id, category_id) VALUES('asset', 'seed');
             INSERT INTO settings(key, value) VALUES('categories_seeded', '1');",
            )
            .unwrap();
        migrate_legacy_seeded_categories(&connection).unwrap();
        let categories: i64 = connection
            .query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0))
            .unwrap();
        let category_id: String = connection
            .query_row("SELECT category_id FROM animation_metadata", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(categories, 0);
        assert!(category_id.is_empty());
    }
}
