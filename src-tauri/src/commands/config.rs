use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFiles {
    pub global_settings: Option<serde_json::Value>,
    pub global_settings_local: Option<serde_json::Value>,
    pub installed_plugins: Option<serde_json::Value>,
    pub known_marketplaces: Option<serde_json::Value>,
    pub install_counts: Option<serde_json::Value>,
    pub blocklist: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub project_path: String,
    pub display_path: String,
    pub settings: Option<serde_json::Value>,
    pub settings_local: Option<serde_json::Value>,
    pub claude_md: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInfo {
    pub name: String,
    pub source: serde_json::Value,
    pub catalog: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginDetail {
    pub name: String,
    pub marketplace: String,
    pub plugin_json: Option<serde_json::Value>,
    pub has_mcp: bool,
    pub mcp_json: Option<serde_json::Value>,
    pub skills: Vec<SkillInfo>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub content: String,
}

fn read_json_file(path: &PathBuf) -> Option<serde_json::Value> {
    if path.exists() {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
    } else {
        None
    }
}

fn write_json_file(path: &PathBuf, value: &serde_json::Value) -> Result<(), String> {
    let dir = path.parent().ok_or("Invalid path")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[command]
pub fn read_global_config() -> Result<ConfigFiles, String> {
    let base = claude_dir().ok_or("Could not find home directory")?;

    Ok(ConfigFiles {
        global_settings: read_json_file(&base.join("settings.json")),
        global_settings_local: read_json_file(&base.join("settings.local.json")),
        installed_plugins: read_json_file(&base.join("plugins").join("installed_plugins.json")),
        known_marketplaces: read_json_file(&base.join("plugins").join("known_marketplaces.json")),
        install_counts: read_json_file(
            &base.join("plugins").join("install-counts-cache.json"),
        ),
        blocklist: read_json_file(&base.join("plugins").join("blocklist.json")),
    })
}

#[command]
pub fn write_global_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = claude_dir()
        .ok_or("Could not find home directory")?
        .join("settings.json");
    write_json_file(&path, &settings)
}

#[command]
pub fn read_project_config(project_dir: String) -> Result<ProjectConfig, String> {
    let dir = PathBuf::from(&project_dir);
    let claude_dir = dir.join(".claude");

    let display_path = dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let claude_md_path = dir.join("CLAUDE.md");
    let claude_md = if claude_md_path.exists() {
        fs::read_to_string(&claude_md_path).ok()
    } else {
        None
    };

    Ok(ProjectConfig {
        project_path: project_dir,
        display_path,
        settings: read_json_file(&claude_dir.join("settings.json")),
        settings_local: read_json_file(&claude_dir.join("settings.local.json")),
        claude_md,
    })
}

#[command]
pub fn write_project_settings(
    project_dir: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    let path = PathBuf::from(&project_dir)
        .join(".claude")
        .join("settings.json");
    write_json_file(&path, &settings)
}

#[command]
pub fn write_project_settings_local(
    project_dir: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    let path = PathBuf::from(&project_dir)
        .join(".claude")
        .join("settings.local.json");
    write_json_file(&path, &settings)
}

#[command]
pub fn list_marketplaces() -> Result<Vec<MarketplaceInfo>, String> {
    let marketplaces_dir = claude_dir()
        .ok_or("Could not find home directory")?
        .join("plugins")
        .join("marketplaces");

    if !marketplaces_dir.exists() {
        return Ok(vec![]);
    }

    let known = read_json_file(
        &claude_dir().unwrap().join("plugins").join("known_marketplaces.json"),
    );

    let mut result = Vec::new();

    let entries = fs::read_dir(&marketplaces_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let catalog_path = path.join(".claude-plugin").join("marketplace.json");
        let catalog = read_json_file(&catalog_path);

        let source = known
            .as_ref()
            .and_then(|k| k.get(&name))
            .and_then(|m| m.get("source"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        result.push(MarketplaceInfo {
            name,
            source,
            catalog,
        });
    }

    Ok(result)
}

#[command]
pub fn read_plugin_detail(
    marketplace: String,
    plugin_name: String,
) -> Result<PluginDetail, String> {
    let base = claude_dir()
        .ok_or("Could not find home directory")?
        .join("plugins")
        .join("cache")
        .join(&marketplace);

    // Find the plugin directory (may have a version subdirectory)
    let plugin_base = base.join(&plugin_name);
    let plugin_dir = if plugin_base.exists() {
        // Look for version subdirectory
        let mut found = plugin_base.clone();
        if let Ok(entries) = fs::read_dir(&plugin_base) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    found = entry.path();
                    break;
                }
            }
        }
        found
    } else {
        return Ok(PluginDetail {
            name: plugin_name,
            marketplace,
            plugin_json: None,
            has_mcp: false,
            mcp_json: None,
            skills: vec![],
        });
    };

    let plugin_json = read_json_file(&plugin_dir.join(".claude-plugin").join("plugin.json"));
    let mcp_path = plugin_dir.join(".mcp.json");
    let has_mcp = mcp_path.exists();
    let mcp_json = read_json_file(&mcp_path);

    // Read skills
    let mut skills = Vec::new();
    let skills_dir = plugin_dir.join("skills");
    if skills_dir.exists() {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let skill_dir = entry.path();
                if skill_dir.is_dir() {
                    let skill_md = skill_dir.join("SKILL.md");
                    if skill_md.exists() {
                        if let Ok(content) = fs::read_to_string(&skill_md) {
                            skills.push(SkillInfo {
                                name: entry.file_name().to_string_lossy().to_string(),
                                content,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(PluginDetail {
        name: plugin_name,
        marketplace,
        plugin_json,
        has_mcp,
        mcp_json,
        skills,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

#[command]
pub fn install_plugin(plugin_id: String) -> Result<CommandResult, String> {
    // plugin_id is like "frontend-design@claude-plugins-official"
    let output = Command::new("claude")
        .args(["plugins", "install", &plugin_id])
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn add_marketplace(source: String) -> Result<CommandResult, String> {
    let output = Command::new("claude")
        .args(["plugins", "marketplace", "add", &source])
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn remove_marketplace(name: String) -> Result<CommandResult, String> {
    let output = Command::new("claude")
        .args(["plugins", "marketplace", "remove", &name])
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn update_marketplace(name: Option<String>) -> Result<CommandResult, String> {
    let mut args = vec!["plugins", "marketplace", "update"];
    let name_ref;
    if let Some(n) = &name {
        name_ref = n.as_str();
        args.push(name_ref);
    }

    let output = Command::new("claude")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn update_plugin(plugin_id: String) -> Result<CommandResult, String> {
    let output = Command::new("claude")
        .args(["plugins", "update", &plugin_id])
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn uninstall_plugin(plugin_id: String) -> Result<CommandResult, String> {
    let output = Command::new("claude")
        .args(["plugins", "uninstall", &plugin_id])
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
