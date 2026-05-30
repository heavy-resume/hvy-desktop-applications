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
