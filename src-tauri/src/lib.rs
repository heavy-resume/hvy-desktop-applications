use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
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

pub fn extract_docx_text_cli(path: &str) -> Result<String, String> {
    extract_docx_text_at(Path::new(path)).map_err(|error| error.to_string())
}

pub fn extract_pdf_text_cli_path_arg(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find(|pair| pair[0] == "--extract-pdf-text")
        .map(|pair| pair[1].as_str())
}

pub fn extract_docx_text_cli_path_arg(args: &[String]) -> Option<&str> {
    args.windows(2)
        .find(|pair| pair[0] == "--extract-docx-text")
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

fn extract_docx_text_at(path: &Path) -> AppResult<String> {
    let text = extract_docx_body_text_at(path)?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Message("DocX did not contain extractable text.".into()));
    }
    Ok(trimmed)
}

fn extract_docx_body_text_at(path: &Path) -> AppResult<String> {
    let file = fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| AppError::Message(error.to_string()))?;
    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|error| AppError::Message(error.to_string()))?
        .read_to_string(&mut document_xml)?;
    extract_docx_document_xml_text(&document_xml)
}

fn extract_docx_document_xml_text(xml: &str) -> AppResult<String> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut parts = Vec::new();
    let mut buf = Vec::new();
    let mut in_table = false;
    let mut in_paragraph = false;
    let mut in_text = false;
    let mut paragraph_text = String::new();
    let mut cell_text = String::new();
    let mut row_cells: Vec<String> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"w:tbl" => in_table = true,
                b"w:tr" => row_cells.clear(),
                b"w:tc" => cell_text.clear(),
                b"w:p" => {
                    in_paragraph = true;
                    paragraph_text.clear();
                }
                b"w:t" => in_text = true,
                b"w:tab" if in_paragraph => paragraph_text.push('\t'),
                b"w:br" | b"w:cr" if in_paragraph => paragraph_text.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"w:tab" if in_paragraph => paragraph_text.push('\t'),
                b"w:br" | b"w:cr" if in_paragraph => paragraph_text.push('\n'),
                _ => {}
            },
            Ok(Event::Text(text)) => {
                if in_text && in_paragraph {
                    paragraph_text.push_str(&text.unescape().map_err(|error| AppError::Message(error.to_string()))?);
                }
            }
            Ok(Event::End(event)) => match event.name().as_ref() {
                b"w:t" => in_text = false,
                b"w:p" => {
                    let trimmed = paragraph_text.trim();
                    if !trimmed.is_empty() {
                        if in_table {
                            if !cell_text.is_empty() {
                                cell_text.push('\n');
                            }
                            cell_text.push_str(trimmed);
                        } else {
                            parts.push(trimmed.to_string());
                        }
                    }
                    paragraph_text.clear();
                    in_paragraph = false;
                }
                b"w:tc" => {
                    let trimmed = cell_text.trim();
                    if !trimmed.is_empty() {
                        row_cells.push(trimmed.to_string());
                    }
                    cell_text.clear();
                }
                b"w:tr" => {
                    if !row_cells.is_empty() {
                        parts.push(row_cells.join(" | "));
                    }
                    row_cells.clear();
                }
                b"w:tbl" => in_table = false,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(AppError::Message(error.to_string())),
            _ => {}
        }
        buf.clear();
    }

    Ok(parts.join("\n"))
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
