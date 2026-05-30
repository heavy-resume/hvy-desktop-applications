use super::*;

pub(crate) fn run_mcp_stdio_main() -> Result<(), String> {
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
pub(crate) struct McpSettings {
    #[serde(default)]
    pub(crate) start_automatically: bool,
    #[serde(default)]
    pub(crate) port: Option<u16>,
    #[serde(default = "default_mcp_write_access")]
    pub(crate) write_access: String,
    #[serde(default = "generate_mcp_bearer_token")]
    pub(crate) bearer_token: String,
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
pub(crate) struct McpServerStatus {
    running: bool,
    url: Option<String>,
    message: String,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStdioLaunchConfig {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpClientInstallStatus {
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
pub(crate) struct McpWorkspaceConfig {
    #[serde(default)]
    pub(crate) workspaces: Vec<String>,
    #[serde(default = "default_mcp_write_access")]
    pub(crate) write_access: String,
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
pub(crate) enum McpStdioFraming {
    ContentLength,
    Newline,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct McpStdioMessage {
    pub(crate) body: Vec<u8>,
    pub(crate) framing: McpStdioFraming,
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

pub(crate) struct McpRuntime {
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

pub(crate) fn default_mcp_write_access() -> String {
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

#[tauri::command]
pub fn load_mcp_settings(app: AppHandle) -> AppResult<McpSettings> {
    let path = mcp_settings_path(&app)?;
    let settings = read_mcp_settings(&path)?;
    write_json_atomically(&path, &settings)?;
    write_mcp_stdio_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn save_mcp_settings(app: AppHandle, settings: McpSettings) -> AppResult<McpSettings> {
    let settings = normalize_mcp_settings(settings)?;
    write_json_atomically(&mcp_settings_path(&app)?, &settings)?;
    write_mcp_stdio_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn load_mcp_server_status(runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
    Ok(runtime
        .status
        .lock()
        .map_err(|_| AppError::Message("MCP status lock is unavailable.".into()))?
        .clone())
}

#[tauri::command]
pub fn load_mcp_stdio_launch_config(app: AppHandle) -> AppResult<McpStdioLaunchConfig> {
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
pub fn load_mcp_client_install_status(app: AppHandle) -> AppResult<Vec<McpClientInstallStatus>> {
    let launch = load_mcp_stdio_launch_config(app)?;
    mcp_client_install_statuses(&launch)
}

#[tauri::command]
pub fn install_mcp_client(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
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
pub fn remove_mcp_client(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
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
pub fn restore_mcp_client_backup(app: AppHandle, target: String) -> AppResult<Vec<McpClientInstallStatus>> {
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
pub fn start_mcp_server(app: AppHandle, runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
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
pub fn stop_mcp_server(app: AppHandle, runtime: State<McpRuntime>) -> AppResult<McpServerStatus> {
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
pub fn update_mcp_workspaces(app: AppHandle, runtime: State<McpRuntime>, paths: Vec<String>) -> AppResult<()> {
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

fn read_mcp_settings(path: &Path) -> AppResult<McpSettings> {
    if !path.exists() {
        return Ok(McpSettings::default());
    }
    let settings: McpSettings = serde_json::from_slice(&fs::read(path)?)?;
    normalize_mcp_settings(settings)
}

pub(crate) fn normalize_mcp_settings(settings: McpSettings) -> AppResult<McpSettings> {
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

pub(crate) struct HttpRequest {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) headers: Vec<(String, String)>,
    pub(crate) body: Vec<u8>,
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

pub(crate) fn mcp_request_is_authorized(request: &HttpRequest, bearer_token: &str) -> bool {
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

pub(crate) fn mcp_tool_list() -> serde_json::Value {
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
        },
        {
            "name": "workspace.create",
            "description": "Create a new HVY Galaxy workspace folder and add it to this MCP server's workspace list. Use this before creating documents when the user wants a new workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path of the folder to create or initialize as a workspace."
                    },
                    "name": {
                        "type": "string",
                        "description": "Optional workspace display name. Defaults to the folder name."
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "workspace.archive",
            "description": "Archive a workspace for this MCP server by removing it from the active MCP workspace list. This does not delete workspace files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspacePath": {
                        "type": "string",
                        "description": "Absolute path of the workspace to archive."
                    }
                },
                "required": ["workspacePath"],
                "additionalProperties": false
            }
        },
        {
            "name": "document.create",
            "description": "Create a new blank HVY document in an existing workspace. After creation, use document.cli_based_editor to edit the existing document with HVY CLI commands.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspacePath": {
                        "type": "string",
                        "description": "Absolute path of the existing workspace where the document should be created."
                    },
                    "name": {
                        "type": "string",
                        "description": "Document file name or title. Defaults to .hvy unless the name ends with .hvy, .thvy, .phvy, or .md."
                    },
                    "title": {
                        "type": "string",
                        "description": "Optional first section title. Defaults to the document name without extension."
                    }
                },
                "required": ["workspacePath", "name"],
                "additionalProperties": false
            }
        },
        {
            "name": "document.archive",
            "description": "Archive an existing document inside its workspace. This hides it from normal active workspace views and does not delete the file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path of the existing document to archive."
                    }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "hvy.guidance",
            "description": "Return the HVY Galaxy AI guide file. Use this before creating or substantially editing HVY Galaxy workspaces and documents.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "document.cli_based_editor",
            "description": "CLI based editor for one existing HVY document in a workspace. Use this for edits after finding or creating a document: inspect with commands like ls, find, rg, cat, and man; mutate with hvy insert/remove, sed, echo/printf redirection, cp, mv, rm, and plugin commands. Mutating commands are saved back to the document file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path of the .hvy, .thvy, .phvy, or .md document to edit."
                    },
                    "command": {
                        "type": "string",
                        "description": "One HVY CLI command to run, for example \"man hvy\", \"find /body -maxdepth 3\", or \"sed -i 's/old/new/' /body/intro/text.txt\"."
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Optional virtual CLI working directory. Defaults to /."
                    }
                },
                "required": ["path", "command"],
                "additionalProperties": false
            }
        }
    ])
}

fn handle_mcp_tool_call(app: &AppHandle, params: serde_json::Value) -> AppResult<serde_json::Value> {
    let archived_workspaces_path = archived_workspaces_path(app)?;
    handle_mcp_tool_call_from_with_access_config_and_archive_path(
        &known_workspaces(app)?,
        params,
        &default_mcp_write_access(),
        None,
        Some(&archived_workspaces_path),
    )
}

fn handle_mcp_tool_call_from_with_access(
    workspaces: &[Workspace],
    params: serde_json::Value,
    write_access: &str,
) -> AppResult<serde_json::Value> {
    handle_mcp_tool_call_from_with_access_and_config(workspaces, params, write_access, None)
}

fn handle_mcp_tool_call_from_with_access_and_config(
    workspaces: &[Workspace],
    params: serde_json::Value,
    write_access: &str,
    workspace_config_path: Option<&Path>,
) -> AppResult<serde_json::Value> {
    handle_mcp_tool_call_from_with_access_config_and_archive_path(
        workspaces,
        params,
        write_access,
        workspace_config_path,
        workspace_config_path.map(mcp_archived_workspaces_path_from_config).as_deref(),
    )
}

fn handle_mcp_tool_call_from_with_access_config_and_archive_path(
    workspaces: &[Workspace],
    params: serde_json::Value,
    write_access: &str,
    workspace_config_path: Option<&Path>,
    archived_workspaces_path: Option<&Path>,
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
        "workspace.create" => mcp_workspace_create_from(arguments, workspace_config_path)?,
        "workspace.archive" => {
            mcp_workspace_archive_from(workspaces, arguments, workspace_config_path, archived_workspaces_path)?
        }
        "document.create" => mcp_document_create_from(workspaces, arguments)?,
        "document.archive" => mcp_document_archive_from(workspaces, arguments)?,
        "hvy.guidance" => mcp_hvy_guidance()?,
        "document.cli_based_editor" => mcp_document_cli_from(workspaces, arguments)?,
        _ => return Err(AppError::Message(format!("Unknown tool: {name}"))),
    };
    Ok(mcp_tool_result(result))
}

pub(crate) fn ensure_mcp_tool_allowed(name: &str, write_access: &str) -> AppResult<()> {
    if mcp_tool_required_access(name) <= mcp_write_access_level(write_access) {
        return Ok(());
    }
    Err(AppError::Message(format!(
        "Tool {name} is not allowed by MCP write access setting."
    )))
}

fn mcp_tool_required_access(name: &str) -> u8 {
    match name {
        "workspace.list" | "workspace.tree" | "workspace.search" | "hvy.guidance" => 0,
        "document.cli_based_editor" => 1,
        "workspace.create" | "workspace.archive" | "document.create" | "document.archive" => 2,
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

pub(crate) fn mcp_workspace_list_from(workspaces: &[Workspace]) -> AppResult<serde_json::Value> {
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

pub(crate) fn mcp_workspace_tree_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
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

pub(crate) fn mcp_workspace_search_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
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

pub(crate) fn mcp_workspace_create_from(
    arguments: serde_json::Value,
    workspace_config_path: Option<&Path>,
) -> AppResult<serde_json::Value> {
    let path = arguments
        .get("path")
        .and_then(|path| path.as_str())
        .ok_or_else(|| AppError::Message("workspace.create requires a path.".into()))?;
    let name = arguments.get("name").and_then(|name| name.as_str()).map(str::trim).filter(|name| !name.is_empty());
    let path = PathBuf::from(path);
    fs::create_dir_all(&path)?;
    let workspace = initialize_workspace_with_name(&path, name)?;
    if let Some(config_path) = workspace_config_path {
        update_mcp_workspace_config_path(config_path, &path, true)?;
    }
    Ok(serde_json::json!({ "workspace": workspace }))
}

pub(crate) fn mcp_workspace_archive_from(
    workspaces: &[Workspace],
    arguments: serde_json::Value,
    workspace_config_path: Option<&Path>,
    archived_workspaces_path: Option<&Path>,
) -> AppResult<serde_json::Value> {
    let workspace_path = arguments
        .get("workspacePath")
        .and_then(|path| path.as_str())
        .ok_or_else(|| AppError::Message("workspace.archive requires a workspacePath.".into()))?;
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace.path == workspace_path)
        .ok_or_else(|| AppError::Message("workspace.archive requires an active workspace path.".into()))?;
    if let Some(config_path) = workspace_config_path {
        update_mcp_workspace_config_path(config_path, Path::new(workspace_path), false)?;
    }
    if let Some(archive_path) = archived_workspaces_path {
        add_archived_workspace_at_path(
            archive_path,
            ArchivedWorkspace {
                path: workspace.path.clone(),
                name: workspace.manifest.name.clone(),
                archived_at: Utc::now().to_rfc3339(),
            },
        )?;
    }
    Ok(serde_json::json!({
        "workspacePath": workspace.path,
        "name": workspace.manifest.name,
        "archived": true,
        "deleted": false,
    }))
}

pub(crate) fn mcp_document_create_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
    let workspace_path = arguments
        .get("workspacePath")
        .and_then(|path| path.as_str())
        .ok_or_else(|| AppError::Message("document.create requires a workspacePath.".into()))?;
    let name = arguments
        .get("name")
        .and_then(|name| name.as_str())
        .ok_or_else(|| AppError::Message("document.create requires a name.".into()))?;
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace.path == workspace_path)
        .ok_or_else(|| AppError::Message("document.create requires an existing active workspace.".into()))?;
    let workspace_path = PathBuf::from(&workspace.path);
    ensure_workspace(&workspace_path)?;
    let file_name = document_file_name(name)?;
    let path = workspace_path.join(&file_name);
    if path.exists() {
        return Err(AppError::Message("A document already exists at that path.".into()));
    }
    let title = arguments
        .get("title")
        .and_then(|title| title.as_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| document_title(&file_name));
    write_file_atomically(&path, blank_hvy_document_source(&title).as_bytes())?;
    touch_workspace_manifest(&workspace_path)?;
    Ok(serde_json::json!({
        "document": read_document_at(&path)?,
        "workspacePath": workspace.path,
    }))
}

pub(crate) fn mcp_document_archive_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
    let path = arguments
        .get("path")
        .and_then(|path| path.as_str())
        .ok_or_else(|| AppError::Message("document.archive requires a path.".into()))?;
    let document_path = PathBuf::from(path);
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace_contains_document(workspace, &document_path))
        .ok_or_else(|| AppError::Message("document.archive path must be an active HVY document in an added workspace.".into()))?;
    update_archived_document_file(Path::new(&workspace.path), &document_path, true)?;
    Ok(serde_json::json!({
        "path": path,
        "workspacePath": workspace.path,
        "archived": true,
        "deleted": false,
    }))
}

fn mcp_hvy_guidance() -> AppResult<serde_json::Value> {
    let path = hvy_guidance_path()?;
    Ok(serde_json::json!({
        "path": path_to_string(&path),
        "text": fs::read_to_string(path)?,
    }))
}

fn update_mcp_workspace_config_path(config_path: &Path, workspace_path: &Path, add: bool) -> AppResult<()> {
    let mut config = read_mcp_workspace_config(config_path).unwrap_or_else(|_| McpWorkspaceConfig::default());
    let normalized = path_to_string(workspace_path);
    config.workspaces.retain(|path| path != &normalized);
    if add {
        config.workspaces.push(normalized);
        config.workspaces.sort();
        config.workspaces.dedup();
    }
    write_json_atomically(config_path, &config)
}

fn blank_hvy_document_source(title: &str) -> String {
    format!(
        "---\nhvy_version: 0.1\n---\n\n<!--hvy: {{\"id\":\"{}\"}}-->\n#! {}\n\n<!--hvy:text {{}}-->\n Start here\n",
        workspace_folder_name(title),
        title.replace('\n', " ").trim()
    )
}

fn document_title(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled Document")
        .to_string()
}

fn hvy_guidance_path() -> AppResult<PathBuf> {
    let cwd = std::env::current_dir()?;
    let current_exe = std::env::current_exe()?;
    for root in cwd.ancestors().chain(current_exe.ancestors()) {
        for candidate in [
            root.join("src-tauri")
                .join("resources")
                .join("hvy-galaxy-ai-guide.hvy"),
            root.join("resources").join("hvy-galaxy-ai-guide.hvy"),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(AppError::Message("HVY guidance document was not found.".into()))
}

fn mcp_document_cli_from(workspaces: &[Workspace], arguments: serde_json::Value) -> AppResult<serde_json::Value> {
    let path = arguments
        .get("path")
        .and_then(|path| path.as_str())
        .ok_or_else(|| AppError::Message("document.cli_based_editor requires a document path.".into()))?;
    let command = arguments
        .get("command")
        .and_then(|command| command.as_str())
        .ok_or_else(|| AppError::Message("document.cli_based_editor requires a command.".into()))?
        .trim();
    if command.is_empty() {
        return Err(AppError::Message("document.cli_based_editor requires a non-empty command.".into()));
    }
    let cwd = arguments.get("cwd").and_then(|cwd| cwd.as_str()).unwrap_or("/");
    let document_path = PathBuf::from(path);
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace_contains_document(workspace, &document_path))
        .ok_or_else(|| AppError::Message("document.cli_based_editor path must be an HVY document in an added workspace.".into()))?;
    document_extension(&document_path)
        .ok_or_else(|| AppError::Message("document.cli_based_editor supports .hvy, .thvy, .phvy, and .md documents.".into()))?;

    let package_root = mcp_cli_package_root()?;
    let request = serde_json::json!({
        "filePath": path_to_string(&document_path),
        "cwd": cwd,
        "commands": [command],
    });
    let output = Command::new("node")
        .current_dir(package_root)
        .arg("--input-type=module")
        .arg("--eval")
        .arg(MCP_CLI_NODE_EVAL)
        .arg(request.to_string())
        .output()?;
    if !output.status.success() {
        return Err(AppError::Message(mcp_cli_runner_error(&output)));
    }
    let result: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    if result.get("mutated").and_then(|mutated| mutated.as_bool()).unwrap_or(false) {
        touch_workspace_manifest(Path::new(&workspace.path))?;
    }
    Ok(serde_json::json!({
        "path": path,
        "cwd": result.get("cwd").cloned().unwrap_or_else(|| serde_json::json!(cwd)),
        "mutated": result.get("mutated").cloned().unwrap_or_else(|| serde_json::json!(false)),
        "results": result.get("results").cloned().unwrap_or_else(|| serde_json::json!([])),
    }))
}

fn workspace_contains_document(workspace: &Workspace, path: &Path) -> bool {
    flatten_workspace_file_nodes(&workspace.files)
        .iter()
        .any(|file| Path::new(&file.path) == path)
}

const MCP_CLI_NODE_EVAL: &str = r#"
import { runHvyCliOnFile } from 'heavy-file-format-ref-impl/mcp-cli-runner';

try {
  const result = await runHvyCliOnFile(JSON.parse(process.argv[1]));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}
"#;

fn mcp_cli_package_root() -> AppResult<PathBuf> {
    if let Some(path) = std::env::var_os("HVY_GALAXY_MCP_PACKAGE_ROOT") {
        return Ok(PathBuf::from(path));
    }
    let cwd = std::env::current_dir()?;
    let current_exe = std::env::current_exe()?;
    if let Some(path) = mcp_cli_package_root_from(&cwd, &current_exe) {
        return Ok(path);
    }
    Err(AppError::Message(
        "heavy-file-format-ref-impl was not found for the HVY MCP CLI based editor. Set HVY_GALAXY_MCP_PACKAGE_ROOT to the package root.".into(),
    ))
}

pub(crate) fn mcp_cli_package_root_from(cwd: &Path, current_exe: &Path) -> Option<PathBuf> {
    for candidate in [
        mcp_cli_package_root_path(cwd),
        mcp_cli_package_root_path(&cwd.join("..")),
    ] {
        if mcp_cli_package_entry_exists(&candidate) {
            return Some(candidate);
        }
    }
    for ancestor in current_exe.ancestors() {
        let candidate = mcp_cli_package_root_path(ancestor);
        if mcp_cli_package_entry_exists(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn mcp_cli_package_root_path(root: &Path) -> PathBuf {
    root.join("node_modules")
        .join("heavy-file-format-ref-impl")
}

fn mcp_cli_package_entry_exists(package_root: &Path) -> bool {
    package_root.join("package.json").exists()
        && package_root
            .join("scripts")
            .join("hvy-mcp-cli.mjs")
            .exists()
}

fn mcp_cli_runner_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stderr) {
        if let Some(error) = value.get("error").and_then(|error| error.as_str()) {
            return error.to_string();
        }
    }
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        "HVY CLI command failed.".into()
    } else {
        stdout
    }
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

pub(crate) fn run_mcp_stdio<I, R, W>(
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
    let workspace_config_path = cwd.join(MCP_STDIO_WORKSPACE_CONFIG);
    let mut workspace_config = mcp_stdio_workspace_config(args, env_workspaces, cwd)?;
    let mut workspace_paths = workspace_config
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
        let is_tool_call = mcp_request_method(&request) == Some("tools/call");
        let response = if is_tool_call {
            let workspaces = load_mcp_stdio_workspaces(&workspace_paths)?;
            handle_mcp_tool_call_from_with_access_and_config(
                &workspaces,
                request.get("params").cloned().unwrap_or(serde_json::Value::Null),
                &workspace_config.write_access,
                Some(&workspace_config_path),
            )
            .map(|result| {
                let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
                json_rpc_result(id, result)
            })
            .unwrap_or_else(|error| {
                let id = request.get("id").cloned().unwrap_or(serde_json::Value::Null);
                json_rpc_error(Some(id), -32000, &error.to_string())
            })
        } else {
            handle_mcp_json_rpc_for_workspaces(&[], request)
        };
        if !response.is_null() {
            write_mcp_stdio_message(&mut output, &response, message.framing)?;
        }
        if is_tool_call {
            if let Ok(next_config) = read_mcp_workspace_config(&workspace_config_path) {
                workspace_config = next_config;
                workspace_paths = workspace_config
                    .workspaces
                    .iter()
                    .map(PathBuf::from)
                    .collect::<Vec<_>>();
            }
        }
    }
    Ok(())
}

fn mcp_request_method(request: &serde_json::Value) -> Option<&str> {
    request.get("method").and_then(|method| method.as_str())
}

pub(crate) fn mcp_stdio_workspace_config<I>(
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

pub(crate) fn read_mcp_workspace_config_paths(paths: &[PathBuf]) -> AppResult<McpWorkspaceConfig> {
    let mut merged = McpWorkspaceConfig::default();
    for path in paths {
        let config = read_mcp_workspace_config(path)?;
        merged.write_access = config.write_access;
        merged.workspaces.extend(config.workspaces);
    }
    Ok(merged)
}

pub(crate) fn read_mcp_workspace_config(path: &Path) -> AppResult<McpWorkspaceConfig> {
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

fn mcp_archived_workspaces_path_from_config(config_path: &Path) -> PathBuf {
    let directory = config_path.parent().unwrap_or_else(|| Path::new("."));
    if directory.file_name().and_then(|name| name.to_str()) == Some("mcp") {
        if let Some(app_data_directory) = directory.parent() {
            return app_data_directory.join(ARCHIVED_WORKSPACES);
        }
    }
    directory.join(ARCHIVED_WORKSPACES)
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

pub(crate) fn load_mcp_stdio_workspaces(paths: &[PathBuf]) -> AppResult<Vec<Workspace>> {
    let mut workspaces = Vec::new();
    for path in paths {
        if let Ok(workspace) = load_workspace_from_path(path) {
            workspaces.push(workspace);
        }
    }
    Ok(workspaces)
}

pub(crate) fn read_mcp_stdio_message<R: BufRead>(reader: &mut R) -> AppResult<Option<McpStdioMessage>> {
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

fn mcp_settings_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&directory)?;
    Ok(directory.join(MCP_SETTINGS))
}

pub(crate) fn mcp_stdio_workspace_config_path(app: &AppHandle) -> AppResult<PathBuf> {
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

pub(crate) fn install_mcp_for_codex(path: &Path, launch: &McpStdioLaunchConfig) -> AppResult<()> {
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

pub(crate) fn restore_mcp_client_backup_file(path: &Path) -> AppResult<()> {
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

pub(crate) fn upsert_codex_mcp_block(content: &str, launch: &McpStdioLaunchConfig) -> String {
    let block = codex_mcp_block(launch);
    let mut next = remove_codex_mcp_block(content).trim_end().to_string();
    if !next.is_empty() {
        next.push_str("\n\n");
    }
    next.push_str(&block);
    next.push('\n');
    next
}

pub(crate) fn remove_codex_mcp_block(content: &str) -> String {
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

pub(crate) fn upsert_claude_mcp_config(content: &str, launch: &McpStdioLaunchConfig) -> AppResult<String> {
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

pub(crate) fn remove_claude_mcp_config(content: &str) -> AppResult<String> {
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
