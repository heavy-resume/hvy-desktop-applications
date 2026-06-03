pub fn run() {
    set_native_process_name();

    let app = tauri::Builder::default()
        .manage(mcp::McpRuntime::default())
        .manage(NativeMenuState::default())
        .manage(LaunchDocumentState {
            pending_paths: Mutex::new(launch_document_paths_from_args()),
            renderer_accepts_open_document_paths: AtomicBool::new(false),
        })
        .setup(|app| {
            set_native_process_name();
            install_camera_permission_handler(app.handle());
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-event", event.id().as_ref().to_string());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_recent_state,
            load_ai_settings,
            save_ai_settings,
            mcp::load_mcp_settings,
            mcp::save_mcp_settings,
            mcp::load_mcp_server_status,
            mcp::load_mcp_stdio_launch_config,
            mcp::load_mcp_client_install_status,
            load_archived_workspaces,
            mcp::install_mcp_client,
            mcp::remove_mcp_client,
            mcp::restore_mcp_client_backup,
            mcp::start_mcp_server,
            mcp::stop_mcp_server,
            mcp::update_mcp_workspaces,
            load_default_guide,
            load_hvy_guide,
            open_workspace_dialog,
            choose_workspace_folder,
            create_workspace,
            new_workspace_dialog,
            initialize_workspace_path,
            load_workspace,
            rename_workspace,
            archive_workspace,
            unarchive_workspace,
            add_files_to_workspace,
            add_dropped_files_to_workspace,
            open_file_dialog,
            open_import_source_dialog,
            load_launch_document_paths,
            read_document_file,
            save_document_file,
            save_document_as_dialog,
            save_pdf_as_dialog,
            list_saved_templates,
            save_document_template,
            update_workspace_template_visibility,
            update_workspace_file_ai_access,
            open_color_theme_dialog,
            save_color_theme_as_dialog,
            update_file_menu_state,
            create_document_file,
            reveal_document_file,
            open_document_file,
            rename_document_file,
            archive_document_file,
            restore_document_file,
            delete_document_file,
            save_document_to_workspace,
            copy_document_to_workspace,
            move_document_to_workspace,
            write_system_file_clipboard,
            paste_system_files_to_workspace,
            create_document_backup,
            list_document_backups,
            restore_document_backup,
            discard_document_backup,
            clear_document_recovery_drafts,
            open_external_url,
            close_app_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building HVY Galaxy");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    enqueue_open_document_path(app, &path);
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
        let _ = event;
    });
}

#[cfg(target_os = "macos")]
fn set_native_process_name() {
    use objc2_foundation::{NSProcessInfo, NSString};
    use std::ffi::CStr;

    let app_name = CStr::from_bytes_with_nul(b"HVY Galaxy\0").expect("static app name is nul-terminated");
    unsafe {
        libc::setprogname(app_name.as_ptr());
    }
    let process_name = NSString::from_str("HVY Galaxy");
    NSProcessInfo::processInfo().setProcessName(&process_name);
}

#[cfg(not(target_os = "macos"))]
fn set_native_process_name() {}

#[cfg(target_os = "windows")]
fn install_camera_permission_handler(app: &AppHandle) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND,
            COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
        PermissionRequestedEventHandler,
    };

    let Some(webview) = app.get_webview_window("main") else {
        return;
    };
    let _ = webview.with_webview(|webview| unsafe {
        let Ok(core_webview) = webview.controller().CoreWebView2() else {
            return;
        };
        let mut token = 0;
        let _ = core_webview.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

#[cfg(not(target_os = "windows"))]
fn install_camera_permission_handler(_app: &AppHandle) {}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let recent = recent_state_path(app)
        .ok()
        .and_then(|path| read_recent_state(&path).ok())
        .unwrap_or_default();
    let recent_files = build_recent_files_menu(app, &recent)?;
    let recent_workspaces = build_recent_workspaces_menu(app, &recent)?;
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "HVY Galaxy")
        .item(&MenuItemBuilder::new("About HVY Galaxy").id("about").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Services"))?)
        .separator()
        .item(&app_shortcut_menu_item(app, "Quit HVY Galaxy", "app-close-requested", "CmdOrCtrl+Q")?)
        .build()?;

    let file_builder = SubmenuBuilder::with_id(app, "file-menu", "File")
        .item(&app_shortcut_menu_item(app, "New Workspace", "new-workspace", "CmdOrCtrl+N")?)
        .item(&app_shortcut_menu_item(app, "Open Workspace", "open-workspace", "CmdOrCtrl+O")?)
        .item(&MenuItemBuilder::new("Manage Workspaces...").id("manage-workspaces").build(app)?)
        .item(&app_shortcut_menu_item(app, "Open File", "open-file", "CmdOrCtrl+Shift+O")?)
        .item(&recent_workspaces)
        .item(&recent_files)
        .separator();
    let file_builder = file_builder
        .item(&disabled_app_shortcut_menu_item(app, "Close Document", "close-document", "CmdOrCtrl+W")?)
        .item(&disabled_app_shortcut_menu_item(app, "Save", "save", "CmdOrCtrl+S")?)
        .item(&disabled_app_shortcut_menu_item(app, "Save As...", "save-as", "CmdOrCtrl+Shift+S")?)
        .item(&MenuItemBuilder::new("Save to Workspace...").id("save-to-workspace").enabled(false).build(app)?)
        .item(&MenuItemBuilder::new("Export PDF...").id("export-pdf").enabled(false).build(app)?)
        .item(&MenuItemBuilder::new("Import Into Current...").id("import-current").enabled(false).build(app)?)
        .separator()
        .item(&MenuItemBuilder::new("Recover Unsaved Edits...").id("recover-backup").build(app)?);
    #[cfg(not(target_os = "macos"))]
    let file_builder = file_builder
        .separator()
        .item(&app_shortcut_menu_item(app, "Quit HVY Galaxy", "app-close-requested", "CmdOrCtrl+Q")?);
    let file = file_builder.build()?;
    let ai = SubmenuBuilder::with_id(app, "ai-menu", "AI")
        .item(&app_shortcut_menu_item(app, "LLM Settings...", "ai-settings", "CmdOrCtrl+,")?)
        .item(&MenuItemBuilder::new("MCP Settings...").id("mcp-settings").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::with_id(app, "edit-menu", "Edit")
        .item(&app_shortcut_menu_item(app, "Undo", "undo", "CmdOrCtrl+Z")?)
        .item(&app_shortcut_menu_item(
            app,
            "Redo",
            "redo",
            redo_accelerator(),
        )?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .separator()
        .item(&app_shortcut_menu_item(app, "Bold", "bold", "CmdOrCtrl+B")?)
        .item(&app_shortcut_menu_item(app, "Italic", "italic", "CmdOrCtrl+I")?)
        .item(&app_shortcut_menu_item(app, "Underline", "underline", "CmdOrCtrl+U")?)
        .item(&app_shortcut_menu_item(app, "Strikethrough", "strikethrough", "CmdOrCtrl+Shift+X")?)
        .separator()
        .item(&app_shortcut_menu_item(app, "Find", "find", "CmdOrCtrl+F")?)
        .separator()
        .item(&MenuItemBuilder::new("Colors").id("colors").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .build()?;
    let help_builder = SubmenuBuilder::with_id(app, "help-menu", "Help")
        .item(
            &MenuItemBuilder::new("HVY Galaxy Guide")
                .id("open-guide")
                .accelerator("F1")
                .build(app)?,
        )
        .item(&MenuItemBuilder::new("HVY Guide").id("open-hvy-guide").build(app)?);
    #[cfg(not(target_os = "macos"))]
    let help_builder = help_builder
        .separator()
        .item(&MenuItemBuilder::new("About HVY Galaxy").id("about").build(app)?);
    let help = help_builder.build()?;

    let builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let builder = builder.item(&app_menu);
    builder.item(&file).item(&edit).item(&ai).item(&help).build()
}

fn app_shortcut_menu_item(
    app: &AppHandle,
    label: &str,
    id: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::new(label).id(id);
    #[cfg(target_os = "macos")]
    let builder = builder.accelerator(accelerator);
    #[cfg(not(target_os = "macos"))]
    let _ = accelerator;
    builder.build(app)
}

fn disabled_app_shortcut_menu_item(
    app: &AppHandle,
    label: &str,
    id: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::new(label).id(id).enabled(false);
    #[cfg(target_os = "macos")]
    let builder = builder.accelerator(accelerator);
    #[cfg(not(target_os = "macos"))]
    let _ = accelerator;
    builder.build(app)
}

fn redo_accelerator() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "CmdOrCtrl+Shift+Z"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "CmdOrCtrl+Y"
    }
}

fn build_recent_files_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::with_id(app, "recent-files", "Recent Files");
    if recent.files.is_empty() {
        builder = builder.item(&MenuItemBuilder::new("No Recent Files").id("recent-files-empty").build(app)?);
    } else {
        for path in &recent.files {
            builder = builder.item(
                &MenuItemBuilder::new(menu_label(path))
                    .id(format!("recent-file:{path}"))
                    .build(app)?,
            );
        }
    }
    builder.build()
}

fn build_recent_workspaces_menu(
    app: &AppHandle,
    recent: &RecentState,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let mut builder = SubmenuBuilder::with_id(app, "recent-workspaces", "Recent Workspaces");
    if recent.workspaces.is_empty() {
        builder = builder.item(&MenuItemBuilder::new("No Recent Workspaces").id("recent-workspaces-empty").build(app)?);
    } else {
        for path in &recent.workspaces {
            builder = builder.item(
                &MenuItemBuilder::new(menu_label(path))
                    .id(format!("recent-workspace:{path}"))
                    .build(app)?,
            );
        }
    }
    builder.build()
}
