use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

#[cfg(unix)]
fn is_process_running(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn is_process_running(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains(&pid.to_string())
        })
        .unwrap_or(false)
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
                let is_running = is_process_running(pid);

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

#[cfg(target_os = "macos")]
#[command]
pub fn focus_session(pid: u32) -> Result<String, String> {
    use std::process::Command;

    // Find the parent terminal process (Terminal.app, iTerm2, Warp, etc.)
    // Walk up the process tree to find the terminal app
    let output = Command::new("ps")
        .args(["-o", "ppid=", "-p", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to get parent PID: {}", e))?;

    let ppid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let ppid: u32 = ppid_str.parse().unwrap_or(0);

    // Walk up to find the terminal application
    let mut current_pid = ppid;
    let mut app_name = String::new();

    for _ in 0..10 {
        // Get the process name
        let name_output = Command::new("ps")
            .args(["-o", "comm=", "-p", &current_pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;

        let name = String::from_utf8_lossy(&name_output.stdout).trim().to_string();

        if name.contains("Terminal") || name.contains("iTerm") || name.contains("Warp")
            || name.contains("Alacritty") || name.contains("kitty") || name.contains("Hyper")
            || name.contains("WezTerm")
        {
            // Extract just the app name
            app_name = if name.contains("Terminal") {
                "Terminal".to_string()
            } else if name.contains("iTerm") {
                "iTerm2".to_string()
            } else if name.contains("Warp") {
                "Warp".to_string()
            } else if name.contains("Alacritty") {
                "Alacritty".to_string()
            } else if name.contains("kitty") {
                "kitty".to_string()
            } else if name.contains("WezTerm") {
                "WezTerm".to_string()
            } else {
                name.clone()
            };
            break;
        }

        // Get parent of current
        let parent_output = Command::new("ps")
            .args(["-o", "ppid=", "-p", &current_pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;

        let next_pid: u32 = String::from_utf8_lossy(&parent_output.stdout)
            .trim()
            .parse()
            .unwrap_or(0);

        if next_pid == 0 || next_pid == 1 || next_pid == current_pid {
            break;
        }
        current_pid = next_pid;
    }

    if app_name.is_empty() {
        return Err("Could not find terminal application for this session".to_string());
    }

    // Use AppleScript to activate the terminal app
    let script = format!(
        r#"tell application "{}" to activate"#,
        app_name
    );

    Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to activate {}: {}", app_name, e))?;

    Ok(format!("Focused {}", app_name))
}

#[cfg(not(target_os = "macos"))]
#[command]
pub fn focus_session(_pid: u32) -> Result<String, String> {
    Err("Focus session is only supported on macOS".to_string())
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
