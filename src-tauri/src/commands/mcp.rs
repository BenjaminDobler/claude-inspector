use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub source: String, // "user", "project:<path>", "plugin:<name>"
    pub server_type: String, // "stdio", "http", "sse"
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub env: std::collections::HashMap<String, String>,
    pub headers: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

fn parse_mcp_json(
    content: &serde_json::Value,
    source: &str,
) -> Vec<McpServer> {
    let mut servers = Vec::new();

    // MCP json can have servers at root level or under "mcpServers"
    let server_map = content
        .get("mcpServers")
        .or(Some(content))
        .and_then(|v| v.as_object());

    if let Some(map) = server_map {
        for (name, config) in map {
            if !config.is_object() {
                continue;
            }

            let server_type = if config.get("url").is_some() {
                let t = config
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("http");
                t.to_string()
            } else {
                "stdio".to_string()
            };

            let command = config
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let args: Vec<String> = config
                .get("args")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let url = config
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let env: std::collections::HashMap<String, String> = config
                .get("env")
                .and_then(|v| v.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();

            let headers: std::collections::HashMap<String, String> = config
                .get("headers")
                .and_then(|v| v.as_object())
                .map(|o| {
                    o.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();

            servers.push(McpServer {
                name: name.clone(),
                source: source.to_string(),
                server_type,
                command,
                args,
                url,
                env,
                headers,
            });
        }
    }

    servers
}

#[command]
pub fn list_mcp_servers() -> Result<Vec<McpServer>, String> {
    let mut all_servers = Vec::new();
    let base = claude_dir().ok_or("Could not find home directory")?;

    // 1. User-level MCP servers (from claude mcp add)
    // These are stored in ~/.claude/settings.local.json or similar
    let user_settings_path = base.join("settings.local.json");
    if user_settings_path.exists() {
        if let Ok(content) = fs::read_to_string(&user_settings_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(mcp) = val.get("mcpServers") {
                    all_servers.extend(parse_mcp_json(mcp, "user"));
                }
            }
        }
    }

    // Also check a standalone mcp config
    let mcp_json_path = base.join(".mcp.json");
    if mcp_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&mcp_json_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                all_servers.extend(parse_mcp_json(&val, "user"));
            }
        }
    }

    // 2. Project-level MCP servers (scan known projects)
    let projects_dir = base.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let path_key = entry.file_name().to_string_lossy().to_string();
                let display_path = path_key.replace('-', "/");

                // Check if the actual project has a .mcp.json
                let project_mcp = PathBuf::from(&display_path).join(".mcp.json");
                if project_mcp.exists() {
                    if let Ok(content) = fs::read_to_string(&project_mcp) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                            let source = format!("project:{}", display_path);
                            all_servers.extend(parse_mcp_json(&val, &source));
                        }
                    }
                }
            }
        }
    }

    // 3. Plugin MCP servers (from installed plugins)
    let cache_dir = base.join("plugins").join("cache");
    if cache_dir.exists() {
        if let Ok(marketplaces) = fs::read_dir(&cache_dir) {
            for mkt in marketplaces.flatten() {
                if let Ok(plugins) = fs::read_dir(mkt.path()) {
                    for plugin in plugins.flatten() {
                        // Find the version subdirectory
                        let plugin_path = plugin.path();
                        if !plugin_path.is_dir() {
                            continue;
                        }

                        // Check direct .mcp.json or version subdirectory
                        let check_paths = vec![plugin_path.join(".mcp.json")];
                        let mut version_paths = Vec::new();
                        if let Ok(versions) = fs::read_dir(&plugin_path) {
                            for ver in versions.flatten() {
                                if ver.path().is_dir() {
                                    version_paths.push(ver.path().join(".mcp.json"));
                                }
                            }
                        }

                        for mcp_path in check_paths.iter().chain(version_paths.iter()) {
                            if mcp_path.exists() {
                                if let Ok(content) = fs::read_to_string(mcp_path) {
                                    if let Ok(val) =
                                        serde_json::from_str::<serde_json::Value>(&content)
                                    {
                                        let plugin_name = plugin
                                            .file_name()
                                            .to_string_lossy()
                                            .to_string();
                                        let source = format!("plugin:{}", plugin_name);
                                        all_servers.extend(parse_mcp_json(&val, &source));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Deduplicate by name (user overrides project overrides plugin)
    let mut seen = std::collections::HashSet::new();
    all_servers.retain(|s| seen.insert(s.name.clone()));

    Ok(all_servers)
}

#[command]
pub fn add_mcp_server(
    name: String,
    command_or_url: String,
    args: Vec<String>,
    transport: Option<String>,
    env: std::collections::HashMap<String, String>,
    scope: Option<String>,
) -> Result<CommandResult, String> {
    let mut cmd_args = vec!["mcp".to_string(), "add".to_string()];

    if let Some(t) = &transport {
        cmd_args.push("--transport".to_string());
        cmd_args.push(t.clone());
    }

    if let Some(s) = &scope {
        cmd_args.push("--scope".to_string());
        cmd_args.push(s.clone());
    }

    for (k, v) in &env {
        cmd_args.push("-e".to_string());
        cmd_args.push(format!("{}={}", k, v));
    }

    cmd_args.push(name);
    cmd_args.push(command_or_url);
    cmd_args.extend(args);

    let output = Command::new("claude")
        .args(&cmd_args)
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[command]
pub fn remove_mcp_server(name: String, scope: Option<String>) -> Result<CommandResult, String> {
    let mut cmd_args = vec!["mcp", "remove"];

    let scope_val;
    if let Some(s) = &scope {
        cmd_args.push("--scope");
        scope_val = s.clone();
        cmd_args.push(&scope_val);
    }

    let output = Command::new("claude")
        .args(&cmd_args)
        .arg(&name)
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    Ok(CommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
