use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSessionInfo {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    pub started_at: u64,
    pub project_path: String,
    pub is_running: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PollResult {
    pub new_entries: Vec<serde_json::Value>,
    pub total_lines: usize,
}

#[command]
pub fn get_active_sessions() -> Result<Vec<ActiveSessionInfo>, String> {
    let sessions_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("sessions");

    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    let mut active = Vec::new();

    let entries = fs::read_dir(&sessions_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let pid = val["pid"].as_u64().unwrap_or(0) as u32;
                let session_id = val["sessionId"].as_str().unwrap_or("").to_string();
                let cwd = val["cwd"].as_str().unwrap_or("").to_string();
                let started_at = val["startedAt"].as_u64().unwrap_or(0);

                // Check if process is running
                let is_running = unsafe { libc::kill(pid as i32, 0) } == 0;

                // Find project path by looking for matching session JSONL
                let mut project_path = String::new();
                let projects_dir = claude_dir().unwrap().join("projects");
                if projects_dir.exists() {
                    if let Ok(project_entries) = fs::read_dir(&projects_dir) {
                        for proj_entry in project_entries.flatten() {
                            let session_file = proj_entry
                                .path()
                                .join(format!("{}.jsonl", session_id));
                            if session_file.exists() {
                                project_path = proj_entry
                                    .file_name()
                                    .to_string_lossy()
                                    .to_string();
                                break;
                            }
                        }
                    }
                }

                if is_running && !session_id.is_empty() {
                    active.push(ActiveSessionInfo {
                        pid,
                        session_id,
                        cwd,
                        started_at,
                        project_path,
                        is_running,
                    });
                }
            }
        }
    }

    Ok(active)
}

#[command]
pub fn poll_session(
    project_path: String,
    session_id: String,
    last_line: usize,
) -> Result<PollResult, String> {
    let session_file = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects")
        .join(&project_path)
        .join(format!("{}.jsonl", session_id));

    if !session_file.exists() {
        return Err("Session file not found".to_string());
    }

    let file = fs::File::open(&session_file).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut new_entries = Vec::new();
    let mut total_lines = 0;

    for (idx, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| e.to_string())?;
        total_lines = idx + 1;

        if idx < last_line {
            continue;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            new_entries.push(value);
        }
    }

    Ok(PollResult {
        new_entries,
        total_lines,
    })
}
