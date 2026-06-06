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
        document_modes: state
            .document_modes
            .into_iter()
            .filter(|(entry, _)| Path::new(entry).is_file())
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
    let model = action.model.trim().to_string();
    let effective_provider_id = if provider_id == "default" { active_provider_id } else { provider_id };
    let mut models_by_provider = std::collections::BTreeMap::new();
    for (provider, model) in action.models_by_provider {
        let provider = provider.trim();
        let model = model.trim();
        if !provider.is_empty() && !model.is_empty() {
            models_by_provider.insert(provider.into(), model.into());
        }
    }
    if !model.is_empty() {
        models_by_provider.insert(effective_provider_id.into(), model.clone());
    }
    AiActionConfig {
        provider_id: provider_id.into(),
        model,
        models_by_provider,
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
