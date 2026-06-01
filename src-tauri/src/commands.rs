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
