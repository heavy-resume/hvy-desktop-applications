pub(crate) fn run_mcp_stdio_main() -> Result<(), String> {
    run_mcp_stdio(
        std::env::args().skip(1).filter(|arg| arg != "--mcp-stdio"),
        std::env::var_os("HVY_GALAXY_WORKSPACES"),
        std::env::current_dir().map_err(|error| error.to_string())?,
        std::io::stdin().lock(),
        std::io::stdout().lock(),
    )
    .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpSettings {
    #[serde(default)]
    pub(crate) start_automatically: bool,
    #[serde(default)]
    pub(crate) port: Option<u16>,
    #[serde(default = "default_mcp_write_access")]
    pub(crate) write_access: String,
    #[serde(default = "generate_mcp_bearer_token")]
    pub(crate) bearer_token: String,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            start_automatically: false,
            port: Some(DEFAULT_MCP_PORT),
            write_access: default_mcp_write_access(),
            bearer_token: generate_mcp_bearer_token(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerStatus {
    running: bool,
    url: Option<String>,
    message: String,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStdioLaunchConfig {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpClientInstallStatus {
    target: String,
    label: String,
    config_path: String,
    config_exists: bool,
    executable_exists: bool,
    installed: bool,
    backup_count: usize,
    latest_backup_path: Option<String>,
    latest_backup_label: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpWorkspaceConfig {
    #[serde(default)]
    pub(crate) workspaces: Vec<String>,
    #[serde(default = "default_mcp_write_access")]
    pub(crate) write_access: String,
}

impl Default for McpWorkspaceConfig {
    fn default() -> Self {
        Self {
            workspaces: Vec::new(),
            write_access: default_mcp_write_access(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum McpStdioFraming {
    ContentLength,
    Newline,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct McpStdioMessage {
    pub(crate) body: Vec<u8>,
    pub(crate) framing: McpStdioFraming,
}

impl Default for McpServerStatus {
    fn default() -> Self {
        Self {
            running: false,
            url: None,
            message: "MCP server is stopped.".into(),
            last_error: None,
        }
    }
}

pub(crate) struct McpRuntime {
    handle: Mutex<Option<McpServerHandle>>,
    status: Mutex<McpServerStatus>,
    workspaces: Mutex<Vec<String>>,
}

struct McpServerHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Default for McpRuntime {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            status: Mutex::new(McpServerStatus::default()),
            workspaces: Mutex::new(Vec::new()),
        }
    }
}

impl Drop for McpServerHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub(crate) fn default_mcp_write_access() -> String {
    "hvyCliEdits".into()
}

fn generate_mcp_bearer_token() -> String {
    let mut bytes = [0_u8; 32];
    fill_token_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(unix)]
fn fill_token_bytes(bytes: &mut [u8]) {
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(bytes))
        .is_ok()
    {
        return;
    }
    fill_fallback_token_bytes(bytes);
}

#[cfg(not(unix))]
fn fill_token_bytes(bytes: &mut [u8]) {
    fill_fallback_token_bytes(bytes);
}

fn fill_fallback_token_bytes(bytes: &mut [u8]) {
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0)
        ^ u64::from(std::process::id());
    for byte in bytes {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *byte = (seed & 0xff) as u8;
    }
}
