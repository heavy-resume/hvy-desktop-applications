use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

const GALAXY_MANIFEST: &str = ".hvygalaxy.json";
const RECENT_STATE: &str = "recent.json";
const AI_SETTINGS: &str = "ai-settings.json";
const RECENT_LIMIT: usize = 12;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GalaxyManifest {
    schema_version: u8,
    name: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    root_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expanded_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Galaxy {
    path: String,
    manifest: GalaxyManifest,
    files: Vec<GalaxyTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GalaxyOpenCandidate {
    path: String,
    has_manifest: bool,
    default_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum GalaxyTreeNode {
    Folder {
        name: String,
        path: String,
        relative_path: String,
        children: Vec<GalaxyTreeNode>,
    },
    File {
        name: String,
        path: String,
        relative_path: String,
        extension: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecentState {
    #[serde(default)]
    galaxies: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    path: String,
    name: String,
    extension: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiActionConfig {
    provider_id: String,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiActionSettings {
    chat: AiActionConfig,
    edit: AiActionConfig,
    import_planning: AiActionConfig,
    import_writing: AiActionConfig,
    import_cleanup: AiActionConfig,
    compaction: AiActionConfig,
}

impl AiActionConfig {
    fn new(provider_id: &str, model: &str) -> Self {
        Self {
            provider_id: provider_id.into(),
            model: model.into(),
        }
    }
}

impl Default for AiActionSettings {
    fn default() -> Self {
        default_ai_action_settings()
    }
}

fn default_ai_action_settings() -> AiActionSettings {
    AiActionSettings {
        chat: AiActionConfig::new("default", "gpt-5.4-nano"),
        edit: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_planning: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_writing: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_cleanup: AiActionConfig::new("default", "gpt-5.4-mini"),
        compaction: AiActionConfig::new("default", "gpt-5.4-nano"),
    }
}

fn same_model_ai_action_settings(provider_id: &str, model: &str) -> AiActionSettings {
    AiActionSettings {
        chat: AiActionConfig::new(provider_id, model),
        edit: AiActionConfig::new(provider_id, model),
        import_planning: AiActionConfig::new(provider_id, model),
        import_writing: AiActionConfig::new(provider_id, model),
        import_cleanup: AiActionConfig::new(provider_id, model),
        compaction: AiActionConfig::new(provider_id, model),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    provider: String,
    base_url: String,
    api_key: String,
}

impl Default for AiProviderConfig {
    fn default() -> Self {
        Self {
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    active_provider_id: String,
    providers: Vec<AiProviderConfig>,
    actions: AiActionSettings,
}

impl Default for AiSettings {
    fn default() -> Self {
        let provider = AiProviderConfig::default();
        Self {
            active_provider_id: provider.provider.clone(),
            providers: vec![provider],
            actions: AiActionSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum AiSettingsFile {
    Current(AiSettings),
    Preset(AiSettingsPresetFile),
    Legacy(AiSettingsLegacy),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsPresetFile {
    active_preset_id: String,
    presets: Vec<AiConnectionPresetLegacy>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectionPresetLegacy {
    id: String,
    provider: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: AiTaskModelsLegacy,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiTaskModelsLegacy {
    chat: String,
    edit: String,
    import_planning: String,
    import_writing: String,
    import_cleanup: String,
    compaction: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsLegacy {
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
}

#[tauri::command]
fn load_recent_state(app: AppHandle) -> AppResult<RecentState> {
    read_recent_state(&recent_state_path(&app)?)
}

#[tauri::command]
fn load_ai_settings(app: AppHandle) -> AppResult<AiSettings> {
    read_ai_settings(&ai_settings_path(&app)?)
}

#[tauri::command]
fn save_ai_settings(app: AppHandle, settings: AiSettings) -> AppResult<AiSettings> {
    let settings = normalize_ai_settings(settings)?;
    write_json_atomically(&ai_settings_path(&app)?, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn load_default_guide(app: AppHandle) -> AppResult<DocumentFile> {
    let resource_path = app
        .path()
        .resolve("resources/hvy-guide.hvy", tauri::path::BaseDirectory::Resource)
        .map_err(|error| AppError::Message(error.to_string()))?;
    read_document_at(&resource_path)
}

#[tauri::command]
fn open_galaxy_dialog(app: AppHandle) -> AppResult<Option<Galaxy>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let galaxy = ensure_galaxy(&path)?;
    add_recent_galaxy(&app, &path)?;
    Ok(Some(galaxy))
}

#[tauri::command]
fn choose_galaxy_folder() -> AppResult<Option<GalaxyOpenCandidate>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    Ok(Some(GalaxyOpenCandidate {
        has_manifest: path.join(GALAXY_MANIFEST).exists(),
        default_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled Galaxy")
            .to_string(),
        path: path_to_string(&path),
    }))
}

#[tauri::command]
fn create_galaxy(app: AppHandle, name: String) -> AppResult<Galaxy> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Message("Galaxy name is required.".into()));
    }
    let path = unique_managed_galaxy_path(&app, name)?;
    fs::create_dir_all(&path)?;
    let galaxy = initialize_galaxy_with_name(&path, Some(name))?;
    add_recent_galaxy(&app, &path)?;
    Ok(galaxy)
}

#[tauri::command]
fn new_galaxy_dialog(app: AppHandle) -> AppResult<Option<Galaxy>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let galaxy = initialize_galaxy(&path)?;
    add_recent_galaxy(&app, &path)?;
    Ok(Some(galaxy))
}

#[tauri::command]
fn initialize_galaxy_path(app: AppHandle, path: String) -> AppResult<Galaxy> {
    let path = PathBuf::from(path);
    let galaxy = initialize_galaxy(&path)?;
    add_recent_galaxy(&app, &path)?;
    Ok(galaxy)
}

#[tauri::command]
fn load_galaxy(app: AppHandle, path: String) -> AppResult<Galaxy> {
    let path = PathBuf::from(path);
    let galaxy = ensure_galaxy(&path)?;
    add_recent_galaxy(&app, &path)?;
    Ok(galaxy)
}

#[tauri::command]
fn open_file_dialog(app: AppHandle) -> AppResult<Option<DocumentFile>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Supported documents", &["hvy", "thvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy"])
        .add_filter("Markdown", &["md"])
        .pick_file()
    else {
        return Ok(None);
    };
    let file = read_document_at(&path)?;
    add_recent_file(&app, &path)?;
    Ok(Some(file))
}

#[tauri::command]
fn read_document_file(app: AppHandle, path: String) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    let file = read_document_at(&path)?;
    add_recent_file(&app, &path)?;
    Ok(file)
}

#[tauri::command]
fn save_document_file(app: AppHandle, path: String, bytes: Vec<u8>) -> AppResult<()> {
    let path = PathBuf::from(path);
    write_file_atomically(&path, &bytes)?;
    add_recent_file(&app, &path)?;
    Ok(())
}

#[tauri::command]
fn save_document_as_dialog(
    app: AppHandle,
    suggested_name: String,
    bytes: Vec<u8>,
) -> AppResult<Option<DocumentFile>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Supported documents", &["hvy", "thvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy"])
        .add_filter("Markdown", &["md"])
        .set_file_name(suggested_name)
        .save_file()
    else {
        return Ok(None);
    };
    if document_extension(&path).is_none() {
        return Err(AppError::Message("Save As path must end in .hvy, .thvy, or .md.".into()));
    }
    write_file_atomically(&path, &bytes)?;
    add_recent_file(&app, &path)?;
    Ok(Some(read_document_at(&path)?))
}

#[tauri::command]
fn create_document_file(
    app: AppHandle,
    galaxy_path: String,
    relative_path: String,
    template: String,
) -> AppResult<DocumentFile> {
    let galaxy_path = PathBuf::from(galaxy_path);
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(AppError::Message("Document path must stay inside the galaxy.".into()));
    }
    let path = galaxy_path.join(relative);
    if path.exists() {
        return Err(AppError::Message("A document already exists at that path.".into()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_file_atomically(&path, template.as_bytes())?;
    touch_galaxy_manifest(&galaxy_path)?;
    add_recent_file(&app, &path)?;
    Ok(read_document_at(&path)?)
}

#[tauri::command]
fn open_external_url(url: String) -> AppResult<()> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Message("Only http and https links can be opened.".into()));
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn()?;
    Ok(())
}

pub fn run() {
    set_native_process_name();

    tauri::Builder::default()
        .setup(|app| {
            set_native_process_name();
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if matches!(
                    id,
                    "new-galaxy" | "open-galaxy" | "open-file" | "open-guide" | "ai-settings" | "save" | "save-as"
                )
                    || id.starts_with("recent-file:")
                    || id.starts_with("recent-galaxy:")
                {
                    let _ = app.emit("menu-event", id.to_string());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_recent_state,
            load_ai_settings,
            save_ai_settings,
            load_default_guide,
            open_galaxy_dialog,
            choose_galaxy_folder,
            create_galaxy,
            new_galaxy_dialog,
            initialize_galaxy_path,
            load_galaxy,
            open_file_dialog,
            read_document_file,
            save_document_file,
            save_document_as_dialog,
            create_document_file,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running HVY Galaxy");
}

#[cfg(target_os = "macos")]
fn set_native_process_name() {
    use objc2_foundation::{NSProcessInfo, NSString};
    use std::ffi::CStr;

    let app_name = CStr::from_bytes_with_nul(b"HVY Galaxy\0").expect("static app name is nul-terminated");
    unsafe {
        libc::setprogname(app_name.as_ptr());
    }
    let process_name = NSString::from_str("HVY Galaxy");
    NSProcessInfo::processInfo().setProcessName(&process_name);
}

#[cfg(not(target_os = "macos"))]
fn set_native_process_name() {}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let recent = recent_state_path(app)
        .ok()
        .and_then(|path| read_recent_state(&path).ok())
        .unwrap_or_default();
    let recent_files = build_recent_files_menu(app, &recent)?;
    let recent_galaxies = build_recent_galaxies_menu(app, &recent)?;
    let app_menu = SubmenuBuilder::new(app, "HVY Galaxy")
        .item(&PredefinedMenuItem::about(app, Some("About HVY Galaxy"), None)?)
        .separator()
        .item(&MenuItemBuilder::new("AI Settings...").id("ai-settings").accelerator("CmdOrCtrl+,").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Services"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide HVY Galaxy"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit HVY Galaxy"))?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::new("New Galaxy").id("new-galaxy").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::new("Open Galaxy").id("open-galaxy").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&MenuItemBuilder::new("Open File").id("open-file").accelerator("CmdOrCtrl+Shift+O").build(app)?)
        .item(&recent_galaxies)
        .item(&recent_files)
        .separator()
        .item(&MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::new("Save As...").id("save-as").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, Some("Undo"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Redo"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::new("HVY Guide")
                .id("open-guide")
                .accelerator("F1")
                .build(app)?,
        )
        .build()?;

    MenuBuilder::new(app).item(&app_menu).item(&file).item(&edit).item(&help).build()
}

fn build_recent_files_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Recent Files");
    if recent.files.is_empty() {
        builder = builder.item(&MenuItemBuilder::new("No Recent Files").id("recent-files-empty").build(app)?);
    } else {
        for path in &recent.files {
            builder = builder.item(
                &MenuItemBuilder::new(menu_label(path))
                    .id(format!("recent-file:{path}"))
                    .build(app)?,
            );
        }
    }
    builder.build()
}

fn build_recent_galaxies_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::new(app, "Recent Galaxies");
    if recent.galaxies.is_empty() {
        builder = builder.item(&MenuItemBuilder::new("No Recent Galaxies").id("recent-galaxies-empty").build(app)?);
    } else {
        for path in &recent.galaxies {
            builder = builder.item(
                &MenuItemBuilder::new(menu_label(path))
                    .id(format!("recent-galaxy:{path}"))
                    .build(app)?,
            );
        }
    }
    builder.build()
}

fn ensure_galaxy(path: &Path) -> AppResult<Galaxy> {
    if path.join(GALAXY_MANIFEST).exists() {
        load_galaxy_from_path(path)
    } else {
        initialize_galaxy(path)
    }
}

fn initialize_galaxy(path: &Path) -> AppResult<Galaxy> {
    initialize_galaxy_with_name(path, None)
}

fn initialize_galaxy_with_name(path: &Path, name: Option<&str>) -> AppResult<Galaxy> {
    if !path.is_dir() {
        return Err(AppError::Message("Galaxy path must be a folder.".into()));
    }
    let manifest_path = path.join(GALAXY_MANIFEST);
    let now = Utc::now().to_rfc3339();
    let manifest = if manifest_path.exists() {
        read_manifest(&manifest_path)?
    } else {
        GalaxyManifest {
            schema_version: 1,
            name: name
                .map(ToOwned::to_owned)
                .or_else(|| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "Untitled Galaxy".into()),
            created_at: now.clone(),
            updated_at: now,
            root_files: Vec::new(),
            expanded_paths: Vec::new(),
        }
    };
    write_json_atomically(&manifest_path, &manifest)?;
    load_galaxy_from_path(path)
}

fn unique_managed_galaxy_path(app: &AppHandle, name: &str) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("galaxies");
    fs::create_dir_all(&directory)?;

    let slug = galaxy_folder_name(name);
    let mut candidate = directory.join(&slug);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = directory.join(format!("{slug}-{suffix}"));
        suffix += 1;
    }
    Ok(candidate)
}

fn galaxy_folder_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;
    for character in name.trim().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator && !slug.is_empty() {
            slug.push('-');
            last_was_separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "galaxy".into()
    } else {
        slug
    }
}

fn load_galaxy_from_path(path: &Path) -> AppResult<Galaxy> {
    let manifest = read_manifest(&path.join(GALAXY_MANIFEST))?;
    Ok(Galaxy {
        path: path_to_string(path),
        manifest,
        files: scan_galaxy_files(path)?,
    })
}

fn read_manifest(path: &Path) -> AppResult<GalaxyManifest> {
    let bytes = fs::read(path)?;
    let manifest: GalaxyManifest = serde_json::from_slice(&bytes)?;
    if manifest.schema_version != 1 {
        return Err(AppError::Message("Unsupported galaxy schema version.".into()));
    }
    Ok(manifest)
}

fn touch_galaxy_manifest(path: &Path) -> AppResult<()> {
    let manifest_path = path.join(GALAXY_MANIFEST);
    if !manifest_path.exists() {
        return Ok(());
    }
    let mut manifest = read_manifest(&manifest_path)?;
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn scan_galaxy_files(root: &Path) -> AppResult<Vec<GalaxyTreeNode>> {
    scan_directory(root, root)
}

fn scan_directory(root: &Path, directory: &Path) -> AppResult<Vec<GalaxyTreeNode>> {
    let mut folders = Vec::new();
    let mut files = Vec::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name) {
            continue;
        }
        if path.is_dir() {
            let children = scan_directory(root, &path)?;
            if !children.is_empty() {
                folders.push(GalaxyTreeNode::Folder {
                    name,
                    path: path_to_string(&path),
                    relative_path: relative_path(root, &path),
                    children,
                });
            }
        } else if let Some(extension) = document_extension(&path) {
            files.push(GalaxyTreeNode::File {
                name,
                path: path_to_string(&path),
                relative_path: relative_path(root, &path),
                extension,
            });
        }
    }

    folders.sort_by_key(node_name);
    files.sort_by_key(node_name);
    folders.extend(files);
    Ok(folders)
}

fn should_ignore(name: &str) -> bool {
    name == GALAXY_MANIFEST
        || name.starts_with('.')
        || matches!(name, "node_modules" | "dist" | "build" | "target" | ".git")
}

fn document_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "hvy" => Some(".hvy".into()),
        "thvy" => Some(".thvy".into()),
        "md" => Some(".md".into()),
        _ => None,
    }
}

fn read_document_at(path: &Path) -> AppResult<DocumentFile> {
    let extension = document_extension(path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, and .md documents are supported.".into()))?;
    Ok(DocumentFile {
        path: path_to_string(path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string(),
        extension,
        bytes: fs::read(path)?,
    })
}

fn add_recent_galaxy(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    push_recent(&mut state.galaxies, path);
    state.galaxies.retain(|entry| Path::new(entry).is_dir());
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn add_recent_file(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    push_recent(&mut state.files, path);
    state.files.retain(|entry| Path::new(entry).is_file());
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn refresh_menu(app: &AppHandle) -> AppResult<()> {
    let menu = build_menu(app).map_err(|error| AppError::Message(error.to_string()))?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| AppError::Message(error.to_string()))
}

fn push_recent(entries: &mut Vec<String>, path: &Path) {
    let path = path_to_string(path);
    let mut deduped = VecDeque::from(std::mem::take(entries));
    deduped.retain(|entry| entry != &path);
    deduped.push_front(path);
    while deduped.len() > RECENT_LIMIT {
        deduped.pop_back();
    }
    *entries = deduped.into_iter().collect();
}

fn read_recent_state(path: &Path) -> AppResult<RecentState> {
    if !path.exists() {
        return Ok(RecentState::default());
    }
    let state: RecentState = serde_json::from_slice(&fs::read(path)?)?;
    Ok(RecentState {
        galaxies: state
            .galaxies
            .into_iter()
            .filter(|entry| Path::new(entry).is_dir())
            .take(RECENT_LIMIT)
            .collect(),
        files: state
            .files
            .into_iter()
            .filter(|entry| Path::new(entry).is_file())
            .take(RECENT_LIMIT)
            .collect(),
    })
}

fn read_ai_settings(path: &Path) -> AppResult<AiSettings> {
    if !path.exists() {
        return Ok(AiSettings::default());
    }
    match serde_json::from_slice(&fs::read(path)?)? {
        AiSettingsFile::Current(settings) => normalize_ai_settings(settings),
        AiSettingsFile::Preset(settings) => normalize_ai_settings(preset_ai_settings(settings)),
        AiSettingsFile::Legacy(settings) => normalize_ai_settings(legacy_ai_settings(settings)),
    }
}

fn normalize_ai_settings(settings: AiSettings) -> AppResult<AiSettings> {
    let mut providers = Vec::new();
    for provider in settings.providers {
        providers.push(normalize_ai_provider(provider)?);
    }
    if providers.is_empty() {
        providers.push(AiProviderConfig::default());
    }
    let active_provider_id = settings.active_provider_id.trim();
    let active_provider_id = if active_provider_id.is_empty() || !providers.iter().any(|provider| provider.provider == active_provider_id) {
        providers[0].provider.clone()
    } else {
        active_provider_id.into()
    };
    let actions = normalize_ai_actions(settings.actions, &providers, &active_provider_id);
    Ok(AiSettings {
        active_provider_id,
        providers,
        actions,
    })
}

fn normalize_ai_provider(provider_config: AiProviderConfig) -> AppResult<AiProviderConfig> {
    let provider = provider_config.provider.trim();
    let base_url = provider_config.base_url.trim().trim_end_matches('/');
    if provider.is_empty() {
        return Err(AppError::Message("AI provider is required.".into()));
    }
    if base_url.is_empty() {
        return Err(AppError::Message("AI base URL is required.".into()));
    }
    Ok(AiProviderConfig {
        provider: provider.into(),
        base_url: base_url.into(),
        api_key: provider_config.api_key.trim().into(),
    })
}

fn normalize_ai_actions(
    actions: AiActionSettings,
    providers: &[AiProviderConfig],
    active_provider_id: &str,
) -> AiActionSettings {
    AiActionSettings {
        chat: normalize_ai_action(actions.chat, providers, active_provider_id),
        edit: normalize_ai_action(actions.edit, providers, active_provider_id),
        import_planning: normalize_ai_action(actions.import_planning, providers, active_provider_id),
        import_writing: normalize_ai_action(actions.import_writing, providers, active_provider_id),
        import_cleanup: normalize_ai_action(actions.import_cleanup, providers, active_provider_id),
        compaction: normalize_ai_action(actions.compaction, providers, active_provider_id),
    }
}

fn normalize_ai_action(
    action: AiActionConfig,
    providers: &[AiProviderConfig],
    active_provider_id: &str,
) -> AiActionConfig {
    let provider_id = action.provider_id.trim();
    let provider_id = if provider_id == "default" {
        "default"
    } else if provider_id.is_empty() || !providers.iter().any(|provider| provider.provider == provider_id) {
        active_provider_id
    } else {
        provider_id
    };
    AiActionConfig {
        provider_id: provider_id.into(),
        model: action.model.trim().into(),
    }
}

fn preset_ai_settings(settings: AiSettingsPresetFile) -> AiSettings {
    let requested_provider_id = settings.active_preset_id.trim().to_string();
    let mut providers = Vec::new();
    let mut active_models = AiTaskModelsLegacy::default();
    for preset in settings.presets {
        if preset.id.trim() == requested_provider_id || preset.provider.trim() == requested_provider_id {
            active_models = preset.models.clone();
        }
        providers.push(AiProviderConfig {
            provider: preset.provider,
            base_url: preset.base_url,
            api_key: preset.api_key,
        });
    }
    let provider_id = if requested_provider_id.is_empty() {
        providers.first().map(|provider| provider.provider.clone()).unwrap_or_else(|| "openai".into())
    } else if providers.iter().any(|provider| provider.provider == requested_provider_id) {
        requested_provider_id
    } else {
        providers.first().map(|provider| provider.provider.clone()).unwrap_or_else(|| "openai".into())
    };
    AiSettings {
        active_provider_id: provider_id.clone(),
        providers,
        actions: AiActionSettings {
            chat: AiActionConfig::new(&provider_id, active_models.chat.trim()),
            edit: AiActionConfig::new(&provider_id, active_models.edit.trim()),
            import_planning: AiActionConfig::new(&provider_id, active_models.import_planning.trim()),
            import_writing: AiActionConfig::new(&provider_id, active_models.import_writing.trim()),
            import_cleanup: AiActionConfig::new(&provider_id, active_models.import_cleanup.trim()),
            compaction: AiActionConfig::new(&provider_id, active_models.compaction.trim()),
        },
    }
}

fn legacy_ai_settings(settings: AiSettingsLegacy) -> AiSettings {
    let model = settings.model.trim().to_string();
    let provider = AiProviderConfig {
        provider: settings.provider,
        base_url: settings.base_url,
        api_key: settings.api_key,
    };
    let provider_id = provider.provider.clone();
    AiSettings {
        active_provider_id: provider_id.clone(),
        providers: vec![provider],
        actions: same_model_ai_action_settings(&provider_id, &model),
    }
}

fn recent_state_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(RECENT_STATE))
}

fn ai_settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(AI_SETTINGS))
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(value)?;
    write_file_atomically(path, &json)
}

fn write_file_atomically(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Cannot write a file without a parent directory.".into()))?;
    fs::create_dir_all(parent)?;
    let temp_path = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("hvy-write")
    ));
    {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(temp_path, path)?;
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn menu_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn node_name(node: &GalaxyTreeNode) -> String {
    match node {
        GalaxyTreeNode::Folder { name, .. } | GalaxyTreeNode::File { name, .. } => name.to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn initializes_and_loads_galaxy_manifest() {
        let dir = tempdir().unwrap();
        let galaxy = initialize_galaxy(dir.path()).unwrap();

        assert_eq!(galaxy.manifest.schema_version, 1);
        assert!(dir.path().join(GALAXY_MANIFEST).exists());

        let loaded = load_galaxy_from_path(dir.path()).unwrap();
        assert_eq!(loaded.manifest.name, galaxy.manifest.name);
    }

    #[test]
    fn initializes_galaxy_with_user_facing_name() {
        let dir = tempdir().unwrap();
        let galaxy = initialize_galaxy_with_name(dir.path(), Some("Nebula Drafts")).unwrap();

        assert_eq!(galaxy.manifest.name, "Nebula Drafts");
        assert_eq!(
            load_galaxy_from_path(dir.path()).unwrap().manifest.name,
            "Nebula Drafts"
        );
    }

    #[test]
    fn galaxy_folder_name_is_filesystem_safe() {
        assert_eq!(galaxy_folder_name("Nebula Drafts"), "nebula-drafts");
        assert_eq!(galaxy_folder_name("  alpha/beta:  "), "alpha-beta");
        assert_eq!(galaxy_folder_name("***"), "galaxy");
    }

    #[test]
    fn scans_hvy_tree_and_ignores_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("a.hvy"), "a").unwrap();
        fs::write(dir.path().join("notes").join("b.thvy"), "b").unwrap();
        fs::write(dir.path().join(".git").join("hidden.hvy"), "hidden").unwrap();
        fs::write(dir.path().join("skip.txt"), "skip").unwrap();

        let nodes = scan_galaxy_files(dir.path()).unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(matches!(&nodes[0], GalaxyTreeNode::Folder { name, .. } if name == "notes"));
        assert!(matches!(&nodes[1], GalaxyTreeNode::File { name, .. } if name == "a.hvy"));
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.hvy");
        write_file_atomically(&file, b"first").unwrap();
        write_file_atomically(&file, b"second").unwrap();

        assert_eq!(fs::read_to_string(file).unwrap(), "second");
    }

    #[test]
    fn recent_entries_are_deduped_and_limited() {
        let dir = tempdir().unwrap();
        let mut recent = Vec::new();

        for index in 0..14 {
            let path = dir.path().join(format!("{index}.hvy"));
            push_recent(&mut recent, &path);
        }
        push_recent(&mut recent, &dir.path().join("7.hvy"));

        assert_eq!(recent.len(), RECENT_LIMIT);
        assert_eq!(recent[0], path_to_string(&dir.path().join("7.hvy")));
    }

    #[test]
    fn normalizes_ai_settings() {
        let settings = normalize_ai_settings(AiSettings {
            active_provider_id: " local ".into(),
            providers: vec![AiProviderConfig {
                provider: " openai-compatible ".into(),
                base_url: " http://127.0.0.1:11434/v1/ ".into(),
                api_key: " local ".into(),
            }],
            actions: AiActionSettings {
                chat: AiActionConfig::new(" openai-compatible ", " llama3.2 "),
                edit: AiActionConfig::new(" missing ", " qwen "),
                import_planning: AiActionConfig::new(" openai-compatible ", " planner "),
                import_writing: AiActionConfig::new(" openai-compatible ", " writer "),
                import_cleanup: AiActionConfig::new(" openai-compatible ", " cleanup "),
                compaction: AiActionConfig::new(" openai-compatible ", " compact "),
            },
        })
        .unwrap();

        assert_eq!(settings.active_provider_id, "openai-compatible");
        assert_eq!(settings.providers[0].provider, "openai-compatible");
        assert_eq!(settings.providers[0].base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(settings.providers[0].api_key, "local");
        assert_eq!(settings.actions.chat.provider_id, "openai-compatible");
        assert_eq!(settings.actions.chat.model, "llama3.2");
        assert_eq!(settings.actions.edit.provider_id, "openai-compatible");
    }
}
