use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

// ─── Transcripts: search across all sessions ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptResult {
    pub project_path: String,
    pub session_id: String,
    pub entry_type: String,
    pub text: String,
    pub timestamp: String,
    pub model: String,
    pub tool_name: String,
}

#[command]
pub fn search_transcripts(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<TranscriptResult>, String> {
    let projects_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let query_lower = query.to_lowercase();
    let limit = limit.unwrap_or(100);
    let mut results = Vec::new();

    let project_entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for proj in project_entries.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() {
            continue;
        }
        let project_key = proj.file_name().to_string_lossy().to_string();

        if let Ok(sessions) = fs::read_dir(&proj_path) {
            for session_entry in sessions.flatten() {
                let path = session_entry.path();
                if !path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                    continue;
                }

                let session_id = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                if let Ok(file) = fs::File::open(&path) {
                    let reader = BufReader::new(file);
                    for line in reader.lines().flatten() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        // Quick text check before parsing JSON
                        if !trimmed.to_lowercase().contains(&query_lower) {
                            continue;
                        }

                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            let timestamp = val
                                .get("timestamp")
                                .map(|t| t.to_string().trim_matches('"').to_string())
                                .unwrap_or_default();

                            let model = val
                                .get("message")
                                .and_then(|m| m.get("model"))
                                .and_then(|m| m.as_str())
                                .unwrap_or("")
                                .to_string();

                            // Extract text content
                            let mut text = String::new();
                            let mut entry_type = String::new();
                            let mut tool_name = String::new();

                            if let Some(msg) = val.get("message") {
                                let role = msg
                                    .get("role")
                                    .and_then(|r| r.as_str())
                                    .unwrap_or("");

                                if let Some(content) = msg.get("content") {
                                    if let Some(s) = content.as_str() {
                                        text = s.to_string();
                                        entry_type = format!("{}_message", role);
                                    } else if let Some(arr) = content.as_array() {
                                        for block in arr {
                                            let btype = block
                                                .get("type")
                                                .and_then(|t| t.as_str())
                                                .unwrap_or("");

                                            match btype {
                                                "text" => {
                                                    if let Some(t) =
                                                        block.get("text").and_then(|t| t.as_str())
                                                    {
                                                        text = t.to_string();
                                                        entry_type =
                                                            format!("{}_message", role);
                                                    }
                                                }
                                                "tool_use" => {
                                                    tool_name = block
                                                        .get("name")
                                                        .and_then(|n| n.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                    entry_type = "tool_use".to_string();
                                                    text = serde_json::to_string(
                                                        &block.get("input"),
                                                    )
                                                    .unwrap_or_default();
                                                }
                                                "tool_result" => {
                                                    entry_type = "tool_result".to_string();
                                                    text = block
                                                        .get("content")
                                                        .and_then(|c| c.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                }
                                                "thinking" => {
                                                    entry_type = "thinking".to_string();
                                                    text = block
                                                        .get("thinking")
                                                        .and_then(|t| t.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                            }

                            if text.to_lowercase().contains(&query_lower)
                                || tool_name.to_lowercase().contains(&query_lower)
                            {
                                results.push(TranscriptResult {
                                    project_path: project_key.clone(),
                                    session_id: session_id.clone(),
                                    entry_type,
                                    text: text.chars().take(300).collect(),
                                    timestamp,
                                    model,
                                    tool_name,
                                });

                                if results.len() >= limit {
                                    return Ok(results);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Most recent first
    results.reverse();
    Ok(results)
}

// ─── CLAUDE.md editor ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMdInfo {
    pub project_path: String,
    pub display_path: String,
    pub content: Option<String>,
    pub exists: bool,
}

#[command]
pub fn list_claude_md_files() -> Result<Vec<ClaudeMdInfo>, String> {
    let projects_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();

    let entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }

        let path_key = entry.file_name().to_string_lossy().to_string();
        let display_path = path_key.replace('-', "/");

        let claude_md_path = PathBuf::from(&display_path).join("CLAUDE.md");
        let exists = claude_md_path.exists();
        let content = if exists {
            fs::read_to_string(&claude_md_path).ok()
        } else {
            None
        };

        results.push(ClaudeMdInfo {
            project_path: display_path.clone(),
            display_path,
            content,
            exists,
        });
    }

    results.sort_by(|a, b| b.exists.cmp(&a.exists).then(a.display_path.cmp(&b.display_path)));
    Ok(results)
}

#[command]
pub fn write_claude_md(project_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path).join("CLAUDE.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write CLAUDE.md: {}", e))
}

// ─── Hygiene checks ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HygieneIssue {
    pub category: String,
    pub severity: String, // "warning", "info"
    pub title: String,
    pub description: String,
    pub action: String,
    pub project: String,
}

#[command]
pub fn check_hygiene() -> Result<Vec<HygieneIssue>, String> {
    let base = claude_dir().ok_or("Could not find home directory")?;
    let mut issues = Vec::new();

    // 1. Check for projects missing CLAUDE.md
    let projects_dir = base.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let path_key = entry.file_name().to_string_lossy().to_string();
                let display_path = path_key.replace('-', "/");
                let claude_md = PathBuf::from(&display_path).join("CLAUDE.md");

                if !claude_md.exists() && PathBuf::from(&display_path).exists() {
                    issues.push(HygieneIssue {
                        category: "claude_md".to_string(),
                        severity: "info".to_string(),
                        title: "Missing CLAUDE.md".to_string(),
                        description: format!("{} has no CLAUDE.md file", display_path),
                        action: "Add CLAUDE.md to help Claude understand your project".to_string(),
                        project: display_path,
                    });
                }
            }
        }
    }

    // 2. Check for large session files (>10MB)
    if projects_dir.exists() {
        if let Ok(projects) = fs::read_dir(&projects_dir) {
            for proj in projects.flatten() {
                if !proj.path().is_dir() {
                    continue;
                }
                let display_path = proj.file_name().to_string_lossy().replace('-', "/");

                if let Ok(sessions) = fs::read_dir(proj.path()) {
                    for session in sessions.flatten() {
                        let path = session.path();
                        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                            if let Ok(meta) = fs::metadata(&path) {
                                if meta.len() > 10_000_000 {
                                    let size_mb = meta.len() as f64 / 1_000_000.0;
                                    issues.push(HygieneIssue {
                                        category: "large_session".to_string(),
                                        severity: "warning".to_string(),
                                        title: "Large session file".to_string(),
                                        description: format!(
                                            "{:.1}MB session in {}",
                                            size_mb, display_path
                                        ),
                                        action: "Large sessions consume disk space and slow down loading".to_string(),
                                        project: display_path.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Check for stale worktrees
    let worktrees_dir = base.join("worktrees");
    if worktrees_dir.exists() {
        if let Ok(entries) = fs::read_dir(&worktrees_dir) {
            let count = entries.flatten().count();
            if count > 0 {
                issues.push(HygieneIssue {
                    category: "worktrees".to_string(),
                    severity: "info".to_string(),
                    title: format!("{} worktrees remaining", count),
                    description: "Stale worktrees from previous agent runs".to_string(),
                    action: "Clean up with: rm -rf ~/.claude/worktrees/*".to_string(),
                    project: String::new(),
                });
            }
        }
    }

    // 4. Check debug log size
    let debug_dir = base.join("debug");
    if debug_dir.exists() {
        let mut total_size: u64 = 0;
        let mut count = 0;
        if let Ok(entries) = fs::read_dir(&debug_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = fs::metadata(entry.path()) {
                    total_size += meta.len();
                    count += 1;
                }
            }
        }
        if total_size > 50_000_000 {
            issues.push(HygieneIssue {
                category: "debug_logs".to_string(),
                severity: "warning".to_string(),
                title: format!(
                    "Debug logs using {:.0}MB ({} files)",
                    total_size as f64 / 1_000_000.0,
                    count
                ),
                description: "Debug logs accumulate over time".to_string(),
                action: "Clean up with: rm ~/.claude/debug/*.txt".to_string(),
                project: String::new(),
            });
        }
    }

    // 5. Check telemetry size
    let telemetry_dir = base.join("telemetry");
    if telemetry_dir.exists() {
        let mut total_size: u64 = 0;
        if let Ok(entries) = fs::read_dir(&telemetry_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = fs::metadata(entry.path()) {
                    total_size += meta.len();
                }
            }
        }
        if total_size > 100_000_000 {
            issues.push(HygieneIssue {
                category: "telemetry".to_string(),
                severity: "warning".to_string(),
                title: format!("Telemetry using {:.0}MB", total_size as f64 / 1_000_000.0),
                description: "Failed telemetry events accumulating".to_string(),
                action: "Clean up with: rm ~/.claude/telemetry/*".to_string(),
                project: String::new(),
            });
        }
    }

    // 6. Check for projects with uncommitted git changes
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let display_path = entry.file_name().to_string_lossy().replace('-', "/");
                let project_dir = PathBuf::from(&display_path);

                if project_dir.join(".git").exists() {
                    if let Ok(output) = Command::new("git")
                        .args(["status", "--porcelain"])
                        .current_dir(&project_dir)
                        .output()
                    {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let changed_files = stdout.lines().count();
                        if changed_files > 20 {
                            issues.push(HygieneIssue {
                                category: "uncommitted".to_string(),
                                severity: "info".to_string(),
                                title: format!("{} uncommitted changes", changed_files),
                                description: format!("{} has many uncommitted files", display_path),
                                action: "Review and commit or discard changes".to_string(),
                                project: display_path,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort: warnings first, then info
    issues.sort_by(|a, b| a.severity.cmp(&b.severity));
    Ok(issues)
}
