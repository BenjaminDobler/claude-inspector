use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

// ─── Cost tracking ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CostData {
    pub days: HashMap<String, HashMap<String, ModelUsage>>,
    pub pricing: HashMap<String, ModelPricing>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[command]
pub fn read_cost_data() -> Result<CostData, String> {
    let base = claude_dir().ok_or("Could not find home directory")?;

    let cost_path = base.join("readout-cost-cache.json");
    let pricing_path = base.join("readout-pricing.json");

    let mut days: HashMap<String, HashMap<String, ModelUsage>> = HashMap::new();
    let mut pricing: HashMap<String, ModelPricing> = HashMap::new();

    if cost_path.exists() {
        let content = fs::read_to_string(&cost_path).map_err(|e| e.to_string())?;
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(days_obj) = val.get("days").and_then(|d| d.as_object()) {
                for (date, models) in days_obj {
                    let mut model_map = HashMap::new();
                    if let Some(models_obj) = models.as_object() {
                        for (model, usage) in models_obj {
                            model_map.insert(model.clone(), ModelUsage {
                                input: usage.get("input").and_then(|v| v.as_u64()).unwrap_or(0),
                                output: usage.get("output").and_then(|v| v.as_u64()).unwrap_or(0),
                                cache_read: usage.get("cacheRead").and_then(|v| v.as_u64()).unwrap_or(0),
                                cache_write: usage.get("cacheWrite").and_then(|v| v.as_u64()).unwrap_or(0),
                            });
                        }
                    }
                    days.insert(date.clone(), model_map);
                }
            }
        }
    }

    if pricing_path.exists() {
        let content = fs::read_to_string(&pricing_path).map_err(|e| e.to_string())?;
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = val.as_object() {
                for (model, prices) in obj {
                    pricing.insert(model.clone(), ModelPricing {
                        input: prices.get("input").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        output: prices.get("output").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        cache_read: prices.get("cacheRead").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        cache_write: prices.get("cacheWrite").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    });
                }
            }
        }
    }

    Ok(CostData { days, pricing })
}

// ─── Tasks ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub subject: String,
    pub description: String,
    pub status: String,
    pub active_form: Option<String>,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
}

#[command]
pub fn read_session_tasks(session_id: String) -> Result<Vec<TaskItem>, String> {
    let tasks_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("tasks");

    // Tasks are stored in a directory named by session UUID
    let session_tasks_dir = tasks_dir.join(&session_id);
    if !session_tasks_dir.exists() {
        return Ok(vec![]);
    }

    let mut tasks = Vec::new();
    let entries = fs::read_dir(&session_tasks_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    tasks.push(TaskItem {
                        id: val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        subject: val.get("subject").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        description: val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        status: val.get("status").and_then(|v| v.as_str()).unwrap_or("pending").to_string(),
                        active_form: val.get("activeForm").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        blocks: val.get("blocks").and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                            .unwrap_or_default(),
                        blocked_by: val.get("blockedBy").and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                            .unwrap_or_default(),
                    });
                }
            }
        }
    }

    tasks.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(tasks)
}

// ─── Usage stats ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    pub message_count: u64,
    pub session_count: u64,
    pub tool_call_count: u64,
}

#[command]
pub fn read_usage_stats() -> Result<Vec<DailyActivity>, String> {
    let path = claude_dir()
        .ok_or("Could not find home directory")?
        .join("stats-cache.json");

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut stats = Vec::new();
    if let Some(daily) = val.get("dailyActivity").and_then(|v| v.as_array()) {
        for entry in daily {
            stats.push(DailyActivity {
                date: entry.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                message_count: entry.get("messageCount").and_then(|v| v.as_u64()).unwrap_or(0),
                session_count: entry.get("sessionCount").and_then(|v| v.as_u64()).unwrap_or(0),
                tool_call_count: entry.get("toolCallCount").and_then(|v| v.as_u64()).unwrap_or(0),
            });
        }
    }

    Ok(stats)
}

// ─── File history ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub file_hash: String,
    pub versions: Vec<FileVersion>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub version: String,
    pub size: u64,
    pub content_preview: String,
}

#[command]
pub fn read_file_history(session_id: String) -> Result<Vec<FileHistoryEntry>, String> {
    let dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("file-history")
        .join(&session_id);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut file_map: HashMap<String, Vec<FileVersion>> = HashMap::new();

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let filename = entry.file_name().to_string_lossy().to_string();
        // Format: {hash}@{version}
        if let Some(at_pos) = filename.find('@') {
            let hash = &filename[..at_pos];
            let version = &filename[at_pos + 1..];
            let path = entry.path();
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

            // Read first 500 chars as preview
            let preview = fs::read_to_string(&path)
                .map(|c| c.chars().take(500).collect::<String>())
                .unwrap_or_default();

            file_map.entry(hash.to_string()).or_default().push(FileVersion {
                version: version.to_string(),
                size,
                content_preview: preview,
            });
        }
    }

    let mut result: Vec<FileHistoryEntry> = file_map
        .into_iter()
        .map(|(hash, mut versions)| {
            versions.sort_by(|a, b| a.version.cmp(&b.version));
            FileHistoryEntry {
                file_hash: hash,
                versions,
            }
        })
        .collect();

    result.sort_by(|a, b| b.versions.len().cmp(&a.versions.len()));
    Ok(result)
}

// ─── Global history ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub display: String,
    pub timestamp: u64,
    pub project: String,
    pub session_id: String,
}

#[command]
pub fn read_global_history(limit: Option<usize>) -> Result<Vec<HistoryEntry>, String> {
    let path = claude_dir()
        .ok_or("Could not find home directory")?
        .join("history.jsonl");

    if !path.exists() {
        return Ok(vec![]);
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            entries.push(HistoryEntry {
                display: val.get("display").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                timestamp: val.get("timestamp").and_then(|v| v.as_u64()).unwrap_or(0),
                project: val.get("project").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                session_id: val.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            });
        }
    }

    // Return most recent first
    entries.reverse();

    let limit = limit.unwrap_or(500);
    entries.truncate(limit);

    Ok(entries)
}

// ─── Full history stats (computed from all session files) ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FullDayStats {
    pub date: String,
    pub message_count: u64,
    pub tool_call_count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub models: HashMap<String, u64>,
}

#[command]
pub fn compute_full_stats() -> Result<Vec<FullDayStats>, String> {
    let projects_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut day_stats: HashMap<String, FullDayStats> = HashMap::new();

    let project_entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for proj in project_entries.flatten() {
        if !proj.path().is_dir() { continue; }

        if let Ok(sessions) = fs::read_dir(proj.path()) {
            for session_entry in sessions.flatten() {
                let path = session_entry.path();
                if !path.extension().map(|e| e == "jsonl").unwrap_or(false) { continue; }

                if let Ok(file) = fs::File::open(&path) {
                    let reader = BufReader::new(file);
                    for line in reader.lines().flatten() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }

                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            let date = if let Some(ts) = val.get("timestamp") {
                                if let Some(s) = ts.as_str() {
                                    s.get(..10).unwrap_or("").to_string()
                                } else if let Some(n) = ts.as_u64() {
                                    epoch_to_date(n / 1000)
                                } else if let Some(n) = ts.as_f64() {
                                    epoch_to_date(n as u64 / 1000)
                                } else {
                                    continue;
                                }
                            } else {
                                continue;
                            };

                            if date.len() < 10 { continue; }

                            let entry = day_stats.entry(date.clone()).or_insert_with(|| FullDayStats {
                                date: date.clone(),
                                message_count: 0, tool_call_count: 0,
                                input_tokens: 0, output_tokens: 0,
                                cache_read_tokens: 0, cache_write_tokens: 0,
                                models: HashMap::new(),
                            });

                            if let Some(msg) = val.get("message") {
                                let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
                                if role == "user" || role == "assistant" {
                                    entry.message_count += 1;
                                }

                                if let Some(usage) = msg.get("usage") {
                                    entry.input_tokens += usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                    entry.output_tokens += usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                    entry.cache_read_tokens += usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                    entry.cache_write_tokens += usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                }

                                if let Some(model) = msg.get("model").and_then(|m| m.as_str()) {
                                    *entry.models.entry(model.to_string()).or_default() += 1;
                                }

                                if let Some(content) = msg.get("content").and_then(|c| c.as_array()) {
                                    for block in content {
                                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                            entry.tool_call_count += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<FullDayStats> = day_stats.into_values().collect();
    result.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(result)
}

fn epoch_to_date(secs: u64) -> String {
    let days = secs / 86400;
    let mut y = 1970i64;
    let mut remaining = days as i64;

    loop {
        let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
        let diy = if leap { 366 } else { 365 };
        if remaining < diy { break; }
        remaining -= diy;
        y += 1;
    }

    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1;
    for &days in &month_days {
        if remaining < days as i64 { break; }
        remaining -= days as i64;
        m += 1;
    }

    format!("{:04}-{:02}-{:02}", y, m, remaining + 1)
}

// ─── Hourly activity (When You Work) ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HourlyActivity {
    pub hour: u32,
    pub count: u64,
}

#[command]
pub fn read_hourly_activity() -> Result<Vec<HourlyActivity>, String> {
    let history_path = claude_dir()
        .ok_or("Could not find home directory")?
        .join("history.jsonl");

    if !history_path.exists() {
        return Ok(vec![]);
    }

    let mut hours = vec![0u64; 24];

    let file = fs::File::open(&history_path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(ts) = val.get("timestamp").and_then(|v| v.as_u64()) {
                // Convert epoch ms to hour of day
                let secs = ts / 1000;
                let hour = ((secs % 86400) / 3600) as usize;
                if hour < 24 {
                    hours[hour] += 1;
                }
            }
        }
    }

    Ok(hours.iter().enumerate().map(|(h, &count)| HourlyActivity {
        hour: h as u32,
        count,
    }).collect())
}

// ─── Cross-session tool stats ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlobalToolStat {
    pub name: String,
    pub count: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolSequence {
    pub from_tool: String,
    pub to_tool: String,
    pub count: u64,
}

#[command]
pub fn read_global_tool_stats() -> Result<(Vec<GlobalToolStat>, Vec<ToolSequence>), String> {
    let projects_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects");

    if !projects_dir.exists() {
        return Ok((vec![], vec![]));
    }

    let mut tool_counts: HashMap<String, u64> = HashMap::new();
    let mut sequences: HashMap<(String, String), u64> = HashMap::new();

    // Scan all session files
    let project_entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;
    for proj in project_entries.flatten() {
        let proj_path = proj.path();
        if !proj_path.is_dir() { continue; }

        if let Ok(sessions) = fs::read_dir(&proj_path) {
            for session_entry in sessions.flatten() {
                let path = session_entry.path();
                if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                    if let Ok(file) = fs::File::open(&path) {
                        let reader = BufReader::new(file);
                        let mut last_tool: Option<String> = None;

                        for line in reader.lines().flatten() {
                            let trimmed = line.trim();
                            if trimmed.is_empty() { continue; }

                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                                // Look for tool_use in content
                                if let Some(content) = val.get("message")
                                    .and_then(|m| m.get("content"))
                                    .and_then(|c| c.as_array())
                                {
                                    for block in content {
                                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                            if let Some(name) = block.get("name").and_then(|n| n.as_str()) {
                                                *tool_counts.entry(name.to_string()).or_default() += 1;

                                                if let Some(ref prev) = last_tool {
                                                    *sequences.entry((prev.clone(), name.to_string())).or_default() += 1;
                                                }
                                                last_tool = Some(name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut tools: Vec<GlobalToolStat> = tool_counts
        .into_iter()
        .map(|(name, count)| GlobalToolStat { name, count })
        .collect();
    tools.sort_by(|a, b| b.count.cmp(&a.count));

    let mut seqs: Vec<ToolSequence> = sequences
        .into_iter()
        .map(|((from, to), count)| ToolSequence { from_tool: from, to_tool: to, count })
        .collect();
    seqs.sort_by(|a, b| b.count.cmp(&a.count));
    seqs.truncate(10);

    Ok((tools, seqs))
}

// ─── Session notes/bookmarks ───

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionNote {
    pub session_id: String,
    pub project_path: String,
    pub note: String,
    pub tags: Vec<String>,
    pub bookmarked: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn notes_path() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("inspector-notes.json"))
}

fn load_notes() -> Vec<SessionNote> {
    notes_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_notes(notes: &[SessionNote]) -> Result<(), String> {
    let path = notes_path().ok_or("Could not find home directory")?;
    let content = serde_json::to_string_pretty(notes).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[command]
pub fn list_session_notes() -> Result<Vec<SessionNote>, String> {
    Ok(load_notes())
}

#[command]
pub fn save_session_note(
    session_id: String,
    project_path: String,
    note: String,
    tags: Vec<String>,
    bookmarked: bool,
) -> Result<(), String> {
    let mut notes = load_notes();
    let now = chrono_now();

    if let Some(existing) = notes.iter_mut().find(|n| n.session_id == session_id) {
        existing.note = note;
        existing.tags = tags;
        existing.bookmarked = bookmarked;
        existing.updated_at = now;
    } else {
        notes.push(SessionNote {
            session_id,
            project_path,
            note,
            tags,
            bookmarked,
            created_at: now.clone(),
            updated_at: now,
        });
    }

    save_notes(&notes)
}

#[command]
pub fn delete_session_note(session_id: String) -> Result<(), String> {
    let mut notes = load_notes();
    notes.retain(|n| n.session_id != session_id);
    save_notes(&notes)
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    secs.to_string()
}

// ─── Memory ───

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub filename: String,
    pub content: String,
}

#[command]
pub fn read_project_memory(project_path_key: String) -> Result<Vec<MemoryFile>, String> {
    let memory_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("projects")
        .join(&project_path_key)
        .join("memory");

    if !memory_dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(&memory_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let filename = entry.file_name().to_string_lossy().to_string();
            if let Ok(content) = fs::read_to_string(&path) {
                files.push(MemoryFile { filename, content });
            }
        }
    }

    files.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(files)
}
