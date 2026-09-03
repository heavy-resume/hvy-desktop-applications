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
            hidden_from_ai: false,
            hidden_from_ai_folders: Vec::new(),
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
    let manifest = read_manifest(&manifest_path).map_err(|error| {
        AppError::Message(format!(
            "Could not read workspace manifest at {}: {error}",
            manifest_path.display()
        ))
    })?;
    let files = scan_workspace_files(path, &manifest, include_templates).map_err(|error| {
        AppError::Message(format!(
            "Could not scan workspace files under {}: {error}",
            path.display()
        ))
    })?;
    Ok(Workspace {
        path: path_to_string(path),
        files,
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

fn workspace_target_directory(workspace_path: &Path, target_directory: &str) -> AppResult<PathBuf> {
    let relative = target_directory.trim();
    let directory = if relative.is_empty() {
        workspace_path.to_path_buf()
    } else {
        let relative_path = PathBuf::from(relative);
        if relative_path.is_absolute() || relative_path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
            return Err(AppError::Message("Folder path must stay inside the workspace.".into()));
        }
        workspace_path.join(relative_path)
    };
    fs::create_dir_all(&directory)?;
    Ok(directory)
}

fn normalized_folder_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty() {
        return Err(AppError::Message("Folder name is required.".into()));
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || path.components().count() != 1
        || path.file_name().and_then(|name| name.to_str()) != Some(trimmed)
        || trimmed == "."
        || trimmed == ".."
        || trimmed.starts_with('.')
    {
        return Err(AppError::Message("Folder name is not valid.".into()));
    }
    Ok(trimmed.to_string())
}

fn create_workspace_folder_at(
    workspace_path: &Path,
    parent_directory: &str,
    name: &str,
    encrypted: Option<&EncryptedWorkspaceFolderRequest>,
) -> AppResult<()> {
    let parent = workspace_target_directory(workspace_path, parent_directory)?;
    let folder_name = normalized_folder_name(name)?;
    let encrypted_physical_name;
    let physical_name = if let Some(encrypted) = encrypted {
        if !is_encrypted_folder_id(&encrypted.folder_id) {
            return Err(AppError::Message("Encrypted folder ID is invalid.".into()));
        }
        if encrypted.manifest_bytes.is_empty() {
            return Err(AppError::Message("Encrypted folder manifest is required.".into()));
        }
        if !encrypted_folder_manifest_matches_id(&encrypted.manifest_bytes, &encrypted.folder_id) {
            return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
        }
        encrypted_physical_name = encrypted_folder_physical_name(&encrypted.folder_id);
        encrypted_physical_name.as_str()
    } else {
        folder_name.as_str()
    };
    let folder_path = parent.join(physical_name);
    if folder_path.exists() {
        return Err(AppError::Message("A folder already exists at that path.".into()));
    }
    if let Some(encrypted) = encrypted {
        let staging_path = parent.join(format!(".{}.creating", encrypted.folder_id));
        if staging_path.exists() {
            return Err(AppError::Message("Encrypted folder creation is already staged at that path.".into()));
        }
        fs::create_dir(&staging_path)?;
        let result = (|| -> AppResult<()> {
            fs::write(staging_path.join(ENCRYPTED_FOLDER_MANIFEST_FILE), &encrypted.manifest_bytes)?;
            fs::rename(&staging_path, &folder_path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging_path);
        }
        result?;
    } else {
        fs::create_dir(&folder_path)?;
    }
    touch_workspace_manifest(workspace_path)
}

fn is_encrypted_folder_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 || bytes[8] != b'-' || bytes[13] != b'-' || bytes[18] != b'-' || bytes[23] != b'-' {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit()
    }) && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
}

const ENCRYPTED_FOLDER_PHYSICAL_PREFIX: &str = "hvy-encrypted-folder-";

fn encrypted_folder_physical_name(folder_id: &str) -> String {
    format!("{ENCRYPTED_FOLDER_PHYSICAL_PREFIX}{folder_id}")
}

fn encrypted_folder_id_from_physical_name(value: &str) -> Option<&str> {
    let folder_id = value.strip_prefix(ENCRYPTED_FOLDER_PHYSICAL_PREFIX).unwrap_or(value);
    is_encrypted_folder_id(folder_id).then_some(folder_id)
}

fn encrypted_folder_child_path(parent: &Path, folder_id: &str) -> PathBuf {
    let labeled = parent.join(encrypted_folder_physical_name(folder_id));
    if labeled.exists() { labeled } else { parent.join(folder_id) }
}

fn encrypted_folder_manifest_matches_id(bytes: &[u8], folder_id: &str) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return false;
    };
    value.get("hvy_encrypted_folder").and_then(serde_json::Value::as_u64) == Some(1)
        && value.get("algorithm").and_then(serde_json::Value::as_str) == Some("AES-256-GCM")
        && value.get("folderId").and_then(serde_json::Value::as_str) == Some(folder_id)
        && value.get("keyId").and_then(serde_json::Value::as_str).is_some()
        && value.get("nonce").and_then(serde_json::Value::as_str).is_some()
        && value.get("ciphertext").and_then(serde_json::Value::as_str).is_some()
}

fn create_encrypted_folder_document_at(
    workspace_path: &Path,
    request: &CreateEncryptedFolderDocumentRequest,
) -> AppResult<PathBuf> {
    let relative = PathBuf::from(request.folder_directory.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Encrypted folder path must stay inside the workspace.".into()));
    }
    if !is_encrypted_folder_id(&request.document_id) || !matches!(request.extension.as_str(), ".hvy" | ".thvy" | ".phvy") {
        return Err(AppError::Message("Encrypted document identity is invalid.".into()));
    }
    if request.document_bytes.is_empty() {
        return Err(AppError::Message("Encrypted document bytes are required.".into()));
    }
    let folder_path = workspace_path.join(&relative);
    if !folder_path.is_dir() {
        return Err(AppError::Message("Encrypted folder was not found.".into()));
    }
    let folder_name = folder_path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let Some(folder_id) = encrypted_folder_id_from_physical_name(folder_name) else {
        return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
    };
    if !encrypted_folder_manifest_matches_id(&request.previous_manifest_bytes, folder_id)
        || !encrypted_folder_manifest_matches_id(&request.manifest_bytes, folder_id)
    {
        return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
    }
    let manifest_path = folder_path.join(ENCRYPTED_FOLDER_MANIFEST_FILE);
    if fs::read(&manifest_path)? != request.previous_manifest_bytes {
        return Err(AppError::Message("Encrypted folder changed before the document could be created. Refresh and try again.".into()));
    }
    let destination = folder_path.join(format!("{}{}", request.document_id, request.extension));
    if destination.exists() {
        return Err(AppError::Message("An encrypted document already exists with that identity.".into()));
    }
    let staging = folder_path.join(format!(".{}{}.creating", request.document_id, request.extension));
    if staging.exists() {
        return Err(AppError::Message("Encrypted document creation is already staged.".into()));
    }
    fs::write(&staging, &request.document_bytes)?;
    fs::rename(&staging, &destination)?;
    if fs::read(&manifest_path)? != request.previous_manifest_bytes {
        fs::remove_file(&destination)?;
        return Err(AppError::Message("Encrypted folder changed before the document could be created. Refresh and try again.".into()));
    }
    if let Err(error) = write_file_atomically(&manifest_path, &request.manifest_bytes) {
        fs::remove_file(&destination)?;
        return Err(error);
    }
    touch_workspace_manifest(workspace_path)?;
    Ok(destination)
}

fn create_encrypted_folder_child_at(
    workspace_path: &Path,
    request: &CreateEncryptedFolderChildRequest,
) -> AppResult<()> {
    let relative = PathBuf::from(request.folder_directory.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Encrypted folder path must stay inside the workspace.".into()));
    }
    if !is_encrypted_folder_id(&request.child_folder_id) {
        return Err(AppError::Message("Encrypted child folder identity is invalid.".into()));
    }
    let folder_path = workspace_path.join(&relative);
    if !folder_path.is_dir() {
        return Err(AppError::Message("Encrypted folder was not found.".into()));
    }
    let folder_name = folder_path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let Some(folder_id) = encrypted_folder_id_from_physical_name(folder_name) else {
        return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
    };
    if !encrypted_folder_manifest_matches_id(&request.previous_manifest_bytes, folder_id)
        || !encrypted_folder_manifest_matches_id(&request.manifest_bytes, folder_id)
        || !encrypted_folder_manifest_matches_id(&request.child_manifest_bytes, &request.child_folder_id)
    {
        return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
    }
    let parent_key_id = encrypted_folder_manifest_key_id(&request.previous_manifest_bytes);
    if parent_key_id.is_none()
        || parent_key_id != encrypted_folder_manifest_key_id(&request.manifest_bytes)
        || parent_key_id != encrypted_folder_manifest_key_id(&request.child_manifest_bytes)
    {
        return Err(AppError::Message("Encrypted child folder must use its parent folder key.".into()));
    }
    let manifest_path = folder_path.join(ENCRYPTED_FOLDER_MANIFEST_FILE);
    if fs::read(&manifest_path)? != request.previous_manifest_bytes {
        return Err(AppError::Message("Encrypted folder changed before the child folder could be created. Refresh and try again.".into()));
    }
    let destination = folder_path.join(encrypted_folder_physical_name(&request.child_folder_id));
    let staging = folder_path.join(format!(".{}.creating", request.child_folder_id));
    if destination.exists() || staging.exists() {
        return Err(AppError::Message("An encrypted child folder already exists with that identity.".into()));
    }
    fs::create_dir(&staging)?;
    let result = (|| -> AppResult<()> {
        fs::write(staging.join(ENCRYPTED_FOLDER_MANIFEST_FILE), &request.child_manifest_bytes)?;
        fs::rename(&staging, &destination)?;
        if fs::read(&manifest_path)? != request.previous_manifest_bytes {
            fs::remove_dir_all(&destination)?;
            return Err(AppError::Message("Encrypted folder changed before the child folder could be created. Refresh and try again.".into()));
        }
        if let Err(error) = write_file_atomically(&manifest_path, &request.manifest_bytes) {
            fs::remove_dir_all(&destination)?;
            return Err(error);
        }
        Ok(())
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    touch_workspace_manifest(workspace_path)
}

fn encrypted_folder_manifest_key_id(bytes: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<serde_json::Value>(bytes).ok()?;
    value.get("keyId")?.as_str().map(str::to_owned)
}

fn update_encrypted_folder_manifest_at(
    workspace_path: &Path,
    request: &UpdateEncryptedFolderManifestRequest,
) -> AppResult<()> {
    let relative = PathBuf::from(request.folder_directory.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Encrypted folder path must stay inside the workspace.".into()));
    }
    let folder_path = workspace_path.join(relative);
    let folder_name = folder_path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let folder_id = encrypted_folder_id_from_physical_name(folder_name).unwrap_or_default();
    if !folder_path.is_dir()
        || folder_id.is_empty()
        || !encrypted_folder_manifest_matches_id(&request.previous_manifest_bytes, folder_id)
        || !encrypted_folder_manifest_matches_id(&request.manifest_bytes, folder_id)
        || encrypted_folder_manifest_key_id(&request.previous_manifest_bytes) != encrypted_folder_manifest_key_id(&request.manifest_bytes)
    {
        return Err(AppError::Message("Encrypted folder manifest does not match the folder identity.".into()));
    }
    let manifest_path = folder_path.join(ENCRYPTED_FOLDER_MANIFEST_FILE);
    if fs::read(&manifest_path)? != request.previous_manifest_bytes {
        return Err(AppError::Message("Encrypted folder changed before the update could be saved. Refresh and try again.".into()));
    }
    write_file_atomically(&manifest_path, &request.manifest_bytes)?;
    touch_workspace_manifest(workspace_path)
}

fn delete_encrypted_folder_document_at(
    workspace_path: &Path,
    request: &DeleteEncryptedFolderDocumentRequest,
) -> AppResult<PathBuf> {
    let update = UpdateEncryptedFolderManifestRequest {
        workspace_path: request.workspace_path.clone(),
        folder_directory: request.folder_directory.clone(),
        previous_manifest_bytes: request.previous_manifest_bytes.clone(),
        manifest_bytes: request.manifest_bytes.clone(),
    };
    let relative = PathBuf::from(request.folder_directory.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Encrypted folder path must stay inside the workspace.".into()));
    }
    if !is_encrypted_folder_id(&request.document_id)
        || !matches!(request.extension.as_str(), ".hvy" | ".thvy" | ".phvy")
    {
        return Err(AppError::Message("Encrypted document identity is invalid.".into()));
    }
    let folder_path = workspace_path.join(&relative);
    let document_path = folder_path.join(format!("{}{}", request.document_id, request.extension));
    if !document_path.is_file() {
        return Err(AppError::Message("Encrypted document was not found.".into()));
    }
    let staging = folder_path.join(format!(".{}{}.deleting", request.document_id, request.extension));
    if staging.exists() {
        return Err(AppError::Message("Encrypted document deletion is already staged.".into()));
    }
    fs::rename(&document_path, &staging)?;
    if let Err(error) = update_encrypted_folder_manifest_at(workspace_path, &update) {
        fs::rename(&staging, &document_path)?;
        return Err(error);
    }
    fs::remove_file(&staging)?;
    Ok(document_path)
}

fn delete_encrypted_folder_child_at(
    workspace_path: &Path,
    request: &DeleteEncryptedFolderChildRequest,
) -> AppResult<()> {
    if !is_encrypted_folder_id(&request.child_folder_id) {
        return Err(AppError::Message("Encrypted child folder identity is invalid.".into()));
    }
    let relative = PathBuf::from(request.folder_directory.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::Message("Encrypted folder path must stay inside the workspace.".into()));
    }
    let parent_path = workspace_path.join(&relative);
    let child_path = encrypted_folder_child_path(&parent_path, &request.child_folder_id);
    if !child_path.is_dir() {
        return Err(AppError::Message("Encrypted child folder was not found.".into()));
    }
    let child_physical_name = child_path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let staging = parent_path.join(format!(".{child_physical_name}.deleting"));
    if staging.exists() {
        return Err(AppError::Message("Encrypted child folder deletion is already staged.".into()));
    }
    let update = UpdateEncryptedFolderManifestRequest {
        workspace_path: request.workspace_path.clone(),
        folder_directory: request.folder_directory.clone(),
        previous_manifest_bytes: request.previous_manifest_bytes.clone(),
        manifest_bytes: request.manifest_bytes.clone(),
    };
    fs::rename(&child_path, &staging)?;
    if let Err(error) = update_encrypted_folder_manifest_at(workspace_path, &update) {
        fs::rename(&staging, &child_path)?;
        return Err(error);
    }
    fs::remove_dir_all(staging)?;
    Ok(())
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

fn update_workspace_ai_access_at(
    workspace_path: &Path,
    updates: WorkspaceAiAccessUpdate,
) -> AppResult<()> {
    let manifest_path = workspace_manifest_path(workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    if let Some(hidden_from_ai) = updates.hidden_from_ai {
        manifest.hidden_from_ai = hidden_from_ai;
    }
    manifest.updated_at = Utc::now().to_rfc3339();
    write_json_atomically(&manifest_path, &manifest)
}

fn update_workspace_folder_ai_access_at(
    workspace_path: &Path,
    folder_path: &Path,
    updates: WorkspaceFolderAiAccessUpdate,
) -> AppResult<()> {
    let manifest_path = workspace_manifest_path(workspace_path)
        .ok_or_else(|| AppError::Message("Workspace manifest is missing.".into()))?;
    let mut manifest = read_manifest(&manifest_path)?;
    let relative = relative_path(workspace_path, folder_path);
    if let Some(hidden_from_ai) = updates.hidden_from_ai {
        update_manifest_file_set(&mut manifest.hidden_from_ai_folders, &relative, hidden_from_ai);
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
    rename_manifest_file_set_entry(&mut manifest.hidden_from_ai_folders, &previous, &next);
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
    scan_directory(root, root, manifest, include_templates, manifest.hidden_from_ai)
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    manifest: &WorkspaceManifest,
    include_templates: bool,
    hidden_from_ai_inherited: bool,
) -> AppResult<Vec<WorkspaceTreeNode>> {
    recover_staged_encrypted_deletions(directory)?;
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
            let relative_path = relative_path(root, &path);
            let hidden_from_ai = hidden_from_ai_inherited
                || manifest.hidden_from_ai_folders.iter().any(|hidden| hidden == &relative_path);
            let encrypted_folder_manifest_path = path.join(ENCRYPTED_FOLDER_MANIFEST_FILE);
            let encrypted_folder_manifest = if encrypted_folder_manifest_path.is_file() {
                Some(fs::read(encrypted_folder_manifest_path)?)
            } else {
                None
            };
            let children = scan_directory(root, &path, manifest, include_templates, hidden_from_ai)?;
            folders.push(WorkspaceTreeNode::Folder {
                name,
                path: path_to_string(&path),
                relative_path,
                hidden_from_ai,
                encrypted_folder_manifest,
                children,
            });
        } else if let Some(extension) = document_extension(&path) {
            let relative_path = relative_path(root, &path);
            files.push(WorkspaceTreeNode::File {
                name,
                path: path_to_string(&path),
                archived: manifest.archived_files.iter().any(|archived| archived == &relative_path),
                locked: manifest.locked_files.iter().any(|locked| locked == &relative_path),
                hidden_from_ai: hidden_from_ai_inherited
                    || manifest.hidden_from_ai_files.iter().any(|hidden| hidden == &relative_path),
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

fn recover_staged_encrypted_deletions(directory: &Path) -> AppResult<()> {
    if !directory.join(ENCRYPTED_FOLDER_MANIFEST_FILE).is_file() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(staged_name) = name.strip_prefix('.').and_then(|value| value.strip_suffix(".deleting")) else {
            continue;
        };
        let identity = staged_name.strip_suffix(".hvy")
            .or_else(|| staged_name.strip_suffix(".thvy"))
            .or_else(|| staged_name.strip_suffix(".phvy"))
            .unwrap_or(staged_name);
        if encrypted_folder_id_from_physical_name(identity).is_none() {
            continue;
        }
        let destination = directory.join(staged_name);
        if !destination.exists() {
            fs::rename(entry.path(), destination)?;
        }
    }
    Ok(())
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

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
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

struct IncomingWorkspaceFile {
    destination: PathBuf,
    relocated_archived_file: Option<WorkspaceFileRelocation>,
}

fn incoming_workspace_file(
    workspace_path: &Path,
    root: &Path,
    file_name: &std::ffi::OsStr,
) -> AppResult<IncomingWorkspaceFile> {
    let destination = root.join(file_name);
    if !destination.exists() {
        return Ok(IncomingWorkspaceFile { destination, relocated_archived_file: None });
    }
    let Some(manifest_path) = workspace_manifest_path(workspace_path) else {
        return Ok(IncomingWorkspaceFile {
            destination: unique_copy_path(root, file_name),
            relocated_archived_file: None,
        });
    };
    let manifest = read_manifest(&manifest_path)?;
    let relative = relative_path(workspace_path, &destination);
    if !manifest.archived_files.iter().any(|entry| entry == &relative) {
        return Ok(IncomingWorkspaceFile {
            destination: unique_copy_path(root, file_name),
            relocated_archived_file: None,
        });
    }
    let archived_destination = unique_copy_path(root, file_name);
    fs::rename(&destination, &archived_destination)?;
    rename_workspace_file_manifest_entries(workspace_path, &destination, &archived_destination)?;
    let archived_name = archived_destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Message("Renamed archived document has no file name.".into()))?;
    let extension = document_extension(&archived_destination)
        .ok_or_else(|| AppError::Message("Renamed archived file is not a supported document.".into()))?;
    Ok(IncomingWorkspaceFile {
        destination,
        relocated_archived_file: Some(WorkspaceFileRelocation {
            previous_path: path_to_string(&root.join(file_name)),
            path: path_to_string(&archived_destination),
            name: archived_name.to_string(),
            extension,
        }),
    })
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
        relocated_archived_files: Vec::new(),
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
        manifest.hidden_from_ai
            || manifest.hidden_from_ai_files.iter().any(|hidden| hidden == &relative)
            || manifest.hidden_from_ai_folders.iter().any(|hidden| {
                relative == *hidden || relative.starts_with(&format!("{hidden}/"))
            }),
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
    push_recent(&mut state.recent_workspaces, path);
    let normalized = path_to_string(path);
    if !state.workspaces.contains(&normalized) {
        state.workspaces.insert(0, normalized);
        state.workspaces.truncate(RECENT_LIMIT);
    }
    state.workspaces.retain(|entry| Path::new(entry).is_dir());
    state.recent_workspaces.retain(|entry| Path::new(entry).is_dir());
    write_json_atomically(&recent_path, &state)?;
    refresh_menu(app)
}

fn remove_recent_workspace(app: &AppHandle, path: &Path) -> AppResult<()> {
    let recent_path = recent_state_path(app)?;
    let mut state = read_recent_state(&recent_path)?;
    let normalized = path_to_string(path);
    state.workspaces.retain(|entry| entry != &normalized);
    state.recent_workspaces.retain(|entry| entry != &normalized);
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
    state.document_color_uses.remove(&normalized);
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
