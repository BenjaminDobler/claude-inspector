use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path_key: String,
    pub display_path: String,
    pub session_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub file_size: u64,
    pub modified_at: String,
    pub has_subagents: bool,
    pub subagent_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawSessionData {
    pub entries: Vec<serde_json::Value>,
    pub subagents: HashMap<String, SubagentData>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubagentData {
    pub meta: serde_json::Value,
    pub entries: Vec<serde_json::Value>,
}

#[command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    let entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let path_key = entry.file_name().to_string_lossy().to_string();
        let display_path = path_key.replace('-', "/");

        // Count .jsonl files (sessions)
        let session_count = fs::read_dir(&path)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "jsonl")
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);

        if session_count > 0 {
            projects.push(ProjectInfo {
                path_key,
                display_path,
                session_count,
            });
        }
    }

    projects.sort_by(|a, b| a.display_path.cmp(&b.display_path));
    Ok(projects)
}

#[command]
pub fn list_sessions(project_path: String) -> Result<Vec<SessionInfo>, String> {
    let project_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects")
        .join(&project_path);

    if !project_dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions = Vec::new();

    let entries = fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            let session_id = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            let file_size = metadata.len();
            let modified_at = metadata
                .modified()
                .map(|t| {
                    let duration = t
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default();
                    duration.as_millis().to_string()
                })
                .unwrap_or_default();

            // Check for subagents directory
            let subagents_dir = project_dir.join(&session_id).join("subagents");
            let has_subagents = subagents_dir.exists();
            let subagent_count = if has_subagents {
                fs::read_dir(&subagents_dir)
                    .map(|rd| {
                        rd.flatten()
                            .filter(|e| {
                                e.path()
                                    .extension()
                                    .map(|ext| ext == "jsonl")
                                    .unwrap_or(false)
                            })
                            .count()
                    })
                    .unwrap_or(0)
            } else {
                0
            };

            sessions.push(SessionInfo {
                session_id,
                file_size,
                modified_at,
                has_subagents,
                subagent_count,
            });
        }
    }

    // Sort by modified_at descending (most recent first)
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

#[command]
pub fn read_session(
    project_path: String,
    session_id: String,
) -> Result<RawSessionData, String> {
    let project_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects")
        .join(&project_path);

    let session_file = project_dir.join(format!("{}.jsonl", session_id));
    if !session_file.exists() {
        return Err(format!("Session file not found: {}", session_id));
    }

    // Parse main session JSONL
    let file = fs::File::open(&session_file).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => entries.push(value),
            Err(_) => continue, // skip malformed lines
        }
    }

    // Parse subagent sessions
    let mut subagents = HashMap::new();
    let subagents_dir = project_dir.join(&session_id).join("subagents");

    if subagents_dir.exists() {
        let sub_entries = fs::read_dir(&subagents_dir).map_err(|e| e.to_string())?;
        for entry in sub_entries.flatten() {
            let path = entry.path();
            let filename = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                // Extract agent ID from filename like "agent-abc123"
                let agent_id = filename
                    .strip_prefix("agent-")
                    .unwrap_or(&filename)
                    .to_string();

                // Read meta file
                let meta_path = subagents_dir.join(format!("{}.meta.json", filename));
                let meta = if meta_path.exists() {
                    let meta_content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
                    serde_json::from_str(&meta_content).unwrap_or(serde_json::Value::Null)
                } else {
                    serde_json::Value::Null
                };

                // Read subagent JSONL
                let sub_file = fs::File::open(&path).map_err(|e| e.to_string())?;
                let sub_reader = BufReader::new(sub_file);
                let mut sub_entries_vec = Vec::new();

                for line in sub_reader.lines() {
                    let line = line.map_err(|e| e.to_string())?;
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        sub_entries_vec.push(value);
                    }
                }

                subagents.insert(
                    agent_id,
                    SubagentData {
                        meta,
                        entries: sub_entries_vec,
                    },
                );
            }
        }
    }

    Ok(RawSessionData {
        entries,
        subagents,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanFile {
    pub slug: String,
    pub content: String,
    pub modified_at: String,
}

#[command]
pub fn read_session_plans(
    project_path: String,
    session_id: String,
) -> Result<Vec<PlanFile>, String> {
    let project_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects")
        .join(&project_path);

    let session_file = project_dir.join(format!("{}.jsonl", session_id));
    if !session_file.exists() {
        return Err(format!("Session file not found: {}", session_id));
    }

    // Extract unique slugs from the session
    let file = fs::File::open(&session_file).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut slugs = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(slug) = value.get("slug").and_then(|s| s.as_str()) {
                if !slug.is_empty() {
                    slugs.insert(slug.to_string());
                }
            }
        }
    }

    // Read plan files for found slugs
    let plans_dir = claude_dir().unwrap().join("plans");
    let mut plans = Vec::new();

    for slug in &slugs {
        let plan_path = plans_dir.join(format!("{}.md", slug));
        if plan_path.exists() {
            let content = fs::read_to_string(&plan_path).map_err(|e| e.to_string())?;
            let modified_at = fs::metadata(&plan_path)
                .and_then(|m| m.modified())
                .map(|t| {
                    let duration = t
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default();
                    duration.as_millis().to_string()
                })
                .unwrap_or_default();

            plans.push(PlanFile {
                slug: slug.clone(),
                content,
                modified_at,
            });
        }
    }

    // Sort by modified_at
    plans.sort_by(|a, b| a.modified_at.cmp(&b.modified_at));
    Ok(plans)
}
