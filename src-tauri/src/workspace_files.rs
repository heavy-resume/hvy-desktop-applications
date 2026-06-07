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
            locked_files: Vec::new(),
            hidden_from_ai_files: Vec::new(),
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
        files: scan_workspace_files(path, &manifest, include_templates)?,
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

fn update_workspace_file_ai_access_at(
    workspace_path: &Path,
    document_path: &Path,
    updates: WorkspaceFileAiAccessUpdate,
) -> AppResult<()> {
    let manifest_path = workspace_manifest_path(workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    let relative = relative_path(workspace_path, document_path);
    if let Some(locked) = updates.locked {
        update_manifest_file_set(&mut manifest.locked_files, &relative, locked);
    }
    if let Some(hidden_from_ai) = updates.hidden_from_ai {
        update_manifest_file_set(&mut manifest.hidden_from_ai_files, &relative, hidden_from_ai);
    }
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn rename_workspace_file_manifest_entries(
    workspace_path: &Path,
    previous_path: &Path,
    next_path: &Path,
) -> AppResult<()> {
    let Some(manifest_path) = workspace_manifest_path(workspace_path) else {
        return Ok(());
    };
    let mut manifest = read_manifest(&manifest_path)?;
    let previous = relative_path(workspace_path, previous_path);
    let next = relative_path(workspace_path, next_path);
    rename_manifest_file_set_entry(&mut manifest.archived_files, &previous, &next);
    rename_manifest_file_set_entry(&mut manifest.locked_files, &previous, &next);
    rename_manifest_file_set_entry(&mut manifest.hidden_from_ai_files, &previous, &next);
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn rename_manifest_file_set_entry(files: &mut Vec<String>, previous: &str, next: &str) {
    if !files.iter().any(|path| path == previous) {
        return;
    }
    files.retain(|path| path != previous && path != next);
    files.push(next.to_string());
    files.sort();
    files.dedup();
}

fn update_manifest_file_set(files: &mut Vec<String>, relative_path: &str, enabled: bool) {
    files.retain(|path| path != relative_path);
    if enabled {
        files.push(relative_path.to_string());
        files.sort();
        files.dedup();
    }
}

fn workspace_manifest_path(path: &Path) -> Option<PathBuf> {
    let current = path.join(WORKSPACE_MANIFEST);
    if current.exists() {
        return Some(current);
    }
    let legacy = path.join(LEGACY_WORKSPACE_MANIFEST);
    legacy.exists().then_some(legacy)
}

fn scan_workspace_files(root: &Path, manifest: &WorkspaceManifest, include_templates: bool) -> AppResult<Vec<WorkspaceTreeNode>> {
    scan_directory(root, root, manifest, include_templates)
}

fn scan_directory(root: &Path, directory: &Path, manifest: &WorkspaceManifest, include_templates: bool) -> AppResult<Vec<WorkspaceTreeNode>> {
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
            let children = scan_directory(root, &path, manifest, include_templates)?;
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
                archived: manifest.archived_files.iter().any(|archived| archived == &relative_path),
                locked: manifest.locked_files.iter().any(|locked| locked == &relative_path),
                hidden_from_ai: manifest.hidden_from_ai_files.iter().any(|hidden| hidden == &relative_path),
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

fn launch_document_paths_from_args() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter_map(|arg| launch_document_path(&arg))
        .collect()
}

fn launch_document_path(value: &str) -> Option<String> {
    if value.is_empty() || value.starts_with('-') {
        return None;
    }
    let path = PathBuf::from(value);
    if document_extension(&path).is_none() || !path.exists() {
        return None;
    }
    Some(path_to_string(&path))
}

fn enqueue_open_document_path(app: &AppHandle, path: &Path) {
    let Some(path) = launch_document_path(&path_to_string(path)) else {
        return;
    };
    if let Some(state) = app.try_state::<LaunchDocumentState>() {
        if !state.renderer_accepts_open_document_paths.load(Ordering::SeqCst) {
            state.pending_paths.lock().unwrap().push(path);
            return;
        }
    }
    let _ = app.emit("open-document-path", path);
}

fn import_source_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "hvy" => Some(".hvy".into()),
        "thvy" => Some(".thvy".into()),
        "phvy" => Some(".phvy".into()),
        "txt" => Some(".txt".into()),
        "md" => Some(".md".into()),
        "pdf" => Some(".pdf".into()),
        "docx" => Some(".docx".into()),
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
    let metadata = read_document_metadata_at(path)?;
    Ok(DocumentFile {
        path: metadata.path,
        name: metadata.name,
        extension: metadata.extension,
        bytes: fs::read(path)?,
        locked: metadata.locked,
        hidden_from_ai: metadata.hidden_from_ai,
        recovery_state: metadata.recovery_state,
    })
}

fn read_document_metadata_at(path: &Path) -> AppResult<DocumentFileMetadata> {
    let extension = document_extension(path)
        .ok_or_else(|| AppError::Message("Only .hvy, .thvy, .phvy, and .md documents are supported.".into()))?;
    let (locked, hidden_from_ai) = document_file_ai_access(path);
    Ok(DocumentFileMetadata {
        path: path_to_string(path),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled")
            .to_string(),
        extension,
        locked,
        hidden_from_ai,
        recovery_state: None,
    })
}

fn document_file_ai_access(path: &Path) -> (bool, bool) {
    let Some(parent) = path.parent() else {
        return (false, false);
    };
    let Some(workspace_path) = workspace_root_for_document(parent) else {
        return (false, false);
    };
    let Some(manifest_path) = workspace_manifest_path(&workspace_path) else {
        return (false, false);
    };
    let Ok(manifest) = read_manifest(&manifest_path) else {
        return (false, false);
    };
    let relative = relative_path(&workspace_path, path);
    (
        manifest.locked_files.iter().any(|locked| locked == &relative),
        manifest.hidden_from_ai_files.iter().any(|hidden| hidden == &relative),
    )
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
    add_archived_workspace_at_path(&archived_workspaces_path(app)?, workspace)
}

fn add_archived_workspace_at_path(archive_path: &Path, workspace: ArchivedWorkspace) -> AppResult<()> {
    let mut archived = read_archived_workspaces(archive_path)?;
    archived.retain(|entry| entry.path != workspace.path);
    archived.insert(0, workspace);
    write_json_atomically(archive_path, &archived)
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
    state.document_modes.remove(&normalized);
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
