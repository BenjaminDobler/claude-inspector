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
pub fn focus_session(pid: u32, cwd: Option<String>) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("ps")
        .args(["-o", "ppid=", "-p", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to get parent PID: {}", e))?;

    let ppid_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let ppid: u32 = ppid_str.parse().unwrap_or(0);

    let mut current_pid = ppid;
    let mut app_name = String::new();
    let mut is_ide = false;

    for _ in 0..10 {
        let name_output = Command::new("ps")
            .args(["-o", "comm=", "-p", &current_pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;

        let name = String::from_utf8_lossy(&name_output.stdout).trim().to_string();

        let known_apps: &[(&str, &str, bool)] = &[
            ("Terminal", "Terminal", false),
            ("iTerm", "iTerm2", false),
            ("Warp", "Warp", false),
            ("Alacritty", "Alacritty", false),
            ("kitty", "kitty", false),
            ("Hyper", "Hyper", false),
            ("WezTerm", "WezTerm", false),
            ("Code Helper", "Visual Studio Code", true),
            ("Code", "Visual Studio Code", true),
            ("Cursor Helper", "Cursor", true),
            ("Cursor", "Cursor", true),
            ("Windsurf", "Windsurf", true),
            ("Zed", "Zed", true),
        ];

        let matched = known_apps.iter().find(|(pattern, _, _)| name.contains(pattern));
        if let Some((_, display_name, ide)) = matched {
            app_name = display_name.to_string();
            is_ide = *ide;
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

    // For IDEs with multiple windows, find the window matching the cwd
    if is_ide {
        if let Some(ref cwd) = cwd {
            // Extract project folder name from cwd for matching
            let project_name = std::path::Path::new(cwd)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let process_name = if app_name == "Visual Studio Code" { "Code" } else { &app_name };

            // Use System Events to find and raise the correct window
            let script = format!(
                r#"
                tell application "System Events"
                    tell process "{process_name}"
                        set windowList to name of every window
                        repeat with i from 1 to count of windowList
                            if item i of windowList contains "{project_name}" then
                                perform action "AXRaise" of window i
                                set frontmost to true
                                return "Focused window: " & item i of windowList
                            end if
                        end repeat
                    end tell
                end tell
                tell application "{app_name}" to activate
                "#,
                process_name = process_name,
                project_name = project_name,
                app_name = app_name
            );

            Command::new("osascript")
                .args(["-e", &script])
                .output()
                .map_err(|e| format!("Failed to focus {}: {}", app_name, e))?;

            return Ok(format!("Focused {} window for {}", app_name, project_name));
        }
    }

    // Simple activate for standalone terminals
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
pub fn focus_session(_pid: u32, _cwd: Option<String>) -> Result<String, String> {
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
