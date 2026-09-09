use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, Wry,
};

use crate::app_error::AppError;

const SHOW_MAIN_WINDOW_ID: &str = "show-main-window";
const QUIT_APPLICATION_ID: &str = "quit-application";

#[derive(Default)]
pub struct TrayRuntimeState {
    close_to_tray_enabled: AtomicBool,
    tray_ready: AtomicBool,
    tray_icon: Mutex<Option<TrayIcon<Wry>>>,
}

impl TrayRuntimeState {
    pub fn should_close_to_tray(&self) -> bool {
        self.tray_ready.load(Ordering::Acquire)
            && self.close_to_tray_enabled.load(Ordering::Acquire)
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), AppError> {
    let show_item = MenuItem::with_id(app, SHOW_MAIN_WINDOW_ID, "显示 MXterm", true, None::<&str>)
        .map_err(|error| tray_error("tray_menu_create_failed", "无法创建托盘菜单", error))?;
    let quit_item = MenuItem::with_id(app, QUIT_APPLICATION_ID, "退出 MXterm", true, None::<&str>)
        .map_err(|error| tray_error("tray_menu_create_failed", "无法创建托盘菜单", error))?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])
        .map_err(|error| tray_error("tray_menu_create_failed", "无法创建托盘菜单", error))?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MAIN_WINDOW_ID => {
                if let Err(error) = show_main_window(app) {
                    eprintln!("[tray] restore main window failed: {}", error.raw_message);
                }
            }
            QUIT_APPLICATION_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = show_main_window(tray.app_handle()) {
                    eprintln!("[tray] restore main window failed: {}", error.raw_message);
                }
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    let tray_icon = builder
        .build(app)
        .map_err(|error| tray_error("tray_icon_create_failed", "无法创建系统托盘", error))?;
    let state = app.state::<TrayRuntimeState>();
    let mut slot = state.tray_icon.lock().map_err(|_| {
        AppError::new(
            "tray_state_poisoned",
            "托盘状态不可用",
            "mutex poisoned",
            true,
        )
    })?;
    *slot = Some(tray_icon);
    state.tray_ready.store(true, Ordering::Release);
    state.close_to_tray_enabled.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn set_close_to_tray_enabled(
    enabled: bool,
    state: State<'_, TrayRuntimeState>,
) -> Result<(), AppError> {
    if enabled && !state.tray_ready.load(Ordering::Acquire) {
        return Err(AppError::new(
            "tray_unavailable",
            "系统托盘不可用",
            "tray initialization did not complete",
            true,
        ));
    }
    state
        .close_to_tray_enabled
        .store(enabled, Ordering::Release);
    Ok(())
}

fn show_main_window(app: &AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::new("main_window_not_found", "主窗口不存在", "main", true))?;
    window
        .show()
        .map_err(|error| tray_error("main_window_show_failed", "无法显示主窗口", error))?;
    window
        .unminimize()
        .map_err(|error| tray_error("main_window_restore_failed", "无法恢复主窗口", error))?;
    window
        .set_focus()
        .map_err(|error| tray_error("main_window_focus_failed", "无法激活主窗口", error))?;
    Ok(())
}

fn tray_error(code: &str, message: &str, error: impl ToString) -> AppError {
    AppError::new(code, message, error, true)
}

#[cfg(test)]
mod tests {
    use super::TrayRuntimeState;
    use std::sync::atomic::Ordering;

    #[test]
    fn close_to_tray_requires_ready_tray() {
        let state = TrayRuntimeState::default();
        state.close_to_tray_enabled.store(true, Ordering::Release);
        assert!(!state.should_close_to_tray());
        state.tray_ready.store(true, Ordering::Release);
        assert!(state.should_close_to_tray());
    }

    #[test]
    fn disabled_setting_allows_normal_close() {
        let state = TrayRuntimeState::default();
        state.tray_ready.store(true, Ordering::Release);
        assert!(!state.should_close_to_tray());
    }
}
