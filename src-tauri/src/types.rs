#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceManifest {
    schema_version: u8,
    name: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    root_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expanded_paths: Vec<String>,
    #[serde(default)]
    template_visibility: WorkspaceTemplateVisibility,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    archived_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    locked_files: Vec<String>,
    #[serde(default, rename = "hiddenFromAI", skip_serializing_if = "is_false")]
    hidden_from_ai: bool,
    #[serde(default, rename = "hiddenFromAIFolders", skip_serializing_if = "Vec::is_empty")]
    hidden_from_ai_folders: Vec<String>,
    #[serde(default, rename = "hiddenFromAIFiles", skip_serializing_if = "Vec::is_empty")]
    hidden_from_ai_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTemplateVisibility {
    #[serde(default = "default_true")]
    hvy_documents: bool,
    #[serde(default = "default_true")]
    thvy_templates: bool,
    #[serde(default = "default_true")]
    phvy_templates: bool,
    #[serde(default)]
    archived_files: bool,
}

impl Default for WorkspaceTemplateVisibility {
    fn default() -> Self {
        Self {
            hvy_documents: true,
            thvy_templates: true,
            phvy_templates: true,
            archived_files: false,
        }
    }
}

fn default_true() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    path: String,
    manifest: WorkspaceManifest,
    files: Vec<WorkspaceTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AddFilesResult {
    workspace: Workspace,
    copied_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    copied_template_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DroppedWorkspaceFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFolderRequest {
    workspace_path: String,
    #[serde(default)]
    parent_directory: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DeleteWorkspaceFolderRequest {
    workspace_path: String,
    target_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOpenCandidate {
    path: String,
    has_manifest: bool,
    default_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WorkspaceTreeNode {
    Folder {
        name: String,
        path: String,
        relative_path: String,
        #[serde(rename = "hiddenFromAI")]
        hidden_from_ai: bool,
        children: Vec<WorkspaceTreeNode>,
    },
    File {
        name: String,
        path: String,
        relative_path: String,
        extension: String,
        archived: bool,
        locked: bool,
        #[serde(rename = "hiddenFromAI")]
        hidden_from_ai: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileAiAccessUpdate {
    locked: Option<bool>,
    #[serde(rename = "hiddenFromAI")]
    hidden_from_ai: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAiAccessUpdate {
    #[serde(rename = "hiddenFromAI")]
    hidden_from_ai: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFolderAiAccessUpdate {
    #[serde(rename = "hiddenFromAI")]
    hidden_from_ai: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecentState {
    #[serde(default, alias = "galaxies")]
    workspaces: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    document_modes: HashMap<String, String>,
    #[serde(default)]
    document_color_uses: HashMap<String, bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ArchivedWorkspace {
    path: String,
    name: String,
    archived_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    path: String,
    name: String,
    extension: String,
    bytes: Vec<u8>,
    #[serde(default, skip_serializing_if = "is_false")]
    locked: bool,
    #[serde(default, rename = "hiddenFromAI", skip_serializing_if = "is_false")]
    hidden_from_ai: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentFileMetadata {
    path: String,
    name: String,
    extension: String,
    #[serde(default, skip_serializing_if = "is_false")]
    locked: bool,
    #[serde(default, rename = "hiddenFromAI", skip_serializing_if = "is_false")]
    hidden_from_ai: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ImportSourceFile {
    path: String,
    name: String,
    extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SavedTemplate {
    id: String,
    path: String,
    name: String,
    scope: String,
    extension: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SaveDocumentTemplateRequest {
    scope: String,
    workspace_path: Option<String>,
    name: String,
    extension: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentWriteResult {
    #[serde(default, rename = "debugTimings", skip_serializing_if = "Option::is_none")]
    debug_timings: Option<HashMap<String, u128>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileMenuState {
    close_document: bool,
    save: bool,
    save_as: bool,
    save_to_workspace: bool,
    export_pdf: bool,
    import_current: bool,
}

#[derive(Default)]
struct NativeMenuState {
    file_menu: Mutex<FileMenuState>,
}

#[derive(Default)]
struct LaunchDocumentState {
    pending_paths: Mutex<Vec<String>>,
    renderer_accepts_open_document_paths: AtomicBool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ThemeFile {
    path: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackupRequest {
    document_path: String,
    name: String,
    extension: String,
    bytes: Vec<u8>,
    #[serde(default)]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SystemFileClipboardRequest {
    paths: Vec<String>,
    operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentRecoveryDraftRequest {
    document_path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackup {
    id: String,
    document_path: String,
    name: String,
    extension: String,
    created_at: String,
    #[serde(default, rename = "debugTimings", skip_serializing_if = "Option::is_none")]
    debug_timings: Option<HashMap<String, u128>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentBackupSnapshot {
    id: String,
    document_path: String,
    name: String,
    extension: String,
    created_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    bytes: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bytes_path: Option<String>,
    #[serde(default)]
    recovery_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiActionConfig {
    provider_id: String,
    model: String,
    #[serde(default)]
    models_by_provider: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiActionSettings {
    chat: AiActionConfig,
    edit: AiActionConfig,
    import_planning: AiActionConfig,
    import_writing: AiActionConfig,
    import_cleanup: AiActionConfig,
    #[serde(default = "default_semantic_filter_action_config")]
    semantic_filter: AiActionConfig,
    compaction: AiActionConfig,
}

impl AiActionConfig {
    fn new(provider_id: &str, model: &str) -> Self {
        let effective_provider_id = if provider_id == "default" { "openai" } else { provider_id };
        let mut models_by_provider = std::collections::BTreeMap::new();
        models_by_provider.insert(effective_provider_id.into(), model.into());
        Self {
            provider_id: provider_id.into(),
            model: model.into(),
            models_by_provider,
        }
    }
}

impl Default for AiActionSettings {
    fn default() -> Self {
        default_ai_action_settings()
    }
}

fn default_ai_action_settings() -> AiActionSettings {
    AiActionSettings {
        chat: AiActionConfig::new("default", "gpt-5.4-nano"),
        edit: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_planning: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_writing: AiActionConfig::new("default", "gpt-5.4-mini"),
        import_cleanup: AiActionConfig::new("default", "gpt-5.4-mini"),
        semantic_filter: default_semantic_filter_action_config(),
        compaction: AiActionConfig::new("default", "gpt-5.4-nano"),
    }
}

fn same_model_ai_action_settings(provider_id: &str, model: &str) -> AiActionSettings {
    AiActionSettings {
        chat: AiActionConfig::new(provider_id, model),
        edit: AiActionConfig::new(provider_id, model),
        import_planning: AiActionConfig::new(provider_id, model),
        import_writing: AiActionConfig::new(provider_id, model),
        import_cleanup: AiActionConfig::new(provider_id, model),
        semantic_filter: AiActionConfig::new(provider_id, model),
        compaction: AiActionConfig::new(provider_id, model),
    }
}

fn default_semantic_filter_action_config() -> AiActionConfig {
    AiActionConfig::new("default", "gpt-5.4-nano")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiEmbeddingSettings {
    #[serde(default)]
    enabled: bool,
    provider_id: String,
    model: String,
    #[serde(default)]
    models_by_provider: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    dimensions: Option<u32>,
    #[serde(default = "default_embedding_batch_size")]
    batch_size: u32,
}

impl Default for AiEmbeddingSettings {
    fn default() -> Self {
        let mut models_by_provider = std::collections::BTreeMap::new();
        models_by_provider.insert("openai".into(), "text-embedding-ada-002".into());
        Self {
            enabled: false,
            provider_id: "openai".into(),
            model: "text-embedding-ada-002".into(),
            models_by_provider,
            dimensions: None,
            batch_size: default_embedding_batch_size(),
        }
    }
}

fn default_embedding_batch_size() -> u32 {
    8
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    provider: String,
    base_url: String,
    api_key: String,
}

impl Default for AiProviderConfig {
    fn default() -> Self {
        Self {
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ImageAttachmentMaxDimensions {
    #[serde(default = "default_image_attachment_max_dimension")]
    width: u32,
    #[serde(default = "default_image_attachment_max_dimension")]
    height: u32,
}

impl Default for ImageAttachmentMaxDimensions {
    fn default() -> Self {
        Self {
            width: default_image_attachment_max_dimension(),
            height: default_image_attachment_max_dimension(),
        }
    }
}

fn default_image_attachment_max_dimension() -> u32 {
    DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSION
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum HomepageSetting {
    Included { id: String },
    File { path: String },
    None,
}

impl Default for HomepageSetting {
    fn default() -> Self {
        Self::Included { id: "hvy-galaxy-guide".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    #[serde(default)]
    homepage: HomepageSetting,
    #[serde(default)]
    image_attachment_max_dimensions: ImageAttachmentMaxDimensions,
    #[serde(default)]
    power_scripting_allowed_files: Vec<String>,
    #[serde(default)]
    power_script_acceptances: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    power_script_acceptance_scripts: std::collections::BTreeMap<String, std::collections::BTreeMap<String, Vec<PowerScriptAcceptanceEntry>>>,
    #[serde(default)]
    debug_semantic_search: bool,
    #[serde(default = "default_debug_log_max_bytes")]
    debug_log_max_bytes: u64,
    #[serde(default)]
    plugin_policies: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    plugin_acceptances: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    web_capability_profile_bindings: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    web_capability_authorizations: std::collections::BTreeMap<String, std::collections::BTreeMap<String, WebCapabilityAuthorizationRecord>>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            homepage: HomepageSetting::default(),
            image_attachment_max_dimensions: ImageAttachmentMaxDimensions::default(),
            power_scripting_allowed_files: Vec::new(),
            power_script_acceptances: std::collections::BTreeMap::new(),
            power_script_acceptance_scripts: std::collections::BTreeMap::new(),
            debug_semantic_search: false,
            debug_log_max_bytes: default_debug_log_max_bytes(),
            plugin_policies: std::collections::BTreeMap::new(),
            plugin_acceptances: std::collections::BTreeMap::new(),
            web_capability_profile_bindings: std::collections::BTreeMap::new(),
            web_capability_authorizations: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebCapabilityAuthorizationRecord {
    capability_id: String,
    profile_id: String,
    capability_hash: String,
    summary: WebCapabilityApprovalSummary,
    authorized_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebCapabilityApprovalSummary {
    schema_version: u8,
    kind: String,
    name: String,
    page_url: String,
    allowed_origins: Vec<String>,
    field_labels: Vec<String>,
    commands: Vec<WebCapabilityApprovalCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct WebCapabilityApprovalCommand {
    id: String,
    name: String,
    gesture: String,
    scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PowerScriptAcceptanceEntry {
    id: String,
    hash: String,
}

fn default_debug_log_max_bytes() -> u64 {
    10 * 1024 * 1024
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AiSettings {
    active_provider_id: String,
    providers: Vec<AiProviderConfig>,
    actions: AiActionSettings,
    #[serde(default)]
    embeddings: AiEmbeddingSettings,
    #[serde(default = "default_ai_max_context_chars")]
    max_context_chars: u32,
    #[serde(default = "default_max_concurrent_semantic_filters", alias = "workspaceFilterFileConcurrency")]
    max_concurrent_semantic_filters: u32,
}

impl Default for AiSettings {
    fn default() -> Self {
        let provider = AiProviderConfig::default();
        Self {
            active_provider_id: provider.provider.clone(),
            providers: vec![provider],
            actions: AiActionSettings::default(),
            embeddings: AiEmbeddingSettings::default(),
            max_context_chars: default_ai_max_context_chars(),
            max_concurrent_semantic_filters: default_max_concurrent_semantic_filters(),
        }
    }
}

fn default_ai_max_context_chars() -> u32 {
    DEFAULT_AI_MAX_CONTEXT_CHARS
}

fn default_max_concurrent_semantic_filters() -> u32 {
    3
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum AiSettingsFile {
    Current(AiSettings),
    Preset(AiSettingsPresetFile),
    Legacy(AiSettingsLegacy),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsPresetFile {
    active_preset_id: String,
    presets: Vec<AiConnectionPresetLegacy>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectionPresetLegacy {
    id: String,
    provider: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: AiTaskModelsLegacy,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AiTaskModelsLegacy {
    chat: String,
    edit: String,
    import_planning: String,
    import_writing: String,
    import_cleanup: String,
    #[serde(default)]
    semantic_filter: String,
    compaction: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSettingsLegacy {
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
}
