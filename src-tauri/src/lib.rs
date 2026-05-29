use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;

const WORKSPACE_MANIFEST: &str = ".hvyworkspace.json";
const LEGACY_WORKSPACE_MANIFEST: &str = ".hvygalaxy.json";
const RECENT_STATE: &str = "recent.json";
const ARCHIVED_WORKSPACES: &str = "archived-workspaces.json";
const AI_SETTINGS: &str = "ai-settings.json";
const MCP_SETTINGS: &str = "mcp-settings.json";
const MCP_STDIO_WORKSPACE_CONFIG: &str = "hvy-galaxy-mcp-workspaces.json";
const DEFAULT_MCP_PORT: u16 = 8794;
const RECENT_LIMIT: usize = 12;
const DEFAULT_AI_MAX_CONTEXT_CHARS: u32 = 40_000;
const AI_MIN_CONTEXT_CHARS: u32 = 1_000;
const AI_MAX_CONTEXT_CHARS: u32 = 750_000;
const AI_CONTEXT_STEP_CHARS: u32 = 1_000;
const BACKUP_RETENTION_HOURS: i64 = 24 * 7;

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

pub fn run_mcp_stdio_main() -> Result<(), String> {
    run_mcp_stdio(
        std::env::args().skip(1).filter(|arg| arg != "--mcp-stdio"),
        std::env::var_os("HVY_GALAXY_WORKSPACES"),
        std::env::current_dir().map_err(|error| error.to_string())?,
        std::io::stdin().lock(),
        std::io::stdout().lock(),
    )
    .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceManifest {
    schema_version: u8,
    name: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    root_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expanded_paths: Vec<String>,
    #[serde(default)]
    template_visibility: WorkspaceTemplateVisibility,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    archived_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTemplateVisibility {
    #[serde(default = "default_true")]
    hvy_documents: bool,
    #[serde(default = "default_true")]
    thvy_templates: bool,
    #[serde(default = "default_true")]
    phvy_templates: bool,
    #[serde(default)]
    archived_files: bool,
}

impl Default for WorkspaceTemplateVisibility {
    fn default() -> Self {
        Self {
            hvy_documents: true,
            thvy_templates: true,
            phvy_templates: true,
            archived_files: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    path: String,
    manifest: WorkspaceManifest,
    files: Vec<WorkspaceTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AddFilesResult {
    workspace: Workspace,
    copied_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    copied_template_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DroppedWorkspaceFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOpenCandidate {
    path: String,
    has_manifest: bool,
    default_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WorkspaceTreeNode {
    Folder {
        name: String,
        path: String,
        relative_path: String,
        children: Vec<WorkspaceTreeNode>,
    },
    File {
        name: String,
        path: String,
        relative_path: String,
        extension: String,
        archived: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecentState {
    #[serde(default, alias = "galaxies")]
    workspaces: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ArchivedWorkspace {
    path: String,
    name: String,
    archived_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    path: String,
    name: String,
    extension: String,
    bytes: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ImportSourceFile {
    path: String,
    name: String,
    extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SavedTemplate {
    id: String,
    path: String,
    name: String,
    scope: String,
    extension: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SaveDocumentTemplateRequest {
    scope: String,
    workspace_path: Option<String>,
    name: String,
    extension: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileMenuState {
    close_document: bool,
    save: bool,
    save_as: bool,
    save_to_workspace: bool,
    export_pdf: bool,
    import_current: bool,
}

#[derive(Default)]
struct NativeMenuState {
    file_menu: Mutex<FileMenuState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ThemeFile {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackupRequest {
    document_path: String,
    name: String,
    extension: String,
    bytes: Vec<u8>,
    #[serde(default)]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SystemFileClipboardRequest {
    paths: Vec<String>,
    operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentRecoveryDraftRequest {
    document_path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackup {
    id: String,
    document_path: String,
    name: String,
    extension: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackupSnapshot {
    id: String,
    document_path: String,
    name: String,
    extension: String,
    created_at: String,
    bytes: Vec<u8>,
    #[serde(default)]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct McpSettings {
    #[serde(default)]
    start_automatically: bool,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default = "default_mcp_write_access")]
    write_access: String,
    #[serde(default = "generate_mcp_bearer_token")]
    bearer_token: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            start_automatically: false,
            port: Some(DEFAULT_MCP_PORT),
            write_access: default_mcp_write_access(),
            bearer_token: generate_mcp_bearer_token(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct McpServerStatus {
    running: bool,
    url: Option<String>,
    message: String,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct McpStdioLaunchConfig {
    command: String,
    args: Vec<String>,
    working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct McpClientInstallStatus {
    target: String,
    label: String,
    config_path: String,
    config_exists: bool,
    executable_exists: bool,
    installed: bool,
    backup_count: usize,
    latest_backup_path: Option<String>,
    latest_backup_label: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct McpWorkspaceConfig {
    #[serde(default)]
    workspaces: Vec<String>,
    #[serde(default = "default_mcp_write_access")]
    write_access: String,
}

impl Default for McpWorkspaceConfig {
    fn default() -> Self {
        Self {
            workspaces: Vec::new(),
            write_access: default_mcp_write_access(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpStdioFraming {
    ContentLength,
    Newline,
}

#[derive(Debug, PartialEq, Eq)]
struct McpStdioMessage {
    body: Vec<u8>,
    framing: McpStdioFraming,
}

impl Default for McpServerStatus {
    fn default() -> Self {
        Self {
            running: false,
            url: None,
            message: "MCP server is stopped.".into(),
            last_error: None,
        }
    }
}

struct McpRuntime {
    handle: Mutex<Option<McpServerHandle>>,
    status: Mutex<McpServerStatus>,
    workspaces: Mutex<Vec<String>>,
}

struct McpServerHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Default for McpRuntime {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            status: Mutex::new(McpServerStatus::default()),
            workspaces: Mutex::new(Vec::new()),
        }
    }
}

impl Drop for McpServerHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn default_mcp_write_access() -> String {
    "hvyCliEdits".into()
}

fn generate_mcp_bearer_token() -> String {
    let mut bytes = [0_u8; 32];
    fill_token_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(unix)]
fn fill_token_bytes(bytes: &mut [u8]) {
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(bytes))
        .is_ok()
    {
        return;
    }
    fill_fallback_token_bytes(bytes);
}

#[cfg(not(unix))]
fn fill_token_bytes(bytes: &mut [u8]) {
    fill_fallback_token_bytes(bytes);
}

fn fill_fallback_token_bytes(bytes: &mut [u8]) {
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0)
        ^ u64::from(std::process::id());
    for byte in bytes {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *byte = (seed & 0xff) as u8;
    }
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
    #[serde(default = "default_semantic_filter_action_config")]
    semantic_filter: AiActionConfig,
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
        semantic_filter: default_semantic_filter_action_config(),
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
        semantic_filter: AiActionConfig::new(provider_id, model),
        compaction: AiActionConfig::new(provider_id, model),
    }
}

fn default_semantic_filter_action_config() -> AiActionConfig {
    AiActionConfig::new("default", "gpt-5.4-nano")
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
    #[serde(default = "default_ai_max_context_chars")]
    max_context_chars: u32,
}

impl Default for AiSettings {
    fn default() -> Self {
        let provider = AiProviderConfig::default();
        Self {
            active_provider_id: provider.provider.clone(),
            providers: vec![provider],
            actions: AiActionSettings::default(),
            max_context_chars: default_ai_max_context_chars(),
        }
    }
}

fn default_ai_max_context_chars() -> u32 {
    DEFAULT_AI_MAX_CONTEXT_CHARS
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
    #[serde(default)]
    semantic_filter: String,
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
fn load_archived_workspaces(app: AppHandle) -> AppResult<Vec<ArchivedWorkspace>> {
    read_archived_workspaces(&archived_workspaces_path(&app)?)
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
fn load_mcp_settings(app: AppHandle) -> AppResult<McpSettings> {
    let path = mcp_settings_path(&app)?;
    let settings = read_mcp_settings(&path)?;
    write_json_atomically(&path, &settings)?;
    write_mcp_stdio_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn save_mcp_settings(app: AppHandle, settings: McpSettings) -> AppResult<McpSettings> {
    let settings = normalize_mcp_settings(settings)?;
    write_json_atomically(&mcp_settings_path(&app)?, &settings)?;
    write_mcp_stdio_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn load_mcp_server_status(runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
    Ok(runtime
        .status
        .lock()
        .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))?
        .clone())
}

#[tauri::command]
fn load_mcp_stdio_launch_config(app: AppHandle) -> AppResult<McpStdioLaunchConfig> {
    let workspace_config_path = mcp_stdio_workspace_config_path(&app)?;
    let working_directory = workspace_config_path
        .parent()
        .map(path_to_string)
        .unwrap_or_else(|| ".".into());
    Ok(McpStdioLaunchConfig {
        command: path_to_string(&std::env::current_exe()?),
        args: vec!["--mcp-stdio".into()],
        working_directory,
    })
}

#[tauri::command]
fn load_mcp_client_install_status(app: AppHandle) -> AppResult<Vec<McpClientInstallStatus>> {
    let launch = load_mcp_stdio_launch_config(app)?;
    mcp_client_install_statuses(&launch)
}

#[tauri::command]
fn install_mcp_client(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
    let launch = load_mcp_stdio_launch_config(app)?;
    let path = match target.as_str() {
        "codex" => codex_config_path()?,
        "claude" => claude_config_path()?,
        _ => return Err(AppError::Message(format!("Unknown MCP client target: {target}"))),
    };
    if !path.exists() && !(target == "claude" && claude_config_can_be_created(&path)) {
        return Err(AppError::Message(format!("{} was not found.", path_to_string(&path))));
    }
    if !Path::new(&launch.command).exists() {
        return Err(AppError::Message(format!("{} was not found.", launch.command)));
    }
    match target.as_str() {
        "codex" => install_mcp_for_codex(&path, &launch)?,
        "claude" => install_mcp_for_claude(&path, &launch)?,
        _ => unreachable!(),
    }
    mcp_client_install_statuses(&launch)
}

#[tauri::command]
fn remove_mcp_client(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
    let launch = load_mcp_stdio_launch_config(app)?;
    let path = match target.as_str() {
        "codex" => codex_config_path()?,
        "claude" => claude_config_path()?,
        _ => return Err(AppError::Message(format!("Unknown MCP client target: {target}"))),
    };
    if !path.exists() {
        return Err(AppError::Message(format!("{} was not found.", path_to_string(&path))));
    }
    match target.as_str() {
        "codex" => remove_mcp_from_codex(&path)?,
        "claude" => remove_mcp_from_claude(&path)?,
        _ => unreachable!(),
    }
    mcp_client_install_statuses(&launch)
}

#[tauri::command]
fn restore_mcp_client_backup(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
    let launch = load_mcp_stdio_launch_config(app)?;
    let path = match target.as_str() {
        "codex" => codex_config_path()?,
        "claude" => claude_config_path()?,
        _ => return Err(AppError::Message(format!("Unknown MCP client target: {target}"))),
    };
    restore_mcp_client_backup_file(&path)?;
    mcp_client_install_statuses(&launch)
}

#[tauri::command]
fn start_mcp_server(app: AppHandle, runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
    let settings = read_mcp_settings(&mcp_settings_path(&app)?)?;
    let port = settings.port.unwrap_or(DEFAULT_MCP_PORT);
    let url = format!("http://127.0.0.1:{port}/mcp");
    let mut handle_guard = runtime
        .handle
        .lock()
        .map_err(|_| AppError::Message("MCP server lock is unavailable.".into()))?;
    if handle_guard.is_some() {
        return Ok(runtime
            .status
            .lock()
            .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))?
            .clone());
    }

    match spawn_mcp_server(app.clone(), port) {
        Ok(handle) => {
            *handle_guard = Some(handle);
            let status = McpServerStatus {
                running: true,
                url: Some(url),
                message: "MCP server is running.".into(),
                last_error: None,
            };
            *runtime
                .status
                .lock()
                .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))? = status.clone();
            refresh_menu(&app)?;
            Ok(status)
        }
        Err(error) => {
            let status = McpServerStatus {
                running: false,
                url: None,
                message: "MCP server could not start.".into(),
                last_error: Some(error.to_string()),
            };
            *runtime
                .status
                .lock()
                .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))? = status.clone();
            refresh_menu(&app)?;
            Ok(status)
        }
    }
}

#[tauri::command]
fn stop_mcp_server(app: AppHandle, runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
    let mut handle_guard = runtime
        .handle
        .lock()
        .map_err(|_| AppError::Message("MCP server lock is unavailable.".into()))?;
    if let Some(mut handle) = handle_guard.take() {
        handle.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = handle.thread.take() {
            let _ = thread.join();
        }
    }
    let status = McpServerStatus::default();
    *runtime
        .status
        .lock()
        .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))? = status.clone();
    refresh_menu(&app)?;
    Ok(status)
}

#[tauri::command]
fn update_mcp_workspaces(app: AppHandle, runtime: State<McpRuntime>, paths: Vec<String>) -> AppResult<()> {
    let mut normalized = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        if workspace_manifest_path(&path).is_some() {
            normalized.push(path_to_string(&path));
        }
    }
    normalized.sort();
    normalized.dedup();
    let settings = read_mcp_settings(&mcp_settings_path(&app)?)?;
    let config = McpWorkspaceConfig {
        workspaces: normalized.clone(),
        write_access: settings.write_access,
    };
    *runtime
        .workspaces
        .lock()
        .map_err(|_| AppError::Message("MCP workspace lock is unavailable.".into()))? = normalized;
    write_mcp_stdio_workspace_config(&app, &config)?;
    Ok(())
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
fn open_workspace_dialog(app: AppHandle) -> AppResult<Option<Workspace>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let workspace = ensure_workspace(&path)?;
    add_recent_workspace(&app, &path)?;
    Ok(Some(workspace))
}

#[tauri::command]
fn choose_workspace_folder() -> AppResult<Option<WorkspaceOpenCandidate>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    Ok(Some(WorkspaceOpenCandidate {
        has_manifest: workspace_manifest_path(&path).is_some(),
        default_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled Workspace")
            .to_string(),
        path: path_to_string(&path),
    }))
}

#[tauri::command]
fn create_workspace(app: AppHandle, name: String) -> AppResult<Workspace> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Message("Workspace name is required.".into()));
    }
    let path = unique_managed_workspace_path(&app, name)?;
    fs::create_dir_all(&path)?;
    let workspace = initialize_workspace_with_name(&path, Some(name))?;
    add_recent_workspace(&app, &path)?;
    Ok(workspace)
}

#[tauri::command]
fn new_workspace_dialog(app: AppHandle) -> AppResult<Option<Workspace>> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };
    let workspace = initialize_workspace(&path)?;
    add_recent_workspace(&app, &path)?;
    Ok(Some(workspace))
}

#[tauri::command]
fn initialize_workspace_path(app: AppHandle, path: String) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let workspace = initialize_workspace(&path)?;
    add_recent_workspace(&app, &path)?;
    Ok(workspace)
}

#[tauri::command]
fn load_workspace(app: AppHandle, path: String, include_templates: Option<bool>) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let workspace = ensure_workspace(&path)?;
    remove_archived_workspace(&app, &path)?;
    add_recent_workspace(&app, &path)?;
    if include_templates.unwrap_or(false) {
        return load_workspace_from_path_with_options(&path, true);
    }
    Ok(workspace)
}

#[tauri::command]
fn rename_workspace(app: AppHandle, path: String, name: String) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    ensure_workspace(&path)?;
    let manifest_path = workspace_manifest_path(&path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Message("Workspace name is required.".into()));
    }
    let mut manifest = read_manifest(&manifest_path)?;
    manifest.name = name.to_string();
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)?;
    add_recent_workspace(&app, &path)?;
    load_workspace_from_path(&path)
}

#[tauri::command]
fn update_workspace_template_visibility(
    workspace_path: String,
    template_visibility: WorkspaceTemplateVisibility,
) -> AppResult<Workspace> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let manifest_path = workspace_manifest_path(&workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    manifest.template_visibility = template_visibility;
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn archive_workspace(app: AppHandle, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    let workspace = ensure_workspace(&path)?;
    add_archived_workspace(
        &app,
        ArchivedWorkspace {
            path: workspace.path,
            name: workspace.manifest.name,
            archived_at: Utc::now().to_rfc3339(),
        },
    )?;
    remove_recent_workspace(&app, &path)
}

#[tauri::command]
fn unarchive_workspace(app: AppHandle, path: String) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let workspace = ensure_workspace(&path)?;
    remove_archived_workspace(&app, &path)?;
    add_recent_workspace(&app, &path)?;
    Ok(workspace)
}

#[tauri::command]
fn add_files_to_workspace(app: AppHandle, workspace_path: String) -> AppResult<Option<AddFilesResult>> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let Some(paths) = rfd::FileDialog::new()
        .add_filter("Supported documents", &["hvy", "thvy", "phvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
        .add_filter("Markdown", &["md"])
        .pick_files()
    else {
        return Ok(None);
    };

    let mut copied = Vec::new();
    let mut copied_templates = Vec::new();
    for source in paths {
        if document_extension(&source).is_none() {
            return Err(AppError::Message(
                "Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.".into(),
            ));
        }
        let file_name = source
            .file_name()
            .ok_or_else(|| AppError::Message("Selected file has no file name.".into()))?;
        let destination_root = if template_extension(&source).is_some() {
            workspace_templates_dir(&workspace_path)?
        } else {
            workspace_path.clone()
        };
        let destination = unique_copy_path(&destination_root, file_name);
        fs::copy(&source, &destination)?;
        if template_extension(&source).is_some() {
            copied_templates.push(destination);
        } else {
            copied.push(destination);
        }
    }

    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    for path in &copied {
        add_recent_file(&app, &path)?;
    }
    Ok(Some(AddFilesResult {
        workspace: load_workspace_from_path(&workspace_path)?,
        copied_paths: copied.iter().map(|path| path_to_string(path)).collect(),
        copied_template_paths: copied_templates.iter().map(|path| path_to_string(path)).collect(),
    }))
}

#[tauri::command]
fn add_dropped_files_to_workspace(
    app: AppHandle,
    workspace_path: String,
    files: Vec<DroppedWorkspaceFile>,
) -> AppResult<AddFilesResult> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let mut copied = Vec::new();
    let mut copied_templates = Vec::new();

    for file in files {
        if document_extension(Path::new(&file.name)).is_none() {
            return Err(AppError::Message(
                "Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.".into(),
            ));
        }
        let is_template = template_extension(Path::new(&file.name)).is_some();
        let destination_root = if is_template {
            workspace_templates_dir(&workspace_path)?
        } else {
            workspace_path.clone()
        };
        let destination = unique_copy_path(&destination_root, std::ffi::OsStr::new(&file.name));
        fs::write(&destination, file.bytes)?;
        if is_template {
            copied_templates.push(destination);
        } else {
            copied.push(destination);
        }
    }

    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    for path in &copied {
        add_recent_file(&app, path)?;
    }
    Ok(AddFilesResult {
        workspace: load_workspace_from_path(&workspace_path)?,
        copied_paths: copied.iter().map(|path| path_to_string(path)).collect(),
        copied_template_paths: copied_templates.iter().map(|path| path_to_string(path)).collect(),
    })
}

#[tauri::command]
fn open_file_dialog(app: AppHandle) -> AppResult<Option<DocumentFile>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Supported documents", &["hvy", "thvy", "phvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
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
fn open_import_source_dialog() -> AppResult<Option<ImportSourceFile>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Import sources", &["hvy", "thvy", "phvy", "txt", "md"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
        .add_filter("Markdown", &["md"])
        .add_filter("Plain text", &["txt"])
        .pick_file()
    else {
        return Ok(None);
    };
    let extension = import_source_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, .txt, and .md files can be imported.".into()))?;
    let text = if extension == ".txt" {
        Some(fs::read_to_string(&path)?)
    } else {
        None
    };
    let bytes = if extension == ".txt" {
        None
    } else {
        Some(fs::read(&path)?)
    };
    Ok(Some(ImportSourceFile {
        path: path_to_string(&path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("source.txt")
            .to_string(),
        extension,
        text,
        bytes,
    }))
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
        .add_filter("Supported documents", &["hvy", "thvy", "phvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
        .add_filter("Markdown", &["md"])
        .set_file_name(suggested_name)
        .save_file()
    else {
        return Ok(None);
    };
    if document_extension(&path).is_none() {
        return Err(AppError::Message("Save As path must end in .hvy, .thvy, .phvy, or .md.".into()));
    }
    write_file_atomically(&path, &bytes)?;
    add_recent_file(&app, &path)?;
    Ok(Some(read_document_at(&path)?))
}

#[tauri::command]
fn save_pdf_as_dialog(suggested_name: String, bytes: Vec<u8>) -> AppResult<Option<String>> {
    let Some(mut path) = rfd::FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(ensure_pdf_file_name(&suggested_name))
        .save_file()
    else {
        return Ok(None);
    };
    if path.extension().is_none() {
        path.set_extension("pdf");
    }
    if pdf_extension(&path).is_none() {
        return Err(AppError::Message("PDF export path must end in .pdf.".into()));
    }
    write_file_atomically(&path, &bytes)?;
    Ok(Some(path_to_string(&path)))
}

#[tauri::command]
fn list_saved_templates(app: AppHandle, workspace_path: Option<String>) -> AppResult<Vec<SavedTemplate>> {
    let mut templates = Vec::new();
    append_saved_templates(&mut templates, &app_templates_dir(&app)?, "app")?;
    if let Some(workspace_path) = workspace_path {
        let workspace_path = PathBuf::from(workspace_path);
        ensure_workspace(&workspace_path)?;
        append_saved_templates(&mut templates, &workspace_templates_dir(&workspace_path)?, "workspace")?;
    }
    templates.sort_by(|left, right| left.scope.cmp(&right.scope).then(left.name.cmp(&right.name)));
    Ok(templates)
}

#[tauri::command]
fn save_document_template(app: AppHandle, request: SaveDocumentTemplateRequest) -> AppResult<SavedTemplate> {
    let directory = match request.scope.as_str() {
        "app" => app_templates_dir(&app)?,
        "workspace" => {
            let workspace_path = request.workspace_path
                .ok_or_else(|| AppError::Message("Workspace template requires a workspace path.".into()))?;
            let workspace_path = PathBuf::from(workspace_path);
            ensure_workspace(&workspace_path)?;
            workspace_templates_dir(&workspace_path)?
        }
        _ => return Err(AppError::Message("Template scope must be app or workspace.".into())),
    };
    fs::create_dir_all(&directory)?;
    let file_name = template_file_name(&request.name, &request.extension)?;
    let path = directory.join(file_name);
    write_file_atomically(&path, &request.bytes)?;
    read_saved_template_at(&path, &request.scope)
}

#[tauri::command]
fn open_color_theme_dialog() -> AppResult<Option<ThemeFile>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("HVY themes", &["hvytheme"])
        .add_filter("JSON", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    read_theme_at(&path).map(Some)
}

#[tauri::command]
fn save_color_theme_as_dialog(suggested_name: String, bytes: Vec<u8>) -> AppResult<Option<ThemeFile>> {
    let Some(mut path) = rfd::FileDialog::new()
        .add_filter("HVY themes", &["hvytheme"])
        .set_file_name(ensure_theme_file_name(&suggested_name))
        .save_file()
    else {
        return Ok(None);
    };
    if path.extension().is_none() {
        path.set_extension("hvytheme");
    }
    if theme_extension(&path).is_none() {
        return Err(AppError::Message("Theme path must end in .hvytheme or .json.".into()));
    }
    write_file_atomically(&path, &bytes)?;
    read_theme_at(&path).map(Some)
}

#[tauri::command]
fn create_document_file(
    app: AppHandle,
    workspace_path: String,
    relative_path: String,
    template: String,
) -> AppResult<DocumentFile> {
    let workspace_path = PathBuf::from(workspace_path);
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(AppError::Message("Document path must stay inside the workspace.".into()));
    }
    let path = workspace_path.join(relative);
    if path.exists() {
        return Err(AppError::Message("A document already exists at that path.".into()));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_file_atomically(&path, template.as_bytes())?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_file(&app, &path)?;
    Ok(read_document_at(&path)?)
}

#[tauri::command]
fn reveal_document_file(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(AppError::Message("File does not exist.".into()));
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", path_to_string(&path)));
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or_else(|| Path::new(".")));
        command
    };
    command.spawn()?;
    Ok(())
}

#[tauri::command]
fn open_document_file(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(AppError::Message("File does not exist.".into()));
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", &path_to_string(&path)]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };
    command.spawn()?;
    Ok(())
}

#[tauri::command]
fn rename_document_file(app: AppHandle, path: String, name: String) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    let extension = document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents can be renamed.".into()))?;
    if !path.is_file() {
        return Err(AppError::Message("Document file does not exist.".into()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let name = normalized_rename_stem(&name)?;
    let destination = parent.join(format!("{name}{extension}"));
    if destination == path {
        return Ok(read_document_at(&path)?);
    }
    if destination.exists() {
        return Err(AppError::Message("A document with that name already exists.".into()));
    }
    fs::rename(&path, &destination)?;
    if let Some(workspace_path) = workspace_root_for_document(parent) {
        touch_workspace_manifest(&workspace_path)?;
    }
    add_recent_file(&app, &destination)?;
    Ok(read_document_at(&destination)?)
}

#[tauri::command]
fn archive_document_file(path: String) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let workspace_path = workspace_root_for_document(parent)
        .ok_or_else(|| AppError::Message("Document must be inside a workspace.".into()))?;
    update_archived_document_file(&workspace_path, &path, true)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn restore_document_file(path: String) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let workspace_path = workspace_root_for_document(parent)
        .ok_or_else(|| AppError::Message("Document must be inside a workspace.".into()))?;
    update_archived_document_file(&workspace_path, &path, false)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn delete_document_file(app: AppHandle, path: String) -> AppResult<Option<Workspace>> {
    let path = PathBuf::from(path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let workspace_path = workspace_root_for_document(parent);
    fs::remove_file(&path)?;
    remove_recent_file(&app, &path)?;
    if let Some(workspace_path) = workspace_path {
        update_archived_document_file(&workspace_path, &path, false)?;
        return load_workspace_from_path(&workspace_path).map(Some);
    }
    Ok(None)
}

#[tauri::command]
fn save_document_to_workspace(
    app: AppHandle,
    workspace_path: String,
    name: String,
    bytes: Vec<u8>,
) -> AppResult<DocumentFile> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let file_name = document_file_name(&name)?;
    let destination = unique_copy_path(&workspace_path, std::ffi::OsStr::new(&file_name));
    write_file_atomically(&destination, &bytes)?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    add_recent_file(&app, &destination)?;
    read_document_at(&destination)
}

#[tauri::command]
fn copy_document_to_workspace(app: AppHandle, path: String, workspace_path: String) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents can be copied.".into()))?;
    if !path.is_file() {
        return Err(AppError::Message("Document file does not exist.".into()));
    }
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Message("Document file has no file name.".into()))?;
    let destination = unique_copy_path(&workspace_path, file_name);
    fs::copy(&path, &destination)?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    add_recent_file(&app, &destination)?;
    read_document_at(&destination)
}

#[tauri::command]
fn move_document_to_workspace(app: AppHandle, path: String, workspace_path: String) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents can be moved.".into()))?;
    if !path.is_file() {
        return Err(AppError::Message("Document file does not exist.".into()));
    }
    let source_parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let source_workspace = workspace_root_for_document(source_parent);
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    if fs::canonicalize(source_parent)? == fs::canonicalize(&workspace_path)? {
        touch_workspace_manifest(&workspace_path)?;
        add_recent_workspace(&app, &workspace_path)?;
        add_recent_file(&app, &path)?;
        return read_document_at(&path);
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Message("Document file has no file name.".into()))?;
    let destination = unique_copy_path(&workspace_path, file_name);
    fs::rename(&path, &destination)?;
    if let Some(source_workspace) = source_workspace {
        touch_workspace_manifest(&source_workspace)?;
    }
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    add_recent_file(&app, &destination)?;
    read_document_at(&destination)
}

#[tauri::command]
fn write_system_file_clipboard(request: SystemFileClipboardRequest) -> AppResult<()> {
    let files: Vec<PathBuf> = request
        .paths
        .iter()
        .map(PathBuf::from)
        .filter(|path| document_extension(path).is_some() && path.exists())
        .collect();
    if files.is_empty() {
        return Err(AppError::Message("No supported document files to copy.".into()));
    }
    if !cfg!(target_os = "macos") {
        return Err(AppError::Message("System file clipboard is currently supported on macOS only.".into()));
    }
    run_apple_script(&mac_file_clipboard_write_script(&files))?;
    Ok(())
}

#[tauri::command]
fn paste_system_files_to_workspace(app: AppHandle, workspace_path: String) -> AppResult<AddFilesResult> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    if !cfg!(target_os = "macos") {
        return Err(AppError::Message("System file paste is currently supported on macOS only.".into()));
    }
    let output = run_apple_script(mac_file_clipboard_read_script())?;
    let source_paths: Vec<PathBuf> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect();
    if source_paths.is_empty() {
        return Err(AppError::Message("No files are available to paste.".into()));
    }
    let mut copied_paths = Vec::new();
    for source in source_paths {
        if document_extension(&source).is_none() || !source.is_file() {
            continue;
        }
        let file_name = source
            .file_name()
            .ok_or_else(|| AppError::Message("Document file has no file name.".into()))?;
        let destination = unique_copy_path(&workspace_path, file_name);
        fs::copy(&source, &destination)?;
        add_recent_file(&app, &destination)?;
        copied_paths.push(destination.to_string_lossy().to_string());
    }
    if copied_paths.is_empty() {
        return Err(AppError::Message("No supported .hvy, .thvy, .phvy, or .md files are available to paste.".into()));
    }
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    Ok(AddFilesResult {
        workspace: load_workspace_from_path(&workspace_path)?,
        copied_paths,
        copied_template_paths: Vec::new(),
    })
}

fn mac_file_clipboard_write_script(files: &[PathBuf]) -> String {
    let file_items = files
        .iter()
        .map(|file| format!("POSIX file {}", apple_script_string(&file.to_string_lossy())))
        .collect::<Vec<_>>()
        .join(", ");
    format!("set the clipboard to {{{file_items}}}")
}

fn mac_file_clipboard_read_script() -> &'static str {
    r#"
use framework "AppKit"
use scripting additions
set pasteboard to current application's NSPasteboard's generalPasteboard()
set urls to pasteboard's readObjectsForClasses:{current application's NSURL} options:(missing value)
set filePaths to {}
if urls is not missing value then
  repeat with fileUrl in urls
    if (fileUrl's isFileURL()) as boolean then set end of filePaths to (fileUrl's |path|()) as text
  end repeat
end if
set AppleScript's text item delimiters to linefeed
return filePaths as text
"#
}

fn apple_script_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn run_apple_script(script: &str) -> AppResult<String> {
    let output = Command::new("/usr/bin/osascript").arg("-e").arg(script).output()?;
    if !output.status.success() {
        return Err(AppError::Message(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn create_document_backup(app: AppHandle, request: DocumentBackupRequest) -> AppResult<Option<DocumentBackup>> {
    if document_extension(Path::new(&request.name)).is_none() {
        return Err(AppError::Message("Recovery draft document name must end in .hvy, .thvy, .phvy, or .md.".into()));
    }
    prune_document_backups(&app)?;
    let created_at = Utc::now().to_rfc3339();
    let id = document_backup_id(&request, &created_at);
    let snapshot = DocumentBackupSnapshot {
        id: id.clone(),
        document_path: request.document_path,
        name: request.name,
        extension: request.extension,
        created_at,
        bytes: request.bytes,
        recovery_state: request.recovery_state,
    };
    write_json_atomically(&document_backup_path(&app, &id)?, &snapshot)?;
    Ok(Some(snapshot_metadata(&snapshot)))
}

#[tauri::command]
fn list_document_backups(app: AppHandle) -> AppResult<Vec<DocumentBackup>> {
    prune_document_backups(&app)?;
    let mut snapshots = read_document_backup_snapshots(&app)?;
    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    let mut seen_documents = HashSet::new();
    let mut backups = Vec::new();
    for snapshot in snapshots {
        if document_backup_matches_saved_file(&snapshot) {
            continue;
        }
        let document_key = document_backup_key(&snapshot);
        if seen_documents.contains(&document_key) {
            continue;
        }
        seen_documents.insert(document_key);
        backups.push(snapshot_metadata(&snapshot));
    }
    Ok(backups)
}

#[tauri::command]
fn restore_document_backup(app: AppHandle, id: String) -> AppResult<DocumentFile> {
    prune_document_backups(&app)?;
    let snapshot = read_document_backup_snapshot(&document_backup_path(&app, &id)?)?;
    Ok(DocumentFile {
        path: snapshot.document_path,
        name: snapshot.name,
        extension: snapshot.extension,
        bytes: snapshot.bytes,
        recovery_state: snapshot.recovery_state,
    })
}

#[tauri::command]
fn discard_document_backup(app: AppHandle, id: String) -> AppResult<()> {
    let path = document_backup_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[tauri::command]
fn clear_document_recovery_drafts(app: AppHandle, request: DocumentRecoveryDraftRequest) -> AppResult<()> {
    let directory = document_backups_dir(&app)?;
    if !directory.exists() {
        return Ok(());
    }
    let key = document_recovery_draft_key(&request.document_path, &request.name);
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Ok(snapshot) = read_document_backup_snapshot(&path) else {
            continue;
        };
        if document_backup_key(&snapshot) == key {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
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

#[tauri::command]
fn close_app_window(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn update_file_menu_state(app: AppHandle, native_menu: State<NativeMenuState>, state: FileMenuState) -> AppResult<()> {
    *native_menu.file_menu.lock().unwrap() = state.clone();
    if let Some(menu) = app.menu() {
        set_file_menu_state(&menu, &state)?;
    }
    Ok(())
}

pub fn run() {
    set_native_process_name();

    tauri::Builder::default()
        .manage(McpRuntime::default())
        .manage(NativeMenuState::default())
        .setup(|app| {
            set_native_process_name();
            install_camera_permission_handler(app.handle());
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-event", event.id().as_ref().to_string());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_recent_state,
            load_ai_settings,
            save_ai_settings,
            load_mcp_settings,
            save_mcp_settings,
            load_mcp_server_status,
            load_mcp_stdio_launch_config,
            load_mcp_client_install_status,
            load_archived_workspaces,
            install_mcp_client,
            remove_mcp_client,
            restore_mcp_client_backup,
            start_mcp_server,
            stop_mcp_server,
            update_mcp_workspaces,
            load_default_guide,
            open_workspace_dialog,
            choose_workspace_folder,
            create_workspace,
            new_workspace_dialog,
            initialize_workspace_path,
            load_workspace,
            rename_workspace,
            archive_workspace,
            unarchive_workspace,
            add_files_to_workspace,
            add_dropped_files_to_workspace,
            open_file_dialog,
            open_import_source_dialog,
            read_document_file,
            save_document_file,
            save_document_as_dialog,
            save_pdf_as_dialog,
            list_saved_templates,
            save_document_template,
            update_workspace_template_visibility,
            open_color_theme_dialog,
            save_color_theme_as_dialog,
            update_file_menu_state,
            create_document_file,
            reveal_document_file,
            open_document_file,
            rename_document_file,
            archive_document_file,
            restore_document_file,
            delete_document_file,
            save_document_to_workspace,
            copy_document_to_workspace,
            move_document_to_workspace,
            write_system_file_clipboard,
            paste_system_files_to_workspace,
            create_document_backup,
            list_document_backups,
            restore_document_backup,
            discard_document_backup,
            clear_document_recovery_drafts,
            open_external_url,
            close_app_window
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

#[cfg(target_os = "windows")]
fn install_camera_permission_handler(app: &AppHandle) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND,
            COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
        PermissionRequestedEventHandler,
    };

    let Some(webview) = app.get_webview_window("main") else {
        return;
    };
    let _ = webview.with_webview(|webview| unsafe {
        let Ok(core_webview) = webview.controller().CoreWebView2() else {
            return;
        };
        let mut token = 0;
        let _ = core_webview.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

#[cfg(not(target_os = "windows"))]
fn install_camera_permission_handler(_app: &AppHandle) {}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let recent = recent_state_path(app)
        .ok()
        .and_then(|path| read_recent_state(&path).ok())
        .unwrap_or_default();
    let recent_files = build_recent_files_menu(app, &recent)?;
    let recent_workspaces = build_recent_workspaces_menu(app, &recent)?;
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "HVY Galaxy")
        .item(&MenuItemBuilder::new("About HVY Galaxy").id("about").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Services"))?)
        .separator()
        .item(&app_shortcut_menu_item(app, "Quit HVY Galaxy", "app-close-requested", "CmdOrCtrl+Q")?)
        .build()?;

    let file_builder = SubmenuBuilder::with_id(app, "file-menu", "File")
        .item(&app_shortcut_menu_item(app, "New Workspace", "new-workspace", "CmdOrCtrl+N")?)
        .item(&app_shortcut_menu_item(app, "Open Workspace", "open-workspace", "CmdOrCtrl+O")?)
        .item(&MenuItemBuilder::new("Manage Workspaces...").id("manage-workspaces").build(app)?)
        .item(&app_shortcut_menu_item(app, "Open File", "open-file", "CmdOrCtrl+Shift+O")?)
        .item(&recent_workspaces)
        .item(&recent_files)
        .separator();
    let file_builder = file_builder
        .item(&disabled_app_shortcut_menu_item(app, "Close Document", "close-document", "CmdOrCtrl+W")?)
        .item(&disabled_app_shortcut_menu_item(app, "Save", "save", "CmdOrCtrl+S")?)
        .item(&disabled_app_shortcut_menu_item(app, "Save As...", "save-as", "CmdOrCtrl+Shift+S")?)
        .item(&MenuItemBuilder::new("Save to Workspace...").id("save-to-workspace").enabled(false).build(app)?)
        .item(&MenuItemBuilder::new("Export PDF...").id("export-pdf").enabled(false).build(app)?)
        .item(&MenuItemBuilder::new("Import Into Current...").id("import-current").enabled(false).build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Recover Unsaved Edits...").id("recover-backup").build(app)?);
    #[cfg(not(target_os = "macos"))]
    let file_builder = file_builder
        .separator()
        .item(&app_shortcut_menu_item(app, "Quit HVY Galaxy", "app-close-requested", "CmdOrCtrl+Q")?);
    let file = file_builder.build()?;
    let ai = SubmenuBuilder::with_id(app, "ai-menu", "AI")
        .item(&app_shortcut_menu_item(app, "LLM Settings...", "ai-settings", "CmdOrCtrl+,")?)
        .item(&MenuItemBuilder::new("MCP Settings...").id("mcp-settings").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::with_id(app, "edit-menu", "Edit")
        .item(&PredefinedMenuItem::undo(app, Some("Undo"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Redo"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .separator()
        .item(&MenuItemBuilder::new("Colors").id("colors").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .build()?;
    let help_builder = SubmenuBuilder::with_id(app, "help-menu", "Help")
        .item(
            &MenuItemBuilder::new("HVY Guide")
                .id("open-guide")
                .accelerator("F1")
                .build(app)?,
        );
    #[cfg(not(target_os = "macos"))]
    let help_builder = help_builder
        .separator()
        .item(&MenuItemBuilder::new("About HVY Galaxy").id("about").build(app)?);
    let help = help_builder.build()?;

    let builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let builder = builder.item(&app_menu);
    builder.item(&file).item(&edit).item(&ai).item(&help).build()
}

fn app_shortcut_menu_item(
    app: &AppHandle,
    label: &str,
    id: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::new(label).id(id);
    #[cfg(target_os = "macos")]
    let builder = builder.accelerator(accelerator);
    #[cfg(not(target_os = "macos"))]
    let _ = accelerator;
    builder.build(app)
}

fn disabled_app_shortcut_menu_item(
    app: &AppHandle,
    label: &str,
    id: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::new(label).id(id).enabled(false);
    #[cfg(target_os = "macos")]
    let builder = builder.accelerator(accelerator);
    #[cfg(not(target_os = "macos"))]
    let _ = accelerator;
    builder.build(app)
}

fn build_recent_files_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::with_id(app, "recent-files", "Recent Files");
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

fn build_recent_workspaces_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::with_id(app, "recent-workspaces", "Recent Workspaces");
    if recent.workspaces.is_empty() {
        builder = builder.item(&MenuItemBuilder::new("No Recent Workspaces").id("recent-workspaces-empty").build(app)?);
    } else {
        for path in &recent.workspaces {
            builder = builder.item(
                &MenuItemBuilder::new(menu_label(path))
                    .id(format!("recent-workspace:{path}"))
                    .build(app)?,
            );
        }
    }
    builder.build()
}

fn ensure_workspace(path: &Path) -> AppResult<Workspace> {
    if workspace_manifest_path(path).is_some() {
        load_workspace_from_path(path)
    } else {
        initialize_workspace(path)
    }
}

fn initialize_workspace(path: &Path) -> AppResult<Workspace> {
    initialize_workspace_with_name(path, None)
}

fn initialize_workspace_with_name(path: &Path, name: Option<&str>) -> AppResult<Workspace> {
    if !path.is_dir() {
        return Err(AppError::Message("Workspace path must be a folder.".into()));
    }
    let manifest_path = workspace_manifest_path(path).unwrap_or_else(|| path.join(WORKSPACE_MANIFEST));
    let now = Utc::now().to_rfc3339();
    let manifest = if manifest_path.exists() {
        read_manifest(&manifest_path)?
    } else {
        WorkspaceManifest {
            schema_version: 1,
            name: name
                .map(ToOwned::to_owned)
                .or_else(|| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "Untitled Workspace".into()),
            created_at: now.clone(),
            updated_at: now,
            root_files: Vec::new(),
            expanded_paths: Vec::new(),
            template_visibility: WorkspaceTemplateVisibility::default(),
            archived_files: Vec::new(),
        }
    };
    write_json_atomically(&manifest_path, &manifest)?;
    load_workspace_from_path(path)
}

fn unique_managed_workspace_path(app: &AppHandle, name: &str) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("workspaces");
    fs::create_dir_all(&directory)?;

    let slug = workspace_folder_name(name);
    let mut candidate = directory.join(&slug);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = directory.join(format!("{slug}-{suffix}"));
        suffix += 1;
    }
    Ok(candidate)
}

fn workspace_folder_name(name: &str) -> String {
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
        "workspace".into()
    } else {
        slug
    }
}

fn load_workspace_from_path(path: &Path) -> AppResult<Workspace> {
    load_workspace_from_path_with_options(path, false)
}

fn load_workspace_from_path_with_options(path: &Path, include_templates: bool) -> AppResult<Workspace> {
    let manifest_path = workspace_manifest_path(path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let manifest = read_manifest(&manifest_path)?;
    Ok(Workspace {
        path: path_to_string(path),
        files: scan_workspace_files(path, &manifest.archived_files, include_templates)?,
        manifest,
    })
}

fn read_manifest(path: &Path) -> AppResult<WorkspaceManifest> {
    let bytes = fs::read(path)?;
    let manifest: WorkspaceManifest = serde_json::from_slice(&bytes)?;
    if manifest.schema_version != 1 {
        return Err(AppError::Message("Unsupported workspace schema version.".into()));
    }
    Ok(manifest)
}

fn touch_workspace_manifest(path: &Path) -> AppResult<()> {
    let Some(manifest_path) = workspace_manifest_path(path) else {
        return Ok(());
    };
    let mut manifest = read_manifest(&manifest_path)?;
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn workspace_manifest_path(path: &Path) -> Option<PathBuf> {
    let current = path.join(WORKSPACE_MANIFEST);
    if current.exists() {
        return Some(current);
    }
    let legacy = path.join(LEGACY_WORKSPACE_MANIFEST);
    legacy.exists().then_some(legacy)
}

fn scan_workspace_files(root: &Path, archived_files: &[String], include_templates: bool) -> AppResult<Vec<WorkspaceTreeNode>> {
    scan_directory(root, root, archived_files, include_templates)
}

fn scan_directory(root: &Path, directory: &Path, archived_files: &[String], include_templates: bool) -> AppResult<Vec<WorkspaceTreeNode>> {
    let mut folders = Vec::new();
    let mut files = Vec::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(root, &path, &name, include_templates) {
            continue;
        }
        if path.is_dir() {
            let children = scan_directory(root, &path, archived_files, include_templates)?;
            if !children.is_empty() {
                folders.push(WorkspaceTreeNode::Folder {
                    name,
                    path: path_to_string(&path),
                    relative_path: relative_path(root, &path),
                    children,
                });
            }
        } else if let Some(extension) = document_extension(&path) {
            let relative_path = relative_path(root, &path);
            files.push(WorkspaceTreeNode::File {
                name,
                path: path_to_string(&path),
                archived: archived_files.iter().any(|archived| archived == &relative_path),
                relative_path,
                extension,
            });
        }
    }

    folders.sort_by_key(node_name);
    files.sort_by_key(node_name);
    folders.extend(files);
    Ok(folders)
}

fn should_ignore(root: &Path, path: &Path, name: &str, include_templates: bool) -> bool {
    name == WORKSPACE_MANIFEST
        || name == LEGACY_WORKSPACE_MANIFEST
        || name.starts_with('.')
        || (!include_templates && path == workspace_templates_dir_path(root))
        || matches!(name, "node_modules" | "dist" | "build" | "target" | ".git")
}

fn document_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "hvy" => Some(".hvy".into()),
        "thvy" => Some(".thvy".into()),
        "phvy" => Some(".phvy".into()),
        "md" => Some(".md".into()),
        _ => None,
    }
}

fn import_source_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "hvy" => Some(".hvy".into()),
        "thvy" => Some(".thvy".into()),
        "phvy" => Some(".phvy".into()),
        "txt" => Some(".txt".into()),
        "md" => Some(".md".into()),
        _ => None,
    }
}

fn template_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "thvy" => Some(".thvy".into()),
        "phvy" => Some(".phvy".into()),
        _ => None,
    }
}

fn pdf_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(".pdf".into()),
        _ => None,
    }
}

fn theme_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "hvytheme" => Some(".hvytheme".into()),
        "json" => Some(".json".into()),
        _ => None,
    }
}

fn ensure_theme_file_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "Untitled Theme.hvytheme".into();
    }
    let path = Path::new(trimmed);
    if theme_extension(path).is_some() {
        trimmed.to_string()
    } else {
        format!("{trimmed}.hvytheme")
    }
}

fn ensure_pdf_file_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "document.pdf".into();
    }
    let path = Path::new(trimmed);
    if pdf_extension(path).is_some() {
        trimmed.to_string()
    } else {
        format!("{trimmed}.pdf")
    }
}

fn read_theme_at(path: &Path) -> AppResult<ThemeFile> {
    theme_extension(path)
        .ok_or_else(|| AppError::Message("Only .hvytheme and .json theme files are supported.".into()))?;
    Ok(ThemeFile {
        path: path_to_string(path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled Theme.hvytheme")
            .to_string(),
        bytes: fs::read(path)?,
    })
}

fn normalized_rename_stem(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("Document name is required.".into()));
    }
    let path = Path::new(trimmed);
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || path.components().count() != 1
        || path.file_name().and_then(|name| name.to_str()) != Some(trimmed)
    {
        return Err(AppError::Message("Document name cannot include folders.".into()));
    }
    if trimmed == "." || trimmed == ".." || trimmed.starts_with('.') {
        return Err(AppError::Message("Document name is not valid.".into()));
    }
    let stem = if document_extension(path).is_some() {
        path.file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(trimmed)
            .trim()
    } else {
        trimmed
    };
    if stem.is_empty() {
        return Err(AppError::Message("Document name is required.".into()));
    }
    Ok(stem.into())
}

fn document_file_name(name: &str) -> AppResult<String> {
    let stem = normalized_rename_stem(name)?;
    let path = Path::new(name.trim());
    let extension = document_extension(path).unwrap_or_else(|| ".hvy".into());
    Ok(format!("{stem}{extension}"))
}

fn workspace_root_for_document(parent: &Path) -> Option<PathBuf> {
    parent
        .ancestors()
        .find(|candidate| candidate.join(WORKSPACE_MANIFEST).is_file() || candidate.join(LEGACY_WORKSPACE_MANIFEST).is_file())
        .map(Path::to_path_buf)
}

fn unique_copy_path(root: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("document");
    let extension = original.extension().and_then(|extension| extension.to_str());
    let mut path = root.join(original);
    let mut index = 2;

    while path.exists() {
        let candidate_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem} {index}.{extension}"),
            _ => format!("{stem} {index}"),
        };
        path = root.join(candidate_name);
        index += 1;
    }

    path
}

fn read_document_at(path: &Path) -> AppResult<DocumentFile> {
    let extension = document_extension(path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents are supported.".into()))?;
    Ok(DocumentFile {
        path: path_to_string(path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string(),
        extension,
        bytes: fs::read(path)?,
        recovery_state: None,
    })
}

fn append_saved_templates(templates: &mut Vec<SavedTemplate>, directory: &Path, scope: &str) -> AppResult<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && template_extension(&path).is_some() {
            templates.push(read_saved_template_at(&path, scope)?);
        }
    }
    Ok(())
}

fn read_saved_template_at(path: &Path, scope: &str) -> AppResult<SavedTemplate> {
    let extension = template_extension(path)
        .ok_or_else(|| AppError::Message("Only .thvy and .phvy templates are supported.".into()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.thvy")
        .to_string();
    Ok(SavedTemplate {
        id: format!("{scope}:{}", path_to_string(path)),
        path: path_to_string(path),
        name,
        scope: scope.to_string(),
        extension,
        bytes: fs::read(path)?,
    })
}

fn template_file_name(name: &str, requested_extension: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("Template name is required.".into()));
    }
    let path = Path::new(trimmed);
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || path.components().count() != 1
        || path.file_name().and_then(|name| name.to_str()) != Some(trimmed)
    {
        return Err(AppError::Message("Template name cannot include folders.".into()));
    }
    if trimmed == "." || trimmed == ".." || trimmed.starts_with('.') {
        return Err(AppError::Message("Template name is not valid.".into()));
    }
    let stem = if template_extension(path).is_some() || document_extension(path).is_some() {
        path.file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(trimmed)
            .trim()
    } else {
        trimmed
    };
    if stem.is_empty() {
        return Err(AppError::Message("Template name is required.".into()));
    }
    let extension = if requested_extension == ".phvy" { ".phvy" } else { ".thvy" };
    Ok(format!("{stem}{extension}"))
}

fn app_templates_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("templates");
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn workspace_templates_dir(workspace_path: &Path) -> AppResult<PathBuf> {
    let directory = workspace_templates_dir_path(workspace_path);
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn workspace_templates_dir_path(workspace_path: &Path) -> PathBuf {
    workspace_path.join("templates")
}

fn add_recent_workspace(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    push_recent(&mut state.workspaces, path);
    state.workspaces.retain(|entry| Path::new(entry).is_dir());
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn remove_recent_workspace(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    let normalized = path_to_string(path);
    state.workspaces.retain(|entry| entry != &normalized);
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn add_archived_workspace(app: &AppHandle, workspace: ArchivedWorkspace) -> AppResult<()> {
    let archive_path = archived_workspaces_path(app)?;
    let mut archived = read_archived_workspaces(&archive_path)?;
    archived.retain(|entry| entry.path != workspace.path);
    archived.insert(0, workspace);
    write_json_atomically(&archive_path, &archived)
}

fn remove_archived_workspace(app: &AppHandle, path: &Path) -> AppResult<()> {
    let archive_path = archived_workspaces_path(app)?;
    let mut archived = read_archived_workspaces(&archive_path)?;
    let normalized = path_to_string(path);
    archived.retain(|entry| entry.path != normalized);
    write_json_atomically(&archive_path, &archived)
}

fn add_recent_file(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    push_recent(&mut state.files, path);
    state.files.retain(|entry| Path::new(entry).is_file());
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn remove_recent_file(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    let normalized = path_to_string(path);
    state.files.retain(|entry| entry != &normalized);
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn update_archived_document_file(workspace_path: &Path, file_path: &Path, archived: bool) -> AppResult<()> {
    let manifest_path = workspace_manifest_path(workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    let relative = relative_path(workspace_path, file_path);
    manifest.archived_files.retain(|entry| entry != &relative);
    if archived {
        manifest.archived_files.push(relative);
        manifest.archived_files.sort();
    }
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn snapshot_metadata(snapshot: &DocumentBackupSnapshot) -> DocumentBackup {
    DocumentBackup {
        id: snapshot.id.clone(),
        document_path: snapshot.document_path.clone(),
        name: snapshot.name.clone(),
        extension: snapshot.extension.clone(),
        created_at: snapshot.created_at.clone(),
    }
}

fn document_backup_matches_saved_file(snapshot: &DocumentBackupSnapshot) -> bool {
    if snapshot.document_path.is_empty() {
        return false;
    }
    if let (Ok(metadata), Ok(created_at)) = (
        fs::metadata(&snapshot.document_path),
        DateTime::parse_from_rfc3339(&snapshot.created_at),
    ) {
        if let Ok(modified) = metadata.modified() {
            if DateTime::<Utc>::from(modified) >= created_at.with_timezone(&Utc) {
                return true;
            }
        }
    }
    let Ok(saved_bytes) = fs::read(&snapshot.document_path) else {
        return false;
    };
    saved_bytes == snapshot.bytes
}

fn document_backup_key(snapshot: &DocumentBackupSnapshot) -> String {
    document_recovery_draft_key(&snapshot.document_path, &snapshot.name)
}

fn document_recovery_draft_key(document_path: &str, name: &str) -> String {
    if document_path.is_empty() {
        format!("untitled:{name}")
    } else {
        document_path.to_string()
    }
}

fn read_document_backup_snapshots(app: &AppHandle) -> AppResult<Vec<DocumentBackupSnapshot>> {
    let directory = document_backups_dir(app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        if let Ok(snapshot) = read_document_backup_snapshot(&path) {
            snapshots.push(snapshot);
        }
    }
    Ok(snapshots)
}

fn read_document_backup_snapshot(path: &Path) -> AppResult<DocumentBackupSnapshot> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn prune_document_backups(app: &AppHandle) -> AppResult<()> {
    let directory = document_backups_dir(app)?;
    if !directory.exists() {
        return Ok(());
    }
    let cutoff = Utc::now() - Duration::hours(BACKUP_RETENTION_HOURS);
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let should_remove = read_document_backup_snapshot(&path)
            .ok()
            .and_then(|snapshot| DateTime::parse_from_rfc3339(&snapshot.created_at).ok())
            .map(|created_at| created_at.with_timezone(&Utc) < cutoff)
            .unwrap_or(true);
        if should_remove {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn document_backup_id(request: &DocumentBackupRequest, created_at: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    request.document_path.hash(&mut hasher);
    request.name.hash(&mut hasher);
    request.bytes.hash(&mut hasher);
    created_at.hash(&mut hasher);
    format!(
        "{}-{:016x}",
        created_at
            .chars()
            .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
            .collect::<String>(),
        hasher.finish()
    )
}

fn document_backup_path(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.trim().is_empty() {
        return Err(AppError::Message("Invalid backup id.".into()));
    }
    Ok(document_backups_dir(app)?.join(format!("{id}.json")))
}

fn document_backups_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("backups");
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn refresh_menu(app: &AppHandle) -> AppResult<()> {
    if let Some(menu) = app.menu() {
        refresh_menu_items(app, &menu)?;
        return Ok(());
    }
    let menu = build_menu(app).map_err(|error| AppError::Message(error.to_string()))?;
    refresh_menu_items(app, &menu)?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| AppError::Message(error.to_string()))
}

fn refresh_menu_items(app: &AppHandle, menu: &tauri::menu::Menu<tauri::Wry>) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let recent = read_recent_state(&recent_path)?;
    let file = menu
        .get("file-menu")
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| AppError::Message("File menu is unavailable.".into()))?;
    let recent_files = file
        .get("recent-files")
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| AppError::Message("Recent Files menu is unavailable.".into()))?;
    let recent_workspaces = file
        .get("recent-workspaces")
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| AppError::Message("Recent Workspaces menu is unavailable.".into()))?;
    replace_recent_menu_items(app, &recent_files, &recent.files, "recent-file:", "No Recent Files")?;
    replace_recent_menu_items(
        app,
        &recent_workspaces,
        &recent.workspaces,
        "recent-workspace:",
        "No Recent Workspaces",
    )?;
    let native_menu = app.state::<NativeMenuState>();
    set_file_menu_state(menu, &native_menu.file_menu.lock().unwrap())?;

    Ok(())
}

fn set_file_menu_state(menu: &tauri::menu::Menu<tauri::Wry>, state: &FileMenuState) -> AppResult<()> {
    let file = menu
        .get("file-menu")
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| AppError::Message("File menu is unavailable.".into()))?;
    set_submenu_item_enabled(&file, "close-document", state.close_document)?;
    set_submenu_item_enabled(&file, "save", state.save)?;
    set_submenu_item_enabled(&file, "save-as", state.save_as)?;
    set_submenu_item_enabled(&file, "save-to-workspace", state.save_to_workspace)?;
    set_submenu_item_enabled(&file, "export-pdf", state.export_pdf)?;
    set_submenu_item_enabled(&file, "import-current", state.import_current)?;
    Ok(())
}

fn set_submenu_item_enabled(
    menu: &Submenu<tauri::Wry>,
    id: &str,
    enabled: bool,
) -> AppResult<()> {
    if let Some(item) = menu.get(id).and_then(|item| item.as_menuitem().cloned()) {
        item.set_enabled(enabled)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

fn replace_recent_menu_items(
    app: &AppHandle,
    menu: &Submenu<tauri::Wry>,
    entries: &[String],
    prefix: &str,
    empty_label: &str,
) -> AppResult<()> {
    while !menu
        .items()
        .map_err(|error| AppError::Message(error.to_string()))?
        .is_empty()
    {
        menu.remove_at(0)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    if entries.is_empty() {
        let item = MenuItemBuilder::new(empty_label)
            .id(format!("{prefix}empty"))
            .enabled(false)
            .build(app)
            .map_err(|error| AppError::Message(error.to_string()))?;
        menu.append(&item)
            .map_err(|error| AppError::Message(error.to_string()))?;
        return Ok(());
    }
    for path in entries {
        let item = MenuItemBuilder::new(menu_label(path))
            .id(format!("{prefix}{path}"))
            .build(app)
            .map_err(|error| AppError::Message(error.to_string()))?;
        menu.append(&item)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
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
        workspaces: state
            .workspaces
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

fn read_archived_workspaces(path: &Path) -> AppResult<Vec<ArchivedWorkspace>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut archived: Vec<ArchivedWorkspace> = serde_json::from_slice(&fs::read(path)?)?;
    archived.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(archived)
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

fn read_mcp_settings(path: &Path) -> AppResult<McpSettings> {
    if !path.exists() {
        return Ok(McpSettings::default());
    }
    let settings: McpSettings = serde_json::from_slice(&fs::read(path)?)?;
    normalize_mcp_settings(settings)
}

fn normalize_mcp_settings(settings: McpSettings) -> AppResult<McpSettings> {
    let write_access = normalize_mcp_write_access(&settings.write_access);
    let bearer_token = settings.bearer_token.trim().to_string();
    Ok(McpSettings {
        start_automatically: settings.start_automatically,
        port: settings.port.filter(|port| *port > 0),
        write_access,
        bearer_token,
    })
}

fn normalize_mcp_write_access(value: &str) -> String {
    match value.trim() {
        "searchOnly" | "hvyCliEdits" | "createImportSave" => value.trim().to_string(),
        _ => default_mcp_write_access(),
    }
}

fn spawn_mcp_server(app: AppHandle, port: u16) -> AppResult<McpServerHandle> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name("hvy-mcp-server".into())
        .spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle_mcp_stream(&app, stream),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(StdDuration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
        })?;
    Ok(McpServerHandle {
        stop,
        thread: Some(thread),
    })
}

fn handle_mcp_stream(app: &AppHandle, mut stream: TcpStream) {
    let response = match read_http_request(&mut stream) {
        Ok(request) => handle_mcp_http_request(app, request),
        Err(error) => http_json_response(
            400,
            &json_rpc_error(None, -32700, &format!("Invalid request: {error}")),
        ),
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

fn read_http_request(stream: &mut TcpStream) -> AppResult<HttpRequest> {
    stream.set_read_timeout(Some(StdDuration::from_secs(2)))?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(AppError::Message("Connection closed before headers.".into()));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() > 64 * 1024 {
            return Err(AppError::Message("HTTP headers are too large.".into()));
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| AppError::Message("Missing request line.".into()))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| AppError::Message("Missing HTTP method.".into()))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| AppError::Message("Missing HTTP path.".into()))?
        .to_string();
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect::<Vec<_>>();
    let content_length = headers
        .iter()
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn handle_mcp_http_request(app: &AppHandle, request: HttpRequest) -> String {
    if request.method == "GET" && request.path == "/health" {
        return http_json_response(
            200,
            &serde_json::json!({
                "status": "ok",
                "server": "hvy-galaxy"
            }),
        );
    }
    if request.method != "POST" || request.path.split('?').next() != Some("/mcp") {
        return http_json_response(
            404,
            &serde_json::json!({
                "error": "HVY MCP server listens for POST requests at /mcp."
            }),
        );
    }
    let settings = match mcp_settings_path(app).and_then(|path| read_mcp_settings(&path)) {
        Ok(settings) => settings,
        Err(error) => {
            return http_json_response(
                500,
                &json_rpc_error(None, -32000, &format!("Could not load MCP settings: {error}")),
            )
        }
    };
    if !mcp_request_is_authorized(&request, &settings.bearer_token) {
        return http_json_response(401, &json_rpc_error(None, -32001, "Unauthorized."));
    }
    let parsed = serde_json::from_slice::<serde_json::Value>(&request.body);
    let response = match parsed {
        Ok(value) => handle_mcp_json_rpc(app, value),
        Err(error) => json_rpc_error(None, -32700, &format!("Invalid JSON: {error}")),
    };
    http_json_response(200, &response)
}

fn mcp_request_is_authorized(request: &HttpRequest, bearer_token: &str) -> bool {
    if bearer_token.trim().is_empty() {
        return true;
    }
    let Some((scheme, token)) = request.header("authorization").and_then(|value| value.split_once(' ')) else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer") && token.trim() == bearer_token
}

fn handle_mcp_json_rpc(app: &AppHandle, request: serde_json::Value) -> serde_json::Value {
    let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = request.get("method").and_then(|method| method.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(serde_json::Value::Null);
    match method {
        "initialize" => json_rpc_result(id, mcp_initialize_result(&params)),
        "notifications/initialized" => serde_json::Value::Null,
        "tools/list" => json_rpc_result(id, serde_json::json!({ "tools": mcp_tool_list() })),
        "tools/call" => match handle_mcp_tool_call(app, params) {
            Ok(result) => json_rpc_result(id, result),
            Err(error) => json_rpc_error(Some(id), -32000, &error.to_string()),
        },
        _ => json_rpc_error(Some(id), -32601, "Method not found."),
    }
}

fn handle_mcp_json_rpc_for_workspaces(workspaces: &[Workspace], request: serde_json::Value) -> serde_json::Value {
    handle_mcp_json_rpc_for_workspaces_with_access(workspaces, request, &default_mcp_write_access())
}

fn handle_mcp_json_rpc_for_workspaces_with_access(
    workspaces: &[Workspace],
    request: serde_json::Value,
    write_access: &str,
) -> serde_json::Value {
    let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = request.get("method").and_then(|method| method.as_str()).unwrap_or("");
    let params = request.get("params").cloned().unwrap_or(serde_json::Value::Null);
    match method {
        "initialize" => json_rpc_result(id, mcp_initialize_result(&params)),
        "notifications/initialized" => serde_json::Value::Null,
        "tools/list" => json_rpc_result(id, serde_json::json!({ "tools": mcp_tool_list() })),
        "tools/call" => match handle_mcp_tool_call_from_with_access(workspaces, params, write_access) {
            Ok(result) => json_rpc_result(id, result),
            Err(error) => json_rpc_error(Some(id), -32000, &error.to_string()),
        },
        _ => json_rpc_error(Some(id), -32601, "Method not found."),
    }
}

fn mcp_initialize_result(params: &serde_json::Value) -> serde_json::Value {
    let protocol_version = params
        .get("protocolVersion")
        .and_then(|version| version.as_str())
        .unwrap_or("2025-06-18");
    serde_json::json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "hvy-galaxy",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn mcp_tool_list() -> serde_json::Value {
    serde_json::json!([
        {
            "name": "workspace.list",
            "description": "List workspaces currently added to HVY Galaxy without reading HVY file contents. Use this to discover which workspaces are available through HVY Galaxy.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "workspace.tree",
            "description": "Return low-context file trees for workspaces currently added to HVY Galaxy. Use this when the user asks what HVY files or folders are available in a workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspacePath": {
                        "type": "string",
                        "description": "Optional absolute path of one workspace to inspect. Omit to inspect every workspace currently added to HVY Galaxy."
                    }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "workspace.search",
            "description": "Search HVY files in workspaces currently added to HVY Galaxy and return matching file paths, snippets, and line numbers. Use this to answer questions like which HVY file contains a resume, a person's name, a topic, or other document content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search text, name, phrase, or topic to find inside HVY files in workspaces currently added to HVY Galaxy."
                    },
                    "workspacePath": {
                        "type": "string",
                        "description": "Optional absolute path of one workspace to search. Omit to search every workspace currently added to HVY Galaxy."
                    },
                    "max": {
                        "type": "number",
                        "description": "Maximum number of matching files to return."
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        }
    ])
}

fn handle_mcp_tool_call(app: &AppHandle, params: serde_json::Value) -> AppResult<serde_json::Value> {
    handle_mcp_tool_call_from(&known_workspaces(app)?, params)
}

fn handle_mcp_tool_call_from(workspaces: &[Workspace], params: serde_json::Value) -> AppResult<serde_json::Value> {
    handle_mcp_tool_call_from_with_access(workspaces, params, &default_mcp_write_access())
}

fn handle_mcp_tool_call_from_with_access(
    workspaces: &[Workspace],
    params: serde_json::Value,
    write_access: &str,
) -> AppResult<serde_json::Value> {
    let name = params
        .get("name")
        .and_then(|name| name.as_str())
        .ok_or_else(|| AppError::Message("tools/call requires a tool name.".into()))?;
    ensure_mcp_tool_allowed(name, write_access)?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let result = match name {
        "workspace.list" => mcp_workspace_list_from(workspaces)?,
        "workspace.tree" => mcp_workspace_tree_from(workspaces, arguments)?,
        "workspace.search" => mcp_workspace_search_from(workspaces, arguments)?,
        _ => return Err(AppError::Message(format!("Unknown tool: {name}"))),
    };
    Ok(mcp_tool_result(result))
}

fn ensure_mcp_tool_allowed(name: &str, write_access: &str) -> AppResult<()> {
    if mcp_tool_required_access(name) <= mcp_write_access_level(write_access) {
        return Ok(());
    }
    Err(AppError::Message(format!(
        "Tool {name} is not allowed by MCP write access setting."
    )))
}

fn mcp_tool_required_access(name: &str) -> u8 {
    match name {
        "workspace.list" | "workspace.tree" | "workspace.search" => 0,
        _ => 2,
    }
}

fn mcp_write_access_level(write_access: &str) -> u8 {
    match normalize_mcp_write_access(write_access).as_str() {
        "searchOnly" => 0,
        "hvyCliEdits" => 1,
        "createImportSave" => 2,
        _ => 1,
    }
}

fn mcp_workspace_list_from(workspaces: &[Workspace]) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({
        "workspaces": workspaces
            .iter()
            .map(|workspace| serde_json::json!({
                "name": workspace.manifest.name,
                "path": workspace.path,
                "updatedAt": workspace.manifest.updated_at,
                "fileCount": count_workspace_files(&workspace.files),
            }))
            .collect::<Vec<_>>()
    }))
}

fn mcp_workspace_tree_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
    let requested_path = arguments.get("workspacePath").and_then(|path| path.as_str());
    let workspaces = workspaces
        .iter()
        .filter(|workspace| requested_path.map(|path| path == workspace.path).unwrap_or(true))
        .map(|workspace| serde_json::json!({
            "name": workspace.manifest.name,
            "path": workspace.path,
            "files": workspace.files,
        }))
        .collect::<Vec<_>>();
    Ok(serde_json::json!({ "workspaces": workspaces }))
}

fn mcp_workspace_search_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
    let query = arguments
        .get("query")
        .and_then(|query| query.as_str())
        .unwrap_or("")
        .trim();
    if query.is_empty() {
        return Err(AppError::Message("workspace.search requires a non-empty query.".into()));
    }
    let max = arguments
        .get("max")
        .and_then(|max| max.as_u64())
        .map(|max| max.clamp(1, 100) as usize)
        .unwrap_or(25);
    let requested_path = arguments.get("workspacePath").and_then(|path| path.as_str());
    let query_lower = query.to_ascii_lowercase();
    let mut results = Vec::new();
    for workspace in workspaces {
        if requested_path.map(|path| path != workspace.path).unwrap_or(false) {
            continue;
        }
        for file in flatten_workspace_file_nodes(&workspace.files) {
            if results.len() >= max {
                break;
            }
            if let Ok(text) = fs::read_to_string(&file.path) {
                for (line_index, line) in text.lines().enumerate() {
                    if !line.to_ascii_lowercase().contains(&query_lower) {
                        continue;
                    }
                    results.push(serde_json::json!({
                        "workspaceName": workspace.manifest.name,
                        "workspacePath": workspace.path,
                        "path": file.path,
                        "relativePath": file.relative_path,
                        "extension": file.extension,
                        "lineNumber": line_index + 1,
                        "snippet": search_snippet(line, query),
                    }));
                    break;
                }
            }
            if results.len() >= max {
                break;
            }
        }
    }
    Ok(serde_json::json!({
        "query": query,
        "results": results
    }))
}

#[derive(Clone)]
struct FlatWorkspaceFile {
    path: String,
    relative_path: String,
    extension: String,
}

fn flatten_workspace_file_nodes(nodes: &[WorkspaceTreeNode]) -> Vec<FlatWorkspaceFile> {
    let mut files = Vec::new();
    append_workspace_file_nodes(nodes, &mut files);
    files
}

fn append_workspace_file_nodes(nodes: &[WorkspaceTreeNode], files: &mut Vec<FlatWorkspaceFile>) {
    for node in nodes {
        match node {
            WorkspaceTreeNode::File {
                path,
                relative_path,
                extension,
                ..
            } => files.push(FlatWorkspaceFile {
                path: path.clone(),
                relative_path: relative_path.clone(),
                extension: extension.clone(),
            }),
            WorkspaceTreeNode::Folder { children, .. } => append_workspace_file_nodes(children, files),
        }
    }
}

fn known_workspaces(app: &AppHandle) -> AppResult<Vec<Workspace>> {
    let runtime = app.state::<McpRuntime>();
    let paths = runtime
        .workspaces
        .lock()
        .map_err(|_| AppError::Message("MCP workspace lock is unavailable.".into()))?
        .clone();
    let mut workspaces = Vec::new();
    for path in paths {
        if let Ok(workspace) = load_workspace_from_path(Path::new(&path)) {
            workspaces.push(workspace);
        }
    }
    Ok(workspaces)
}

fn count_workspace_files(nodes: &[WorkspaceTreeNode]) -> usize {
    nodes
        .iter()
        .map(|node| match node {
            WorkspaceTreeNode::File { .. } => 1,
            WorkspaceTreeNode::Folder { children, .. } => count_workspace_files(children),
        })
        .sum()
}

fn search_snippet(line: &str, query: &str) -> String {
    let clean = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = clean.to_ascii_lowercase();
    let query_lower = query.to_ascii_lowercase();
    let Some(match_index) = lower.find(&query_lower) else {
        return clean.chars().take(180).collect();
    };
    let start = byte_index_saturating_before(&clean, match_index, 70);
    let end = byte_index_saturating_after(&clean, match_index + query.len(), 90);
    format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        &clean[start..end],
        if end < clean.len() { "..." } else { "" }
    )
}

fn byte_index_saturating_before(value: &str, byte_index: usize, chars_before: usize) -> usize {
    value[..byte_index.min(value.len())]
        .char_indices()
        .rev()
        .nth(chars_before)
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn byte_index_saturating_after(value: &str, byte_index: usize, chars_after: usize) -> usize {
    value[byte_index.min(value.len())..]
        .char_indices()
        .nth(chars_after)
        .map(|(index, _)| byte_index.min(value.len()) + index)
        .unwrap_or(value.len())
}

fn run_mcp_stdio<I, R, W>(
    args: I,
    env_workspaces: Option<std::ffi::OsString>,
    cwd: PathBuf,
    input: R,
    mut output: W,
) -> AppResult<()>
where
    I: IntoIterator<Item = String>,
    R: Read,
    W: Write,
{
    let workspace_config = mcp_stdio_workspace_config(args, env_workspaces, cwd)?;
    let workspace_paths = workspace_config
        .workspaces
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let mut reader = BufReader::new(input);
    while let Some(message) = read_mcp_stdio_message(&mut reader)? {
        let request = match serde_json::from_slice::<serde_json::Value>(&message.body) {
            Ok(request) => request,
            Err(error) => {
                write_mcp_stdio_message(
                    &mut output,
                    &json_rpc_error(None, -32700, &format!("Invalid JSON: {error}")),
                    message.framing,
                )?;
                continue;
            }
        };
        let response = if mcp_request_method(&request) == Some("tools/call") {
            let workspaces = load_mcp_stdio_workspaces(&workspace_paths)?;
            handle_mcp_json_rpc_for_workspaces_with_access(&workspaces, request, &workspace_config.write_access)
        } else {
            handle_mcp_json_rpc_for_workspaces(&[], request)
        };
        if !response.is_null() {
            write_mcp_stdio_message(&mut output, &response, message.framing)?;
        }
    }
    Ok(())
}

fn mcp_request_method(request: &serde_json::Value) -> Option<&str> {
    request.get("method").and_then(|method| method.as_str())
}

fn mcp_stdio_workspace_config<I>(
    args: I,
    env_workspaces: Option<std::ffi::OsString>,
    cwd: PathBuf,
) -> AppResult<McpWorkspaceConfig>
where
    I: IntoIterator<Item = String>,
{
    let mut roots = Vec::new();
    let mut config_paths = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--workspace" {
            let path = args
                .next()
                .ok_or_else(|| AppError::Message("--workspace requires a path.".into()))?;
            roots.push(PathBuf::from(path));
        } else if let Some(path) = arg.strip_prefix("--workspace=") {
            roots.push(PathBuf::from(path));
        } else if arg == "--workspaces" {
            let value = args
                .next()
                .ok_or_else(|| AppError::Message("--workspaces requires a path list.".into()))?;
            roots.extend(std::env::split_paths(&value));
        } else if let Some(value) = arg.strip_prefix("--workspaces=") {
            roots.extend(std::env::split_paths(value));
        } else if arg == "--config" {
            let path = args
                .next()
                .ok_or_else(|| AppError::Message("--config requires a path.".into()))?;
            config_paths.push(PathBuf::from(path));
        } else if let Some(path) = arg.strip_prefix("--config=") {
            config_paths.push(PathBuf::from(path));
        } else {
            return Err(AppError::Message(format!("Unknown MCP stdio argument: {arg}")));
        }
    }
    let default_config = cwd.join(MCP_STDIO_WORKSPACE_CONFIG);
    if default_config.is_file() {
        config_paths.insert(0, default_config);
    }
    let workspace_config = read_mcp_workspace_config_paths(&config_paths)?;
    roots.extend(workspace_config.workspaces.iter().map(PathBuf::from));
    if let Some(value) = env_workspaces {
        roots.extend(std::env::split_paths(&value));
    }
    roots.push(cwd);

    let mut seen = HashSet::new();
    let mut workspaces = Vec::new();
    for root in roots {
        for workspace in discover_workspace_paths(&root)? {
            let key = fs::canonicalize(&workspace).unwrap_or(workspace.clone());
            if seen.insert(path_to_string(&key)) {
                workspaces.push(path_to_string(&workspace));
            }
        }
    }
    Ok(McpWorkspaceConfig {
        workspaces,
        write_access: workspace_config.write_access,
    })
}

fn read_mcp_workspace_config_paths(paths: &[PathBuf]) -> AppResult<McpWorkspaceConfig> {
    let mut merged = McpWorkspaceConfig::default();
    for path in paths {
        let config = read_mcp_workspace_config(path)?;
        merged.write_access = config.write_access;
        merged.workspaces.extend(config.workspaces);
    }
    Ok(merged)
}

fn read_mcp_workspace_config(path: &Path) -> AppResult<McpWorkspaceConfig> {
    if !path.exists() {
        return Ok(McpWorkspaceConfig::default());
    }
    let config: McpWorkspaceConfig = serde_json::from_slice(&fs::read(path)?)?;
    let write_access = normalize_mcp_write_access(&config.write_access);
    let config_directory = path.parent().unwrap_or_else(|| Path::new("."));
    let workspaces = config
        .workspaces
        .into_iter()
        .map(PathBuf::from)
        .map(|workspace| {
            if workspace.is_absolute() {
                workspace
            } else {
                config_directory.join(workspace)
            }
        })
        .map(|workspace| path_to_string(&workspace))
        .collect();
    Ok(McpWorkspaceConfig {
        workspaces,
        write_access,
    })
}

fn discover_workspace_paths(root: &Path) -> AppResult<Vec<PathBuf>> {
    if workspace_manifest_path(root).is_some() {
        return Ok(vec![root.to_path_buf()]);
    }
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut workspaces = Vec::new();
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() && workspace_manifest_path(&path).is_some() {
            workspaces.push(path);
        }
    }
    workspaces.sort();
    Ok(workspaces)
}

fn load_mcp_stdio_workspaces(paths: &[PathBuf]) -> AppResult<Vec<Workspace>> {
    let mut workspaces = Vec::new();
    for path in paths {
        if let Ok(workspace) = load_workspace_from_path(path) {
            workspaces.push(workspace);
        }
    }
    Ok(workspaces)
}

fn read_mcp_stdio_message<R: BufRead>(reader: &mut R) -> AppResult<Option<McpStdioMessage>> {
    let mut content_length = None;
    let mut saw_header = false;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return if saw_header {
                Err(AppError::Message("MCP stdio stream ended inside headers.".into()))
            } else {
                Ok(None)
            };
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if !saw_header && !trimmed.to_ascii_lowercase().starts_with("content-length:") {
            return Ok(Some(McpStdioMessage {
                body: trimmed.as_bytes().to_vec(),
                framing: McpStdioFraming::Newline,
            }));
        }
        saw_header = true;
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let length = content_length.ok_or_else(|| AppError::Message("Missing MCP Content-Length header.".into()))?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;
    Ok(Some(McpStdioMessage {
        body,
        framing: McpStdioFraming::ContentLength,
    }))
}

fn write_mcp_stdio_message<W: Write>(
    writer: &mut W,
    value: &serde_json::Value,
    framing: McpStdioFraming,
) -> AppResult<()> {
    let body = value.to_string();
    match framing {
        McpStdioFraming::ContentLength => write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body)?,
        McpStdioFraming::Newline => writeln!(writer, "{body}")?,
    }
    writer.flush()?;
    Ok(())
}

fn mcp_tool_result(value: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into())
        }],
        "structuredContent": value,
        "isError": false
    })
}

fn json_rpc_result(id: serde_json::Value, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_rpc_error(id: Option<serde_json::Value>, code: i64, message: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(serde_json::Value::Null),
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn http_json_response(status: u16, value: &serde_json::Value) -> String {
    let body = if value.is_null() {
        String::new()
    } else {
        value.to_string()
    };
    let label = match status {
        200 => "OK",
        401 => "Unauthorized",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    format!(
        "HTTP/1.1 {status} {label}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://127.0.0.1\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
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
        max_context_chars: normalize_ai_max_context_chars(settings.max_context_chars),
    })
}

fn normalize_ai_max_context_chars(value: u32) -> u32 {
    if value == 0 {
        return default_ai_max_context_chars();
    }
    let stepped = (value.saturating_add(AI_CONTEXT_STEP_CHARS / 2) / AI_CONTEXT_STEP_CHARS) * AI_CONTEXT_STEP_CHARS;
    stepped.clamp(AI_MIN_CONTEXT_CHARS, AI_MAX_CONTEXT_CHARS)
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
        semantic_filter: normalize_ai_action(actions.semantic_filter, providers, active_provider_id),
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
            semantic_filter: AiActionConfig::new(&provider_id, active_models.semantic_filter.trim()),
            compaction: AiActionConfig::new(&provider_id, active_models.compaction.trim()),
        },
        max_context_chars: default_ai_max_context_chars(),
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
        max_context_chars: default_ai_max_context_chars(),
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

fn archived_workspaces_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(ARCHIVED_WORKSPACES))
}

fn ai_settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(AI_SETTINGS))
}

fn mcp_settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(MCP_SETTINGS))
}

fn mcp_stdio_workspace_config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("mcp");
    fs::create_dir_all(&directory)?;
    Ok(directory.join(MCP_STDIO_WORKSPACE_CONFIG))
}

fn read_mcp_stdio_workspace_config(app: &AppHandle) -> AppResult<McpWorkspaceConfig> {
    let path = mcp_stdio_workspace_config_path(app)?;
    read_mcp_workspace_config(&path)
}

fn write_mcp_stdio_workspace_config(app: &AppHandle, config: &McpWorkspaceConfig) -> AppResult<()> {
    write_json_atomically(&mcp_stdio_workspace_config_path(app)?, config)
}

fn write_mcp_stdio_settings(app: &AppHandle, settings: &McpSettings) -> AppResult<()> {
    let mut config = read_mcp_stdio_workspace_config(app).unwrap_or_else(|_| McpWorkspaceConfig::default());
    config.write_access = settings.write_access.clone();
    write_mcp_stdio_workspace_config(app, &config)
}

fn mcp_client_install_statuses(launch: &McpStdioLaunchConfig) -> AppResult<Vec<McpClientInstallStatus>> {
    Ok(vec![
        mcp_client_install_status(
            "codex",
            "Codex",
            codex_config_path()?,
            launch,
            codex_config_has_hvy_mcp,
        ),
        mcp_client_install_status(
            "claude",
            "Claude",
            claude_config_path()?,
            launch,
            claude_config_has_hvy_mcp,
        ),
    ])
}

fn mcp_client_install_status(
    target: &str,
    label: &str,
    path: PathBuf,
    launch: &McpStdioLaunchConfig,
    is_installed: fn(&Path, &McpStdioLaunchConfig) -> bool,
) -> McpClientInstallStatus {
    let config_exists = path.exists() || (target == "claude" && claude_config_can_be_created(&path));
    let executable_exists = Path::new(&launch.command).exists();
    let installed = config_exists && is_installed(&path, launch);
    let backups = mcp_client_backup_paths(&path);
    let latest_backup_path = backups.first().map(|path| path_to_string(path));
    let latest_backup_label = backups.first().and_then(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(mcp_client_backup_label)
    });
    let message = if !config_exists {
        if backups.is_empty() {
            format!("{label} config file was not found.")
        } else {
            format!("{label} config file was not found. A backup can be restored.")
        }
    } else if installed {
        if executable_exists {
            format!("HVY MCP is installed for {label}. Refresh or remove it anytime.")
        } else {
            "HVY MCP is installed, but the HVY Galaxy executable was not found.".into()
        }
    } else if !executable_exists {
        "HVY Galaxy executable was not found.".into()
    } else {
        format!("Ready to install HVY MCP for {label}. A backup will be saved first.")
    };
    McpClientInstallStatus {
        target: target.into(),
        label: label.into(),
        config_path: path_to_string(&path),
        config_exists,
        executable_exists,
        installed,
        backup_count: backups.len(),
        latest_backup_path,
        latest_backup_label,
        message,
    }
}

fn codex_config_path() -> AppResult<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_HOME") {
        return Ok(PathBuf::from(home).join("config.toml"));
    }
    Ok(user_home_dir()?.join(".codex").join("config.toml"))
}

fn claude_config_path() -> AppResult<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(config_dir) = packaged_claude_config_dir() {
            return Ok(config_dir.join("claude_desktop_config.json"));
        }
        if let Some(app_data) = std::env::var_os("APPDATA") {
            return Ok(PathBuf::from(app_data)
                .join("Claude")
                .join("claude_desktop_config.json"));
        }
        return Ok(user_home_dir()?
            .join("AppData")
            .join("Roaming")
            .join("Claude")
            .join("claude_desktop_config.json"));
    }
    #[cfg(not(windows))]
    Ok(user_home_dir()?
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join("claude_desktop_config.json"))
}

fn claude_config_can_be_created(path: &Path) -> bool {
    if path.parent().is_some_and(Path::exists) {
        return true;
    }
    #[cfg(windows)]
    {
        return packaged_claude_config_dir().is_some()
            || if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
                PathBuf::from(local_app_data).join("Claude").exists()
            } else {
                user_home_dir()
                    .map(|home| home.join("AppData").join("Local").join("Claude").exists())
                    .unwrap_or(false)
            };
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn packaged_claude_config_dir() -> Option<PathBuf> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            user_home_dir()
                .map(|home| home.join("AppData").join("Local"))
                .unwrap_or_else(|_| PathBuf::from("."))
        });
    let packages_dir = local_app_data.join("Packages");
    let entries = fs::read_dir(packages_dir).ok()?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("Claude_") {
            continue;
        }
        let config_dir = entry.path().join("LocalCache").join("Roaming").join("Claude");
        if config_dir.exists() {
            return Some(config_dir);
        }
    }
    None
}

fn user_home_dir() -> AppResult<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            return Ok(PathBuf::from(home));
        }
        if let (Some(drive), Some(path)) = (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
            return Ok(PathBuf::from(format!(
                "{}{}",
                drive.to_string_lossy(),
                path.to_string_lossy()
            )));
        }
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Message("Could not determine the home directory.".into()))
}

fn install_mcp_for_codex(path: &Path, launch: &McpStdioLaunchConfig) -> AppResult<()> {
    let current = fs::read_to_string(path)?;
    let next = upsert_codex_mcp_block(&current, launch);
    backup_file_before_overwrite(path)?;
    write_file_atomically(path, next.as_bytes())
}

fn install_mcp_for_claude(path: &Path, launch: &McpStdioLaunchConfig) -> AppResult<()> {
    let current = if path.exists() {
        fs::read_to_string(path)?
    } else {
        "{}\n".into()
    };
    let next = upsert_claude_mcp_config(&current, launch)?;
    if path.exists() {
        backup_file_before_overwrite(path)?;
    }
    write_file_atomically(path, next.as_bytes())
}

fn remove_mcp_from_codex(path: &Path) -> AppResult<()> {
    let current = fs::read_to_string(path)?;
    let next = remove_codex_mcp_block(&current);
    backup_file_before_overwrite(path)?;
    write_file_atomically(path, next.as_bytes())
}

fn remove_mcp_from_claude(path: &Path) -> AppResult<()> {
    let current = fs::read_to_string(path)?;
    let next = remove_claude_mcp_config(&current)?;
    backup_file_before_overwrite(path)?;
    write_file_atomically(path, next.as_bytes())
}

fn restore_mcp_client_backup_file(path: &Path) -> AppResult<()> {
    let backup_path = latest_mcp_client_backup_path(path)
        .ok_or_else(|| AppError::Message(format!("No HVY MCP backup was found for {}.", path_to_string(path))))?;
    if path.exists() {
        backup_file_before_overwrite(path)?;
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&backup_path, path)?;
    Ok(())
}

fn backup_file_before_overwrite(path: &Path) -> AppResult<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Cannot back up a file without a parent directory.".into()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Message("Cannot back up a file without a valid file name.".into()))?;
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    for attempt in 0..100 {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let backup_path = parent.join(format!("{file_name}.hvy-galaxy-backup-{timestamp}{suffix}"));
        if backup_path.exists() {
            continue;
        }
        fs::copy(path, &backup_path)?;
        return Ok(backup_path);
    }
    Err(AppError::Message(format!(
        "Could not create a backup for {}.",
        path_to_string(path)
    )))
}

fn latest_mcp_client_backup_path(path: &Path) -> Option<PathBuf> {
    mcp_client_backup_paths(path).into_iter().next()
}

fn mcp_client_backup_paths(path: &Path) -> Vec<PathBuf> {
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };
    let prefix = format!("{file_name}.hvy-galaxy-backup-");
    let mut paths = fs::read_dir(parent)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| {
        right
            .file_name()
            .and_then(|name| name.to_str())
            .cmp(&left.file_name().and_then(|name| name.to_str()))
    });
    paths
}

fn mcp_client_backup_label(file_name: &str) -> String {
    file_name
        .split(".hvy-galaxy-backup-")
        .nth(1)
        .unwrap_or(file_name)
        .to_string()
}

fn codex_config_has_hvy_mcp(path: &Path, launch: &McpStdioLaunchConfig) -> bool {
    fs::read_to_string(path)
        .map(|content| {
            (content.contains("[mcp_servers.hvy-galaxy]")
                || content.contains("[mcp_servers.\"hvy-galaxy\"]"))
                && content.contains(&toml_string(&launch.command))
        })
        .unwrap_or(false)
}

fn claude_config_has_hvy_mcp(path: &Path, launch: &McpStdioLaunchConfig) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| {
            value
                .get("mcpServers")
                .and_then(|servers| servers.get("hvy-galaxy"))
                .and_then(|server| server.get("command"))
                .and_then(|command| command.as_str())
                .map(|command| command == launch.command)
        })
        .unwrap_or(false)
}

fn upsert_codex_mcp_block(content: &str, launch: &McpStdioLaunchConfig) -> String {
    let block = codex_mcp_block(launch);
    let mut next = remove_codex_mcp_block(content).trim_end().to_string();
    if !next.is_empty() {
        next.push_str("\n\n");
    }
    next.push_str(&block);
    next.push('\n');
    next
}

fn remove_codex_mcp_block(content: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in content.lines() {
        let trimmed = line.trim();
        let is_hvy_header =
            trimmed == "[mcp_servers.hvy-galaxy]" || trimmed == "[mcp_servers.\"hvy-galaxy\"]";
        if is_hvy_header {
            skipping = true;
            continue;
        }
        if skipping && trimmed.starts_with('[') {
            skipping = false;
        }
        if !skipping {
            output.push(line);
        }
    }
    let mut next = output.join("\n").trim_end().to_string();
    next.push('\n');
    next
}

fn codex_mcp_block(launch: &McpStdioLaunchConfig) -> String {
    format!(
        "[mcp_servers.hvy-galaxy]\ntype = \"stdio\"\ncommand = {}\nargs = {}\ncwd = {}",
        toml_string(&launch.command),
        toml_string_array(&launch.args),
        toml_string(&launch.working_directory)
    )
}

fn upsert_claude_mcp_config(content: &str, launch: &McpStdioLaunchConfig) -> AppResult<String> {
    let mut value = if content.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(content)?
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| AppError::Message("Claude config must be a JSON object.".into()))?;
    let servers = object
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| AppError::Message("Claude mcpServers value must be a JSON object.".into()))?;
    servers.insert(
        "hvy-galaxy".into(),
        serde_json::json!({
            "type": "stdio",
            "command": launch.command,
            "args": launch.args,
            "cwd": launch.working_directory,
        }),
    );
    Ok(format!("{}\n", serde_json::to_string_pretty(&value)?))
}

fn remove_claude_mcp_config(content: &str) -> AppResult<String> {
    let mut value = if content.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str::<serde_json::Value>(content)?
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| AppError::Message("Claude config must be a JSON object.".into()))?;
    if let Some(servers_value) = object.get_mut("mcpServers") {
        let servers = servers_value
            .as_object_mut()
            .ok_or_else(|| AppError::Message("Claude mcpServers value must be a JSON object.".into()))?;
        servers.remove("hvy-galaxy");
    }
    Ok(format!("{}\n", serde_json::to_string_pretty(&value)?))
}

fn toml_string_array(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| toml_string(value))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
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

fn node_name(node: &WorkspaceTreeNode) -> String {
    match node {
        WorkspaceTreeNode::Folder { name, .. } | WorkspaceTreeNode::File { name, .. } => name.to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn initializes_and_loads_workspace_manifest() {
        let dir = tempdir().unwrap();
        let workspace = initialize_workspace(dir.path()).unwrap();

        assert_eq!(workspace.manifest.schema_version, 1);
        assert!(workspace.manifest.template_visibility.hvy_documents);
        assert!(workspace.manifest.template_visibility.thvy_templates);
        assert!(workspace.manifest.template_visibility.phvy_templates);
        assert!(dir.path().join(WORKSPACE_MANIFEST).exists());

        let loaded = load_workspace_from_path(dir.path()).unwrap();
        assert_eq!(loaded.manifest.name, workspace.manifest.name);
    }

    #[test]
    fn initializes_workspace_with_user_facing_name() {
        let dir = tempdir().unwrap();
        let workspace = initialize_workspace_with_name(dir.path(), Some("Nebula Drafts")).unwrap();

        assert_eq!(workspace.manifest.name, "Nebula Drafts");
        assert_eq!(
            load_workspace_from_path(dir.path()).unwrap().manifest.name,
            "Nebula Drafts"
        );
    }

    #[test]
    fn loads_legacy_workspace_manifest() {
        let dir = tempdir().unwrap();
        let now = Utc::now().to_rfc3339();
        let manifest = WorkspaceManifest {
            schema_version: 1,
            name: "Legacy Drafts".into(),
            created_at: now.clone(),
            updated_at: now,
            root_files: Vec::new(),
            expanded_paths: Vec::new(),
            template_visibility: WorkspaceTemplateVisibility::default(),
            archived_files: Vec::new(),
        };
        write_json_atomically(&dir.path().join(LEGACY_WORKSPACE_MANIFEST), &manifest).unwrap();

        let workspace = load_workspace_from_path(dir.path()).unwrap();

        assert_eq!(workspace.manifest.name, "Legacy Drafts");
    }

    #[test]
    fn workspace_folder_name_is_filesystem_safe() {
        assert_eq!(workspace_folder_name("Nebula Drafts"), "nebula-drafts");
        assert_eq!(workspace_folder_name("  alpha/beta:  "), "alpha-beta");
        assert_eq!(workspace_folder_name("***"), "workspace");
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

        let nodes = scan_workspace_files(dir.path(), &[], false).unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(matches!(&nodes[0], WorkspaceTreeNode::Folder { name, .. } if name == "notes"));
        assert!(matches!(&nodes[1], WorkspaceTreeNode::File { name, .. } if name == "a.hvy"));
    }

    #[test]
    fn unique_copy_path_avoids_existing_documents() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("draft.hvy"), "first").unwrap();
        fs::write(dir.path().join("draft 2.hvy"), "second").unwrap();

        assert_eq!(
            unique_copy_path(dir.path(), std::ffi::OsStr::new("draft.hvy")),
            dir.path().join("draft 3.hvy")
        );
    }

    #[test]
    fn rename_stem_strips_supported_extensions() {
        assert_eq!(normalized_rename_stem("Draft").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.hvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.thvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.phvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.md").unwrap(), "Draft");
    }

    #[test]
    fn rename_stem_rejects_folders_and_hidden_names() {
        assert!(normalized_rename_stem("../Draft").is_err());
        assert!(normalized_rename_stem("folder/Draft").is_err());
        assert!(normalized_rename_stem(".Draft").is_err());
        assert!(normalized_rename_stem("   ").is_err());
    }

    #[test]
    fn template_file_name_uses_requested_template_extension() {
        assert_eq!(template_file_name("Draft", ".thvy").unwrap(), "Draft.thvy");
        assert_eq!(template_file_name("Draft.hvy", ".thvy").unwrap(), "Draft.thvy");
        assert_eq!(template_file_name("Draft.thvy", ".phvy").unwrap(), "Draft.phvy");
        assert_eq!(template_file_name("Draft.md", ".phvy").unwrap(), "Draft.phvy");
    }

    #[test]
    fn saved_template_scan_includes_thvy_and_phvy_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("alpha.thvy"), "template").unwrap();
        fs::write(dir.path().join("beta.phvy"), "template").unwrap();
        fs::write(dir.path().join("regular.hvy"), "regular").unwrap();
        fs::write(dir.path().join("notes.md"), "notes").unwrap();

        let mut templates = Vec::new();
        append_saved_templates(&mut templates, dir.path(), "app").unwrap();

        templates.sort_by(|left, right| left.name.cmp(&right.name));
        assert_eq!(templates.len(), 2);
        assert_eq!(templates[0].name, "alpha.thvy");
        assert_eq!(templates[0].extension, ".thvy");
        assert_eq!(templates[1].name, "beta.phvy");
        assert_eq!(templates[1].extension, ".phvy");
        assert_eq!(templates[0].scope, "app");
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
                semantic_filter: AiActionConfig::new(" openai-compatible ", " semantic "),
                compaction: AiActionConfig::new(" openai-compatible ", " compact "),
            },
            max_context_chars: 0,
        })
        .unwrap();

        assert_eq!(settings.active_provider_id, "openai-compatible");
        assert_eq!(settings.providers[0].provider, "openai-compatible");
        assert_eq!(settings.providers[0].base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(settings.providers[0].api_key, "local");
        assert_eq!(settings.actions.chat.provider_id, "openai-compatible");
        assert_eq!(settings.actions.chat.model, "llama3.2");
        assert_eq!(settings.actions.edit.provider_id, "openai-compatible");
        assert_eq!(settings.actions.semantic_filter.provider_id, "openai-compatible");
        assert_eq!(settings.actions.semantic_filter.model, "semantic");
    }

    #[test]
    fn normalizes_mcp_settings() {
        let settings = normalize_mcp_settings(McpSettings {
            start_automatically: true,
            port: Some(0),
            write_access: "all".into(),
            bearer_token: "".into(),
        })
        .unwrap();

        assert!(settings.start_automatically);
        assert_eq!(settings.port, None);
        assert_eq!(settings.write_access, "hvyCliEdits");
        assert_eq!(settings.bearer_token, "");

        assert_eq!(McpSettings::default().port, Some(DEFAULT_MCP_PORT));

        let explicit = normalize_mcp_settings(McpSettings {
            start_automatically: false,
            port: Some(8794),
            write_access: "createImportSave".into(),
            bearer_token: "secret-token".into(),
        })
        .unwrap();

        assert_eq!(explicit.port, Some(8794));
        assert_eq!(explicit.write_access, "createImportSave");
        assert_eq!(explicit.bearer_token, "secret-token");
    }

    #[test]
    fn upserts_codex_mcp_block_without_touching_other_servers() {
        let launch = test_mcp_launch();
        let current = r#"model = "gpt-5"

[mcp_servers.other]
command = "other"

[mcp_servers.hvy-galaxy]
command = "old"
args = []

[profiles.work]
model = "gpt-5.4"
"#;

        let next = upsert_codex_mcp_block(current, &launch);

        assert!(next.contains("[mcp_servers.other]\ncommand = \"other\""));
        assert!(next.contains("[profiles.work]\nmodel = \"gpt-5.4\""));
        assert!(next.contains("[mcp_servers.hvy-galaxy]\ntype = \"stdio\""));
        assert!(next.contains("command = \"/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy\""));
        assert_eq!(next.matches("[mcp_servers.hvy-galaxy]").count(), 1);
        assert!(!next.contains("command = \"old\""));
    }

    #[test]
    fn upserts_claude_mcp_config_preserving_existing_servers() {
        let launch = test_mcp_launch();
        let current = r#"{
  "mcpServers": {
    "other": {
      "command": "other"
    }
  },
  "theme": "dark"
}"#;

        let next = upsert_claude_mcp_config(current, &launch).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&next).unwrap();

        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["mcpServers"]["other"]["command"], "other");
        assert_eq!(parsed["mcpServers"]["hvy-galaxy"]["type"], "stdio");
        assert_eq!(
            parsed["mcpServers"]["hvy-galaxy"]["command"],
            "/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy"
        );
        assert_eq!(parsed["mcpServers"]["hvy-galaxy"]["args"][0], "--mcp-stdio");
    }

    #[test]
    fn removes_codex_mcp_block_without_touching_other_servers() {
        let current = r#"model = "gpt-5"

[mcp_servers.other]
command = "other"

[mcp_servers.hvy-galaxy]
command = "old"
args = []

[profiles.work]
model = "gpt-5.4"
"#;

        let next = remove_codex_mcp_block(current);

        assert!(next.contains("[mcp_servers.other]\ncommand = \"other\""));
        assert!(next.contains("[profiles.work]\nmodel = \"gpt-5.4\""));
        assert!(!next.contains("[mcp_servers.hvy-galaxy]"));
        assert!(!next.contains("command = \"old\""));
    }

    #[test]
    fn removes_claude_mcp_config_preserving_existing_servers() {
        let current = r#"{
  "mcpServers": {
    "hvy-galaxy": {
      "command": "old"
    },
    "other": {
      "command": "other"
    }
  },
  "theme": "dark"
}"#;

        let next = remove_claude_mcp_config(current).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&next).unwrap();

        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["mcpServers"]["other"]["command"], "other");
        assert!(parsed["mcpServers"].get("hvy-galaxy").is_none());
    }

    #[test]
    fn installing_mcp_client_config_keeps_a_backup_copy() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "model = \"gpt-5\"\n").unwrap();

        install_mcp_for_codex(&path, &test_mcp_launch()).unwrap();

        let backup_paths = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("config.toml.hvy-galaxy-backup-"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();

        assert_eq!(backup_paths.len(), 1);
        assert_eq!(fs::read_to_string(&backup_paths[0]).unwrap(), "model = \"gpt-5\"\n");
        assert!(fs::read_to_string(path).unwrap().contains("[mcp_servers.hvy-galaxy]"));
    }

    #[test]
    fn restoring_mcp_client_config_uses_latest_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "current\n").unwrap();
        fs::write(
            dir.path()
                .join("config.toml.hvy-galaxy-backup-20260101T000000Z"),
            "old\n",
        )
        .unwrap();
        fs::write(
            dir.path()
                .join("config.toml.hvy-galaxy-backup-20260102T000000Z"),
            "latest\n",
        )
        .unwrap();

        restore_mcp_client_backup_file(&path).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "latest\n");
        let pre_restore_backups = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("config.toml.hvy-galaxy-backup-"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        assert_eq!(pre_restore_backups.len(), 3);
    }

    #[test]
    fn mcp_tool_list_exposes_workspace_tools() {
        let tools = mcp_tool_list();
        let tools = tools.as_array().unwrap();
        let names = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|name| name.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["workspace.list", "workspace.tree", "workspace.search"]);
        assert!(tools[2]
            .get("description")
            .and_then(|description| description.as_str())
            .unwrap()
            .contains("which HVY file contains a resume"));
        assert_eq!(
            tools[2]["inputSchema"]["required"].as_array().unwrap()[0],
            serde_json::json!("query")
        );
    }

    #[test]
    fn mcp_workspace_suite_lists_trees_and_searches_files() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("people")).unwrap();
        fs::write(
            dir.path().join("people").join("james-resume.hvy"),
            "Resume\nJames Hutchison\nExperience building HVY Galaxy.",
        )
        .unwrap();
        fs::write(
            dir.path().join("notes.md"),
            "# Notes\nThis markdown file mentions HVY Galaxy but not the resume owner.",
        )
        .unwrap();
        fs::write(dir.path().join("ignore.txt"), "James Hutchison outside supported documents").unwrap();
        let workspace = initialize_workspace_with_name(dir.path(), Some("Career Documents")).unwrap();
        let workspaces = vec![workspace.clone()];

        let list = mcp_workspace_list_from(&workspaces).unwrap();
        assert_eq!(list["workspaces"][0]["name"], "Career Documents");
        assert_eq!(list["workspaces"][0]["fileCount"], 2);

        let tree = mcp_workspace_tree_from(&workspaces, serde_json::json!({})).unwrap();
        assert_eq!(tree["workspaces"][0]["path"], workspace.path);
        assert!(tree["workspaces"][0]["files"]
            .to_string()
            .contains("james-resume.hvy"));
        assert!(!tree["workspaces"][0]["files"].to_string().contains("ignore.txt"));

        let search = mcp_workspace_search_from(
            &workspaces,
            serde_json::json!({
                "query": "James Hutchison",
                "max": 10
            }),
        )
        .unwrap();
        assert_eq!(search["query"], "James Hutchison");
        assert_eq!(search["results"].as_array().unwrap().len(), 1);
        assert_eq!(search["results"][0]["relativePath"], "people/james-resume.hvy");
        assert_eq!(search["results"][0]["lineNumber"], 2);
        assert!(search["results"][0]["snippet"]
            .as_str()
            .unwrap()
            .contains("James Hutchison"));
    }

    #[test]
    fn mcp_workspace_search_can_be_scoped_and_limited() {
        let first = tempdir().unwrap();
        let second = tempdir().unwrap();
        fs::write(first.path().join("one.hvy"), "needle in first workspace").unwrap();
        fs::write(second.path().join("two.hvy"), "needle in second workspace").unwrap();
        let first_workspace = initialize_workspace_with_name(first.path(), Some("First")).unwrap();
        let second_workspace = initialize_workspace_with_name(second.path(), Some("Second")).unwrap();
        let workspaces = vec![first_workspace.clone(), second_workspace.clone()];

        let scoped = mcp_workspace_search_from(
            &workspaces,
            serde_json::json!({
                "query": "needle",
                "workspacePath": second_workspace.path,
                "max": 1
            }),
        )
        .unwrap();

        assert_eq!(scoped["results"].as_array().unwrap().len(), 1);
        assert_eq!(scoped["results"][0]["workspaceName"], "Second");
        assert_eq!(scoped["results"][0]["relativePath"], "two.hvy");
    }

    #[test]
    fn mcp_workspace_search_rejects_empty_queries() {
        let error = mcp_workspace_search_from(&[], serde_json::json!({ "query": "   " })).unwrap_err();
        assert!(error.to_string().contains("requires a non-empty query"));
    }

    #[test]
    fn mcp_authorization_allows_blank_token_or_matching_bearer() {
        let request = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: vec![("Authorization".into(), "Bearer secret-token".into())],
            body: Vec::new(),
        };
        let missing = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: Vec::new(),
            body: Vec::new(),
        };

        assert!(mcp_request_is_authorized(&missing, ""));
        assert!(mcp_request_is_authorized(&request, "secret-token"));
        assert!(!mcp_request_is_authorized(&missing, "secret-token"));
        assert!(!mcp_request_is_authorized(&request, "other-token"));
    }

    #[test]
    fn mcp_stdio_discovers_workspaces_from_args_env_config_and_cwd() {
        let arg_workspace = tempdir().unwrap();
        let config_workspace = tempdir().unwrap();
        let explicit_config_workspace = tempdir().unwrap();
        let env_root = tempdir().unwrap();
        let env_workspace = env_root.path().join("env-workspace");
        let cwd_root = tempdir().unwrap();
        let cwd_workspace = cwd_root.path().join("cwd-workspace");
        fs::create_dir(&env_workspace).unwrap();
        fs::create_dir(&cwd_workspace).unwrap();
        initialize_workspace_with_name(arg_workspace.path(), Some("Args")).unwrap();
        initialize_workspace_with_name(config_workspace.path(), Some("Config")).unwrap();
        initialize_workspace_with_name(explicit_config_workspace.path(), Some("Explicit Config")).unwrap();
        initialize_workspace_with_name(&env_workspace, Some("Env")).unwrap();
        initialize_workspace_with_name(&cwd_workspace, Some("Cwd")).unwrap();
        let env_value = std::env::join_paths([env_root.path()]).unwrap();
        write_json_atomically(
            &cwd_root.path().join(MCP_STDIO_WORKSPACE_CONFIG),
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(config_workspace.path())],
                write_access: "searchOnly".into(),
            },
        )
        .unwrap();
        let explicit_config = cwd_root.path().join("explicit-workspaces.json");
        write_json_atomically(
            &explicit_config,
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(explicit_config_workspace.path())],
                write_access: "createImportSave".into(),
            },
        )
        .unwrap();

        let config = mcp_stdio_workspace_config(
            vec![
                "--config".to_string(),
                path_to_string(&explicit_config),
                "--workspace".to_string(),
                path_to_string(arg_workspace.path()),
                "--workspace".to_string(),
                path_to_string(arg_workspace.path()),
            ],
            Some(env_value),
            cwd_root.path().to_path_buf(),
        )
        .unwrap();
        let paths = config.workspaces.iter().map(PathBuf::from).collect::<Vec<_>>();
        let names = load_mcp_stdio_workspaces(&paths)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.manifest.name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["Args", "Config", "Explicit Config", "Env", "Cwd"]);
        assert_eq!(config.write_access, "createImportSave");
    }

    #[test]
    fn mcp_stdio_reads_write_access_from_workspace_config() {
        let workspace = tempdir().unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Config")).unwrap();
        let cwd = tempdir().unwrap();
        write_json_atomically(
            &cwd.path().join(MCP_STDIO_WORKSPACE_CONFIG),
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(workspace.path())],
                write_access: "searchOnly".into(),
            },
        )
        .unwrap();

        let config = mcp_stdio_workspace_config(Vec::<String>::new(), None, cwd.path().to_path_buf()).unwrap();

        assert_eq!(config.write_access, "searchOnly");
        assert_eq!(config.workspaces, vec![path_to_string(workspace.path())]);
    }

    #[test]
    fn mcp_access_levels_allow_search_tools_but_block_higher_access_tools() {
        assert!(ensure_mcp_tool_allowed("workspace.search", "searchOnly").is_ok());
        assert!(ensure_mcp_tool_allowed("workspace.create", "searchOnly").is_err());
        assert!(ensure_mcp_tool_allowed("workspace.create", "createImportSave").is_ok());
    }

    #[test]
    fn mcp_stdio_serves_initialized_tool_calls() {
        let workspace = tempdir().unwrap();
        fs::write(workspace.path().join("resume.hvy"), "Resume for James Hutchison").unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Career")).unwrap();
        let requests = [
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "test", "version": "0" }
                }
            }),
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "workspace.search",
                    "arguments": {
                        "query": "James Hutchison"
                    }
                }
            }),
        ];
        let input = requests
            .iter()
            .map(mcp_test_frame)
            .collect::<Vec<_>>()
            .join("");
        let mut output = Vec::new();

        run_mcp_stdio(
            vec!["--workspace".to_string(), path_to_string(workspace.path())],
            None,
            tempdir().unwrap().path().to_path_buf(),
            input.as_bytes(),
            &mut output,
        )
        .unwrap();
        let mut reader = BufReader::new(output.as_slice());
        let initialize = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let search = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let initialize: serde_json::Value = serde_json::from_slice(&initialize.body).unwrap();
        let search: serde_json::Value = serde_json::from_slice(&search.body).unwrap();

        assert_eq!(initialize["result"]["serverInfo"]["name"], "hvy-galaxy");
        assert_eq!(
            search["result"]["structuredContent"]["results"][0]["relativePath"],
            "resume.hvy"
        );
    }

    #[test]
    fn mcp_stdio_initializes_even_when_workspace_load_fails() {
        let workspace = tempdir().unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Missing")).unwrap();
        fs::remove_file(workspace.path().join(WORKSPACE_MANIFEST)).unwrap();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "claude-ai", "version": "0.1.0" }
            }
        });
        let input = mcp_test_frame(&request);
        let mut output = Vec::new();

        run_mcp_stdio(
            vec!["--workspace".to_string(), path_to_string(workspace.path())],
            None,
            workspace.path().to_path_buf(),
            input.as_bytes(),
            &mut output,
        )
        .unwrap();
        let mut reader = BufReader::new(output.as_slice());
        let initialize = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let initialize: serde_json::Value = serde_json::from_slice(&initialize.body).unwrap();

        assert_eq!(initialize["id"], 1);
        assert_eq!(initialize["result"]["serverInfo"]["name"], "hvy-galaxy");
    }

    #[test]
    fn mcp_stdio_supports_newline_framing_from_current_spec() {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "claude-ai", "version": "0.1.0" }
            }
        });
        let mut output = Vec::new();

        run_mcp_stdio(
            Vec::<String>::new(),
            None,
            tempdir().unwrap().path().to_path_buf(),
            format!("{request}\n").as_bytes(),
            &mut output,
        )
        .unwrap();

        let line = String::from_utf8(output).unwrap();
        let response: serde_json::Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(response["id"], 0);
        assert_eq!(response["result"]["protocolVersion"], "2025-11-25");
    }

    fn mcp_test_frame(value: &serde_json::Value) -> String {
        let body = value.to_string();
        format!("Content-Length: {}\r\n\r\n{}", body.len(), body)
    }

    fn test_mcp_launch() -> McpStdioLaunchConfig {
        McpStdioLaunchConfig {
            command: "/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy".into(),
            args: vec!["--mcp-stdio".into()],
            working_directory: "/Users/example/Library/Application Support/com.hvy.galaxy/mcp".into(),
        }
    }
}
