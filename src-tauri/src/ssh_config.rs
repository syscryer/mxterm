use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::app_error::AppError;
use crate::connections::{
    validate_profile_input, ConnectionAuthKind, ConnectionCredentialMode, ConnectionProfile,
    ConnectionProfileInput, ConnectionStore,
};
use crate::credentials::{CredentialProfile, CredentialStore};
use crate::known_hosts::HostKeyInfo;

#[derive(Clone, Debug, Default)]
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
    pub proxy: crate::connections::ConnectionProxyConfig,
    pub jump: crate::connections::ConnectionJumpConfig,
    pub advanced: crate::connections::ConnectionAdvancedConfig,
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
    let profile = load_connection_profile(app, connection_id)?;
    resolve_profile(app, profile, prompt)
}

pub fn resolve_transient_connection(
    app: &AppHandle,
    input: ConnectionProfileInput,
) -> Result<ResolvedSshConfig, AppError> {
    let validated = validate_profile_input(&input)?;
    let profile = ConnectionProfile {
        id: "__transient_connection_test__".to_string(),
        name: validated.name,
        group: validated.group,
        host: validated.host,
        port: validated.port,
        username: validated.username,
        credential_mode: validated.credential_mode,
        credential_id: validated.credential_id,
        inline_auth_kind: validated.inline_auth_kind,
        inline_password: validated.inline_password,
        inline_private_key_path: validated.inline_private_key_path,
        inline_private_key_passphrase: validated.inline_private_key_passphrase,
        prompt_auth_kind: validated.prompt_auth_kind,
        proxy: validated.proxy,
        jump: validated.jump,
        advanced: validated.advanced,
        notes: validated.notes,
        is_favorite: false,
        last_connected_at: None,
        remote_os_id: None,
        remote_os_name: None,
        remote_os_version: None,
        created_at: String::new(),
        updated_at: String::new(),
        auth_kind: None,
        password: None,
        private_key_path: None,
        private_key_passphrase: None,
    };

    resolve_profile(app, profile, None)
}

pub fn load_connection_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<ConnectionProfile, AppError> {
    let store = ConnectionStore::load(connection_store_path(app)?)?;
    store.get(connection_id).ok_or_else(|| {
        AppError::new(
            "connection_missing",
            "连接不存在。",
            format!("connection_id={connection_id}"),
            false,
        )
    })
}

pub fn connection_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "connection_store_path_failed",
            "连接仓库路径获取失败。",
            error,
            true,
        )
    })?;
    Ok(app_data_dir.join("connections.json"))
}

pub fn credential_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "credential_store_path_failed",
            "凭据仓库路径获取失败。",
            error,
            true,
        )
    })?;
    Ok(app_data_dir.join("credentials.json"))
}

pub fn known_host_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(
            "known_host_store_path_failed",
            "主机密钥仓库路径获取失败。",
            error,
            true,
        )
    })?;
    Ok(app_data_dir.join("known_hosts.json"))
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

fn resolve_profile(
    app: &AppHandle,
    profile: ConnectionProfile,
    prompt: Option<RuntimeCredentialInput>,
) -> Result<ResolvedSshConfig, AppError> {
    let (auth_kind, password, private_key_path, private_key_passphrase) =
        match profile.credential_mode {
            ConnectionCredentialMode::Saved => {
                let credential_id = profile.credential_id.as_deref().ok_or_else(|| {
                    AppError::new(
                        "connection_credential_missing",
                        "连接缺少保存的凭据。",
                        format!("connection_id={}", profile.id),
                        true,
                    )
                })?;
                let store = CredentialStore::load(credential_store_path(app)?)?;
                let credential = store.get(credential_id).ok_or_else(|| {
                    AppError::new(
                        "credential_missing",
                        "连接引用的凭据不存在。",
                        format!("credential_id={credential_id}"),
                        true,
                    )
                })?;
                credential_parts(credential)
            }
            ConnectionCredentialMode::Inline => {
                let auth_kind = profile.inline_auth_kind.clone().ok_or_else(|| {
                    AppError::new(
                        "terminal_auth_missing",
                        "连接缺少认证方式。",
                        format!("connection_id={}", profile.id),
                        true,
                    )
                })?;
                (
                    auth_kind,
                    profile.inline_password,
                    profile.inline_private_key_path,
                    profile.inline_private_key_passphrase,
                )
            }
            ConnectionCredentialMode::Prompt => {
                let prompt = prompt.ok_or_else(|| {
                    AppError::new(
                        "credential_prompt_required",
                        "请输入本次连接凭据。",
                        format!("connection_id={}", profile.id),
                        true,
                    )
                })?;
                let auth_kind = prompt
                    .auth_kind
                    .or(profile.prompt_auth_kind)
                    .unwrap_or(ConnectionAuthKind::Password);
                (
                    auth_kind,
                    prompt.password,
                    prompt.private_key_path,
                    prompt.private_key_passphrase,
                )
            }
        };

    validate_auth_material(
        &auth_kind,
        password.as_ref(),
        private_key_path.as_ref(),
        "terminal_auth_missing",
    )?;

    let (password, private_key_path, private_key_passphrase) = match auth_kind {
        ConnectionAuthKind::Password => (password, None, None),
        ConnectionAuthKind::PrivateKey => (None, private_key_path, private_key_passphrase),
    };

    Ok(ResolvedSshConfig {
        connection_id: profile.id,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        auth_kind,
        password,
        private_key_path,
        private_key_passphrase,
        proxy: profile.proxy,
        jump: profile.jump,
        advanced: profile.advanced,
    })
}

fn credential_parts(
    credential: CredentialProfile,
) -> (
    ConnectionAuthKind,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    (
        credential.kind,
        credential.password,
        credential.private_key_path,
        credential.private_key_passphrase,
    )
}

fn validate_auth_material(
    auth_kind: &ConnectionAuthKind,
    password: Option<&String>,
    private_key_path: Option<&String>,
    code: &str,
) -> Result<(), AppError> {
    match auth_kind {
        ConnectionAuthKind::Password if password.is_none_or(|value| value.trim().is_empty()) => {
            Err(AppError::new(
                code,
                "请填写密码或选择私钥。",
                "password is empty",
                true,
            ))
        }
        ConnectionAuthKind::PrivateKey
            if private_key_path.is_none_or(|value| value.trim().is_empty()) =>
        {
            Err(AppError::new(
                code,
                "请填写密码或选择私钥。",
                "private_key_path is empty",
                true,
            ))
        }
        _ => Ok(()),
    }
}
