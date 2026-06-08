mod app_error;
mod commands;
mod connections;
mod events;
mod remote_files;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(remote_files::RemoteFileManager::default())
        .manage(terminal::manager::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::connection_list,
            commands::connection_upsert,
            commands::connection_delete,
            commands::connection_probe_latency,
            commands::terminal_connect,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
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
            commands::remote_file_download,
            commands::remote_file_check_download_target,
            commands::remote_file_download_to_local,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
