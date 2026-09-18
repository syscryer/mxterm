use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionEvent {
    Connecting,
    Connected,
    LoginComplete,
    Disconnected { reason: i32, extended: Option<i32> },
    Fatal(i32),
    Reconnecting,
    Reconnected,
    Dialog(bool),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    Connecting,
    SigningIn,
    Reconnecting,
    Ready,
    Stopped(String),
}

pub struct ConnectionState {
    pub phase: Phase,
    pub dialog_visible: bool,
    started: Instant,
}

impl ConnectionState {
    pub fn new() -> Self {
        Self {
            phase: Phase::Connecting,
            dialog_visible: false,
            started: Instant::now(),
        }
    }

    pub fn apply(&mut self, event: ConnectionEvent) {
        match event {
            ConnectionEvent::Connecting => {
                if !self.waiting() {
                    self.started = Instant::now();
                }
                self.phase = Phase::Connecting;
                self.dialog_visible = false;
            }
            ConnectionEvent::Connected => {
                if self.waiting() {
                    self.phase = Phase::SigningIn;
                }
            }
            ConnectionEvent::LoginComplete | ConnectionEvent::Reconnected => {
                if self.waiting() {
                    self.phase = Phase::Ready;
                }
                self.dialog_visible = false;
            }
            ConnectionEvent::Disconnected { reason, extended } => {
                // A later disconnect must not overwrite the more specific fatal error.
                if !matches!(self.phase, Phase::Stopped(_)) {
                    self.phase = Phase::Stopped(match extended {
                        Some(code) => format!("连接已断开（原因 {reason}，扩展 {code}）"),
                        None => format!("连接已断开（原因 {reason}）"),
                    });
                }
                self.dialog_visible = false;
            }
            ConnectionEvent::Fatal(code) => {
                self.phase = Phase::Stopped(format!("连接失败（错误 {code}）"));
                self.dialog_visible = false;
            }
            ConnectionEvent::Reconnecting => {
                if self.phase != Phase::Reconnecting {
                    self.started = Instant::now();
                }
                self.phase = Phase::Reconnecting;
            }
            ConnectionEvent::Dialog(visible) => self.dialog_visible = visible,
        }
    }

    pub fn waiting(&self) -> bool {
        matches!(
            self.phase,
            Phase::Connecting | Phase::SigningIn | Phase::Reconnecting
        )
    }

    pub fn visible(&self) -> bool {
        !self.dialog_visible && self.phase != Phase::Ready
    }

    pub fn display_ready(&self) -> bool {
        self.phase == Phase::Ready
    }

    pub fn title(&self) -> &str {
        match &self.phase {
            Phase::Connecting => "正在连接远程桌面…",
            Phase::SigningIn => "已连接，等待登录完成…",
            Phase::Reconnecting => "连接中断，正在重新连接…",
            Phase::Ready => "",
            Phase::Stopped(message) => message,
        }
    }

    pub fn detail(&self) -> &str {
        if !self.waiting() {
            return "可重试连接，或关闭当前标签页。";
        }
        if self.started.elapsed() >= Duration::from_secs(20) {
            "等待时间较长，请检查远端登录或认证提示。"
        } else {
            "请稍候，可通过标签页关闭按钮取消。"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slow_connections_wait_for_login_event() {
        let mut state = ConnectionState::new();
        state.started = Instant::now() - Duration::from_secs(60);
        state.apply(ConnectionEvent::Connected);
        assert!(!state.display_ready());
        assert!(state.visible());
        assert!(state.waiting());
        assert!(state.detail().contains("等待时间较长"));
        state.apply(ConnectionEvent::LoginComplete);
        assert!(state.display_ready());
        assert!(!state.visible());
    }

    #[test]
    fn dialogs_restore_pending_feedback_and_fatal_reason_survives_disconnect() {
        let mut state = ConnectionState::new();
        state.apply(ConnectionEvent::Dialog(true));
        assert!(!state.visible());
        state.apply(ConnectionEvent::Dialog(false));
        assert!(state.visible());
        state.apply(ConnectionEvent::Fatal(7));
        state.apply(ConnectionEvent::Disconnected {
            reason: 0,
            extended: None,
        });
        state.apply(ConnectionEvent::LoginComplete);
        assert_eq!(state.title(), "连接失败（错误 7）");
        assert!(!state.waiting());
    }

    #[test]
    fn reconnect_has_its_own_lifecycle() {
        let mut state = ConnectionState::new();
        state.apply(ConnectionEvent::LoginComplete);
        state.apply(ConnectionEvent::Reconnecting);
        assert!(state.visible());
        state.apply(ConnectionEvent::Reconnected);
        assert!(!state.visible());
        state.apply(ConnectionEvent::Disconnected {
            reason: 3,
            extended: Some(5),
        });
        assert!(state.title().contains("原因 3，扩展 5"));
        state.apply(ConnectionEvent::Connecting);
        assert!(state.waiting());
    }
}
