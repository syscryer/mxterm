//! Small native feedback surface; never hides the ActiveX desktop or owns credentials.
use super::{
    connection_state::{ConnectionState, Phase},
    scale_dip_value, to_wide_null, window_dpi_for_window, NativeRdpAppearance,
};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::{DRAWITEMSTRUCT, ODS_FOCUS, ODS_SELECTED};
use windows::Win32::UI::WindowsAndMessaging::*;

pub const RETRY_MESSAGE: u32 = WM_APP + 44;
pub const ANIMATION_TIMER: usize = 0x4d58_5245;

struct PaintState {
    colors: NativeRdpAppearance,
    brush: HBRUSH,
    frame: usize,
    waiting: bool,
}

impl Drop for PaintState {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.brush.into());
        }
    }
}

pub struct FeedbackPanel {
    pub hwnd: HWND,
    title: HWND,
    detail: HWND,
    retry: HWND,
    font: HFONT,
    font_dpi: u32,
    detail_text: String,
    // Stable address until the child HWND has been destroyed.
    paint: Box<PaintState>,
}

impl FeedbackPanel {
    pub fn new(
        parent: HWND,
        appearance: Option<NativeRdpAppearance>,
    ) -> windows::core::Result<Self> {
        unsafe {
            let colors = appearance.unwrap_or_else(|| NativeRdpAppearance {
                panel: GetSysColor(COLOR_WINDOW),
                text: GetSysColor(COLOR_WINDOWTEXT),
                muted: GetSysColor(COLOR_WINDOWTEXT),
                line: GetSysColor(COLOR_WINDOWFRAME),
                primary: GetSysColor(COLOR_HIGHLIGHT),
                danger: GetSysColor(COLOR_WINDOWTEXT),
                reduced_motion: true,
            });
            let mut paint = Box::new(PaintState {
                brush: CreateSolidBrush(COLORREF(colors.panel)),
                colors,
                frame: 0,
                waiting: true,
            });
            let instance = GetModuleHandleW(None)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: instance.into(),
                lpszClassName: w!("mXtermRdpConnectionFeedback"),
                hCursor: LoadCursorW(None, IDC_ARROW)?,
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_CONTROLPARENT,
                class.lpszClassName,
                w!("远程桌面连接状态"),
                WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                0,
                0,
                1,
                1,
                Some(parent),
                None,
                Some(instance.into()),
                None,
            )?;
            SetWindowLongPtrW(
                hwnd,
                GWLP_USERDATA,
                paint.as_mut() as *mut PaintState as isize,
            );
            let child = |class, text, style, id| {
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    class,
                    text,
                    WS_CHILD | WS_VISIBLE | style,
                    0,
                    0,
                    1,
                    1,
                    Some(hwnd),
                    Some(HMENU(id as *mut _)),
                    Some(instance.into()),
                    None,
                )
            };
            // Construct the owner before any fallible child creation so partial failures clean up.
            let mut panel = Self {
                hwnd,
                title: HWND::default(),
                detail: HWND::default(),
                retry: HWND::default(),
                font: HFONT::default(),
                font_dpi: 0,
                detail_text: String::new(),
                paint,
            };
            panel.title = child(
                w!("STATIC"),
                w!("正在连接远程桌面…"),
                WINDOW_STYLE::default(),
                1,
            )?;
            panel.detail = child(w!("STATIC"), w!(""), WINDOW_STYLE::default(), 2)?;
            panel.retry = child(
                w!("BUTTON"),
                w!("重试连接 (&R)"),
                WS_TABSTOP | WINDOW_STYLE(BS_OWNERDRAW as u32),
                3,
            )?;
            Ok(panel)
        }
    }

    pub fn reduced_motion(&self) -> bool {
        self.paint.colors.reduced_motion
    }

    pub fn update(&mut self, parent: HWND, state: &ConnectionState, active: bool) {
        unsafe {
            let visible = active && state.visible();
            if !visible {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
                return;
            }
            let Some((x, y, width, height)) = super::rdp_content_rect_for_window(parent) else {
                return;
            };
            let dpi = window_dpi_for_window(parent);
            let dip = |v| scale_dip_value(v, dpi);
            let stopped = matches!(state.phase, Phase::Stopped(_));
            let panel_width = dip(400).min((width - dip(24)).max(1));
            let panel_height = dip(if stopped { 142 } else { 96 }).min(height.max(1));
            // Leave the remote sign-in controls accessible after transport connection.
            let panel_y = if matches!(state.phase, Phase::SigningIn | Phase::Reconnecting) {
                dip(12)
            } else {
                (height - panel_height) / 2
            };
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_TOP),
                x + (width - panel_width) / 2,
                y + panel_y,
                panel_width,
                panel_height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            if self.font_dpi != dpi {
                let font = CreateFontW(
                    -dip(12),
                    0,
                    0,
                    0,
                    FW_NORMAL.0 as i32,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    CLEARTYPE_QUALITY,
                    DEFAULT_PITCH.0 as u32,
                    w!("Microsoft YaHei UI"),
                );
                for child in [self.title, self.detail, self.retry] {
                    SendMessageW(
                        child,
                        WM_SETFONT,
                        Some(WPARAM(font.0 as usize)),
                        Some(LPARAM(1)),
                    );
                }
                if !self.font.is_invalid() {
                    let _ = DeleteObject(self.font.into());
                }
                self.font = font;
                self.font_dpi = dpi;
            }
            self.paint.waiting = state.waiting();
            let inset = if stopped { dip(16) } else { dip(48) };
            let _ = MoveWindow(
                self.title,
                inset,
                dip(18),
                (panel_width - inset - dip(16)).max(1),
                dip(32),
                true,
            );
            let _ = MoveWindow(
                self.detail,
                dip(16),
                dip(56),
                (panel_width - dip(32)).max(1),
                dip(32),
                true,
            );
            let _ = MoveWindow(self.retry, dip(16), dip(100), dip(124), dip(28), true);
            let _ = SetWindowTextW(self.title, PCWSTR(to_wide_null(state.title()).as_ptr()));
            let _ = SetWindowTextW(self.detail, PCWSTR(to_wide_null(state.detail()).as_ptr()));
            self.detail_text = state.detail().to_string();
            let _ = ShowWindow(self.retry, if stopped { SW_SHOW } else { SW_HIDE });
            let _ = InvalidateRect(Some(self.hwnd), None, false);
        }
    }

    pub fn tick(&mut self, state: &ConnectionState) {
        if self.detail_text != state.detail() {
            self.detail_text = state.detail().to_string();
            unsafe {
                let _ = SetWindowTextW(
                    self.detail,
                    PCWSTR(to_wide_null(&self.detail_text).as_ptr()),
                );
            }
        }
        if self.reduced_motion() {
            return;
        }
        self.paint.frame = (self.paint.frame + 1) % 12;
        let dpi = window_dpi_for_window(self.hwnd);
        let rect = RECT {
            left: scale_dip_value(12, dpi),
            top: scale_dip_value(14, dpi),
            right: scale_dip_value(44, dpi),
            bottom: scale_dip_value(46, dpi),
        };
        unsafe {
            let _ = InvalidateRect(Some(self.hwnd), Some(&rect), false);
        }
    }

    pub fn handle_keyboard(&self, message: &MSG) -> bool {
        unsafe {
            IsWindowVisible(self.retry).as_bool() && IsDialogMessageW(self.hwnd, message).as_bool()
        }
    }
}

impl Drop for FeedbackPanel {
    fn drop(&mut self) {
        unsafe {
            // WM_NCDESTROY also clears userdata when Windows destroys the parent first.
            if GetWindowLongPtrW(self.hwnd, GWLP_USERDATA)
                == self.paint.as_ref() as *const PaintState as isize
            {
                let _ = DestroyWindow(self.hwnd);
            }
            if !self.font.is_invalid() {
                let _ = DeleteObject(self.font.into());
            }
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut PaintState;
        if message == WM_NCDESTROY {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        }
        if !state_ptr.is_null() {
            let state = &*state_ptr;
            if message == WM_COMMAND && (wp.0 & 0xffff) == 3 {
                if let Ok(parent) = GetParent(hwnd) {
                    let _ = PostMessageW(
                        Some(parent),
                        RETRY_MESSAGE,
                        WPARAM(0),
                        LPARAM(hwnd.0 as isize),
                    );
                }
                return LRESULT(0);
            }
            if message == WM_CTLCOLORSTATIC {
                let dc = HDC(wp.0 as *mut _);
                let color = if GetDlgCtrlID(HWND(lp.0 as *mut _)) == 1 {
                    if state.waiting {
                        state.colors.text
                    } else {
                        state.colors.danger
                    }
                } else {
                    state.colors.muted
                };
                SetTextColor(dc, COLORREF(color));
                SetBkColor(dc, COLORREF(state.colors.panel));
                return LRESULT(state.brush.0 as isize);
            }
            if message == WM_DRAWITEM {
                let item = &*(lp.0 as *const DRAWITEMSTRUCT);
                let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
                let fill = CreateSolidBrush(COLORREF(if pressed {
                    state.colors.line
                } else {
                    state.colors.panel
                }));
                FillRect(item.hDC, &item.rcItem, fill);
                let _ = DeleteObject(fill.into());
                let border = CreateSolidBrush(COLORREF(state.colors.line));
                FrameRect(item.hDC, &item.rcItem, border);
                let _ = DeleteObject(border.into());
                SetTextColor(item.hDC, COLORREF(state.colors.text));
                SetBkMode(item.hDC, TRANSPARENT);
                let font = SendMessageW(item.hwndItem, WM_GETFONT, None, None);
                let old_font = SelectObject(item.hDC, HGDIOBJ(font.0 as *mut _));
                let mut rect = item.rcItem;
                DrawTextW(
                    item.hDC,
                    &mut to_wide_null("重试连接 (&R)"),
                    &mut rect,
                    DT_CENTER | DT_VCENTER | DT_SINGLELINE,
                );
                if item.itemState.0 & ODS_FOCUS.0 != 0 {
                    let _ = InflateRect(&mut rect, -3, -3);
                    let _ = DrawFocusRect(item.hDC, &rect);
                }
                SelectObject(item.hDC, old_font);
                return LRESULT(1);
            }
            if message == WM_ERASEBKGND {
                return LRESULT(1);
            }
            if message == WM_PAINT {
                let mut ps = PAINTSTRUCT::default();
                let dc = BeginPaint(hwnd, &mut ps);
                let mut rect = RECT::default();
                let _ = GetClientRect(hwnd, &mut rect);
                FillRect(dc, &ps.rcPaint, state.brush);
                let border = CreateSolidBrush(COLORREF(state.colors.line));
                FrameRect(dc, &rect, border);
                let _ = DeleteObject(border.into());
                if state.waiting {
                    let dpi = window_dpi_for_window(hwnd);
                    let dip = |v| scale_dip_value(v, dpi);
                    for segment in 0..12 {
                        let color = if (segment + 12 - state.frame) % 12 < 4 {
                            state.colors.primary
                        } else {
                            state.colors.line
                        };
                        let pen = CreatePen(PS_SOLID, dip(2).max(1), COLORREF(color));
                        let old = SelectObject(dc, pen.into());
                        let angle = segment as f64 * std::f64::consts::TAU / 12.0;
                        let _ = MoveToEx(
                            dc,
                            dip(28) + (angle.cos() * dip(7) as f64) as i32,
                            dip(28) + (angle.sin() * dip(7) as f64) as i32,
                            None,
                        );
                        let _ = LineTo(
                            dc,
                            dip(28) + (angle.cos() * dip(11) as f64) as i32,
                            dip(28) + (angle.sin() * dip(11) as f64) as i32,
                        );
                        SelectObject(dc, old);
                        let _ = DeleteObject(pen.into());
                    }
                }
                let _ = EndPaint(hwnd, &ps);
                return LRESULT(0);
            }
        }
        DefWindowProcW(hwnd, message, wp, lp)
    }
}

#[cfg(test)]
mod tests {
    use super::super::connection_state::ConnectionEvent;
    use super::*;
    use std::time::{Duration, Instant};

    fn pump_messages() {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    #[test]
    #[ignore = "Creates a local native preview window; no remote connection"]
    fn native_feedback_visibility_retry_and_reduced_motion() {
        // Fixtures match the default light/dark global tokens; production receives resolved CSS values.
        let themes = [
            NativeRdpAppearance {
                panel: 0xffffff,
                text: 0x2a2420,
                muted: 0x786b62,
                line: 0xe7e1dd,
                primary: 0xc67423,
                danger: 0x2626dc,
                reduced_motion: false,
            },
            NativeRdpAppearance {
                panel: 0x211b17,
                text: 0xeee9e6,
                muted: 0xb9ada4,
                line: 0x39302a,
                primary: 0xffb773,
                danger: 0x9b8fff,
                reduced_motion: true,
            },
        ];
        unsafe {
            let parent = CreateWindowExW(
                WS_EX_APPWINDOW,
                w!("STATIC"),
                w!("mXterm RDP feedback check"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN,
                120,
                120,
                800,
                560,
                None,
                None,
                Some(GetModuleHandleW(None).unwrap().into()),
                None,
            )
            .unwrap();
            struct Window(HWND);
            impl Drop for Window {
                fn drop(&mut self) {
                    unsafe {
                        let _ = DestroyWindow(self.0);
                    }
                }
            }
            let _window = Window(parent);
            for theme in themes {
                let reduced = theme.reduced_motion;
                let mut panel = FeedbackPanel::new(parent, Some(theme)).unwrap();
                let mut state = ConnectionState::new();
                for event in [
                    ConnectionEvent::Connecting,
                    ConnectionEvent::Connected,
                    ConnectionEvent::Disconnected {
                        reason: 3,
                        extended: Some(7),
                    },
                ] {
                    state.apply(event);
                    panel.update(parent, &state, true);
                    pump_messages();
                    assert!(IsWindowVisible(panel.hwnd).as_bool());
                    let frame = panel.paint.frame;
                    panel.tick(&state);
                    assert_eq!(panel.paint.frame == frame, reduced);
                    // Optional visual acceptance uses the screenshot skill's helper, outside normal test runs.
                    if let Ok(script) = std::env::var("MX_RDP_FEEDBACK_SCREENSHOT_SCRIPT") {
                        let _ = SetWindowPos(
                            parent,
                            Some(HWND_TOPMOST),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                        let until = Instant::now() + Duration::from_millis(250);
                        while Instant::now() < until {
                            pump_messages();
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        let mut capture = std::process::Command::new("powershell")
                            .args([
                                "-NoProfile",
                                "-ExecutionPolicy",
                                "Bypass",
                                "-File",
                                &script,
                                "-Mode",
                                "temp",
                                "-WindowHandle",
                                &(panel.hwnd.0 as usize).to_string(),
                            ])
                            .stdout(std::process::Stdio::piped())
                            .stderr(std::process::Stdio::piped())
                            .spawn()
                            .unwrap();
                        let deadline = Instant::now() + Duration::from_secs(15);
                        while capture.try_wait().unwrap().is_none() {
                            if Instant::now() >= deadline {
                                let _ = capture.kill();
                                panic!("Native feedback capture timed out");
                            }
                            pump_messages();
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        let output = capture.wait_with_output().unwrap();
                        assert!(
                            output.status.success(),
                            "{}",
                            String::from_utf8_lossy(&output.stderr)
                        );
                        eprintln!(
                            "feedback capture reduced={reduced} {:?}: {}",
                            state.phase,
                            String::from_utf8_lossy(&output.stdout)
                        );
                    }
                }
                assert!(IsWindowVisible(panel.retry).as_bool());
                SendMessageW(panel.retry, BM_CLICK, None, None);
                let mut msg = MSG::default();
                assert!(PeekMessageW(
                    &mut msg,
                    Some(parent),
                    RETRY_MESSAGE,
                    RETRY_MESSAGE,
                    PM_REMOVE
                )
                .as_bool());
                assert_eq!(msg.lParam.0, panel.hwnd.0 as isize);
                state = ConnectionState::new();
                panel.update(parent, &state, false);
                assert!(!IsWindowVisible(panel.hwnd).as_bool());
                state.apply(ConnectionEvent::Dialog(true));
                panel.update(parent, &state, true);
                assert!(!IsWindowVisible(panel.hwnd).as_bool());
                state.apply(ConnectionEvent::Dialog(false));
                panel.update(parent, &state, true);
                assert!(IsWindowVisible(panel.hwnd).as_bool());
                state.apply(ConnectionEvent::LoginComplete);
                panel.update(parent, &state, true);
                assert!(!IsWindowVisible(panel.hwnd).as_bool());
            }
        }
    }
}
