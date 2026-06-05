#![allow(dead_code)]

use serde::Serialize;

pub const TERMINAL_OUTPUT: &str = "terminal.output";
pub const TERMINAL_STATE_CHANGED: &str = "terminal.state_changed";
pub const TERMINAL_CONNECT_PROGRESS: &str = "terminal.connect_progress";
pub const TERMINAL_ERROR: &str = "terminal.error";

#[derive(Clone, Debug, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalStateChangedEvent {
    pub session_id: String,
    pub state: String,
    pub exit_status: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalConnectProgressEvent {
    pub request_id: String,
    pub stage: String,
    pub message: String,
}
