const WEBMCP_BROKER_CONNECTION: &str = "webmcp-broker.json";

pub(crate) struct WebMcpBrokerRuntime {
    stop: Arc<AtomicBool>,
    renderer_ready: AtomicBool,
    thread: Mutex<Option<JoinHandle<()>>>,
    connection_path: Mutex<Option<PathBuf>>,
}

impl Default for WebMcpBrokerRuntime {
    fn default() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            renderer_ready: AtomicBool::new(false),
            thread: Mutex::new(None),
            connection_path: Mutex::new(None),
        }
    }
}

type WebMcpBrokerReply = Result<serde_json::Value, String>;
static WEBMCP_BROKER_PENDING: OnceLock<Mutex<HashMap<String, std::sync::mpsc::SyncSender<WebMcpBrokerReply>>>> = OnceLock::new();

fn webmcp_broker_pending() -> &'static Mutex<HashMap<String, std::sync::mpsc::SyncSender<WebMcpBrokerReply>>> {
    WEBMCP_BROKER_PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn webmcp_broker_connection_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("mcp");
    fs::create_dir_all(&directory)?;
    Ok(directory.join(WEBMCP_BROKER_CONNECTION))
}

pub(crate) fn start_webmcp_broker(app: AppHandle) -> AppResult<()> {
    let runtime = app.state::<WebMcpBrokerRuntime>();
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let token = BASE64.encode(Aes256Gcm::generate_key(&mut OsRng));
    let connection_path = webmcp_broker_connection_path(&app)?;
    write_json_atomically(&connection_path, &serde_json::json!({
        "schemaVersion": 1,
        "url": format!("http://127.0.0.1:{}/webmcp", address.port()),
        "bearerToken": token,
        "pid": std::process::id()
    }))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&connection_path, fs::Permissions::from_mode(0o600))?;
    }
    *runtime.connection_path.lock().map_err(|_| AppError::Message("WebMCP broker path lock is unavailable.".into()))? = Some(connection_path);
    let stop = Arc::clone(&runtime.stop);
    let thread_app = app.clone();
    let thread_token = token;
    let handle = thread::Builder::new().name("hvy-webmcp-broker".into()).spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let request_app = thread_app.clone();
                    let request_token = thread_token.clone();
                    let _ = thread::Builder::new().name("hvy-webmcp-request".into()).spawn(move || {
                        handle_webmcp_broker_stream(&request_app, stream, &request_token);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(StdDuration::from_millis(25)),
                Err(_) => break,
            }
        }
    })?;
    *runtime.thread.lock().map_err(|_| AppError::Message("WebMCP broker thread lock is unavailable.".into()))? = Some(handle);
    Ok(())
}

fn handle_webmcp_broker_stream(app: &AppHandle, mut stream: TcpStream, token: &str) {
    let response = match read_http_request(&mut stream) {
        Ok(request) if request.method == "POST" && request.path == "/webmcp" => {
            let authorized = request.header("authorization") == Some(format!("Bearer {token}").as_str());
            if !authorized {
                http_json_response(401, &serde_json::json!({ "ok": false, "error": "Unauthorized." }))
            } else if request.body.len() > 1024 * 1024 {
                http_json_response(400, &serde_json::json!({ "ok": false, "error": "Broker request exceeded the 1 MB limit." }))
            } else {
                match serde_json::from_slice::<serde_json::Value>(&request.body) {
                    Ok(value) => http_json_response(200, &forward_webmcp_broker_request(app, value)),
                    Err(error) => http_json_response(400, &serde_json::json!({ "ok": false, "error": format!("Invalid JSON: {error}") })),
                }
            }
        }
        Ok(_) => http_json_response(404, &serde_json::json!({ "ok": false, "error": "Not found." })),
        Err(error) => http_json_response(400, &serde_json::json!({ "ok": false, "error": error.to_string() })),
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn forward_webmcp_broker_request(app: &AppHandle, mut request: serde_json::Value) -> serde_json::Value {
    if app.get_webview("main").is_none() || !app.state::<WebMcpBrokerRuntime>().renderer_ready.load(Ordering::SeqCst) {
        return serde_json::json!({ "ok": false, "error": "Galaxy's trusted renderer is unavailable." });
    }
    let request_id = format!("webmcp-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let settings = mcp_settings_path(app).and_then(|path| read_mcp_settings(&path)).unwrap_or_default();
    request["requestId"] = serde_json::Value::String(request_id.clone());
    request["integrationAccess"] = serde_json::Value::String(settings.integration_access);
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    if let Ok(mut pending) = webmcp_broker_pending().lock() {
        pending.insert(request_id.clone(), sender);
    } else {
        return serde_json::json!({ "ok": false, "error": "WebMCP broker state is unavailable." });
    }
    if app.emit("webmcp-broker-request", request).is_err() {
        if let Ok(mut pending) = webmcp_broker_pending().lock() { pending.remove(&request_id); }
        return serde_json::json!({ "ok": false, "error": "Galaxy's trusted renderer is unavailable." });
    }
    match receiver.recv_timeout(StdDuration::from_secs(65)) {
        Ok(Ok(value)) => serde_json::json!({ "ok": true, "value": value }),
        Ok(Err(error)) => serde_json::json!({ "ok": false, "error": error }),
        Err(_) => {
            if let Ok(mut pending) = webmcp_broker_pending().lock() { pending.remove(&request_id); }
            serde_json::json!({ "ok": false, "error": "Galaxy timed out while executing the WebMCP request." })
        }
    }
}

#[tauri::command]
pub(crate) fn complete_web_mcp_broker_request(request_id: String, value: Option<serde_json::Value>, error: Option<String>) -> AppResult<()> {
    let sender = webmcp_broker_pending()
        .lock()
        .map_err(|_| AppError::Message("WebMCP broker state is unavailable.".into()))?
        .remove(&request_id);
    if let Some(sender) = sender {
        let _ = sender.send(match error { Some(error) => Err(error), None => Ok(value.unwrap_or(serde_json::Value::Null)) });
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_web_mcp_broker_renderer_ready(app: AppHandle, ready: bool) {
    app.state::<WebMcpBrokerRuntime>().renderer_ready.store(ready, Ordering::SeqCst);
}

pub(crate) fn stop_webmcp_broker(app: &AppHandle) {
    let runtime = app.state::<WebMcpBrokerRuntime>();
    runtime.renderer_ready.store(false, Ordering::SeqCst);
    runtime.stop.store(true, Ordering::SeqCst);
    if let Ok(mut thread) = runtime.thread.lock() {
        if let Some(handle) = thread.take() { let _ = handle.join(); }
    }
    if let Ok(mut path) = runtime.connection_path.lock() {
        if let Some(path) = path.take() { let _ = fs::remove_file(path); }
    };
    if let Ok(mut pending) = webmcp_broker_pending().lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err("Galaxy is closing.".into()));
        }
    }
}

pub(crate) fn call_webmcp_broker(connection_path: &Path, operation: &str, arguments: serde_json::Value, integration_access: &str) -> AppResult<serde_json::Value> {
    if normalize_mcp_integration_access(integration_access) == "off" {
        return Err(AppError::Message("Integration access is off.".into()));
    }
    let connection: serde_json::Value = serde_json::from_slice(&fs::read(connection_path).map_err(|_| AppError::Message("Galaxy is not running or its WebMCP broker is unavailable.".into()))?)?;
    let url = connection.get("url").and_then(serde_json::Value::as_str).ok_or_else(|| AppError::Message("The WebMCP broker connection file is invalid.".into()))?;
    let token = connection.get("bearerToken").and_then(serde_json::Value::as_str).ok_or_else(|| AppError::Message("The WebMCP broker connection file is invalid.".into()))?;
    let authority = url.strip_prefix("http://127.0.0.1:").and_then(|value| value.strip_suffix("/webmcp")).ok_or_else(|| AppError::Message("The WebMCP broker address is invalid.".into()))?;
    let port = authority.parse::<u16>().map_err(|_| AppError::Message("The WebMCP broker port is invalid.".into()))?;
    let mut payload = arguments;
    payload["operation"] = serde_json::Value::String(operation.into());
    payload["integrationAccess"] = serde_json::Value::String(normalize_mcp_integration_access(integration_access));
    let body = payload.to_string();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|_| AppError::Message("Galaxy is not running or its WebMCP broker is unavailable.".into()))?;
    stream.set_read_timeout(Some(StdDuration::from_secs(70)))?;
    write!(stream, "POST /webmcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())?;
    stream.flush()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    let body_start = find_header_end(&response).ok_or_else(|| AppError::Message("The WebMCP broker returned an invalid response.".into()))? + 4;
    let result: serde_json::Value = serde_json::from_slice(&response[body_start..])?;
    if result.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(result.get("value").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        Err(AppError::Message(result.get("error").and_then(serde_json::Value::as_str).unwrap_or("The WebMCP request failed.").into()))
    }
}

fn webmcp_tool_call(connection_path: &Path, params: &serde_json::Value, integration_access: &str) -> Option<AppResult<serde_json::Value>> {
    let name = params.get("name").and_then(serde_json::Value::as_str)?;
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| serde_json::json!({}));
    match name {
        "webmcp_list_tools" => Some(call_webmcp_broker(connection_path, "list", serde_json::json!({}), integration_access).map(mcp_tool_result)),
        "webmcp_call_tool" => Some(call_webmcp_broker(connection_path, "call", arguments, integration_access).map(webmcp_mcp_result)),
        _ => None,
    }
}

pub(crate) fn webmcp_mcp_result(result: serde_json::Value) -> serde_json::Value {
    let value = result.get("value").cloned().unwrap_or(serde_json::Value::Null);
    let mut response = serde_json::json!({
        "content": [{
            "type": "text",
            "text": if value.is_string() { value.as_str().unwrap_or_default().to_string() } else { serde_json::to_string_pretty(&value).unwrap_or_else(|_| "null".into()) }
        }],
        "isError": false,
        "_meta": {
            "webmcp": {
                "origin": result.get("origin").cloned().unwrap_or(serde_json::Value::Null),
                "annotations": result.get("annotations").cloned().unwrap_or_else(|| serde_json::json!({}))
            }
        }
    });
    if result.get("resultIsJson").and_then(serde_json::Value::as_bool) == Some(true) {
        response["structuredContent"] = if value.is_object() { value } else { serde_json::json!({ "result": value }) };
    }
    response
}
