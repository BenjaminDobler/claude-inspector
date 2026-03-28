mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sessions::list_projects,
            commands::sessions::list_sessions,
            commands::sessions::read_session,
            commands::sessions::read_session_plans,
            commands::watcher::get_active_sessions,
            commands::watcher::focus_session,
            commands::watcher::poll_session,
            commands::config::read_global_config,
            commands::config::write_global_settings,
            commands::config::read_project_config,
            commands::config::write_project_settings,
            commands::config::write_project_settings_local,
            commands::config::list_marketplaces,
            commands::config::read_plugin_detail,
            commands::data::read_cost_data,
            commands::data::read_session_tasks,
            commands::data::read_usage_stats,
            commands::data::read_file_history,
            commands::data::read_global_history,
            commands::data::read_hourly_activity,
            commands::data::read_global_tool_stats,
            commands::data::list_session_notes,
            commands::data::save_session_note,
            commands::data::delete_session_note,
            commands::data::read_project_memory,
            commands::mcp::list_mcp_servers,
            commands::mcp::add_mcp_server,
            commands::mcp::remove_mcp_server,
            commands::workspace::search_transcripts,
            commands::workspace::list_claude_md_files,
            commands::workspace::write_claude_md,
            commands::workspace::check_hygiene,
            commands::config::add_marketplace,
            commands::config::remove_marketplace,
            commands::config::update_marketplace,
            commands::config::install_plugin,
            commands::config::update_plugin,
            commands::config::uninstall_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
