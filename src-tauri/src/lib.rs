mod app_error;
mod commands;
mod connections;
mod credentials;
mod events;
mod known_hosts;
mod remote_files;
mod ssh_config;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(remote_files::RemoteFileManager::default())
        .manage(terminal::manager::TerminalManager::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                let app_handle = app.handle().clone();
                let _ = commands::set_window_material(app_handle, 2);
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection_list,
            commands::connection_upsert,
            commands::connection_set_favorite,
            commands::connection_mark_connected,
            commands::connection_delete,
            commands::connection_probe_latency,
            commands::connection_test,
            commands::connection_test_profile,
            commands::credential_list,
            commands::credential_upsert,
            commands::credential_delete,
            commands::known_host_trust,
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
            commands::remote_file_delete_upload_temp,
            commands::local_path_metadata,
            commands::remote_file_download,
            commands::remote_file_check_download_target,
            commands::remote_file_download_to_local,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
