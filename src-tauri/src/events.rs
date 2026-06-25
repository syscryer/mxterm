#![allow(dead_code)]

use serde::Serialize;

pub const TERMINAL_OUTPUT: &str = "terminal:output";
pub const TERMINAL_STATE_CHANGED: &str = "terminal:state_changed";
pub const TERMINAL_CONNECT_PROGRESS: &str = "terminal:connect_progress";
pub const TERMINAL_ERROR: &str = "terminal:error";
pub const REMOTE_FILE_TRANSFER_PROGRESS: &str = "remote_file:transfer_progress";
pub const DOCKER_IMAGE_PULL_PROGRESS: &str = "docker:image_pull_progress";
pub const RDP_SESSION_CLOSED: &str = "rdp:session_closed";

#[derive(Clone, Debug, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub request_id: Option<String>,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalStateChangedEvent {
    pub session_id: String,
    pub request_id: Option<String>,
    pub state: String,
    pub exit_status: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TerminalConnectProgressEvent {
    pub request_id: String,
    pub stage: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RemoteFileTransferProgressEvent {
    pub transfer_id: String,
    pub direction: String,
    pub loaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DockerImagePullProgressEvent {
    pub pull_id: String,
    pub connection_id: String,
    pub image: String,
    pub status: String,
    pub message: String,
    pub percent: Option<u8>,
    pub current_layer: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RdpSessionClosedEvent {
    pub session_id: String,
}
