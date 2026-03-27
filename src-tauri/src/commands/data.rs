use serde::Serialize;
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
