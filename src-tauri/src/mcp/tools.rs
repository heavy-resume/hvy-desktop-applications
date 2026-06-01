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
            "description": "CLI based editor for one existing HVY document in a workspace. Use this for edits after finding or creating a document: inspect with commands like ls, find, rg, cat, sed -n, echo, man, hvy request_structure, hvy search, hvy preview, hvy cheatsheet, hvy recipe, and hvy lint. Mutate with hvy insert/remove, sed -i, echo/printf redirection, cp, mv, rm, and plugin commands. Locked documents allow inspection commands and block commands that mutate document state.",
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
                "fileCount": count_workspace_files(&mcp_visible_workspace_nodes(&workspace.files)),
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
            "files": mcp_visible_workspace_nodes(&workspace.files),
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
            if file_hidden_from_ai(&file) {
                continue;
            }
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
        .find(|workspace| workspace_contains_visible_document(workspace, &document_path))
        .ok_or_else(|| AppError::Message("document.archive path must be an active HVY document in an added workspace.".into()))?;
    let document_file = flatten_workspace_file_nodes(&workspace.files)
        .into_iter()
        .find(|file| Path::new(&file.path) == document_path.as_path())
        .ok_or_else(|| AppError::Message("document.archive path must be an active HVY document in an added workspace.".into()))?;
    if file_locked(&document_file) {
        return Err(AppError::Message("document.archive is not available for locked files.".into()));
    }
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

pub(crate) fn mcp_document_cli_from(
    workspaces: &[Workspace],
    arguments: serde_json::Value,
) -> AppResult<serde_json::Value> {
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
        .find(|workspace| workspace_contains_visible_document(workspace, &document_path))
        .ok_or_else(|| AppError::Message("document.cli_based_editor path must be an HVY document in an added workspace.".into()))?;
    let document_file = flatten_workspace_file_nodes(&workspace.files)
        .into_iter()
        .find(|file| Path::new(&file.path) == document_path.as_path())
        .ok_or_else(|| AppError::Message("document.cli_based_editor path must be an HVY document in an added workspace.".into()))?;
    let locked = file_locked(&document_file);
    document_extension(&document_path)
        .ok_or_else(|| AppError::Message("document.cli_based_editor supports .hvy, .thvy, .phvy, and .md documents.".into()))?;

    let result = if locked {
        mcp_run_locked_cli_command(&document_path, cwd, command)?
    } else {
        mcp_run_cli_command(&document_path, cwd, command)?
    };
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

fn mcp_run_locked_cli_command(document_path: &Path, cwd: &str, command: &str) -> AppResult<serde_json::Value> {
    let temp_document_path = mcp_locked_cli_temp_path(document_path);
    fs::copy(document_path, &temp_document_path)?;
    let result = mcp_run_cli_command(&temp_document_path, cwd, command);
    let _ = fs::remove_file(&temp_document_path);
    let result = result?;
    if result.get("mutated").and_then(|mutated| mutated.as_bool()).unwrap_or(false) {
        return Err(AppError::Message(
            "document.cli_based_editor can only run read commands for locked files.".into(),
        ));
    }
    Ok(result)
}

fn mcp_locked_cli_temp_path(document_path: &Path) -> PathBuf {
    let extension = document_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "hvy-galaxy-locked-cli-{}-{timestamp}{extension}",
        std::process::id(),
    ))
}

fn mcp_run_cli_command(document_path: &Path, cwd: &str, command: &str) -> AppResult<serde_json::Value> {
    let package_root = mcp_cli_package_root()?;
    let request = serde_json::json!({
        "filePath": path_to_string(document_path),
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
    Ok(serde_json::from_slice(&output.stdout)?)
}

fn workspace_contains_visible_document(workspace: &Workspace, path: &Path) -> bool {
    flatten_workspace_file_nodes(&workspace.files)
        .iter()
        .any(|file| Path::new(&file.path) == path && !file_hidden_from_ai(file))
}

fn mcp_visible_workspace_nodes(nodes: &[WorkspaceTreeNode]) -> Vec<WorkspaceTreeNode> {
    nodes
        .iter()
        .filter_map(|node| match node {
            WorkspaceTreeNode::Folder {
                name,
                path,
                relative_path,
                children,
            } => {
                let children = mcp_visible_workspace_nodes(children);
                (!children.is_empty()).then(|| WorkspaceTreeNode::Folder {
                    name: name.clone(),
                    path: path.clone(),
                    relative_path: relative_path.clone(),
                    children,
                })
            }
            WorkspaceTreeNode::File { hidden_from_ai: true, .. } => None,
            WorkspaceTreeNode::File {
                name,
                path,
                relative_path,
                extension,
                archived,
                locked,
                hidden_from_ai,
            } => Some(WorkspaceTreeNode::File {
                name: name.clone(),
                path: path.clone(),
                relative_path: relative_path.clone(),
                extension: extension.clone(),
                archived: *archived,
                locked: *locked,
                hidden_from_ai: *hidden_from_ai,
            }),
        })
        .collect()
}

fn file_hidden_from_ai(file: &FlatWorkspaceFile) -> bool {
    file.hidden_from_ai
}

fn file_locked(file: &FlatWorkspaceFile) -> bool {
    file.locked
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
    locked: bool,
    hidden_from_ai: bool,
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
                locked,
                hidden_from_ai,
                ..
            } => files.push(FlatWorkspaceFile {
                path: path.clone(),
                relative_path: relative_path.clone(),
                extension: extension.clone(),
                locked: *locked,
                hidden_from_ai: *hidden_from_ai,
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
