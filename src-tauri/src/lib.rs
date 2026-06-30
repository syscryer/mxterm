pub mod app_error;
mod command_library;
mod commands;
mod connections;
mod credentials;
mod docker_tools;
mod events;
mod known_hosts;
pub mod mcp;
mod network_tools;
mod rdp;
mod remote_exec_pool;
mod remote_files;
mod remote_monitor;
mod ssh_config;
mod storage;
pub mod storage_migration;
pub mod storage_repository;
pub mod storage_sqlite;
pub mod storage_vault;
pub mod sync_snapshot;
mod terminal;
mod tunnels;
mod vnc;
mod webdav;
mod webdav_sync;
use storage_vault::VaultState;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(remote_monitor::RemoteMonitorManager::default())
        .manage(docker_tools::DockerExecSessionManager::default())
        .manage(docker_tools::DockerLogStreamManager::default())
        .manage(network_tools::NetworkDiagnosticSessionManager::default())
        .manage(remote_files::RemoteFileManager::default())
        .manage(terminal::manager::TerminalManager::default())
        .manage(rdp::RdpSessionManager::default())
        .manage(vnc::VncSessionManager::default())
        .manage(tunnels::TunnelManager::default())
        .manage(webdav_sync::WebDavSyncManager::default())
        .manage(VaultState::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                let app_handle = app.handle().clone();
                let _ = commands::set_window_material(app_handle, 2);
            }
            #[cfg(target_os = "macos")]
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::secret_vault_status,
            commands::secret_vault_unlock,
            commands::secret_vault_unlock_local,
            commands::secret_vault_lock,
            commands::secret_vault_enable_master_password,
            commands::secret_vault_disable_master_password,
            commands::connection_list,
            commands::connection_upsert,
            commands::connection_set_favorite,
            commands::connection_mark_connected,
            commands::connection_delete,
            commands::connection_reveal_inline_secret,
            commands::connection_probe_latency,
            commands::connection_probe_system,
            commands::connection_test,
            commands::connection_test_profile,
            commands::rdp_launch_connection,
            commands::rdp_preview_launch,
            commands::rdp_test_runner,
            commands::rdp_close_session,
            commands::rdp_reveal_session,
            commands::rdp_resize_embedded_session,
            commands::vnc_launch_connection,
            commands::vnc_preview_launch,
            commands::vnc_test_runner,
            commands::vnc_close_session,
            commands::credential_list,
            commands::credential_upsert,
            commands::credential_delete,
            commands::credential_reveal_secret,
            commands::known_host_trust,
            commands::local_terminal_list_profiles,
            commands::local_terminal_open,
            commands::telnet_terminal_open,
            commands::serial_list_ports,
            commands::serial_terminal_open,
            mcp::mcp_executable_path,
            mcp::mcp_settings_get,
            mcp::mcp_settings_save,
            commands::get_app_runtime_info,
            commands::get_windows_pty_info,
            commands::terminal_connect,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::get_supported_window_materials,
            commands::set_window_material,
            commands::remote_file_list,
            commands::remote_file_read,
            commands::remote_file_write,
            commands::remote_file_create_file,
            commands::remote_file_create_directory,
            commands::remote_file_rename,
            commands::remote_file_delete,
            commands::remote_file_metadata,
            commands::remote_file_check_path,
            commands::remote_file_upload_file,
            commands::remote_file_upload_local_file,
            commands::remote_file_upload_archive,
            commands::remote_file_upload_local_archive,
            commands::remote_file_prepare_upload_temp,
            commands::remote_file_append_upload_temp,
            commands::remote_file_cancel_transfer,
            commands::remote_file_delete_upload_temp,
            commands::local_path_metadata,
            commands::remote_file_download,
            commands::remote_file_check_download_target,
            commands::remote_file_download_to_local,
            commands::remote_monitor_snapshot,
            commands::remote_monitor_process_signal,
            commands::docker_list_containers,
            commands::docker_list_images,
            commands::docker_container_action,
            commands::docker_container_logs,
            commands::docker_container_inspect,
            commands::docker_container_update_restart_policy,
            commands::docker_list_networks,
            commands::docker_container_connect_network,
            commands::docker_container_logs_start,
            commands::docker_container_logs_stop,
            commands::docker_container_logs_save,
            commands::docker_image_pull,
            commands::docker_image_remove,
            commands::docker_image_run,
            commands::docker_engine_status,
            commands::docker_engine_action,
            commands::docker_engine_read_config,
            commands::docker_engine_save_config,
            commands::docker_exec_invalidate_connection,
            commands::network_diagnostic_run,
            commands::tunnel_list,
            commands::tunnel_upsert,
            commands::tunnel_delete,
            commands::tunnel_start,
            commands::tunnel_stop,
            commands::tunnel_autostart,
            commands::command_snippet_list,
            commands::command_snippet_upsert,
            commands::command_snippet_delete,
            commands::command_snippet_mark_used,
            commands::command_history_list,
            commands::command_history_record,
            commands::command_history_delete,
            commands::command_history_clear,
            commands::webdav_settings_get,
            commands::webdav_settings_save,
            commands::webdav_test_connection,
            commands::webdav_fetch_remote_info,
            commands::webdav_upload_snapshot,
            commands::webdav_download_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
