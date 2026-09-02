#[tauri::command]
fn load_recent_state(app: AppHandle) -> AppResult<RecentState> {
    read_recent_state(&recent_state_path(&app)?)
}

#[cfg(target_os = "macos")]
fn raise_integration_window(window: &tauri::Window) -> AppResult<()> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};

    if window.outer_position().map(|position| position.x < -5000).unwrap_or(false) {
        window.center().map_err(|error| AppError::Message(error.to_string()))?;
    }
    window.show().map_err(|error| AppError::Message(error.to_string()))?;
    let target = window.clone();
    window.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("window activation must run on the macOS main thread");
        let application = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        application.activateIgnoringOtherApps(true);
        let native_window = unsafe { &*target.ns_window().expect("native window is available").cast::<NSWindow>() };
        native_window.makeKeyAndOrderFront(None);
        native_window.orderFrontRegardless();
        target.set_focus().expect("raised window accepts focus");
    }).map_err(|error| AppError::Message(error.to_string()))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn raise_integration_window(window: &tauri::Window) -> AppResult<()> {
    if window.outer_position().map(|position| position.x < -5000).unwrap_or(false) {
        window.center().map_err(|error| AppError::Message(error.to_string()))?;
    }
    window.show().map_err(|error| AppError::Message(error.to_string()))?;
    window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
    Ok(())
}

#[tauri::command]
fn save_workspace_order(app: AppHandle, workspaces: Vec<String>) -> AppResult<RecentState> {
    let recent_path = recent_state_path(&app)?;
    let mut state = read_recent_state(&recent_path)?;
    state.workspaces = workspaces.iter().map(|path| path_to_string(Path::new(path))).collect();
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(&app)?;
    Ok(state)
}

#[tauri::command]
fn save_document_mode_preference(app: AppHandle, path: String, mode: String) -> AppResult<RecentState> {
    let recent_path = recent_state_path(&app)?;
    let mut state = read_recent_state(&recent_path)?;
    state.document_modes.insert(path_to_string(Path::new(&path)), mode);
    write_json_atomically(&recent_path, &state)?;
    Ok(state)
}

#[tauri::command]
fn save_document_color_preference(app: AppHandle, path: String, use_document_colors: bool) -> AppResult<RecentState> {
    let recent_path = recent_state_path(&app)?;
    let mut state = read_recent_state(&recent_path)?;
    state.document_color_uses.insert(path_to_string(Path::new(&path)), use_document_colors);
    write_json_atomically(&recent_path, &state)?;
    Ok(state)
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
fn load_app_settings(app: AppHandle) -> AppResult<AppSettings> {
    read_app_settings(&app_settings_path(&app)?)
}

#[tauri::command]
fn save_ai_settings(app: AppHandle, settings: AiSettings) -> AppResult<AiSettings> {
    let settings = normalize_ai_settings(settings)?;
    write_json_atomically(&ai_settings_path(&app)?, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn save_app_settings(app: AppHandle, settings: AppSettings) -> AppResult<AppSettings> {
    let settings = normalize_app_settings(settings);
    write_json_atomically(&app_settings_path(&app)?, &settings)?;
    Ok(settings)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginPackageFile {
    name: String,
    path: String,
    bytes: Vec<u8>,
}

#[tauri::command]
fn load_installed_plugin_packages(app: AppHandle) -> AppResult<Vec<InstalledPluginPackageFile>> {
    let directory = app.path().app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("plugins");
    fs::create_dir_all(&directory)?;
    let mut entries = fs::read_dir(&directory)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".hvy.plugin"))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    entries.into_iter().map(|entry| {
        let path = entry.path();
        Ok(InstalledPluginPackageFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path_to_string(&path),
            bytes: fs::read(path)?,
        })
    }).collect()
}

#[tauri::command]
fn install_plugin_package(app: AppHandle, name: String, bytes: Vec<u8>) -> AppResult<()> {
    let file_name = Path::new(&name)
        .file_name()
        .ok_or_else(|| AppError::Message("Choose a .hvy.plugin package.".into()))?;
    if !name.ends_with(".hvy.plugin") || file_name.to_string_lossy() != name {
        return Err(AppError::Message("Choose a .hvy.plugin package.".into()));
    }
    let directory = app.path().app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("plugins");
    fs::create_dir_all(&directory)?;
    fs::write(directory.join(file_name), bytes)?;
    Ok(())
}

const PLUGIN_BUILDER_WINDOW_LABEL: &str = "plugin-builder";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginProjectRecord {
    directory_name: String,
    path: String,
    manifest: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginProjectSourceFile {
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePluginProjectRequest {
    workspace_path: String,
    directory_name: String,
    files: Vec<PluginProjectSourceFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginProjectFile {
    path: String,
    content: Option<String>,
    bytes: Option<Vec<u8>>,
    modified_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritePluginProjectFileRequest {
    workspace_path: String,
    directory_name: String,
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritePluginProjectBuildRequest {
    workspace_path: String,
    directory_name: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginProjectBuildResult {
    path: String,
    name: String,
}

#[tauri::command]
fn open_plugin_builder_window(
    app: AppHandle,
    workspace_paths: Vec<String>,
    selected_workspace_path: Option<String>,
) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(PLUGIN_BUILDER_WINDOW_LABEL) {
        return raise_integration_window(&window.as_ref().window());
    }
    let mut url = "plugin-builder.html".to_string();
    if !workspace_paths.is_empty() || selected_workspace_path.is_some() {
        let mut query_url = tauri::Url::parse("http://plugin-builder.local/")
            .map_err(|error| AppError::Message(error.to_string()))?;
        {
            let mut query = query_url.query_pairs_mut();
            for path in workspace_paths.iter().map(String::as_str).map(str::trim).filter(|path| !path.is_empty()) {
                query.append_pair("workspace", path);
            }
            if let Some(path) = selected_workspace_path.as_deref().map(str::trim).filter(|path| !path.is_empty()) {
                query.append_pair("selectedWorkspace", path);
            }
        }
        if let Some(query) = query_url.query() {
            url.push('?');
            url.push_str(query);
        }
    }
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        PLUGIN_BUILDER_WINDOW_LABEL,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Plugin Builder — HVY Galaxy")
    .inner_size(1180.0, 780.0)
    .min_inner_size(820.0, 560.0)
    .build()
    .map_err(|error| AppError::Message(error.to_string()))?;
    let menu_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(menu) = build_menu(&menu_app) {
                let _ = menu_app.set_menu(menu);
            }
        }
    });
    let menu = build_menu(&app).map_err(|error| AppError::Message(error.to_string()))?;
    app.set_menu(menu).map_err(|error| AppError::Message(error.to_string()))?;
    raise_integration_window(&window.as_ref().window())
}

fn plugin_projects_directory(workspace_path: &Path) -> AppResult<PathBuf> {
    ensure_workspace(workspace_path)?;
    Ok(workspace_path.join("plugins"))
}

fn plugin_project_record(path: &Path, directory_name: String) -> PluginProjectRecord {
    let manifest_path = path.join("hvy-plugin.json");
    match fs::read(&manifest_path)
        .map_err(AppError::from)
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).map_err(AppError::from))
    {
        Ok(manifest) if manifest.is_object() => PluginProjectRecord {
            directory_name,
            path: path_to_string(path),
            manifest: Some(manifest),
            error: None,
        },
        Ok(_) => PluginProjectRecord {
            directory_name,
            path: path_to_string(path),
            manifest: None,
            error: Some("hvy-plugin.json must contain a JSON object.".into()),
        },
        Err(error) => PluginProjectRecord {
            directory_name,
            path: path_to_string(path),
            manifest: None,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn list_plugin_projects(workspace_path: String) -> AppResult<Vec<PluginProjectRecord>> {
    let directory = plugin_projects_directory(Path::new(&workspace_path))?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut entries = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries.into_iter().map(|entry| {
        let directory_name = entry.file_name().to_string_lossy().into_owned();
        plugin_project_record(&entry.path(), directory_name)
    }).collect())
}

fn normalized_plugin_project_directory_name(value: &str) -> AppResult<String> {
    let value = value.trim();
    let valid = !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value.chars().all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-');
    if !valid {
        return Err(AppError::Message(
            "Plugin directory name must use lowercase letters, numbers, and single hyphens.".into(),
        ));
    }
    Ok(value.into())
}

fn normalized_plugin_project_file_path(value: &str) -> AppResult<PathBuf> {
    let normalized = value.replace('\\', "/");
    let path = PathBuf::from(&normalized);
    let valid = !normalized.is_empty()
        && !path.is_absolute()
        && path.components().all(|component| matches!(component, std::path::Component::Normal(_)));
    if !valid {
        return Err(AppError::Message(format!(
            "Plugin project file path \"{normalized}\" is not normalized."
        )));
    }
    Ok(path)
}

#[tauri::command]
fn create_plugin_project(request: CreatePluginProjectRequest) -> AppResult<PluginProjectRecord> {
    let workspace_path = PathBuf::from(&request.workspace_path);
    let directory_name = normalized_plugin_project_directory_name(&request.directory_name)?;
    let files = request.files.into_iter().map(|file| {
        Ok((normalized_plugin_project_file_path(&file.path)?, file.content))
    }).collect::<AppResult<Vec<_>>>()?;
    if !files.iter().any(|(path, _)| path == Path::new("hvy-plugin.json")) {
        return Err(AppError::Message("Plugin project must include hvy-plugin.json.".into()));
    }
    let projects_directory = plugin_projects_directory(&workspace_path)?;
    fs::create_dir_all(&projects_directory)?;
    let project_path = projects_directory.join(&directory_name);
    if project_path.exists() {
        return Err(AppError::Message("A plugin project already exists with this directory name.".into()));
    }
    fs::create_dir(&project_path)?;
    for (relative_path, content) in files {
        let destination = project_path.join(relative_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(destination, content)?;
    }
    touch_workspace_manifest(&workspace_path)?;
    Ok(plugin_project_record(&project_path, directory_name))
}

fn plugin_project_path(workspace_path: &Path, directory_name: &str) -> AppResult<PathBuf> {
    let directory_name = normalized_plugin_project_directory_name(directory_name)?;
    let path = plugin_projects_directory(workspace_path)?.join(directory_name);
    if !path.is_dir() {
        return Err(AppError::Message("Plugin project was not found.".into()));
    }
    Ok(path)
}

fn read_plugin_project_directory(
    root: &Path,
    directory: &Path,
    files: &mut Vec<PluginProjectFile>,
) -> AppResult<()> {
    let mut entries = fs::read_dir(directory)?.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || (directory == root && name == "dist") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            read_plugin_project_directory(root, &path, files)?;
        } else if path.is_file() {
            let modified_at = entry.metadata().ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64);
            let bytes = fs::read(&path)?;
            let content = String::from_utf8(bytes.clone()).ok();
            files.push(PluginProjectFile {
                path: relative_path(root, &path),
                bytes: content.is_none().then_some(bytes),
                content,
                modified_at,
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn read_plugin_project_files(workspace_path: String, directory_name: String) -> AppResult<Vec<PluginProjectFile>> {
    let project_path = plugin_project_path(Path::new(&workspace_path), &directory_name)?;
    let mut files = Vec::new();
    read_plugin_project_directory(&project_path, &project_path, &mut files)?;
    Ok(files)
}

#[tauri::command]
fn write_plugin_project_file(request: WritePluginProjectFileRequest) -> AppResult<()> {
    let workspace_path = PathBuf::from(&request.workspace_path);
    let project_path = plugin_project_path(&workspace_path, &request.directory_name)?;
    let relative_path = normalized_plugin_project_file_path(&request.path)?;
    let destination = project_path.join(relative_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(destination, request.content)?;
    touch_workspace_manifest(&workspace_path)
}

#[tauri::command]
fn write_plugin_project_build(request: WritePluginProjectBuildRequest) -> AppResult<PluginProjectBuildResult> {
    let project_path = plugin_project_path(Path::new(&request.workspace_path), &request.directory_name)?;
    let file_name = Path::new(&request.name).file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Message("Plugin build name must end with .hvy.plugin.".into()))?;
    if file_name != request.name || !file_name.ends_with(".hvy.plugin") {
        return Err(AppError::Message("Plugin build name must end with .hvy.plugin.".into()));
    }
    let directory = project_path.join("dist");
    fs::create_dir_all(&directory)?;
    let artifact_path = directory.join(file_name);
    fs::write(&artifact_path, request.bytes)?;
    Ok(PluginProjectBuildResult { path: path_to_string(&artifact_path), name: file_name.into() })
}

const INTEGRATION_BROWSER_LABEL: &str = "integration-browser";
const INTEGRATION_TOOLBAR_HEIGHT: f64 = 52.0;
#[cfg(target_os = "macos")]
const INTEGRATION_TOOLBAR_WINDOW_INSET: f64 = 15.0;
#[cfg(not(target_os = "macos"))]
const INTEGRATION_TOOLBAR_WINDOW_INSET: f64 = 0.0;
const INTEGRATION_VAULT_SERVICE: &str = "com.heavyresume.hvy-galaxy.integration-vault";
const INTEGRATION_VAULT_ACCOUNT: &str = "default";
const INTEGRATION_VAULT_FILE: &str = "integration-cookie-vault-tauri.json";
const INTEGRATION_VAULT_AAD: &[u8] = b"hvy-galaxy-integration-vault-v1";
const DEFAULT_INTEGRATION_PROFILE_ID: &str = "default-google";

fn integration_result_is_background(result: &serde_json::Value) -> bool {
    result.get("kind").and_then(serde_json::Value::as_str) == Some("integration-ready-check-validation")
        || (result.get("kind").and_then(serde_json::Value::as_str) == Some("integration-extraction")
        && result.pointer("/context/mode").and_then(serde_json::Value::as_str) == Some("examples"))
        || (result.get("kind").and_then(serde_json::Value::as_str) == Some("integration-source-discovery")
            && result.pointer("/context/automatic").and_then(serde_json::Value::as_bool) == Some(true))
}

fn emit_integration_result(app: &AppHandle, action_mode: &AtomicBool, profile_id: &str, mut result: serde_json::Value) {
    if let Some(object) = result.as_object_mut() {
        object.insert("profileId".into(), serde_json::Value::String(profile_id.into()));
    }
    let is_background = integration_result_is_background(&result);
    action_mode.store(false, Ordering::SeqCst);
    if let Some(toolbar) = app.get_webview(&integration_toolbar_label(profile_id)) {
        let _ = toolbar.eval("window.hvySetInspectionState?.({})");
    }
    let _ = app.emit("integration-inspection-result", result);
    if !is_background {
        if let Some(main_window) = app.get_webview_window("main") {
            let _ = raise_integration_window(&main_window.as_ref().window());
        }
    }
}

#[cfg(target_os = "windows")]
fn install_integration_message_handler(webview: &tauri::Webview, app: AppHandle, action_mode: Arc<AtomicBool>, profile_id: String) -> AppResult<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::ICoreWebView2,
        WebMessageReceivedEventHandler,
    };
    use windows_core::PWSTR;

    webview.with_webview(move |platform_webview| unsafe {
        let Ok(core_webview): Result<ICoreWebView2, _> = platform_webview.controller().CoreWebView2() else {
            return;
        };
        let mut token = 0;
        let _ = core_webview.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()); };
                let mut message = PWSTR::null();
                args.TryGetWebMessageAsString(&mut message)?;
                let message = webview2_com::take_pwstr(message);
                let Ok(envelope) = serde_json::from_str::<serde_json::Value>(&message) else { return Ok(()); };
                let Some(result) = envelope.get("hvyGalaxyIntegrationResult").cloned() else { return Ok(()); };
                emit_integration_result(&app, &action_mode, &profile_id, result);
                Ok(())
            })),
            &mut token,
        );
    }).map_err(|error| AppError::Message(error.to_string()))
}
#[cfg(target_os = "macos")]
const DEFAULT_INTEGRATION_DATA_STORE_ID: [u8; 16] = [
    0x48, 0x56, 0x59, 0x47, 0x41, 0x4c, 0x41, 0x58,
    0x59, 0x47, 0x4f, 0x4f, 0x47, 0x4c, 0x45, 0x01,
];
static INTEGRATION_VAULT_KEY_CACHE: OnceLock<Mutex<Option<Vec<u8>>>> = OnceLock::new();
static INTEGRATION_ACTION_MODES: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static INTEGRATION_PENDING_EXTRACTIONS: OnceLock<Mutex<HashMap<String, Arc<Mutex<Option<serde_json::Value>>>>>> = OnceLock::new();

fn integration_browser_label(profile_id: &str) -> String {
    format!("{INTEGRATION_BROWSER_LABEL}-{}", profile_id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-').collect::<String>())
}

fn integration_toolbar_label(profile_id: &str) -> String {
    format!("{}-toolbar", integration_browser_label(profile_id))
}

fn integration_content_label(profile_id: &str) -> String {
    format!("{}-content", integration_browser_label(profile_id))
}

#[cfg(target_os = "macos")]
fn integration_data_store_id(browser_store_id: &str) -> AppResult<[u8; 16]> {
    if browser_store_id == DEFAULT_INTEGRATION_PROFILE_ID { return Ok(DEFAULT_INTEGRATION_DATA_STORE_ID); }
    let hex = browser_store_id.replace('-', "");
    if hex.len() != 32 { return Err(AppError::Message("Invalid integration browser store ID.".into())); }
    let mut bytes = [0_u8; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationVaultStatus {
    configured: bool,
    has_vault: bool,
    storage_mode: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationVaultEnvelope {
    version: u8,
    algorithm: String,
    nonce: String,
    ciphertext: String,
}

#[cfg(not(target_os = "macos"))]
#[derive(Serialize, Deserialize)]
struct IntegrationCookieVault {
    cookies: Vec<IntegrationVaultCookie>,
}

#[cfg(not(target_os = "macos"))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationVaultCookie {
    name: String,
    value: String,
    domain: Option<String>,
    path: Option<String>,
    secure: Option<bool>,
    http_only: Option<bool>,
    same_site: Option<String>,
    #[serde(default)]
    expires_unix: Option<i64>,
}

fn integration_vault_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(INTEGRATION_VAULT_SERVICE, INTEGRATION_VAULT_ACCOUNT)
        .map_err(|error| AppError::Message(error.to_string()))
}

fn integration_vault_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join(INTEGRATION_VAULT_FILE))
}

fn write_integration_vault(app: &AppHandle, key: &[u8], plaintext: &[u8]) -> AppResult<()> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| AppError::Message(error.to_string()))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, aes_gcm::aead::Payload { msg: plaintext, aad: INTEGRATION_VAULT_AAD })
        .map_err(|error| AppError::Message(error.to_string()))?;
    let envelope = IntegrationVaultEnvelope {
        version: 1,
        algorithm: "AES-256-GCM".into(),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    };
    write_json_atomically(&integration_vault_path(app)?, &envelope)
}

#[cfg(not(target_os = "macos"))]
fn read_integration_vault(app: &AppHandle, key: &[u8]) -> AppResult<IntegrationCookieVault> {
    let envelope: IntegrationVaultEnvelope = serde_json::from_slice(&fs::read(integration_vault_path(app)?)?)?;
    if envelope.version != 1 || envelope.algorithm != "AES-256-GCM" {
        return Err(AppError::Message("Unsupported integration vault format.".into()));
    }
    let nonce = BASE64.decode(envelope.nonce).map_err(|error| AppError::Message(error.to_string()))?;
    let ciphertext = BASE64.decode(envelope.ciphertext).map_err(|error| AppError::Message(error.to_string()))?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|error| AppError::Message(error.to_string()))?;
    let plaintext = cipher.decrypt(aes_gcm::Nonce::from_slice(&nonce), aes_gcm::aead::Payload { msg: &ciphertext, aad: INTEGRATION_VAULT_AAD })
        .map_err(|_| AppError::Message("Could not decrypt the integration vault.".into()))?;
    serde_json::from_slice(&plaintext).map_err(AppError::from)
}

#[cfg(not(target_os = "macos"))]
fn integration_vault_key() -> AppResult<Vec<u8>> {
    let cache = INTEGRATION_VAULT_KEY_CACHE.get_or_init(|| Mutex::new(None));
    let mut cached_key = cache.lock().map_err(|error| AppError::Message(error.to_string()))?;
    if let Some(key) = cached_key.clone() {
        return Ok(key);
    }
    let key = integration_vault_entry()?.get_secret().map_err(|error| AppError::Message(error.to_string()))?;
    if key.len() != 32 {
        return Err(AppError::Message("The integration vault key is invalid.".into()));
    }
    *cached_key = Some(key.clone());
    Ok(key)
}

#[cfg(not(target_os = "macos"))]
fn restore_integration_cookies(app: &AppHandle, window: &tauri::Webview) -> AppResult<()> {
    let key = integration_vault_key()?;
    let vault = read_integration_vault(app, &key)?;
    for stored in vault.cookies {
        let host_prefixed = stored.name.starts_with("__Host-");
        let secure_prefixed = stored.name.starts_with("__Secure-");
        let mut cookie = tauri::webview::Cookie::build((stored.name, stored.value));
        if !host_prefixed {
            if let Some(domain) = stored.domain { cookie = cookie.domain(domain); }
        }
        if host_prefixed {
            cookie = cookie.path("/").secure(true);
        } else {
            if let Some(path) = stored.path { cookie = cookie.path(path); }
            if secure_prefixed {
                cookie = cookie.secure(true);
            } else if let Some(secure) = stored.secure {
                cookie = cookie.secure(secure);
            }
        }
        if let Some(http_only) = stored.http_only { cookie = cookie.http_only(http_only); }
        cookie = match stored.same_site.as_deref() {
            Some("strict") => cookie.same_site(tauri::webview::cookie::SameSite::Strict),
            Some("lax") => cookie.same_site(tauri::webview::cookie::SameSite::Lax),
            Some("none") => cookie.same_site(tauri::webview::cookie::SameSite::None),
            _ => cookie,
        };
        if let Some(expires_unix) = stored.expires_unix {
            let expires = tauri::webview::cookie::time::OffsetDateTime::from_unix_timestamp(expires_unix)
                .map_err(|error| AppError::Message(error.to_string()))?;
            cookie = cookie.expires(expires);
        }
        window.set_cookie(cookie.build()).map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn save_integration_cookies(app: &AppHandle, window: &tauri::Webview) -> AppResult<()> {
    let key = integration_vault_key()?;
    let cookies = window.cookies().map_err(|error| AppError::Message(error.to_string()))?
        .into_iter()
        .filter(|cookie| cookie.domain().is_some_and(|domain| domain == "google.com" || domain.ends_with(".google.com")))
        .map(|cookie| IntegrationVaultCookie {
            name: cookie.name().into(),
            value: cookie.value().into(),
            domain: cookie.domain().map(str::to_string),
            path: cookie.path().map(str::to_string),
            secure: cookie.secure(),
            http_only: cookie.http_only(),
            same_site: cookie.same_site().map(|value| match value {
                tauri::webview::cookie::SameSite::Strict => "strict".into(),
                tauri::webview::cookie::SameSite::Lax => "lax".into(),
                tauri::webview::cookie::SameSite::None => "none".into(),
            }),
            expires_unix: cookie.expires_datetime().map(|value| value.unix_timestamp()),
        })
        .collect();
    let plaintext = serde_json::to_vec(&IntegrationCookieVault { cookies })?;
    write_integration_vault(app, &key, &plaintext)
}

#[cfg(not(target_os = "macos"))]
fn save_open_integration_cookies(app: &AppHandle) -> AppResult<()> {
    for (label, webview) in app.webviews() {
        if label.starts_with(INTEGRATION_BROWSER_LABEL) && label.ends_with("-content") {
            save_integration_cookies(app, &webview)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn load_integration_vault_status(_app: AppHandle) -> AppResult<IntegrationVaultStatus> {
    #[cfg(target_os = "macos")]
    return Ok(IntegrationVaultStatus {
        configured: true,
        has_vault: true,
        storage_mode: "webkitProfile".into(),
    });
    #[cfg(not(target_os = "macos"))]
    let has_vault = integration_vault_path(&_app)?.exists();
    #[cfg(not(target_os = "macos"))]
    Ok(IntegrationVaultStatus {
        configured: has_vault,
        has_vault,
        storage_mode: "encryptedVault".into(),
    })
}

#[tauri::command]
fn setup_integration_vault(app: AppHandle) -> AppResult<IntegrationVaultStatus> {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    integration_vault_entry()?.set_secret(&key).map_err(|error| AppError::Message(error.to_string()))?;
    *INTEGRATION_VAULT_KEY_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|error| AppError::Message(error.to_string()))? = Some(key.to_vec());
    write_integration_vault(&app, &key, b"{\"cookies\":[]}")?;
    load_integration_vault_status(app)
}

#[tauri::command]
async fn reset_integration_vault(app: AppHandle) -> AppResult<IntegrationVaultStatus> {
    if let Some(window) = app.get_window(&integration_browser_label(DEFAULT_INTEGRATION_PROFILE_ID)) {
        window.close().map_err(|error| AppError::Message(error.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        app.remove_data_store(DEFAULT_INTEGRATION_DATA_STORE_ID).await
            .map_err(|error| AppError::Message(error.to_string()))?;
        return load_integration_vault_status(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
    let path = integration_vault_path(&app)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    let entry = integration_vault_entry()?;
    if entry.get_secret().is_ok() {
        entry.delete_credential().map_err(|error| AppError::Message(error.to_string()))?;
    }
    *INTEGRATION_VAULT_KEY_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|error| AppError::Message(error.to_string()))? = None;
    load_integration_vault_status(app)
    }
}
const INTEGRATION_INSPECTOR: &str = include_str!("../../src/integration-inspector.js");

fn integration_destination_url(destination: &str) -> AppResult<tauri::Url> {
    let value = match destination {
        "msn" => "https://www.msn.com/",
        "gmail" => "https://mail.google.com/",
        "calendar" => "https://calendar.google.com/",
        _ => return Err(AppError::Message("Unknown integration browser destination.".into())),
    };
    value.parse::<tauri::Url>().map_err(|error| AppError::Message(error.to_string()))
}

fn allowed_integration_url(url: &tauri::Url) -> bool {
    allowed_integration_url_for_origins(url, &[])
}

fn allowed_integration_url_for_origins(url: &tauri::Url, origins: &[String]) -> bool {
    if !origins.is_empty() {
        return url.scheme() == "https" && origins.iter().any(|origin| origin == url.origin().ascii_serialization().as_str());
    }
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "msn.com"
                || host.ends_with(".msn.com")
                || host == "google.com"
                || host.ends_with(".google.com")
        })
}

#[tauri::command]
async fn integration_browser_command(app: AppHandle, command: String, destination: Option<String>, profile_id: Option<String>, url: Option<String>, allowed_origins: Option<Vec<String>>, browser_store_id: Option<String>, action_mode: Option<bool>, payload: Option<serde_json::Value>, foreground: Option<bool>, window_name: Option<String>) -> AppResult<()> {
    let profile_id = profile_id.unwrap_or_else(|| DEFAULT_INTEGRATION_PROFILE_ID.into());
    let window_label = integration_browser_label(&profile_id);
    let content_label = integration_content_label(&profile_id);
    let action_mode_pending = {
        let mut modes = INTEGRATION_ACTION_MODES.get_or_init(|| Mutex::new(HashMap::new())).lock()
            .map_err(|error| AppError::Message(error.to_string()))?;
        modes.entry(profile_id.clone()).or_insert_with(|| Arc::new(AtomicBool::new(false))).clone()
    };
    let pending_extraction = {
        let mut extractions = INTEGRATION_PENDING_EXTRACTIONS.get_or_init(|| Mutex::new(HashMap::new())).lock()
            .map_err(|error| AppError::Message(error.to_string()))?;
        extractions.entry(profile_id.clone()).or_insert_with(|| Arc::new(Mutex::new(None))).clone()
    };
    if command == "open" {
        let foreground = foreground.unwrap_or(true);
        action_mode_pending.store(action_mode.unwrap_or(false), Ordering::SeqCst);
        *pending_extraction.lock().map_err(|error| AppError::Message(error.to_string()))? = payload.clone();
        #[cfg(not(target_os = "macos"))]
        if !load_integration_vault_status(app.clone())?.configured {
            setup_integration_vault(app.clone())?;
        }
        let navigation_allowed_origins = allowed_origins.unwrap_or_default();
        let url = if let Some(value) = url {
            let parsed = value.parse::<tauri::Url>().map_err(|error| AppError::Message(error.to_string()))?;
            if parsed.scheme() != "https" { return Err(AppError::Message("Integration pages must use HTTPS.".into())); }
            if !navigation_allowed_origins.iter().any(|origin| origin == parsed.origin().ascii_serialization().as_str()) {
                return Err(AppError::Message("The custom page origin is not allowed.".into()));
            }
            parsed
        } else {
            integration_destination_url(destination.as_deref().unwrap_or(""))?
        };
        let blank_url = tauri::Url::parse("about:blank")
            .map_err(|error| AppError::Message(error.to_string()))?;
        if let (Some(window), Some(content)) = (app.get_window(&window_label), app.get_webview(&content_label)) {
            window.set_title(&format!("HVY Galaxy Integrations — {}", window_name.as_deref().unwrap_or(&profile_id)))
                .map_err(|error| AppError::Message(error.to_string()))?;
            content.navigate(url.clone()).map_err(|error| AppError::Message(error.to_string()))?;
            if foreground {
                raise_integration_window(&window)?;
            } else if !window.is_visible().unwrap_or(false) {
                window.center().map_err(|error| AppError::Message(error.to_string()))?;
                window.show().map_err(|error| AppError::Message(error.to_string()))?;
                if let Some(main_window) = app.get_webview_window("main") {
                    raise_integration_window(&main_window.as_ref().window())?;
                }
            }
            app.set_menu(build_menu(&app).map_err(|error| AppError::Message(error.to_string()))?)
                .map_err(|error| AppError::Message(error.to_string()))?;
            window.remove_menu().map_err(|error| AppError::Message(error.to_string()))?;
            return Ok(());
        }
        let integration_app = app.clone();
        let integration_window_label = window_label.clone();
        let result_profile_id = profile_id.clone();
        let page_load_profile_id = result_profile_id.clone();
        let page_load_action_mode = action_mode_pending.clone();
        let page_load_extraction = pending_extraction.clone();
        let navigation_action_mode = action_mode_pending.clone();
        let page_load_allowed_origins = navigation_allowed_origins.clone();
        let toolbar_allowed_origins = navigation_allowed_origins.clone();
        let new_window_allowed_origins = navigation_allowed_origins.clone();
        let new_window_app = app.clone();
        let new_window_profile_id = profile_id.clone();
        let title_profile_name = window_name.clone().unwrap_or_else(|| profile_id.clone());
        #[cfg(target_os = "windows")]
        let integration_inspector = format!(
            "window.__hvyGalaxyPublish = value => window.chrome.webview.postMessage(JSON.stringify({{ hvyGalaxyIntegrationResult: value }}));\n{}",
            INTEGRATION_INSPECTOR,
        );
        #[cfg(not(target_os = "windows"))]
        let integration_inspector = INTEGRATION_INSPECTOR.to_owned();
        let native_window = tauri::window::WindowBuilder::new(&app, &window_label)
            .title(format!("HVY Galaxy Integrations — {}", window_name.as_deref().unwrap_or(&profile_id)))
            .visible(false)
            .inner_size(1080.0, 700.0)
            .min_inner_size(720.0, 520.0)
            .center()
            .build()
            .map_err(|error| AppError::Message(error.to_string()))?;
        let builder = tauri::webview::WebviewBuilder::new(
            &content_label,
            tauri::WebviewUrl::External(blank_url),
        )
        .initialization_script(integration_inspector)
        .on_document_title_changed(move |window, title| {
            let site_title = title.trim();
            if !site_title.is_empty() {
                let _ = window.window().set_title(&format!("{site_title} — {title_profile_name}"));
            }
        })
        .on_page_load(move |window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Some(toolbar) = window.app_handle().get_webview(&integration_toolbar_label(&page_load_profile_id)) {
                    let state = serde_json::json!({ "url": payload.url().as_str(), "allowed": page_load_allowed_origins });
                    let _ = toolbar.eval(format!("window.hvySetBrowserState({state})"));
                }
                let _ = window.eval("window.__hvyGalaxyInspector?.discoverStructuredSourcesAndPublish({ automatic: true })");
                if page_load_action_mode.load(Ordering::SeqCst) {
                    let script = format!("{}\nwindow.__hvyGalaxyInspector?.start('parent', {{ primary: true, externalToolbar: true }});", INTEGRATION_INSPECTOR);
                    let _ = window.eval(&script);
                } else if let Ok(mut pending) = page_load_extraction.lock() {
                    let current_origin = payload.url().origin().ascii_serialization();
                    let expected_origins = pending.as_ref()
                        .and_then(|value| value.pointer("/context/expectedOrigins"))
                        .and_then(serde_json::Value::as_array);
                    let expected_origin = pending.as_ref()
                        .and_then(|value| value.pointer("/context/expectedOrigin"))
                        .and_then(serde_json::Value::as_str);
                    let at_expected_origin = expected_origins
                        .map(|origins| origins.iter().any(|origin| origin.as_str() == Some(current_origin.as_str())))
                        .unwrap_or_else(|| expected_origin.is_none_or(|origin| current_origin == origin));
                    if at_expected_origin {
                      if let Some(extraction) = pending.take() {
                        let script = if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("command-target") {
                            let inspection_kind = if extraction.get("inspectionKind").and_then(serde_json::Value::as_str) == Some("parent") { "parent" } else { "target" };
                            format!("{}\nwindow.__hvyGalaxyInspector?.start('{}', Object.assign({{}}, ({}).options || {{}}, {{ externalToolbar: true }}));", INTEGRATION_INSPECTOR, inspection_kind, extraction)
                        } else if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("command-execution") {
                            format!("{}\nwindow.__hvyGalaxyInspector?.executeCommandAndReport(({}).payload || {{}});", INTEGRATION_INSPECTOR, extraction)
                        } else if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("ready-check-validation") {
                            format!("{}\nwindow.__hvyGalaxyInspector?.validateReadyChecksAndPublish(({}).payload?.readyChecks || {{}}, ({}).context || {{}});", INTEGRATION_INSPECTOR, extraction, extraction)
                        } else if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("pattern-highlight") {
                            format!("{}\nwindow.__hvyGalaxyInspector?.matchAndHighlight(({}).pattern || {{}});", INTEGRATION_INSPECTOR, extraction)
                        } else if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("source-discovery") {
                            format!("{}\nwindow.__hvyGalaxyInspector?.discoverStructuredSourcesAndPublish(({}).context || {{}});", INTEGRATION_INSPECTOR, extraction)
                        } else if extraction.get("kind").and_then(serde_json::Value::as_str) == Some("source-fetch") {
                            format!("{}\nwindow.__hvyGalaxyInspector?.fetchStructuredSourceAndPublish(({}).source || {{}}, ({}).context || {{}});", INTEGRATION_INSPECTOR, extraction, extraction)
                        } else {
                            format!("{}\nwindow.__hvyGalaxyInspector?.extractAndPublish(({}).pattern || {{}}, ({}).context || {{}});", INTEGRATION_INSPECTOR, extraction, extraction)
                        };
                        let _ = window.eval(&script);
                      }
                    }
                }
            }
        })
        .on_new_window(move |requested_url, _features| {
            if allowed_integration_url_for_origins(&requested_url, &new_window_allowed_origins) {
                if let Some(content) = new_window_app.get_webview(&integration_content_label(&new_window_profile_id)) {
                    let _ = content.navigate(requested_url);
                }
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_navigation(move |requested_url| {
            if requested_url.as_str() == "about:blank" {
                return true;
            }
            if let Some(browser_command) = requested_url.as_str().strip_prefix("hvy-integration://browser/") {
                if let Some(window) = integration_app.get_webview(&integration_content_label(&result_profile_id)) {
                    if browser_command == "back" { let _ = window.eval("window.history.back()"); }
                    if browser_command == "forward" { let _ = window.eval("window.history.forward()"); }
                    if browser_command == "reload" { let _ = window.reload(); }
                    if browser_command == "inspect" {
                        navigation_action_mode.store(true, Ordering::SeqCst);
                        let _ = window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.start('target', {{ externalToolbar: true }})", INTEGRATION_INSPECTOR));
                    }
                    if browser_command == "close" {
                        #[cfg(not(target_os = "macos"))]
                        let _ = save_integration_cookies(&integration_app, &window);
                        if let Some(host) = integration_app.get_window(&integration_window_label) { let _ = host.close(); }
                    }
                }
                return false;
            }
            if let Some(encoded) = requested_url.as_str().strip_prefix("hvy-integration://navigate/") {
                if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded) {
                    if let Ok(value) = String::from_utf8(bytes) {
                        if let Ok(url) = value.parse::<tauri::Url>() {
                            if allowed_integration_url_for_origins(&url, &navigation_allowed_origins) {
                                if let Some(window) = integration_app.get_webview(&integration_content_label(&result_profile_id)) {
                                    let _ = window.navigate(url);
                                }
                            }
                        }
                    }
                }
                return false;
            }
            if requested_url.as_str() == "hvy-integration://close" {
                if let Some(_window) = integration_app.get_webview(&integration_content_label(&result_profile_id)) {
                    #[cfg(not(target_os = "macos"))]
                    let _ = save_integration_cookies(&integration_app, &_window);
                    if let Some(host) = integration_app.get_window(&integration_window_label) { let _ = host.close(); }
                }
                return false;
            }
            if let Some(encoded) = requested_url.as_str().strip_prefix("hvy-integration://inspection/") {
                if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded) {
                    if let Ok(mut result) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        if let Some(object) = result.as_object_mut() {
                            object.insert("profileId".into(), serde_json::Value::String(result_profile_id.clone()));
                        }
                        let is_background_result = result
                            .get("kind")
                            .and_then(serde_json::Value::as_str)
                            == Some("integration-ready-check-validation");
                        let is_background_result = is_background_result || (result
                            .get("kind")
                            .and_then(serde_json::Value::as_str)
                            == Some("integration-extraction")
                            && result
                                .get("context")
                                .and_then(|context| context.get("mode"))
                                .and_then(serde_json::Value::as_str)
                                == Some("examples"));
                        let is_background_result = is_background_result
                            || (result
                                .get("kind")
                                .and_then(serde_json::Value::as_str)
                                == Some("integration-source-discovery")
                                && result
                                    .get("context")
                                    .and_then(|context| context.get("automatic"))
                                    .and_then(serde_json::Value::as_bool)
                                    == Some(true));
                        navigation_action_mode.store(false, Ordering::SeqCst);
                        if let Some(toolbar) = integration_app.get_webview(&integration_toolbar_label(&result_profile_id)) {
                            let _ = toolbar.eval("window.hvySetInspectionState?.({})");
                        }
                        let _ = integration_app.emit("integration-inspection-result", result);
                        if !is_background_result {
                            if let Some(main_window) = integration_app.get_webview_window("main") {
                                let _ = raise_integration_window(&main_window.as_ref().window());
                            }
                        }
                    }
                }
                return false;
            }
            if let Some(encoded) = requested_url.as_str().strip_prefix("hvy-integration://toolbar-state/") {
                if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded) {
                    if let Ok(state) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        if let Some(toolbar) = integration_app.get_webview(&integration_toolbar_label(&result_profile_id)) {
                            let _ = toolbar.eval(format!("window.hvySetInspectionState?.({state})"));
                        }
                    }
                }
                return false;
            }
            if requested_url.as_str() == "hvy-integration://inspection-cancel" {
                navigation_action_mode.store(false, Ordering::SeqCst);
                if let Some(toolbar) = integration_app.get_webview(&integration_toolbar_label(&result_profile_id)) {
                    let _ = toolbar.eval("window.hvySetInspectionState?.({})");
                }
                if let Some(main_window) = integration_app.get_webview_window("main") {
                    let _ = raise_integration_window(&main_window.as_ref().window());
                }
                return false;
            }
            allowed_integration_url_for_origins(requested_url, &navigation_allowed_origins)
        });
        #[cfg(target_os = "macos")]
        let builder = builder.data_store_identifier(integration_data_store_id(browser_store_id.as_deref().unwrap_or(DEFAULT_INTEGRATION_PROFILE_ID))?);
        #[cfg(not(target_os = "macos"))]
        let builder = builder.incognito(true);
        let scale = native_window.scale_factor().map_err(|error| AppError::Message(error.to_string()))?;
        let size = native_window.inner_size().map_err(|error| AppError::Message(error.to_string()))?;
        let logical_size = size.to_logical::<f64>(scale);
        let toolbar_view_height = INTEGRATION_TOOLBAR_HEIGHT + INTEGRATION_TOOLBAR_WINDOW_INSET;
        let remote_webview = native_window.add_child(
            builder,
            tauri::LogicalPosition::new(0.0, toolbar_view_height),
            tauri::LogicalSize::new(logical_size.width, (logical_size.height - toolbar_view_height).max(0.0)),
        ).map_err(|error| AppError::Message(error.to_string()))?;
        #[cfg(target_os = "windows")]
        install_integration_message_handler(
            &remote_webview,
            app.clone(),
            action_mode_pending.clone(),
            profile_id.clone(),
        )?;
        let toolbar_label = integration_toolbar_label(&profile_id);
        let toolbar_remote = remote_webview.clone();
        let toolbar_window = native_window.clone();
        let toolbar_app = app.clone();
        let toolbar_profile_id = profile_id.clone();
        let toolbar_origins = toolbar_allowed_origins;
        let toolbar_action_mode = action_mode_pending.clone();
        let toolbar = tauri::webview::WebviewBuilder::new(
            toolbar_label,
            tauri::WebviewUrl::App("integration-browser-toolbar.html".into()),
        ).on_navigation(move |requested_url| {
            if let Some(action) = requested_url.as_str().strip_prefix("hvy-integration://toolbar/") {
                let _ = toolbar_app.emit("integration-inspection-result", serde_json::json!({
                    "kind": "integration-toolbar-action",
                    "action": action,
                    "profileId": toolbar_profile_id,
                }));
                if let Some(main_window) = toolbar_app.get_webview_window("main") {
                    let _ = raise_integration_window(&main_window.as_ref().window());
                }
                return false;
            }
            if let Some(browser_command) = requested_url.as_str().strip_prefix("hvy-integration://browser/") {
                if browser_command == "back" { let _ = toolbar_remote.eval("window.history.back()"); }
                if browser_command == "forward" { let _ = toolbar_remote.eval("window.history.forward()"); }
                if browser_command == "reload" { let _ = toolbar_remote.reload(); }
                if browser_command == "inspect" {
                    toolbar_action_mode.store(true, Ordering::SeqCst);
                    let _ = toolbar_remote.eval(&format!("{}\nwindow.__hvyGalaxyInspector.start()", INTEGRATION_INSPECTOR));
                }
                if browser_command == "close" { let _ = toolbar_window.close(); }
                return false;
            }
            if let Some(control) = requested_url.as_str().strip_prefix("hvy-integration://inspector-control/") {
                if matches!(control, "navigate" | "undo" | "done") {
                    let _ = toolbar_remote.eval(&format!("window.__hvyGalaxyInspector?.control({control:?})"));
                }
                return false;
            }
            if let Some(encoded) = requested_url.as_str().strip_prefix("hvy-integration://navigate/") {
                if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded) {
                    if let Ok(value) = String::from_utf8(bytes) {
                        if let Ok(url) = value.parse::<tauri::Url>() {
                            if allowed_integration_url_for_origins(&url, &toolbar_origins) {
                                let _ = toolbar_remote.navigate(url);
                            }
                        }
                    }
                }
                return false;
            }
            true
        });
        let toolbar_webview = native_window.add_child(
            toolbar,
            tauri::LogicalPosition::new(0.0, 0.0),
            tauri::LogicalSize::new(logical_size.width, toolbar_view_height),
        ).map_err(|error| AppError::Message(error.to_string()))?;
        let resized_remote = remote_webview.clone();
        let resized_toolbar = toolbar_webview.clone();
        native_window.on_window_event(move |event| {
            if let tauri::WindowEvent::Resized(size) = event {
                let logical_size = size.to_logical::<f64>(scale);
                let _ = resized_remote.set_bounds(tauri::Rect {
                    position: tauri::LogicalPosition::new(0.0, toolbar_view_height).into(),
                    size: tauri::LogicalSize::new(logical_size.width, (logical_size.height - toolbar_view_height).max(0.0)).into(),
                });
                let _ = resized_toolbar.set_bounds(tauri::Rect {
                    position: tauri::LogicalPosition::new(0.0, 0.0).into(),
                    size: tauri::LogicalSize::new(logical_size.width, toolbar_view_height).into(),
                });
            }
        });
        if !foreground {
            if let Some(main_window) = app.get_webview_window("main") {
                raise_integration_window(&main_window.as_ref().window())?;
            }
        }
        app.set_menu(build_menu(&app).map_err(|error| AppError::Message(error.to_string()))?)
            .map_err(|error| AppError::Message(error.to_string()))?;
        native_window.remove_menu().map_err(|error| AppError::Message(error.to_string()))?;
        let menu_app = app.clone();
        let destroyed_action_mode = action_mode_pending.clone();
        let destroyed_profile_id = profile_id.clone();
        native_window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if destroyed_action_mode.swap(false, Ordering::SeqCst) {
                    let _ = menu_app.emit("integration-inspection-result", serde_json::json!({
                        "kind": "integration-browser-closed",
                        "profileId": destroyed_profile_id,
                    }));
                    if let Some(main_window) = menu_app.get_webview_window("main") {
                        let _ = raise_integration_window(&main_window.as_ref().window());
                    }
                }
                if let Ok(menu) = build_menu(&menu_app) {
                    let _ = menu_app.set_menu(menu);
                }
            }
        });
        #[cfg(not(target_os = "macos"))]
        restore_integration_cookies(&app, &remote_webview)?;
        remote_webview.navigate(url)
            .map_err(|error| AppError::Message(error.to_string()))?;
        native_window.show().map_err(|error| AppError::Message(error.to_string()))?;
        if foreground {
            raise_integration_window(&native_window)?;
        } else if let Some(main_window) = app.get_webview_window("main") {
            raise_integration_window(&main_window.as_ref().window())?;
        }
        #[cfg(not(target_os = "macos"))]
        let close_started = Arc::new(AtomicBool::new(false));
        #[cfg(not(target_os = "macos"))]
        let close_window = native_window.clone();
        #[cfg(not(target_os = "macos"))]
        let close_webview = remote_webview.clone();
        #[cfg(not(target_os = "macos"))]
        let close_app = app.clone();
        #[cfg(not(target_os = "macos"))]
        native_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_started.swap(true, Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let _ = save_integration_cookies(&close_app, &close_webview);
                let _ = close_webview.clear_all_browsing_data();
                let _ = close_window.close();
            }
        });
        return Ok(());
    }

    let (Some(host_window), Some(window)) = (app.get_window(&window_label), app.get_webview(&content_label)) else {
        if command == "close" {
            return Ok(());
        }
        return Err(AppError::Message("Open Gmail or Google Calendar first.".into()));
    };
    if command == "inspect" || command == "inspect-parent" || command == "inspect-target" {
        action_mode_pending.store(true, Ordering::SeqCst);
    } else if command == "cancel-inspect" {
        action_mode_pending.store(false, Ordering::SeqCst);
    }
    let foreground_extraction = command == "extract-pattern" && payload.as_ref().and_then(|value| value.get("foreground")).and_then(serde_json::Value::as_bool) != Some(false);
    if command == "inspect" || command == "inspect-parent" || command == "inspect-target" || command == "test-pattern" || foreground_extraction || command == "execute-command" || command == "focus-browser" {
        raise_integration_window(&host_window)?;
    }
    if command == "cancel-inspect" || command == "focus-main" {
        if let Some(main_window) = app.get_webview_window("main") {
            raise_integration_window(&main_window.as_ref().window())?;
        }
    }
    match command.as_str() {
        "back" => window.eval("window.history.back()"),
        "forward" => window.eval("window.history.forward()"),
        "reload" => window.reload(),
        "inspect" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.start('target', {{ externalToolbar: true }})", INTEGRATION_INSPECTOR)),
        "inspect-parent" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.start('parent', Object.assign({{}}, {}, {{ externalToolbar: true }}))", INTEGRATION_INSPECTOR, payload.unwrap_or_default())),
        "inspect-target" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.start('target', Object.assign({{}}, {}, {{ externalToolbar: true }}))", INTEGRATION_INSPECTOR, payload.unwrap_or_default())),
        "test-pattern" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.matchAndHighlight({})", INTEGRATION_INSPECTOR, payload.unwrap_or_default())),
        "extract-pattern" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.extractAndPublish(({}).pattern || {{}}, ({}).context || {{}})", INTEGRATION_INSPECTOR, payload.clone().unwrap_or_default(), payload.unwrap_or_default())),
        "execute-command" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.executeCommandAndReport({})", INTEGRATION_INSPECTOR, payload.unwrap_or_default())),
        "discover-sources" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.discoverStructuredSourcesAndPublish({})", INTEGRATION_INSPECTOR, payload.unwrap_or_default())),
        "fetch-source" => window.eval(&format!("{}\nwindow.__hvyGalaxyInspector.fetchStructuredSourceAndPublish(({}).source || {{}}, ({}).context || {{}})", INTEGRATION_INSPECTOR, payload.clone().unwrap_or_default(), payload.unwrap_or_default())),
        "cancel-inspect" => {
            if let Some(toolbar) = app.get_webview(&integration_toolbar_label(&profile_id)) {
                let _ = toolbar.eval("window.hvySetInspectionState?.({})");
            }
            window.eval("window.__hvyGalaxyInspector?.stop()")
        },
        "focus-browser" | "focus-main" => Ok(()),
        "close" => {
            #[cfg(not(target_os = "macos"))]
            save_integration_cookies(&app, &window)?;
            host_window.close()
        },
        _ => return Err(AppError::Message("Unknown integration browser command.".into())),
    }
    .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(())
}

#[tauri::command]
fn integration_browser_is_open(app: AppHandle, profile_id: Option<String>) -> bool {
    let profile_id = profile_id.unwrap_or_else(|| DEFAULT_INTEGRATION_PROFILE_ID.into());
    app.get_window(&integration_browser_label(&profile_id)).is_some()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationStorageProbeResult {
    cookie_name: String,
    inserted: bool,
    extracted: bool,
    fresh_store_empty: bool,
    restored: bool,
    deleted: bool,
}

#[tauri::command]
fn probe_integration_cookie_storage(app: AppHandle) -> AppResult<IntegrationStorageProbeResult> {
    let cookie_name = "hvy_galaxy_storage_probe";
    let cookie_value = "round-trip";
    let cookie_url = "https://www.msn.com/".parse::<tauri::Url>()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let probe_id = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Message(error.to_string()))?
        .as_nanos();
    let source_label = format!("integration-storage-probe-source-{probe_id}");
    let restored_label = format!("integration-storage-probe-restored-{probe_id}");
    let source_window = tauri::WebviewWindowBuilder::new(
        &app,
        &source_label,
        tauri::WebviewUrl::External(cookie_url.clone()),
    )
    .title("HVY Galaxy Storage Probe")
    .visible(false)
    .incognito(true)
    .on_navigation(allowed_integration_url)
    .build()
    .map_err(|error| AppError::Message(error.to_string()))?;
    let restored_window = tauri::WebviewWindowBuilder::new(
        &app,
        &restored_label,
        tauri::WebviewUrl::External(cookie_url.clone()),
    )
    .title("HVY Galaxy Storage Probe")
    .visible(false)
    .incognito(true)
    .on_navigation(allowed_integration_url)
    .build()
    .map_err(|error| AppError::Message(error.to_string()))?;
    let cookie = tauri::webview::Cookie::build((cookie_name, cookie_value))
        .domain("www.msn.com")
        .path("/")
        .secure(true)
        .http_only(true)
        .same_site(tauri::webview::cookie::SameSite::Lax)
        .build();
    source_window.set_cookie(cookie.clone()).map_err(|error| AppError::Message(error.to_string()))?;
    let inserted_cookies = source_window.cookies_for_url(cookie_url.clone())
        .map_err(|error| AppError::Message(error.to_string()))?;
    let extracted = inserted_cookies.iter()
        .any(|candidate| candidate.name() == cookie_name && candidate.value() == cookie_value);
    let extracted_cookie = inserted_cookies.into_iter()
        .find(|candidate| candidate.name() == cookie_name && candidate.value() == cookie_value)
        .ok_or_else(|| AppError::Message("The ephemeral source store did not return the inserted cookie.".into()))?;
    let fresh_store_empty = !restored_window.cookies_for_url(cookie_url.clone())
        .map_err(|error| AppError::Message(error.to_string()))?
        .iter()
        .any(|candidate| candidate.name() == cookie_name);
    restored_window.set_cookie(extracted_cookie.clone())
        .map_err(|error| AppError::Message(error.to_string()))?;
    let restored = restored_window.cookies_for_url(cookie_url.clone())
        .map_err(|error| AppError::Message(error.to_string()))?
        .iter()
        .any(|candidate| candidate.name() == cookie_name && candidate.value() == cookie_value);
    source_window.delete_cookie(extracted_cookie.clone())
        .map_err(|error| AppError::Message(error.to_string()))?;
    restored_window.delete_cookie(extracted_cookie)
        .map_err(|error| AppError::Message(error.to_string()))?;
    let source_deleted = !source_window.cookies_for_url(cookie_url.clone())
        .map_err(|error| AppError::Message(error.to_string()))?
        .iter()
        .any(|candidate| candidate.name() == cookie_name);
    let restored_deleted = !restored_window.cookies_for_url(cookie_url)
        .map_err(|error| AppError::Message(error.to_string()))?
        .iter()
        .any(|candidate| candidate.name() == cookie_name);
    source_window.close().map_err(|error| AppError::Message(error.to_string()))?;
    restored_window.close().map_err(|error| AppError::Message(error.to_string()))?;
    Ok(IntegrationStorageProbeResult {
        cookie_name: cookie_name.into(),
        inserted: true,
        extracted,
        fresh_store_empty,
        restored,
        deleted: source_deleted && restored_deleted,
    })
}

#[tauri::command]
fn load_included_document(app: AppHandle, id: String) -> AppResult<DocumentFile> {
    let resource = match id.as_str() {
        "hvy-galaxy-guide" => "resources/hvy-galaxy.hvy",
        "hvy-guide" => "resources/hvy-guide.hvy",
        _ => return Err(AppError::Message(format!("Unknown included document: {id}"))),
    };
    let resource_path = app
        .path()
        .resolve(resource, tauri::path::BaseDirectory::Resource)
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
fn reauthorize_workspace(path: String) -> AppResult<Option<Workspace>> {
    let expected = PathBuf::from(&path);
    let Some(selected) = rfd::FileDialog::new()
        .set_directory(&expected)
        .set_title("Select this workspace folder to grant HVY Galaxy access")
        .pick_folder()
    else {
        return Ok(None);
    };
    if selected != expected {
        return Err(AppError::Message(format!(
            "Selected folder does not match the workspace requiring access. Expected {}; selected {}.",
            expected.display(),
            selected.display()
        )));
    }
    load_workspace_from_path(&selected).map(Some)
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
fn load_workspace(
    app: AppHandle,
    path: String,
    include_templates: Option<bool>,
    record_recent: Option<bool>,
) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let workspace = ensure_workspace(&path)?;
    remove_archived_workspace(&app, &path)?;
    if record_recent.unwrap_or(false) {
        add_recent_workspace(&app, &path)?;
    }
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
fn update_workspace_file_ai_access(path: String, updates: WorkspaceFileAiAccessUpdate) -> AppResult<Workspace> {
    let path = PathBuf::from(path);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let workspace_path = workspace_root_for_document(parent)
        .ok_or_else(|| AppError::Message("Document must be inside a workspace.".into()))?;
    document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents can be updated.".into()))?;
    update_workspace_file_ai_access_at(&workspace_path, &path, updates)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn update_workspace_ai_access(workspace_path: String, updates: WorkspaceAiAccessUpdate) -> AppResult<Workspace> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    update_workspace_ai_access_at(&workspace_path, updates)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn update_workspace_folder_ai_access(
    workspace_path: String,
    target_directory: String,
    updates: WorkspaceFolderAiAccessUpdate,
) -> AppResult<Workspace> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let target_directory = target_directory.trim();
    if target_directory.is_empty() {
        return Err(AppError::Message("Folder is required.".into()));
    }
    let relative = PathBuf::from(target_directory);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(AppError::Message("Folder path must stay inside the workspace.".into()));
    }
    let folder_path = workspace_path.join(relative);
    if !folder_path.is_dir() {
        return Err(AppError::Message("Folder was not found.".into()));
    }
    update_workspace_folder_ai_access_at(&workspace_path, &folder_path, updates)?;
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
fn create_workspace_folder(app: AppHandle, request: WorkspaceFolderRequest) -> AppResult<Workspace> {
    let workspace_path = PathBuf::from(request.workspace_path);
    ensure_workspace(&workspace_path)?;
    let parent = workspace_target_directory(&workspace_path, &request.parent_directory)?;
    let folder_path = parent.join(normalized_folder_name(&request.name)?);
    if folder_path.exists() {
        return Err(AppError::Message("A folder already exists at that path.".into()));
    }
    fs::create_dir(&folder_path)?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    load_workspace_from_path(&workspace_path)
}

#[tauri::command]
fn add_files_to_workspace(app: AppHandle, workspace_path: String, target_directory: String) -> AppResult<Option<AddFilesResult>> {
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
    let destination_root = workspace_target_directory(&workspace_path, &target_directory)?;
    let installs_workspace_templates = destination_root == workspace_templates_dir_path(&workspace_path);
    for source in paths {
        if document_extension(&source).is_none() {
            return Err(AppError::Message(
                "Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.".into(),
            ));
        }
        let file_name = source
            .file_name()
            .ok_or_else(|| AppError::Message("Selected file has no file name.".into()))?;
        let is_template = installs_workspace_templates && template_extension(&source).is_some();
        let destination = incoming_workspace_file_path(&workspace_path, &destination_root, file_name)?;
        fs::copy(&source, &destination)?;
        if is_template {
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
    target_directory: String,
) -> AppResult<AddFilesResult> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let mut copied = Vec::new();
    let mut copied_templates = Vec::new();
    let destination_root = workspace_target_directory(&workspace_path, &target_directory)?;
    let installs_workspace_templates = destination_root == workspace_templates_dir_path(&workspace_path);

    for file in files {
        if document_extension(Path::new(&file.name)).is_none() {
            return Err(AppError::Message(
                "Only .hvy, .thvy, .phvy, and .md documents can be added to a workspace.".into(),
            ));
        }
        let is_template = installs_workspace_templates && template_extension(Path::new(&file.name)).is_some();
        let destination = incoming_workspace_file_path(&workspace_path, &destination_root, std::ffi::OsStr::new(&file.name))?;
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
        .add_filter("Import sources", &["hvy", "thvy", "phvy", "txt", "md", "pdf", "docx"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
        .add_filter("Markdown", &["md"])
        .add_filter("Plain text", &["txt"])
        .add_filter("PDF", &["pdf"])
        .add_filter("DocX", &["docx"])
        .pick_file()
    else {
        return Ok(None);
    };
    let extension = import_source_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, .txt, .md, .pdf, and .docx files can be imported.".into()))?;
    let text = if extension == ".txt" {
        Some(fs::read_to_string(&path)?)
    } else if extension == ".pdf" {
        Some(extract_pdf_text_at(&path)?)
    } else if extension == ".docx" {
        Some(extract_docx_text_at(&path)?)
    } else {
        None
    };
    let bytes = if extension == ".txt" || extension == ".pdf" || extension == ".docx" {
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
fn load_launch_document_paths(state: State<LaunchDocumentState>) -> AppResult<Vec<String>> {
    state
        .renderer_accepts_open_document_paths
        .store(true, Ordering::SeqCst);
    let mut pending_paths = state.pending_paths.lock().unwrap();
    Ok(pending_paths.drain(..).collect())
}

#[tauri::command]
fn read_document_file(app: AppHandle, path: String) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    let file = read_document_at(&path)?;
    add_recent_file(&app, &path)?;
    Ok(file)
}

#[tauri::command]
fn read_document_file_metadata(app: AppHandle, path: String) -> AppResult<DocumentFileMetadata> {
    let path = PathBuf::from(path);
    let metadata = read_document_metadata_at(&path)?;
    add_recent_file(&app, &path)?;
    Ok(metadata)
}

#[tauri::command]
fn read_document_file_bytes(path: String) -> AppResult<tauri::ipc::Response> {
    let path = PathBuf::from(path);
    document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents are supported.".into()))?;
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

#[tauri::command]
fn read_embedding_sidecar_file_bytes(path: String) -> AppResult<Option<Vec<u8>>> {
    let path = PathBuf::from(path);
    embedding_sidecar_source_path(&path)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read(path)?))
}

#[tauri::command]
fn write_embedding_sidecar_file(path: String, bytes: Vec<u8>) -> AppResult<()> {
    let path = PathBuf::from(path);
    let source = embedding_sidecar_source_path(&path)?;
    if !source.exists() {
        return Err(AppError::Message("Embedding sidecar source document does not exist.".into()));
    }
    write_file_atomically(&path, &bytes)?;
    Ok(())
}

#[tauri::command]
fn write_embedding_sidecar_file_raw(request: tauri::ipc::Request<'_>) -> AppResult<()> {
    let path = decode_ipc_header(request.headers(), "x-hvy-sidecar-path")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("Expected raw embedding sidecar bytes.".into()));
    };
    write_embedding_sidecar_file(path, bytes.to_vec())
}

#[tauri::command]
fn delete_embedding_sidecar_file(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    embedding_sidecar_source_path(&path)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn embedding_sidecar_source_path(path: &Path) -> AppResult<PathBuf> {
    if path.extension().and_then(|extension| extension.to_str()) != Some("emb") {
        return Err(AppError::Message("Embedding sidecar files must use the .emb extension.".into()));
    }
    let source = PathBuf::from(path.to_string_lossy().trim_end_matches(".emb"));
    if document_extension(&source).as_deref() != Some(".hvy") {
        return Err(AppError::Message("Embedding sidecars are only supported for .hvy documents.".into()));
    }
    Ok(source)
}

#[tauri::command]
fn save_document_file(app: AppHandle, path: String, bytes: Vec<u8>) -> AppResult<DocumentWriteResult> {
    persist_document_file(&app, PathBuf::from(path), &bytes)
}

#[tauri::command]
fn save_document_file_raw(app: AppHandle, request: tauri::ipc::Request<'_>) -> AppResult<DocumentWriteResult> {
    let path = decode_ipc_header(request.headers(), "x-hvy-document-path")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("Expected raw document bytes.".into()));
    };
    persist_document_file(&app, PathBuf::from(path), bytes)
}

fn persist_document_file(app: &AppHandle, path: PathBuf, bytes: &[u8]) -> AppResult<DocumentWriteResult> {
    let started_at = std::time::Instant::now();
    let mut timings = HashMap::new();
    let write_started_at = std::time::Instant::now();
    write_file_atomically(&path, bytes)?;
    timings.insert("writeBytesMs".to_string(), write_started_at.elapsed().as_millis());
    let recent_started_at = std::time::Instant::now();
    add_recent_file(app, &path)?;
    timings.insert("addRecentMs".to_string(), recent_started_at.elapsed().as_millis());
    timings.insert("totalMs".to_string(), started_at.elapsed().as_millis());
    Ok(DocumentWriteResult {
        debug_timings: Some(timings),
    })
}

#[tauri::command]
fn save_document_as_dialog(
    app: AppHandle,
    suggested_name: String,
    bytes: Vec<u8>,
) -> AppResult<Option<DocumentFileMetadata>> {
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
    persist_document_file(&app, path.clone(), &bytes)?;
    Ok(Some(read_document_metadata_at(&path)?))
}

#[tauri::command]
fn save_document_as_dialog_raw(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<Option<DocumentFileMetadata>> {
    let suggested_name = decode_ipc_header(request.headers(), "x-hvy-suggested-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("Expected raw document bytes.".into()));
    };
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Supported documents", &["hvy", "thvy", "phvy", "md"])
        .add_filter("HVY documents", &["hvy", "thvy", "phvy"])
        .add_filter("Markdown", &["md"])
        .set_file_name(suggested_name)
        .save_file()
    else {
        return Ok(None);
    };
    document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents are supported.".into()))?;
    persist_document_file(&app, path.clone(), bytes)?;
    Ok(Some(read_document_metadata_at(&path)?))
}

fn decode_ipc_header(headers: &tauri::http::HeaderMap, name: &str) -> AppResult<String> {
    let encoded = headers
        .get(name)
        .ok_or_else(|| AppError::Message(format!("Missing {name} header.")))?
        .to_str()
        .map_err(|error| AppError::Message(error.to_string()))?;
    percent_decode_header_value(encoded)
}

fn percent_decode_header_value(value: &str) -> AppResult<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(AppError::Message("Invalid encoded header value.".into()));
            }
            let high = decode_hex_digit(bytes[index + 1])?;
            let low = decode_hex_digit(bytes[index + 2])?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|error| AppError::Message(error.to_string()))
}

fn decode_hex_digit(value: u8) -> AppResult<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(AppError::Message("Invalid encoded header value.".into())),
    }
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
fn save_binary_as_dialog(suggested_name: String, bytes: Vec<u8>) -> AppResult<Option<String>> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(suggested_name)
        .save_file()
    else {
        return Ok(None);
    };
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
        rename_workspace_file_manifest_entries(&workspace_path, &path, &destination)?;
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
        update_workspace_file_ai_access_at(
            &workspace_path,
            &path,
            WorkspaceFileAiAccessUpdate {
                locked: Some(false),
                hidden_from_ai: Some(false),
            },
        )?;
        return load_workspace_from_path(&workspace_path).map(Some);
    }
    Ok(None)
}

#[tauri::command]
fn delete_workspace_folder(app: AppHandle, request: DeleteWorkspaceFolderRequest) -> AppResult<Workspace> {
    let workspace_path = PathBuf::from(request.workspace_path);
    ensure_workspace(&workspace_path)?;
    let target_directory = request.target_directory.trim();
    if target_directory.is_empty() {
        return Err(AppError::Message("Folder is required.".into()));
    }
    let relative_directory = PathBuf::from(target_directory);
    if relative_directory.is_absolute() || relative_directory.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(AppError::Message("Folder path must stay inside the workspace.".into()));
    }
    let folder_path = workspace_path.join(relative_directory);
    let manifest_path = workspace_manifest_path(&workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    let archived_files: HashSet<String> = manifest.archived_files.iter().cloned().collect();
    let deleted_files = workspace_document_files_in_directory(&folder_path)?;
    let active_file = deleted_files
        .iter()
        .map(|path| relative_path(&workspace_path, path))
        .find(|relative| !archived_files.contains(relative));
    if active_file.is_some() {
        return Err(AppError::Message("Folder contains files that are not archived.".into()));
    }
    fs::remove_dir_all(&folder_path)?;
    let deleted_relatives: HashSet<String> = deleted_files
        .iter()
        .map(|path| relative_path(&workspace_path, path))
        .collect();
    let deleted_folder_relative = target_directory.replace('\\', "/");
    manifest.archived_files.retain(|entry| !deleted_relatives.contains(entry));
    manifest.locked_files.retain(|entry| !deleted_relatives.contains(entry));
    manifest.hidden_from_ai_folders.retain(|entry| {
        entry != &deleted_folder_relative && !entry.starts_with(&format!("{deleted_folder_relative}/"))
    });
    manifest.hidden_from_ai_files.retain(|entry| !deleted_relatives.contains(entry));
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)?;
    for path in deleted_files {
        remove_recent_file(&app, &path)?;
    }
    add_recent_workspace(&app, &workspace_path)?;
    load_workspace_from_path(&workspace_path)
}

fn workspace_document_files_in_directory(directory: &Path) -> AppResult<Vec<PathBuf>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(workspace_document_files_in_directory(&path)?);
        } else if document_extension(&path).is_some() {
            files.push(path);
        }
    }
    Ok(files)
}

#[tauri::command]
fn save_document_to_workspace(
    app: AppHandle,
    workspace_path: String,
    name: String,
    target_directory: String,
    bytes: Vec<u8>,
) -> AppResult<DocumentFileMetadata> {
    save_document_to_workspace_bytes(&app, workspace_path, name, target_directory, &bytes)
}

#[tauri::command]
fn save_document_to_workspace_raw(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<DocumentFileMetadata> {
    let workspace_path = decode_ipc_header(request.headers(), "x-hvy-workspace-path")?;
    let name = decode_ipc_header(request.headers(), "x-hvy-document-name")?;
    let target_directory = decode_ipc_header(request.headers(), "x-hvy-target-directory").unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("Expected raw document bytes.".into()));
    };
    save_document_to_workspace_bytes(&app, workspace_path, name, target_directory, bytes)
}

fn save_document_to_workspace_bytes(
    app: &AppHandle,
    workspace_path: String,
    name: String,
    target_directory: String,
    bytes: &[u8],
) -> AppResult<DocumentFileMetadata> {
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    let file_name = document_file_name(&name)?;
    let destination = unique_copy_path(&workspace_target_directory(&workspace_path, &target_directory)?, std::ffi::OsStr::new(&file_name));
    write_file_atomically(&destination, bytes)?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(app, &workspace_path)?;
    add_recent_file(app, &destination)?;
    read_document_metadata_at(&destination)
}

#[tauri::command]
fn copy_document_to_workspace(app: AppHandle, path: String, workspace_path: String, target_directory: String) -> AppResult<DocumentFile> {
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
    let target_root = workspace_target_directory(&workspace_path, &target_directory)?;
    let destination = incoming_workspace_file_path(&workspace_path, &target_root, file_name)?;
    fs::copy(&path, &destination)?;
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    add_recent_file(&app, &destination)?;
    read_document_at(&destination)
}

#[tauri::command]
fn move_document_to_workspace(app: AppHandle, path: String, workspace_path: String, target_directory: String) -> AppResult<DocumentFile> {
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
    let target_root = workspace_target_directory(&workspace_path, &target_directory)?;
    if fs::canonicalize(source_parent)? == fs::canonicalize(&target_root)? {
        touch_workspace_manifest(&workspace_path)?;
        add_recent_workspace(&app, &workspace_path)?;
        add_recent_file(&app, &path)?;
        return read_document_at(&path);
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Message("Document file has no file name.".into()))?;
    let destination = incoming_workspace_file_path(&workspace_path, &target_root, file_name)?;
    fs::rename(&path, &destination)?;
    if let Some(source_workspace) = source_workspace {
        if fs::canonicalize(&source_workspace)? == fs::canonicalize(&workspace_path)? {
            rename_workspace_file_manifest_entries(&source_workspace, &path, &destination)?;
        } else {
            touch_workspace_manifest(&source_workspace)?;
        }
    }
    touch_workspace_manifest(&workspace_path)?;
    add_recent_workspace(&app, &workspace_path)?;
    add_recent_file(&app, &destination)?;
    read_document_at(&destination)
}

#[tauri::command]
fn convert_workspace_document_kind(
    app: AppHandle,
    path: String,
    workspace_path: String,
    to_template: bool,
) -> AppResult<DocumentFile> {
    let path = PathBuf::from(path);
    let extension = document_extension(&path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, and .phvy files can be converted.".into()))?;
    if extension == ".md" {
        return Err(AppError::Message("Only .hvy, .thvy, and .phvy files can be converted.".into()));
    }
    if !path.is_file() {
        return Err(AppError::Message("Document file does not exist.".into()));
    }
    let source_parent = path
        .parent()
        .ok_or_else(|| AppError::Message("Document file has no containing folder.".into()))?;
    let source_workspace = workspace_root_for_document(source_parent)
        .ok_or_else(|| AppError::Message("Document must be inside the selected workspace.".into()))?;
    let workspace_path = PathBuf::from(workspace_path);
    ensure_workspace(&workspace_path)?;
    if fs::canonicalize(&source_workspace)? != fs::canonicalize(&workspace_path)? {
        return Err(AppError::Message("Document must be inside the selected workspace.".into()));
    }
    let next_extension = if extension == ".phvy" {
        ".phvy"
    } else if to_template {
        ".thvy"
    } else {
        ".hvy"
    };
    let destination_root = if to_template {
        workspace_templates_dir(&workspace_path)?
    } else {
        workspace_path.clone()
    };
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Message("Document file has no file name.".into()))?;
    let file_name = format!("{stem}{next_extension}");
    let destination = unique_copy_path(&destination_root, std::ffi::OsStr::new(&file_name));
    fs::rename(&path, &destination)?;
    rename_workspace_file_manifest_entries(&workspace_path, &path, &destination)?;
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
fn read_system_clipboard_text() -> AppResult<String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err(AppError::Message("System clipboard text read is currently supported on macOS only.".into()));
    }
    #[cfg(target_os = "macos")]
    {
        run_apple_script("the clipboard as text")
    }
}

#[tauri::command]
fn paste_system_files_to_workspace(app: AppHandle, workspace_path: String, target_directory: String) -> AppResult<AddFilesResult> {
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
        let destination_root = workspace_target_directory(&workspace_path, &target_directory)?;
        let destination = incoming_workspace_file_path(&workspace_path, &destination_root, file_name)?;
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
    let started_at = std::time::Instant::now();
    let mut timings = HashMap::new();
    if document_extension(Path::new(&request.name)).is_none() {
        return Err(AppError::Message("Recovery draft document name must end in .hvy, .thvy, .phvy, or .md.".into()));
    }
    let prune_started_at = std::time::Instant::now();
    prune_document_backups(&app)?;
    timings.insert("pruneMs".to_string(), prune_started_at.elapsed().as_millis());
    let id_started_at = std::time::Instant::now();
    let created_at = Utc::now().to_rfc3339();
    let id = document_backup_id(&request, &created_at);
    timings.insert("idMs".to_string(), id_started_at.elapsed().as_millis());
    let write_bytes_started_at = std::time::Instant::now();
    write_file_atomically(&document_backup_bytes_path(&app, &id)?, &request.bytes)?;
    timings.insert("writeBytesMs".to_string(), write_bytes_started_at.elapsed().as_millis());
    let snapshot = DocumentBackupSnapshot {
        id: id.clone(),
        document_path: request.document_path,
        name: request.name,
        extension: request.extension,
        created_at,
        bytes: Vec::new(),
        bytes_path: Some(format!("{id}.bytes")),
        recovery_state: request.recovery_state,
    };
    let write_metadata_started_at = std::time::Instant::now();
    write_json_atomically(&document_backup_path(&app, &id)?, &snapshot)?;
    timings.insert("writeMetadataMs".to_string(), write_metadata_started_at.elapsed().as_millis());
    timings.insert("totalMs".to_string(), started_at.elapsed().as_millis());
    let mut backup = snapshot_metadata(&snapshot);
    backup.debug_timings = Some(timings);
    Ok(Some(backup))
}

#[tauri::command]
fn list_document_backups(app: AppHandle) -> AppResult<Vec<DocumentBackup>> {
    prune_document_backups(&app)?;
    let mut snapshot_entries = read_document_backup_snapshot_paths(&app)?
        .into_iter()
        .filter_map(|path| read_document_backup_snapshot(&path).ok().map(|snapshot| (path, snapshot)))
        .collect::<Vec<_>>();
    snapshot_entries.sort_by(|left, right| right.1.created_at.cmp(&left.1.created_at));
    let mut seen_documents = HashSet::new();
    let mut backups = Vec::new();
    for (path, snapshot) in snapshot_entries {
        if document_backup_matches_saved_file(&snapshot, &path) {
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
    let snapshot = read_document_backup_snapshot_with_bytes(&document_backup_path(&app, &id)?)?;
    Ok(DocumentFile {
        path: snapshot.document_path,
        name: snapshot.name,
        extension: snapshot.extension,
        bytes: snapshot.bytes,
        locked: false,
        hidden_from_ai: false,
        recovery_state: snapshot.recovery_state,
    })
}

#[tauri::command]
fn discard_document_backup(app: AppHandle, id: String) -> AppResult<()> {
    let path = document_backup_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    let bytes_path = document_backup_bytes_path(&app, &id)?;
    if bytes_path.exists() {
        fs::remove_file(bytes_path)?;
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
            let id = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("");
            let _ = fs::remove_file(&path);
            if let Ok(bytes_path) = document_backup_bytes_path(&app, id) {
                let _ = fs::remove_file(bytes_path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn relocate_document_recovery_drafts(app: AppHandle, request: RelocateDocumentRecoveryDraftsRequest) -> AppResult<()> {
    let previous_key = document_recovery_draft_key(&request.previous_document_path, &request.previous_name);
    for path in read_document_backup_snapshot_paths(&app)? {
        let Ok(mut snapshot) = read_document_backup_snapshot(&path) else {
            continue;
        };
        if document_backup_key(&snapshot) != previous_key {
            continue;
        }
        snapshot.document_path = request.document_path.clone();
        snapshot.name = request.name.clone();
        snapshot.extension = request.extension.clone();
        write_json_atomically(&path, &snapshot)?;
    }
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> AppResult<()> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err(AppError::Message("Only http, https, and mailto links can be opened.".into()));
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
    #[cfg(not(target_os = "macos"))]
    save_open_integration_cookies(&app)?;
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
