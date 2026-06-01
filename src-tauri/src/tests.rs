    use super::mcp::*;
    use super::*;
    use tempfile::tempdir;
    use zip::write::FileOptions;

    #[test]
    fn initializes_and_loads_workspace_manifest() {
        let dir = tempdir().unwrap();
        let workspace = initialize_workspace(dir.path()).unwrap();

        assert_eq!(workspace.manifest.schema_version, 1);
        assert!(workspace.manifest.template_visibility.hvy_documents);
        assert!(workspace.manifest.template_visibility.thvy_templates);
        assert!(workspace.manifest.template_visibility.phvy_templates);
        assert!(dir.path().join(WORKSPACE_MANIFEST).exists());

        let loaded = load_workspace_from_path(dir.path()).unwrap();
        assert_eq!(loaded.manifest.name, workspace.manifest.name);
    }

    #[test]
    fn workspace_file_ai_access_persists_after_reload() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("private.hvy");
        fs::write(&path, "private notes").unwrap();
        initialize_workspace(dir.path()).unwrap();

        update_workspace_file_ai_access_at(
            dir.path(),
            &path,
            WorkspaceFileAiAccessUpdate {
                locked: None,
                hidden_from_ai: Some(true),
            },
        )
        .unwrap();

        let loaded = load_workspace_from_path(dir.path()).unwrap();
        assert_eq!(loaded.manifest.hidden_from_ai_files, vec!["private.hvy"]);
        let file = loaded.files.iter().find_map(|node| match node {
            WorkspaceTreeNode::File { name, hidden_from_ai, .. } if name == "private.hvy" => {
                Some(hidden_from_ai)
            }
            _ => None,
        });
        assert_eq!(file, Some(&true));
    }

    #[test]
    fn update_workspace_file_ai_access_command_persists_hidden_files() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("private.hvy");
        fs::write(&path, "private notes").unwrap();
        initialize_workspace(dir.path()).unwrap();

        let workspace = update_workspace_file_ai_access(
            path_to_string(&path),
            WorkspaceFileAiAccessUpdate {
                locked: None,
                hidden_from_ai: Some(true),
            },
        )
        .unwrap();

        assert_eq!(workspace.manifest.hidden_from_ai_files, vec!["private.hvy"]);
        let loaded = load_workspace_from_path(dir.path()).unwrap();
        assert_eq!(loaded.manifest.hidden_from_ai_files, vec!["private.hvy"]);
        let document = read_document_at(&path).unwrap();
        assert!(document.hidden_from_ai);
    }

    #[test]
    fn workspace_file_ai_access_update_deserializes_renderer_hidden_field() {
        let update: WorkspaceFileAiAccessUpdate = serde_json::from_value(serde_json::json!({
            "hiddenFromAI": true
        }))
        .unwrap();

        assert_eq!(update.hidden_from_ai, Some(true));
    }

    #[test]
    fn import_source_extension_accepts_pdf() {
        assert_eq!(import_source_extension(Path::new("source.pdf")), Some(".pdf".into()));
    }

    #[test]
    fn import_source_extension_accepts_docx() {
        assert_eq!(import_source_extension(Path::new("source.docx")), Some(".docx".into()));
    }

    #[test]
    fn extract_pdf_text_cli_path_arg_reads_following_path() {
        let args = vec![
            "hvy-galaxy".to_string(),
            "--extract-pdf-text".to_string(),
            "/tmp/source.pdf".to_string(),
        ];

        assert_eq!(extract_pdf_text_cli_path_arg(&args), Some("/tmp/source.pdf"));
    }

    #[test]
    fn extract_docx_text_cli_path_arg_reads_following_path() {
        let args = vec![
            "hvy-galaxy".to_string(),
            "--extract-docx-text".to_string(),
            "/tmp/source.docx".to_string(),
        ];

        assert_eq!(extract_docx_text_cli_path_arg(&args), Some("/tmp/source.docx"));
    }

    #[test]
    fn extracts_docx_paragraph_text() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("source.docx");
        write_docx(&path, r#"
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>
                <w:p><w:r><w:t>Beta paragraph</w:t></w:r></w:p>
              </w:body>
            </w:document>
        "#);

        let text = extract_docx_text_at(&path).unwrap();

        assert!(text.contains("Alpha paragraph"));
        assert!(text.contains("Beta paragraph"));
    }

    #[test]
    fn extracts_docx_table_text() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("source.docx");
        write_docx(&path, r#"
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:tbl>
                  <w:tr>
                    <w:tc><w:p><w:r><w:t>Left cell</w:t></w:r></w:p></w:tc>
                    <w:tc><w:p><w:r><w:t>Right cell</w:t></w:r></w:p></w:tc>
                  </w:tr>
                </w:tbl>
              </w:body>
            </w:document>
        "#);

        let text = extract_docx_text_at(&path).unwrap();

        assert!(text.contains("Left cell"));
        assert!(text.contains("Right cell"));
    }

    #[test]
    fn extracts_docx_preserved_run_boundary_spaces() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("source.docx");
        write_docx(&path, r#"
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p>
                  <w:r><w:t>July</w:t></w:r>
                  <w:r><w:t xml:space="preserve"> 2014</w:t></w:r>
                  <w:r><w:t>–March</w:t></w:r>
                  <w:r><w:t xml:space="preserve"> 2015</w:t></w:r>
                </w:p>
                <w:p>
                  <w:r><w:t>Developed</w:t></w:r>
                  <w:r><w:t xml:space="preserve"> REST API for </w:t></w:r>
                  <w:r><w:t>whitelisting</w:t></w:r>
                  <w:r><w:t xml:space="preserve"> devices</w:t></w:r>
                </w:p>
              </w:body>
            </w:document>
        "#);

        let text = extract_docx_text_at(&path).unwrap();

        assert!(text.contains("July 2014–March 2015"));
        assert!(text.contains("Developed REST API for whitelisting devices"));
        assert!(!text.contains("July2014"));
        assert!(!text.contains("DevelopedREST"));
    }

    fn write_docx(path: &Path, document_xml: &str) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("[Content_Types].xml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#).unwrap();
        zip.start_file("_rels/.rels", options).unwrap();
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#).unwrap();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(document_xml.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn initializes_workspace_with_user_facing_name() {
        let dir = tempdir().unwrap();
        let workspace = initialize_workspace_with_name(dir.path(), Some("Nebula Drafts")).unwrap();

        assert_eq!(workspace.manifest.name, "Nebula Drafts");
        assert_eq!(
            load_workspace_from_path(dir.path()).unwrap().manifest.name,
            "Nebula Drafts"
        );
    }

    #[test]
    fn loads_legacy_workspace_manifest() {
        let dir = tempdir().unwrap();
        let now = Utc::now().to_rfc3339();
        let manifest = WorkspaceManifest {
            schema_version: 1,
            name: "Legacy Drafts".into(),
            created_at: now.clone(),
            updated_at: now,
            root_files: Vec::new(),
            expanded_paths: Vec::new(),
            template_visibility: WorkspaceTemplateVisibility::default(),
            archived_files: Vec::new(),
            locked_files: Vec::new(),
            hidden_from_ai_files: Vec::new(),
        };
        write_json_atomically(&dir.path().join(LEGACY_WORKSPACE_MANIFEST), &manifest).unwrap();

        let workspace = load_workspace_from_path(dir.path()).unwrap();

        assert_eq!(workspace.manifest.name, "Legacy Drafts");
    }

    #[test]
    fn workspace_folder_name_is_filesystem_safe() {
        assert_eq!(workspace_folder_name("Nebula Drafts"), "nebula-drafts");
        assert_eq!(workspace_folder_name("  alpha/beta:  "), "alpha-beta");
        assert_eq!(workspace_folder_name("***"), "workspace");
    }

    #[test]
    fn scans_hvy_tree_and_ignores_noise() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("a.hvy"), "a").unwrap();
        fs::write(dir.path().join("notes").join("b.thvy"), "b").unwrap();
        fs::write(dir.path().join(".git").join("hidden.hvy"), "hidden").unwrap();
        fs::write(dir.path().join("skip.txt"), "skip").unwrap();

        let manifest = WorkspaceManifest {
            schema_version: 1,
            name: "Test".into(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            root_files: Vec::new(),
            expanded_paths: Vec::new(),
            template_visibility: WorkspaceTemplateVisibility::default(),
            archived_files: Vec::new(),
            locked_files: Vec::new(),
            hidden_from_ai_files: Vec::new(),
        };
        let nodes = scan_workspace_files(dir.path(), &manifest, false).unwrap();
        assert_eq!(nodes.len(), 2);
        assert!(matches!(&nodes[0], WorkspaceTreeNode::Folder { name, .. } if name == "notes"));
        assert!(matches!(&nodes[1], WorkspaceTreeNode::File { name, .. } if name == "a.hvy"));
    }

    #[test]
    fn unique_copy_path_avoids_existing_documents() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("draft.hvy"), "first").unwrap();
        fs::write(dir.path().join("draft 2.hvy"), "second").unwrap();

        assert_eq!(
            unique_copy_path(dir.path(), std::ffi::OsStr::new("draft.hvy")),
            dir.path().join("draft 3.hvy")
        );
    }

    #[test]
    fn rename_stem_strips_supported_extensions() {
        assert_eq!(normalized_rename_stem("Draft").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.hvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.thvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.phvy").unwrap(), "Draft");
        assert_eq!(normalized_rename_stem("Draft.md").unwrap(), "Draft");
    }

    #[test]
    fn rename_stem_rejects_folders_and_hidden_names() {
        assert!(normalized_rename_stem("../Draft").is_err());
        assert!(normalized_rename_stem("folder/Draft").is_err());
        assert!(normalized_rename_stem(".Draft").is_err());
        assert!(normalized_rename_stem("   ").is_err());
    }

    #[test]
    fn template_file_name_uses_requested_template_extension() {
        assert_eq!(template_file_name("Draft", ".thvy").unwrap(), "Draft.thvy");
        assert_eq!(template_file_name("Draft.hvy", ".thvy").unwrap(), "Draft.thvy");
        assert_eq!(template_file_name("Draft.thvy", ".phvy").unwrap(), "Draft.phvy");
        assert_eq!(template_file_name("Draft.md", ".phvy").unwrap(), "Draft.phvy");
    }

    #[test]
    fn saved_template_scan_includes_thvy_and_phvy_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("alpha.thvy"), "template").unwrap();
        fs::write(dir.path().join("beta.phvy"), "template").unwrap();
        fs::write(dir.path().join("regular.hvy"), "regular").unwrap();
        fs::write(dir.path().join("notes.md"), "notes").unwrap();

        let mut templates = Vec::new();
        append_saved_templates(&mut templates, dir.path(), "app").unwrap();

        templates.sort_by(|left, right| left.name.cmp(&right.name));
        assert_eq!(templates.len(), 2);
        assert_eq!(templates[0].name, "alpha.thvy");
        assert_eq!(templates[0].extension, ".thvy");
        assert_eq!(templates[1].name, "beta.phvy");
        assert_eq!(templates[1].extension, ".phvy");
        assert_eq!(templates[0].scope, "app");
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.hvy");
        write_file_atomically(&file, b"first").unwrap();
        write_file_atomically(&file, b"second").unwrap();

        assert_eq!(fs::read_to_string(file).unwrap(), "second");
    }

    #[test]
    fn recent_entries_are_deduped_and_limited() {
        let dir = tempdir().unwrap();
        let mut recent = Vec::new();

        for index in 0..14 {
            let path = dir.path().join(format!("{index}.hvy"));
            push_recent(&mut recent, &path);
        }
        push_recent(&mut recent, &dir.path().join("7.hvy"));

        assert_eq!(recent.len(), RECENT_LIMIT);
        assert_eq!(recent[0], path_to_string(&dir.path().join("7.hvy")));
    }

    #[test]
    fn normalizes_ai_settings() {
        let settings = normalize_ai_settings(AiSettings {
            active_provider_id: " local ".into(),
            providers: vec![AiProviderConfig {
                provider: " openai-compatible ".into(),
                base_url: " http://127.0.0.1:11434/v1/ ".into(),
                api_key: " local ".into(),
            }],
            actions: AiActionSettings {
                chat: AiActionConfig::new(" openai-compatible ", " llama3.2 "),
                edit: AiActionConfig::new(" missing ", " qwen "),
                import_planning: AiActionConfig::new(" openai-compatible ", " planner "),
                import_writing: AiActionConfig::new(" openai-compatible ", " writer "),
                import_cleanup: AiActionConfig::new(" openai-compatible ", " cleanup "),
                semantic_filter: AiActionConfig::new(" openai-compatible ", " semantic "),
                compaction: AiActionConfig::new(" openai-compatible ", " compact "),
            },
            max_context_chars: 0,
        })
        .unwrap();

        assert_eq!(settings.active_provider_id, "openai-compatible");
        assert_eq!(settings.providers[0].provider, "openai-compatible");
        assert_eq!(settings.providers[0].base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(settings.providers[0].api_key, "local");
        assert_eq!(settings.actions.chat.provider_id, "openai-compatible");
        assert_eq!(settings.actions.chat.model, "llama3.2");
        assert_eq!(settings.actions.edit.provider_id, "openai-compatible");
        assert_eq!(settings.actions.semantic_filter.provider_id, "openai-compatible");
        assert_eq!(settings.actions.semantic_filter.model, "semantic");
    }

    #[test]
    fn normalizes_mcp_settings() {
        let settings = normalize_mcp_settings(McpSettings {
            start_automatically: true,
            port: Some(0),
            write_access: "all".into(),
            bearer_token: "".into(),
        })
        .unwrap();

        assert!(settings.start_automatically);
        assert_eq!(settings.port, None);
        assert_eq!(settings.write_access, "hvyCliEdits");
        assert_eq!(settings.bearer_token, "");

        assert_eq!(McpSettings::default().port, Some(DEFAULT_MCP_PORT));

        let explicit = normalize_mcp_settings(McpSettings {
            start_automatically: false,
            port: Some(8794),
            write_access: "createImportSave".into(),
            bearer_token: "secret-token".into(),
        })
        .unwrap();

        assert_eq!(explicit.port, Some(8794));
        assert_eq!(explicit.write_access, "createImportSave");
        assert_eq!(explicit.bearer_token, "secret-token");
    }

    #[test]
    fn upserts_codex_mcp_block_without_touching_other_servers() {
        let launch = test_mcp_launch();
        let current = r#"model = "gpt-5"

[mcp_servers.other]
command = "other"

[mcp_servers.hvy-galaxy]
command = "old"
args = []

[profiles.work]
model = "gpt-5.4"
"#;

        let next = upsert_codex_mcp_block(current, &launch);

        assert!(next.contains("[mcp_servers.other]\ncommand = \"other\""));
        assert!(next.contains("[profiles.work]\nmodel = \"gpt-5.4\""));
        assert!(next.contains("[mcp_servers.hvy-galaxy]\ntype = \"stdio\""));
        assert!(next.contains("command = \"/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy\""));
        assert_eq!(next.matches("[mcp_servers.hvy-galaxy]").count(), 1);
        assert!(!next.contains("command = \"old\""));
    }

    #[test]
    fn upserts_claude_mcp_config_preserving_existing_servers() {
        let launch = test_mcp_launch();
        let current = r#"{
  "mcpServers": {
    "other": {
      "command": "other"
    }
  },
  "theme": "dark"
}"#;

        let next = upsert_claude_mcp_config(current, &launch).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&next).unwrap();

        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["mcpServers"]["other"]["command"], "other");
        assert_eq!(parsed["mcpServers"]["hvy-galaxy"]["type"], "stdio");
        assert_eq!(
            parsed["mcpServers"]["hvy-galaxy"]["command"],
            "/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy"
        );
        assert_eq!(parsed["mcpServers"]["hvy-galaxy"]["args"][0], "--mcp-stdio");
    }

    #[test]
    fn removes_codex_mcp_block_without_touching_other_servers() {
        let current = r#"model = "gpt-5"

[mcp_servers.other]
command = "other"

[mcp_servers.hvy-galaxy]
command = "old"
args = []

[profiles.work]
model = "gpt-5.4"
"#;

        let next = remove_codex_mcp_block(current);

        assert!(next.contains("[mcp_servers.other]\ncommand = \"other\""));
        assert!(next.contains("[profiles.work]\nmodel = \"gpt-5.4\""));
        assert!(!next.contains("[mcp_servers.hvy-galaxy]"));
        assert!(!next.contains("command = \"old\""));
    }

    #[test]
    fn removes_claude_mcp_config_preserving_existing_servers() {
        let current = r#"{
  "mcpServers": {
    "hvy-galaxy": {
      "command": "old"
    },
    "other": {
      "command": "other"
    }
  },
  "theme": "dark"
}"#;

        let next = remove_claude_mcp_config(current).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&next).unwrap();

        assert_eq!(parsed["theme"], "dark");
        assert_eq!(parsed["mcpServers"]["other"]["command"], "other");
        assert!(parsed["mcpServers"].get("hvy-galaxy").is_none());
    }

    #[test]
    fn installing_mcp_client_config_keeps_a_backup_copy() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "model = \"gpt-5\"\n").unwrap();

        install_mcp_for_codex(&path, &test_mcp_launch()).unwrap();

        let backup_paths = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("config.toml.hvy-galaxy-backup-"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();

        assert_eq!(backup_paths.len(), 1);
        assert_eq!(fs::read_to_string(&backup_paths[0]).unwrap(), "model = \"gpt-5\"\n");
        assert!(fs::read_to_string(path).unwrap().contains("[mcp_servers.hvy-galaxy]"));
    }

    #[test]
    fn restoring_mcp_client_config_uses_latest_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "current\n").unwrap();
        fs::write(
            dir.path()
                .join("config.toml.hvy-galaxy-backup-20260101T000000Z"),
            "old\n",
        )
        .unwrap();
        fs::write(
            dir.path()
                .join("config.toml.hvy-galaxy-backup-20260102T000000Z"),
            "latest\n",
        )
        .unwrap();

        restore_mcp_client_backup_file(&path).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "latest\n");
        let pre_restore_backups = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("config.toml.hvy-galaxy-backup-"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        assert_eq!(pre_restore_backups.len(), 3);
    }

    #[test]
    fn mcp_tool_list_exposes_workspace_tools() {
        let tools = mcp_tool_list();
        let tools = tools.as_array().unwrap();
        let names = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(|name| name.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "workspace.list",
                "workspace.tree",
                "workspace.search",
                "workspace.create",
                "workspace.archive",
                "document.create",
                "document.archive",
                "hvy.guidance",
                "document.cli_based_editor",
            ]
        );
        assert!(tools[2]
            .get("description")
            .and_then(|description| description.as_str())
            .unwrap()
            .contains("which HVY file contains a resume"));
        assert_eq!(
            tools[2]["inputSchema"]["required"].as_array().unwrap()[0],
            serde_json::json!("query")
        );
        assert!(tools[8]
            .get("description")
            .and_then(|description| description.as_str())
            .unwrap()
            .contains("existing HVY document"));
        assert_eq!(
            tools[8]["inputSchema"]["required"].as_array().unwrap()[0],
            serde_json::json!("path")
        );
    }

    #[test]
    fn mcp_workspace_suite_lists_trees_and_searches_files() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("people")).unwrap();
        fs::write(
            dir.path().join("people").join("james-resume.hvy"),
            "Resume\nJames Hutchison\nExperience building HVY Galaxy.",
        )
        .unwrap();
        fs::write(
            dir.path().join("notes.md"),
            "# Notes\nThis markdown file mentions HVY Galaxy but not the resume owner.",
        )
        .unwrap();
        fs::write(dir.path().join("ignore.txt"), "James Hutchison outside supported documents").unwrap();
        let workspace = initialize_workspace_with_name(dir.path(), Some("Career Documents")).unwrap();
        let workspaces = vec![workspace.clone()];

        let list = mcp_workspace_list_from(&workspaces).unwrap();
        assert_eq!(list["workspaces"][0]["name"], "Career Documents");
        assert_eq!(list["workspaces"][0]["fileCount"], 2);

        let tree = mcp_workspace_tree_from(&workspaces, serde_json::json!({})).unwrap();
        assert_eq!(tree["workspaces"][0]["path"], workspace.path);
        assert!(tree["workspaces"][0]["files"]
            .to_string()
            .contains("james-resume.hvy"));
        assert!(!tree["workspaces"][0]["files"].to_string().contains("ignore.txt"));

        let search = mcp_workspace_search_from(
            &workspaces,
            serde_json::json!({
                "query": "James Hutchison",
                "max": 10
            }),
        )
        .unwrap();
        assert_eq!(search["query"], "James Hutchison");
        assert_eq!(search["results"].as_array().unwrap().len(), 1);
        assert_eq!(search["results"][0]["relativePath"], "people/james-resume.hvy");
        assert_eq!(search["results"][0]["lineNumber"], 2);
        assert!(search["results"][0]["snippet"]
            .as_str()
            .unwrap()
            .contains("James Hutchison"));
    }

    #[test]
    fn mcp_respects_locked_and_hidden_file_access() {
        let dir = tempdir().unwrap();
        let locked_path = dir.path().join("locked.hvy");
        let hidden_path = dir.path().join("hidden.hvy");
        fs::write(&locked_path, "locked needle").unwrap();
        fs::write(&hidden_path, "hidden needle").unwrap();
        initialize_workspace_with_name(dir.path(), Some("Access")).unwrap();
        update_workspace_file_ai_access_at(
            dir.path(),
            &locked_path,
            WorkspaceFileAiAccessUpdate {
                locked: Some(true),
                hidden_from_ai: None,
            },
        )
        .unwrap();
        update_workspace_file_ai_access_at(
            dir.path(),
            &hidden_path,
            WorkspaceFileAiAccessUpdate {
                locked: None,
                hidden_from_ai: Some(true),
            },
        )
        .unwrap();
        let workspace = load_workspace_from_path(dir.path()).unwrap();
        let workspaces = vec![workspace];

        let list = mcp_workspace_list_from(&workspaces).unwrap();
        assert_eq!(list["workspaces"][0]["fileCount"], 1);
        let tree = mcp_workspace_tree_from(&workspaces, serde_json::json!({})).unwrap();
        let tree_text = tree["workspaces"][0]["files"].to_string();
        assert!(tree_text.contains("locked.hvy"));
        assert!(tree_text.contains("\"locked\":true"));
        assert!(!tree_text.contains("hidden.hvy"));

        let search = mcp_workspace_search_from(&workspaces, serde_json::json!({ "query": "needle" })).unwrap();
        assert_eq!(search["results"].as_array().unwrap().len(), 1);
        assert_eq!(search["results"][0]["relativePath"], "locked.hvy");
        assert!(mcp_document_archive_from(&workspaces, serde_json::json!({ "path": path_to_string(&locked_path) })).is_err());
    }

    #[test]
    fn mcp_cli_locked_document_allows_inspection_commands_and_blocks_mutations() {
        let dir = tempdir().unwrap();
        let locked_path = dir.path().join("locked.hvy");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("hvy-guide.hvy"),
            &locked_path,
        )
        .unwrap();
        initialize_workspace_with_name(dir.path(), Some("Locked CLI")).unwrap();
        update_workspace_file_ai_access_at(
            dir.path(),
            &locked_path,
            WorkspaceFileAiAccessUpdate {
                locked: Some(true),
                hidden_from_ai: None,
            },
        )
        .unwrap();
        let workspaces = vec![load_workspace_from_path(dir.path()).unwrap()];
        let original = fs::read_to_string(&locked_path).unwrap();

        for command in [
            "hvy request_structure --collapse",
            "hvy search hvy --max 3",
            "hvy preview /body/welcome/text-0",
            "hvy lint",
            "hvy cheatsheet common-patterns",
            "hvy recipe scripting",
            "sed -n '1,20p' /raw-preview.hvy.txt",
            "echo test",
        ] {
            let result = mcp_document_cli_from(
                &workspaces,
                serde_json::json!({
                    "path": path_to_string(&locked_path),
                    "command": command
                }),
            )
            .unwrap();
            assert_eq!(result["mutated"], serde_json::json!(false), "{command}");
        }

        let error = mcp_document_cli_from(
            &workspaces,
            serde_json::json!({
                "path": path_to_string(&locked_path),
                "command": "hvy insert 0 text /body locked-test"
            }),
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("document.cli_based_editor can only run read commands for locked files.")
        );
        assert_eq!(fs::read_to_string(&locked_path).unwrap(), original);
    }

    #[test]
    fn mcp_workspace_search_can_be_scoped_and_limited() {
        let first = tempdir().unwrap();
        let second = tempdir().unwrap();
        fs::write(first.path().join("one.hvy"), "needle in first workspace").unwrap();
        fs::write(second.path().join("two.hvy"), "needle in second workspace").unwrap();
        let first_workspace = initialize_workspace_with_name(first.path(), Some("First")).unwrap();
        let second_workspace = initialize_workspace_with_name(second.path(), Some("Second")).unwrap();
        let workspaces = vec![first_workspace.clone(), second_workspace.clone()];

        let scoped = mcp_workspace_search_from(
            &workspaces,
            serde_json::json!({
                "query": "needle",
                "workspacePath": second_workspace.path,
                "max": 1
            }),
        )
        .unwrap();

        assert_eq!(scoped["results"].as_array().unwrap().len(), 1);
        assert_eq!(scoped["results"][0]["workspaceName"], "Second");
        assert_eq!(scoped["results"][0]["relativePath"], "two.hvy");
    }

    #[test]
    fn mcp_workspace_create_and_archive_updates_config() {
        let root = tempdir().unwrap();
        let config_path = root.path().join(MCP_STDIO_WORKSPACE_CONFIG);
        let workspace_path = root.path().join("crm");

        let created = mcp_workspace_create_from(
            serde_json::json!({
                "path": path_to_string(&workspace_path),
                "name": "CRM"
            }),
            Some(&config_path),
        )
        .unwrap();

        assert_eq!(created["workspace"]["manifest"]["name"], "CRM");
        let config = read_mcp_workspace_config(&config_path).unwrap();
        assert_eq!(config.workspaces, vec![path_to_string(&workspace_path)]);

        let workspace = load_workspace_from_path(&workspace_path).unwrap();
        let archived = mcp_workspace_archive_from(
            &[workspace],
            serde_json::json!({ "workspacePath": path_to_string(&workspace_path) }),
            Some(&config_path),
            Some(&root.path().join(ARCHIVED_WORKSPACES)),
        )
        .unwrap();

        assert_eq!(archived["archived"], serde_json::json!(true));
        let config = read_mcp_workspace_config(&config_path).unwrap();
        assert!(config.workspaces.is_empty());
        let archived_workspaces = read_archived_workspaces(&root.path().join(ARCHIVED_WORKSPACES)).unwrap();
        assert_eq!(archived_workspaces.len(), 1);
        assert_eq!(archived_workspaces[0].path, path_to_string(&workspace_path));
        assert_eq!(archived_workspaces[0].name, "CRM");
        assert!(workspace_path.is_dir());
    }

    #[test]
    fn mcp_document_create_and_archive_uses_workspace_manifest() {
        let dir = tempdir().unwrap();
        let workspace = initialize_workspace_with_name(dir.path(), Some("Docs")).unwrap();
        let created = mcp_document_create_from(
            &[workspace],
            serde_json::json!({
                "workspacePath": path_to_string(dir.path()),
                "name": "CRM",
                "title": "CRM"
            }),
        )
        .unwrap();
        let path = created["document"]["path"].as_str().unwrap();

        assert!(path.ends_with("CRM.hvy"));
        assert!(fs::read_to_string(path).unwrap().contains("#! CRM"));

        let workspace = load_workspace_from_path(dir.path()).unwrap();
        let archived = mcp_document_archive_from(&[workspace], serde_json::json!({ "path": path })).unwrap();
        assert_eq!(archived["archived"], serde_json::json!(true));
        let manifest = read_manifest(&dir.path().join(WORKSPACE_MANIFEST)).unwrap();
        assert_eq!(manifest.archived_files, vec!["CRM.hvy"]);
    }

    #[test]
    fn mcp_workspace_search_rejects_empty_queries() {
        let error = mcp_workspace_search_from(&[], serde_json::json!({ "query": "   " })).unwrap_err();
        assert!(error.to_string().contains("requires a non-empty query"));
    }

    #[test]
    fn mcp_authorization_allows_blank_token_or_matching_bearer() {
        let request = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: vec![("Authorization".into(), "Bearer secret-token".into())],
            body: Vec::new(),
        };
        let missing = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: Vec::new(),
            body: Vec::new(),
        };

        assert!(mcp_request_is_authorized(&missing, ""));
        assert!(mcp_request_is_authorized(&request, "secret-token"));
        assert!(!mcp_request_is_authorized(&missing, "secret-token"));
        assert!(!mcp_request_is_authorized(&request, "other-token"));
    }

    #[test]
    fn mcp_stdio_discovers_workspaces_from_args_env_config_and_cwd() {
        let arg_workspace = tempdir().unwrap();
        let config_workspace = tempdir().unwrap();
        let explicit_config_workspace = tempdir().unwrap();
        let env_root = tempdir().unwrap();
        let env_workspace = env_root.path().join("env-workspace");
        let cwd_root = tempdir().unwrap();
        let cwd_workspace = cwd_root.path().join("cwd-workspace");
        fs::create_dir(&env_workspace).unwrap();
        fs::create_dir(&cwd_workspace).unwrap();
        initialize_workspace_with_name(arg_workspace.path(), Some("Args")).unwrap();
        initialize_workspace_with_name(config_workspace.path(), Some("Config")).unwrap();
        initialize_workspace_with_name(explicit_config_workspace.path(), Some("Explicit Config")).unwrap();
        initialize_workspace_with_name(&env_workspace, Some("Env")).unwrap();
        initialize_workspace_with_name(&cwd_workspace, Some("Cwd")).unwrap();
        let env_value = std::env::join_paths([env_root.path()]).unwrap();
        write_json_atomically(
            &cwd_root.path().join(MCP_STDIO_WORKSPACE_CONFIG),
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(config_workspace.path())],
                write_access: "searchOnly".into(),
            },
        )
        .unwrap();
        let explicit_config = cwd_root.path().join("explicit-workspaces.json");
        write_json_atomically(
            &explicit_config,
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(explicit_config_workspace.path())],
                write_access: "createImportSave".into(),
            },
        )
        .unwrap();

        let config = mcp_stdio_workspace_config(
            vec![
                "--config".to_string(),
                path_to_string(&explicit_config),
                "--workspace".to_string(),
                path_to_string(arg_workspace.path()),
                "--workspace".to_string(),
                path_to_string(arg_workspace.path()),
            ],
            Some(env_value),
            cwd_root.path().to_path_buf(),
        )
        .unwrap();
        let paths = config.workspaces.iter().map(PathBuf::from).collect::<Vec<_>>();
        let names = load_mcp_stdio_workspaces(&paths)
            .unwrap()
            .into_iter()
            .map(|workspace| workspace.manifest.name)
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["Args", "Config", "Explicit Config", "Env", "Cwd"]);
        assert_eq!(config.write_access, "createImportSave");
    }

    #[test]
    fn mcp_stdio_reads_write_access_from_workspace_config() {
        let workspace = tempdir().unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Config")).unwrap();
        let cwd = tempdir().unwrap();
        write_json_atomically(
            &cwd.path().join(MCP_STDIO_WORKSPACE_CONFIG),
            &McpWorkspaceConfig {
                workspaces: vec![path_to_string(workspace.path())],
                write_access: "searchOnly".into(),
            },
        )
        .unwrap();

        let config = mcp_stdio_workspace_config(Vec::<String>::new(), None, cwd.path().to_path_buf()).unwrap();

        assert_eq!(config.write_access, "searchOnly");
        assert_eq!(config.workspaces, vec![path_to_string(workspace.path())]);
    }

    #[test]
    fn mcp_access_levels_allow_search_tools_but_block_higher_access_tools() {
        assert!(ensure_mcp_tool_allowed("workspace.search", "searchOnly").is_ok());
        assert!(ensure_mcp_tool_allowed("hvy.guidance", "searchOnly").is_ok());
        assert!(ensure_mcp_tool_allowed("document.cli_based_editor", "searchOnly").is_err());
        assert!(ensure_mcp_tool_allowed("document.cli_based_editor", "hvyCliEdits").is_ok());
        assert!(ensure_mcp_tool_allowed("document.create", "hvyCliEdits").is_err());
        assert!(ensure_mcp_tool_allowed("document.archive", "createImportSave").is_ok());
        assert!(ensure_mcp_tool_allowed("workspace.create", "createImportSave").is_ok());
    }

    #[test]
    fn mcp_cli_package_lookup_finds_repo_from_rust_executable() {
        let repo = tempdir().unwrap();
        let package = repo
            .path()
            .join("node_modules")
            .join("heavy-file-format-ref-impl");
        let scripts = package.join("scripts");
        let executable = repo.path().join("src-tauri").join("target").join("debug").join("hvy-galaxy");
        fs::create_dir_all(&scripts).unwrap();
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(package.join("package.json"), "{}").unwrap();
        fs::write(scripts.join("hvy-mcp-cli.mjs"), "").unwrap();
        fs::write(&executable, "").unwrap();
        let cwd = tempdir().unwrap();

        assert_eq!(
            mcp_cli_package_root_from(cwd.path(), &executable),
            Some(package)
        );
    }

    #[test]
    fn mcp_stdio_serves_initialized_tool_calls() {
        let workspace = tempdir().unwrap();
        fs::write(workspace.path().join("resume.hvy"), "Resume for James Hutchison").unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Career")).unwrap();
        let requests = [
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "test", "version": "0" }
                }
            }),
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "workspace.search",
                    "arguments": {
                        "query": "James Hutchison"
                    }
                }
            }),
        ];
        let input = requests
            .iter()
            .map(mcp_test_frame)
            .collect::<Vec<_>>()
            .join("");
        let mut output = Vec::new();

        run_mcp_stdio(
            vec!["--workspace".to_string(), path_to_string(workspace.path())],
            None,
            tempdir().unwrap().path().to_path_buf(),
            input.as_bytes(),
            &mut output,
        )
        .unwrap();
        let mut reader = BufReader::new(output.as_slice());
        let initialize = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let search = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let initialize: serde_json::Value = serde_json::from_slice(&initialize.body).unwrap();
        let search: serde_json::Value = serde_json::from_slice(&search.body).unwrap();

        assert_eq!(initialize["result"]["serverInfo"]["name"], "hvy-galaxy");
        assert_eq!(
            search["result"]["structuredContent"]["results"][0]["relativePath"],
            "resume.hvy"
        );
    }

    #[test]
    fn mcp_stdio_initializes_even_when_workspace_load_fails() {
        let workspace = tempdir().unwrap();
        initialize_workspace_with_name(workspace.path(), Some("Missing")).unwrap();
        fs::remove_file(workspace.path().join(WORKSPACE_MANIFEST)).unwrap();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "claude-ai", "version": "0.1.0" }
            }
        });
        let input = mcp_test_frame(&request);
        let mut output = Vec::new();

        run_mcp_stdio(
            vec!["--workspace".to_string(), path_to_string(workspace.path())],
            None,
            workspace.path().to_path_buf(),
            input.as_bytes(),
            &mut output,
        )
        .unwrap();
        let mut reader = BufReader::new(output.as_slice());
        let initialize = read_mcp_stdio_message(&mut reader).unwrap().unwrap();
        let initialize: serde_json::Value = serde_json::from_slice(&initialize.body).unwrap();

        assert_eq!(initialize["id"], 1);
        assert_eq!(initialize["result"]["serverInfo"]["name"], "hvy-galaxy");
    }

    #[test]
    fn mcp_stdio_supports_newline_framing_from_current_spec() {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": { "name": "claude-ai", "version": "0.1.0" }
            }
        });
        let mut output = Vec::new();

        run_mcp_stdio(
            Vec::<String>::new(),
            None,
            tempdir().unwrap().path().to_path_buf(),
            format!("{request}\n").as_bytes(),
            &mut output,
        )
        .unwrap();

        let line = String::from_utf8(output).unwrap();
        let response: serde_json::Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(response["id"], 0);
        assert_eq!(response["result"]["protocolVersion"], "2025-11-25");
    }

    fn mcp_test_frame(value: &serde_json::Value) -> String {
        let body = value.to_string();
        format!("Content-Length: {}\r\n\r\n{}", body.len(), body)
    }

    fn test_mcp_launch() -> McpStdioLaunchConfig {
        McpStdioLaunchConfig {
            command: "/Applications/HVY Galaxy.app/Contents/MacOS/HVY Galaxy".into(),
            args: vec!["--mcp-stdio".into()],
            working_directory: "/Users/example/Library/Application Support/com.hvy.galaxy/mcp".into(),
        }
    }
