mod app_error;
mod commands;
mod connections;
mod events;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(terminal::manager::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::connection_list,
            commands::connection_upsert,
            commands::connection_delete,
            commands::terminal_connect,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
