use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use thiserror::Error;

mod mcp;

const WORKSPACE_MANIFEST: &str = ".hvyworkspace.json";
const LEGACY_WORKSPACE_MANIFEST: &str = ".hvygalaxy.json";
const RECENT_STATE: &str = "recent.json";
const ARCHIVED_WORKSPACES: &str = "archived-workspaces.json";
const AI_SETTINGS: &str = "ai-settings.json";
const MCP_SETTINGS: &str = "mcp-settings.json";
const MCP_STDIO_WORKSPACE_CONFIG: &str = "hvy-galaxy-mcp-workspaces.json";
const DEFAULT_MCP_PORT: u16 = 8794;
const RECENT_LIMIT: usize = 12;
const DEFAULT_AI_MAX_CONTEXT_CHARS: u32 = 40_000;
const AI_MIN_CONTEXT_CHARS: u32 = 1_000;
const AI_MAX_CONTEXT_CHARS: u32 = 750_000;
const AI_CONTEXT_STEP_CHARS: u32 = 1_000;
const BACKUP_RETENTION_HOURS: i64 = 24 * 7;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type AppResult<T> = Result<T, AppError>;

pub fn run_mcp_stdio_main() -> Result<(), String> {
    mcp::run_mcp_stdio_main()
}

pub fn extract_pdf_text_cli(path: &str) -> Result<String, String> {
    extract_pdf_text_at(Path::new(path)).map_err(|error| error.to_string())
}

pub fn extract_pdf_text_cli_path_arg(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find(|pair| pair[0] == "--extract-pdf-text")
        .map(|pair| pair[1].as_str())
}

fn extract_pdf_text_at(path: &Path) -> AppResult<String> {
    let text = pdf_extract::extract_text(path).map_err(|error| AppError::Message(error.to_string()))?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Message("PDF did not contain selectable text.".into()));
    }
    Ok(trimmed)
}

include!("types.rs");
include!("commands.rs");
include!("app_runtime.rs");
include!("workspace_files.rs");
include!("state_settings.rs");
include!("utils.rs");

#[cfg(test)]
mod tests {
    include!("tests.rs");
}
