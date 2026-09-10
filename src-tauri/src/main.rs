#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{backup::Backup, params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use walkdir::{DirEntry, WalkDir};

const TECHNICAL_DIR: &str = "_biblioteca-3d";
const DEFAULT_LIBRARY_ROOT: &str = r"D:\biblioteca-3d";
const ANIMATION_EXTENSIONS: &[&str] = &["fbx", "glb", "gltf"];
const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetBytes {
    bytes: Vec<u8>,
    directory: String,
    resources: Vec<AssetResource>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMutation {
    old_id: String,
    new_id: String,
    new_path: String,
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
                        uris.push(uri.to_string());
                    }
                }
            }
        }
    }

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
    for uri in uris {
        if !seen.insert(uri.clone()) {
            continue;
        }
        let uri_path = Path::new(&uri);
        if uri_path.is_absolute() || uri.contains('?') || uri.contains('#') {
            return Err(format!(
                "La dependencia usa una ruta no local o no admitida: {uri}"
            ));
        }
        let resolved = directory
            .join(uri_path)
            .canonicalize()
            .map_err(|error| format!("Falta la dependencia {uri}: {error}"))?;
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
        .is_none_or(|name| !name.eq_ignore_ascii_case(TECHNICAL_DIR))
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
",
        )
        .map_err(|error| error.to_string())?;
    let categories_seeded = connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'categories_seeded'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if !categories_seeded {
        connection
            .execute_batch(
                "INSERT OR IGNORE INTO categories(id, name, sort_order) VALUES
                   ('idle', 'Idle', 10),
                   ('walk', 'Walk', 20),
                   ('run', 'Run', 30),
                   ('movement', 'Movimiento', 40),
                   ('jump', 'Salto', 50),
                   ('dodge-roll', 'Esquive / Rodar', 60),
                   ('attack', 'Ataque', 70),
                   ('heavy-attack', 'Ataque fuerte', 80),
                   ('block', 'Bloqueo', 90),
                   ('parry', 'Parada', 100),
                   ('hit-reaction', 'Reaccion a golpe', 110),
                   ('death', 'Muerte', 120),
                   ('turn', 'Giro', 130),
                   ('combat', 'Combate', 140),
                   ('special', 'Especiales', 150);
                 INSERT INTO settings(key, value) VALUES('categories_seeded', '1')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            )
            .map_err(|error| error.to_string())?;
    }
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
            "SELECT id, name, sort_order FROM categories ORDER BY sort_order, name COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let categories = category_statement
        .query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
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

fn clean_field(value: String, maximum: usize, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.chars().count() > maximum {
        return Err(format!("{label} supera el máximo de {maximum} caracteres"));
    }
    Ok(value)
}

#[tauri::command]
fn save_category(app: AppHandle, category_id: String, name: String) -> Result<CatalogData, String> {
    let name = clean_field(name, 60, "El nombre de la categoria")?;
    if name.is_empty() {
        return Err("La categoria necesita un nombre".to_string());
    }
    let category_id = clean_field(category_id, 80, "El identificador de categoria")?;
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
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO categories(id, name, sort_order) VALUES(?1, ?2, ?3)",
                params![id, name, next_order],
            )
            .map_err(|error| format!("No se pudo crear la categoria: {error}"))?;
    } else {
        let changed = connection
            .execute(
                "UPDATE categories SET name = ?2 WHERE id = ?1",
                params![category_id, name],
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
        let path = entry.path();
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
        animations.push(AnimationAsset {
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
            modified: modified_time(&metadata),
        });
    }
    animations.sort_by_key(|animation| animation.name.to_lowercase());
    animations
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
            .is_some_and(|name| name.eq_ignore_ascii_case(TECHNICAL_DIR))
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
    build_snapshot(&root)
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
        let snapshot = build_snapshot(&root)?;
        save_root(&app, &root)?;
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
            .is_some_and(|name| name.eq_ignore_ascii_case(TECHNICAL_DIR))
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

#[tauri::command]
async fn read_asset_bytes(app: AppHandle, path: String) -> Result<AssetBytes, String> {
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
        Ok(AssetBytes {
            bytes,
            directory: file
                .parent()
                .map(path_string)
                .unwrap_or_default()
                .replace('\\', "/"),
            resources,
        })
    })
    .await
    .map_err(|error| format!("La lectura se interrumpió: {error}"))?
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
            save_animation_metadata,
            save_category,
            delete_category,
            reorder_categories,
            export_catalog,
            create_database_backup,
            get_diagnostics,
            restore_database_backup,
            scan_library,
            list_folder,
            create_folder,
            rename_asset,
            copy_asset,
            move_asset,
            read_asset_bytes,
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
}
