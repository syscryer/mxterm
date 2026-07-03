use serde::Deserialize;
use tauri::AppHandle;

use crate::app_error::AppError;
use crate::connections::{
    validate_profile_input, ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionJumpConfig,
    ConnectionProfile, ConnectionProfileInput, ConnectionProxyConfig,
};
use crate::known_hosts::HostKeyInfo;
use crate::storage_repository::StorageRepository;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RuntimeCredentialInput {
    pub auth_kind: Option<ConnectionAuthKind>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ResolvedSshConfig {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: ConnectionAuthKind,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub proxy: ConnectionProxyConfig,
    pub jump: ConnectionJumpConfig,
    pub advanced: ConnectionAdvancedConfig,
}

impl ResolvedSshConfig {
    pub fn signature(&self) -> String {
        format!(
            "{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
            self.host,
            self.port,
            self.username,
            self.auth_kind,
            self.password,
            self.private_key_path,
            self.private_key_passphrase,
            self.proxy,
            self.jump,
            self.advanced,
        )
    }
}

pub fn resolve_saved_connection(
    app: &AppHandle,
    connection_id: &str,
    prompt: Option<RuntimeCredentialInput>,
) -> Result<ResolvedSshConfig, AppError> {
    StorageRepository::open_app(app)?.resolve_saved_connection(connection_id, prompt)
}

pub fn resolve_transient_connection(
    app: &AppHandle,
    input: ConnectionProfileInput,
) -> Result<ResolvedSshConfig, AppError> {
    validate_profile_input(&input)?;
    StorageRepository::open_app(app)?.resolve_transient_connection(input)
}

pub fn load_connection_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ConnectionProfile, AppError> {
    StorageRepository::open_app(app)?
        .connection_get(connection_id)?
        .ok_or_else(|| {
            AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={connection_id}"),
                false,
            )
        })
}

pub fn app_error_for_host_key_unknown(host_key: &HostKeyInfo) -> AppError {
    AppError::new(
        "host_key_unknown",
        "首次连接该主机，需要确认主机密钥。",
        serde_json::to_string(host_key).unwrap_or_else(|_| host_key.fingerprint_sha256.clone()),
        true,
    )
}

pub fn app_error_for_host_key_changed(current: &str, host_key: &HostKeyInfo) -> AppError {
    AppError::new(
        "host_key_changed",
        "主机密钥已变化，连接已阻断。",
        serde_json::json!({
            "old_fingerprint_sha256": current,
            "host_key": host_key,
        })
        .to_string(),
        true,
    )
}
