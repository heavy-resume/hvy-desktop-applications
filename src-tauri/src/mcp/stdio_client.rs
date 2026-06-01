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
        if handle_mcp_stdio_message(
            message,
            &mut output,
            &workspace_config,
            &workspace_paths,
            &workspace_config_path,
        )? {
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

fn handle_mcp_stdio_message<W: Write>(
    message: McpStdioMessage,
    output: &mut W,
    workspace_config: &McpWorkspaceConfig,
    workspace_paths: &[PathBuf],
    workspace_config_path: &Path,
) -> AppResult<bool> {
    let request = match serde_json::from_slice::<serde_json::Value>(&message.body) {
        Ok(request) => request,
        Err(error) => {
            write_mcp_stdio_message(
                output,
                &json_rpc_error(None, -32700, &format!("Invalid JSON: {error}")),
                message.framing,
            )?;
            return Ok(false);
        }
    };
    let is_tool_call = mcp_request_method(&request) == Some("tools/call");
    let response = if is_tool_call {
        let workspaces = load_mcp_stdio_workspaces(workspace_paths)?;
        handle_mcp_tool_call_from_with_access_and_config(
            &workspaces,
            request.get("params").cloned().unwrap_or(serde_json::Value::Null),
            &workspace_config.write_access,
            Some(workspace_config_path),
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
        write_mcp_stdio_message(output, &response, message.framing)?;
    }
    Ok(is_tool_call)
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
