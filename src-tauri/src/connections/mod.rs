use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::storage::{load_json_document, write_json_document, JsonStoreErrorLabels};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionAuthKind {
    Password,
    PrivateKey,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionCredentialMode {
    Saved,
    Inline,
    Prompt,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionProxyKind {
    None,
    HttpConnect,
    Socks5,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionJumpKind {
    None,
    SshJump,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionProxyConfig {
    pub kind: ConnectionProxyKind,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

impl Default for ConnectionProxyConfig {
    fn default() -> Self {
        Self {
            kind: ConnectionProxyKind::None,
            host: None,
            port: None,
            username: None,
            password: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionJumpConfig {
    pub kind: ConnectionJumpKind,
    #[serde(default)]
    pub jump_connection_id: Option<String>,
}

impl Default for ConnectionJumpConfig {
    fn default() -> Self {
        Self {
            kind: ConnectionJumpKind::None,
            jump_connection_id: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionAdvancedConfig {
    pub connect_timeout_ms: u64,
    pub auth_timeout_ms: u64,
    pub keepalive_interval_ms: u64,
    #[serde(default = "default_terminal_encoding")]
    pub terminal_encoding: String,
}

impl Default for ConnectionAdvancedConfig {
    fn default() -> Self {
        Self {
            connect_timeout_ms: 30_000,
            auth_timeout_ms: 45_000,
            keepalive_interval_ms: 20_000,
            terminal_encoding: default_terminal_encoding(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default = "default_credential_mode")]
    pub credential_mode: ConnectionCredentialMode,
    #[serde(default)]
    pub credential_id: Option<String>,
    #[serde(default)]
    pub inline_auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub inline_password: Option<String>,
    #[serde(default)]
    pub inline_private_key_path: Option<String>,
    #[serde(default)]
    pub inline_private_key_passphrase: Option<String>,
    #[serde(default)]
    pub prompt_auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub proxy: ConnectionProxyConfig,
    #[serde(default)]
    pub jump: ConnectionJumpConfig,
    #[serde(default)]
    pub advanced: ConnectionAdvancedConfig,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub is_favorite: Option<bool>,
    #[serde(default)]
    pub last_connected_at: Option<String>,
    #[serde(default)]
    pub remote_os_id: Option<String>,
    #[serde(default)]
    pub remote_os_name: Option<String>,
    #[serde(default)]
    pub remote_os_version: Option<String>,
    #[serde(default)]
    pub auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedConnectionProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential_mode: ConnectionCredentialMode,
    pub credential_id: Option<String>,
    pub inline_auth_kind: Option<ConnectionAuthKind>,
    pub inline_password: Option<String>,
    pub inline_private_key_path: Option<String>,
    pub inline_private_key_passphrase: Option<String>,
    pub prompt_auth_kind: Option<ConnectionAuthKind>,
    pub proxy: ConnectionProxyConfig,
    pub jump: ConnectionJumpConfig,
    pub advanced: ConnectionAdvancedConfig,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default = "default_credential_mode")]
    pub credential_mode: ConnectionCredentialMode,
    #[serde(default)]
    pub credential_id: Option<String>,
    #[serde(default)]
    pub inline_auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub inline_password: Option<String>,
    #[serde(default)]
    pub inline_private_key_path: Option<String>,
    #[serde(default)]
    pub inline_private_key_passphrase: Option<String>,
    #[serde(default)]
    pub prompt_auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub proxy: ConnectionProxyConfig,
    #[serde(default)]
    pub jump: ConnectionJumpConfig,
    #[serde(default)]
    pub advanced: ConnectionAdvancedConfig,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default)]
    pub last_connected_at: Option<String>,
    #[serde(default)]
    pub remote_os_id: Option<String>,
    #[serde(default)]
    pub remote_os_name: Option<String>,
    #[serde(default)]
    pub remote_os_version: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub auth_kind: Option<ConnectionAuthKind>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConnectionRemoteSystemInfo {
    pub os_id: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
}

impl ConnectionRemoteSystemInfo {
    pub fn is_empty(&self) -> bool {
        self.os_id.is_none() && self.os_name.is_none() && self.os_version.is_none()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ConnectionStoreDocument {
    version: u16,
    profiles: Vec<ConnectionProfile>,
}

pub struct ConnectionStore {
    path: PathBuf,
    document: ConnectionStoreDocument,
}

fn connection_store_error_labels() -> JsonStoreErrorLabels {
    JsonStoreErrorLabels {
        create_dir_code: "connection_store_create_dir_failed",
        create_dir_message: "连接仓库目录创建失败。",
        parse_code: "connection_store_parse_failed",
        parse_message: "连接仓库文件格式无效。",
        read_code: "connection_store_read_failed",
        read_message: "连接仓库读取失败。",
        serialize_code: "connection_store_serialize_failed",
        serialize_message: "连接仓库序列化失败。",
        write_code: "connection_store_write_failed",
        write_message: "连接仓库写入失败。",
    }
}

impl ConnectionStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = load_json_document(
            &path,
            || ConnectionStoreDocument {
                version: 2,
                profiles: Vec::new(),
            },
            connection_store_error_labels(),
        )?;
        document.version = 2;
        document.profiles = document
            .profiles
            .into_iter()
            .map(migrate_profile)
            .collect::<Vec<_>>();

        Ok(Self { path, document })
    }

    pub fn list(&self) -> Vec<ConnectionProfile> {
        self.document.profiles.clone()
    }

    pub fn get(&self, id: &str) -> Option<ConnectionProfile> {
        self.document
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
    }

    pub fn upsert(
        &mut self,
        input: ConnectionProfileInput,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let validated = validate_profile_input(&input)?;
        let id = validated
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let existing_index = self
            .document
            .profiles
            .iter()
            .position(|profile| profile.id == id);
        let existing_profile = existing_index.and_then(|index| self.document.profiles.get(index));
        let created_at = existing_profile
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| now.to_string());
        let is_favorite = input.is_favorite.unwrap_or_else(|| {
            existing_profile
                .map(|profile| profile.is_favorite)
                .unwrap_or(false)
        });
        let last_connected_at = trim_optional(input.last_connected_at.as_ref())
            .or_else(|| existing_profile.and_then(|profile| profile.last_connected_at.clone()));
        let target_unchanged = existing_profile.is_some_and(|profile| {
            profile.host == validated.host
                && profile.port == validated.port
                && profile.username == validated.username
        });
        let remote_os_id = trim_optional(input.remote_os_id.as_ref()).or_else(|| {
            target_unchanged
                .then(|| existing_profile.and_then(|profile| profile.remote_os_id.clone()))
                .flatten()
        });
        let remote_os_name = trim_optional(input.remote_os_name.as_ref()).or_else(|| {
            target_unchanged
                .then(|| existing_profile.and_then(|profile| profile.remote_os_name.clone()))
                .flatten()
        });
        let remote_os_version = trim_optional(input.remote_os_version.as_ref()).or_else(|| {
            target_unchanged
                .then(|| existing_profile.and_then(|profile| profile.remote_os_version.clone()))
                .flatten()
        });

        let profile = ConnectionProfile {
            id,
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
            is_favorite,
            last_connected_at,
            remote_os_id,
            remote_os_name,
            remote_os_version,
            created_at,
            updated_at: now.to_string(),
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        };

        if let Some(index) = existing_index {
            self.document.profiles[index] = profile.clone();
        } else {
            self.document.profiles.push(profile.clone());
        }

        self.save()?;
        Ok(profile)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), AppError> {
        let original_len = self.document.profiles.len();
        self.document.profiles.retain(|profile| profile.id != id);
        if self.document.profiles.len() == original_len {
            return Err(AppError::new(
                "connection_missing",
                "连接不存在。",
                format!("connection_id={id}"),
                false,
            ));
        }

        self.save()
    }

    pub fn set_favorite(
        &mut self,
        id: &str,
        is_favorite: bool,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let index = self
            .document
            .profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "connection_missing",
                    "连接不存在。",
                    format!("connection_id={id}"),
                    false,
                )
            })?;

        self.document.profiles[index].is_favorite = is_favorite;
        self.document.profiles[index].updated_at = now.to_string();
        let profile = self.document.profiles[index].clone();
        self.save()?;
        Ok(profile)
    }

    pub fn mark_connected(&mut self, id: &str, now: &str) -> Result<ConnectionProfile, AppError> {
        let index = self
            .document
            .profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "connection_missing",
                    "连接不存在。",
                    format!("connection_id={id}"),
                    false,
                )
            })?;

        self.document.profiles[index].last_connected_at = Some(now.to_string());
        let profile = self.document.profiles[index].clone();
        self.save()?;
        Ok(profile)
    }

    pub fn update_remote_system(
        &mut self,
        id: &str,
        system: ConnectionRemoteSystemInfo,
        now: &str,
    ) -> Result<ConnectionProfile, AppError> {
        let index = self
            .document
            .profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| {
                AppError::new(
                    "connection_missing",
                    "连接不存在。",
                    format!("connection_id={id}"),
                    false,
                )
            })?;

        self.document.profiles[index].remote_os_id = system.os_id;
        self.document.profiles[index].remote_os_name = system.os_name;
        self.document.profiles[index].remote_os_version = system.os_version;
        self.document.profiles[index].updated_at = now.to_string();
        let profile = self.document.profiles[index].clone();
        self.save()?;
        Ok(profile)
    }

    fn save(&self) -> Result<(), AppError> {
        write_json_document(
            &self.path,
            &ConnectionStoreDocument {
                version: 2,
                profiles: self
                    .document
                    .profiles
                    .iter()
                    .cloned()
                    .map(strip_legacy_profile_fields)
                    .collect(),
            },
            connection_store_error_labels(),
        )
    }
}

pub fn validate_profile_input(
    input: &ConnectionProfileInput,
) -> Result<ValidatedConnectionProfileInput, AppError> {
    let host = input.host.trim().to_string();
    if host.is_empty() {
        return Err(AppError::new(
            "connection_host_missing",
            "请填写 SSH 主机。",
            "host is empty",
            true,
        ));
    }

    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::new(
            "connection_username_missing",
            "请填写 SSH 用户名。",
            "username is empty",
            true,
        ));
    }

    if input.port == 0 {
        return Err(AppError::new(
            "connection_port_invalid",
            "SSH 端口无效。",
            "port is 0",
            true,
        ));
    }

    let credential_mode = normalize_credential_mode(input);
    let inline_auth_kind = normalize_inline_auth_kind(input);
    let inline_password = trim_optional(input.inline_password.as_ref())
        .or_else(|| trim_optional(input.password.as_ref()));
    let inline_private_key_path = trim_optional(input.inline_private_key_path.as_ref())
        .or_else(|| trim_optional(input.private_key_path.as_ref()));
    let inline_private_key_passphrase = trim_optional(input.inline_private_key_passphrase.as_ref())
        .or_else(|| trim_optional(input.private_key_passphrase.as_ref()));
    let credential_id = trim_optional(input.credential_id.as_ref());
    let prompt_auth_kind = input.prompt_auth_kind.clone();

    let (
        credential_id,
        inline_auth_kind,
        inline_password,
        inline_private_key_path,
        inline_private_key_passphrase,
        prompt_auth_kind,
    ) = match credential_mode {
        ConnectionCredentialMode::Saved => {
            let Some(credential_id) = credential_id else {
                return Err(AppError::new(
                    "connection_credential_missing",
                    "请选择保存的凭据。",
                    "credential_id is empty",
                    true,
                ));
            };
            (Some(credential_id), None, None, None, None, None)
        }
        ConnectionCredentialMode::Inline => {
            let auth_kind = inline_auth_kind.unwrap_or(ConnectionAuthKind::Password);
            match auth_kind {
                ConnectionAuthKind::Password if inline_password.is_none() => {
                    return Err(AppError::new(
                        "connection_password_missing",
                        "请填写 SSH 密码。",
                        "inline password is empty",
                        true,
                    ));
                }
                ConnectionAuthKind::PrivateKey if inline_private_key_path.is_none() => {
                    return Err(AppError::new(
                        "connection_private_key_missing",
                        "请选择 SSH 私钥。",
                        "inline private key path is empty",
                        true,
                    ));
                }
                _ => {}
            }
            match auth_kind {
                ConnectionAuthKind::Password => (
                    None,
                    Some(ConnectionAuthKind::Password),
                    inline_password,
                    None,
                    None,
                    None,
                ),
                ConnectionAuthKind::PrivateKey => (
                    None,
                    Some(ConnectionAuthKind::PrivateKey),
                    None,
                    inline_private_key_path,
                    inline_private_key_passphrase,
                    None,
                ),
            }
        }
        ConnectionCredentialMode::Prompt => {
            let auth_kind = prompt_auth_kind.unwrap_or(ConnectionAuthKind::Password);
            (None, None, None, None, None, Some(auth_kind))
        }
    };

    let proxy = validate_proxy_config(&input.proxy)?;
    let jump = validate_jump_config(&input.jump)?;
    let advanced = validate_advanced_config(&input.advanced)?;
    let name = input
        .name
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{username}@{host}"));

    Ok(ValidatedConnectionProfileInput {
        id: trim_optional(input.id.as_ref()),
        name,
        group: trim_optional(input.group.as_ref()),
        host,
        port: input.port,
        username,
        credential_mode,
        credential_id,
        inline_auth_kind,
        inline_password,
        inline_private_key_path,
        inline_private_key_passphrase,
        prompt_auth_kind,
        proxy,
        jump,
        advanced,
        notes: trim_optional(input.notes.as_ref()),
    })
}

pub fn trim_optional(value: Option<&String>) -> Option<String> {
    value
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn validate_proxy_config(input: &ConnectionProxyConfig) -> Result<ConnectionProxyConfig, AppError> {
    if input.kind == ConnectionProxyKind::None {
        return Ok(ConnectionProxyConfig::default());
    }

    let host = trim_optional(input.host.as_ref()).ok_or_else(|| {
        AppError::new(
            "connection_proxy_host_missing",
            "请填写代理主机。",
            "proxy host is empty",
            true,
        )
    })?;
    let port = input.port.filter(|port| *port > 0).ok_or_else(|| {
        AppError::new(
            "connection_proxy_port_invalid",
            "代理端口无效。",
            "proxy port is empty or 0",
            true,
        )
    })?;

    Ok(ConnectionProxyConfig {
        kind: input.kind.clone(),
        host: Some(host),
        port: Some(port),
        username: trim_optional(input.username.as_ref()),
        password: trim_optional(input.password.as_ref()),
    })
}

fn validate_jump_config(input: &ConnectionJumpConfig) -> Result<ConnectionJumpConfig, AppError> {
    match input.kind {
        ConnectionJumpKind::None => Ok(ConnectionJumpConfig::default()),
        ConnectionJumpKind::SshJump => {
            let jump_connection_id =
                trim_optional(input.jump_connection_id.as_ref()).ok_or_else(|| {
                    AppError::new(
                        "connection_jump_missing",
                        "请选择 SSH 跳板机连接。",
                        "jump_connection_id is empty",
                        true,
                    )
                })?;

            Ok(ConnectionJumpConfig {
                kind: ConnectionJumpKind::SshJump,
                jump_connection_id: Some(jump_connection_id),
            })
        }
    }
}

fn validate_advanced_config(
    input: &ConnectionAdvancedConfig,
) -> Result<ConnectionAdvancedConfig, AppError> {
    if input.connect_timeout_ms < 1_000 || input.connect_timeout_ms > 300_000 {
        return Err(AppError::new(
            "connection_connect_timeout_invalid",
            "连接超时时间无效。",
            format!("connect_timeout_ms={}", input.connect_timeout_ms),
            true,
        ));
    }
    if input.auth_timeout_ms < 1_000 || input.auth_timeout_ms > 300_000 {
        return Err(AppError::new(
            "connection_auth_timeout_invalid",
            "认证超时时间无效。",
            format!("auth_timeout_ms={}", input.auth_timeout_ms),
            true,
        ));
    }
    if input.keepalive_interval_ms < 5_000 || input.keepalive_interval_ms > 600_000 {
        return Err(AppError::new(
            "connection_keepalive_invalid",
            "心跳间隔无效。",
            format!("keepalive_interval_ms={}", input.keepalive_interval_ms),
            true,
        ));
    }

    let terminal_encoding = normalize_terminal_encoding(&input.terminal_encoding)?;

    Ok(ConnectionAdvancedConfig {
        connect_timeout_ms: input.connect_timeout_ms,
        auth_timeout_ms: input.auth_timeout_ms,
        keepalive_interval_ms: input.keepalive_interval_ms,
        terminal_encoding,
    })
}

fn normalize_credential_mode(input: &ConnectionProfileInput) -> ConnectionCredentialMode {
    if input.auth_kind.is_some() {
        return ConnectionCredentialMode::Inline;
    }
    input.credential_mode.clone()
}

fn normalize_inline_auth_kind(input: &ConnectionProfileInput) -> Option<ConnectionAuthKind> {
    input
        .inline_auth_kind
        .clone()
        .or_else(|| input.auth_kind.clone())
}

fn migrate_profile(mut profile: ConnectionProfile) -> ConnectionProfile {
    if profile.auth_kind.is_some() {
        let auth_kind = profile
            .auth_kind
            .clone()
            .unwrap_or(ConnectionAuthKind::Password);
        profile.credential_mode = ConnectionCredentialMode::Inline;
        profile.inline_auth_kind = Some(auth_kind.clone());
        match auth_kind {
            ConnectionAuthKind::Password => {
                profile.inline_password = trim_optional(profile.password.as_ref());
                profile.inline_private_key_path = None;
                profile.inline_private_key_passphrase = None;
            }
            ConnectionAuthKind::PrivateKey => {
                profile.inline_password = None;
                profile.inline_private_key_path = trim_optional(profile.private_key_path.as_ref());
                profile.inline_private_key_passphrase =
                    trim_optional(profile.private_key_passphrase.as_ref());
            }
        }
        profile.credential_id = None;
        profile.prompt_auth_kind = None;
    }
    strip_legacy_profile_fields(profile)
}

fn strip_legacy_profile_fields(mut profile: ConnectionProfile) -> ConnectionProfile {
    profile.auth_kind = None;
    profile.password = None;
    profile.private_key_path = None;
    profile.private_key_passphrase = None;
    profile
}

fn default_credential_mode() -> ConnectionCredentialMode {
    ConnectionCredentialMode::Inline
}

fn default_terminal_encoding() -> String {
    "utf-8".to_string()
}

pub(crate) const SUPPORTED_TERMINAL_ENCODINGS: &[&str] = &[
    "utf-8",
    "gbk",
    "gb18030",
    "big5",
    "euc-jp",
    "iso-2022-jp",
    "shift-jis",
    "euc-kr",
];

pub(crate) fn normalize_terminal_encoding(value: &str) -> Result<String, AppError> {
    let normalized = value.trim().to_ascii_lowercase().replace('_', "-");
    let normalized = if normalized.is_empty() {
        default_terminal_encoding()
    } else {
        normalized
    };

    if SUPPORTED_TERMINAL_ENCODINGS.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(AppError::new(
            "connection_terminal_encoding_invalid",
            "终端显示编码无效。",
            format!("terminal_encoding={normalized}"),
            true,
        ))
    }
}

pub const REMOTE_SYSTEM_PROBE_COMMAND: &str =
    "cat /etc/os-release 2>/dev/null || uname -s 2>/dev/null || true";

pub fn parse_remote_system_probe(output: &[u8]) -> ConnectionRemoteSystemInfo {
    let text = String::from_utf8_lossy(output);
    let mut info = ConnectionRemoteSystemInfo::default();
    let mut saw_os_release_key = false;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        saw_os_release_key = true;
        let value = normalize_os_release_value(value);
        match key {
            "ID" => info.os_id = normalize_remote_os_id(&value),
            "NAME" => info.os_name = trim_string(&value),
            "VERSION_ID" => info.os_version = trim_string(&value),
            _ => {}
        }
    }

    if info.os_id.is_none() && !saw_os_release_key {
        info.os_id = text
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .and_then(normalize_remote_os_id);
    }

    info
}

fn normalize_os_release_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1]
                .replace("\\\"", "\"")
                .replace("\\'", "'")
                .replace("\\\\", "\\");
        }
    }
    trimmed.to_string()
}

fn normalize_remote_os_id(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase().replace([' ', '_'], "-");
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        return None;
    }

    Some(
        match normalized {
            "centos-linux" => "centos",
            "red-hat-enterprise-linux" => "rhel",
            "darwin" => "macos",
            other => other,
        }
        .to_string(),
    )
}

fn trim_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{
        parse_remote_system_probe, validate_profile_input, ConnectionAdvancedConfig,
        ConnectionAuthKind, ConnectionCredentialMode, ConnectionJumpConfig, ConnectionJumpKind,
        ConnectionProfileInput, ConnectionProxyConfig, ConnectionProxyKind,
        ConnectionRemoteSystemInfo, ConnectionStore,
    };

    fn password_input() -> ConnectionProfileInput {
        ConnectionProfileInput {
            id: None,
            name: None,
            group: Some(" 生产 ".to_string()),
            host: "  example.com  ".to_string(),
            port: 22,
            username: "  root  ".to_string(),
            credential_mode: ConnectionCredentialMode::Inline,
            credential_id: None,
            inline_auth_kind: Some(ConnectionAuthKind::Password),
            inline_password: Some("secret".to_string()),
            inline_private_key_path: None,
            inline_private_key_passphrase: None,
            prompt_auth_kind: None,
            proxy: ConnectionProxyConfig::default(),
            jump: ConnectionJumpConfig::default(),
            advanced: ConnectionAdvancedConfig::default(),
            notes: None,
            is_favorite: None,
            last_connected_at: None,
            remote_os_id: None,
            remote_os_name: None,
            remote_os_version: None,
            auth_kind: None,
            password: None,
            private_key_path: None,
            private_key_passphrase: None,
        }
    }

    #[test]
    fn validation_trims_fields_and_defaults_name() {
        let validated = validate_profile_input(&password_input()).unwrap();

        assert_eq!(validated.name, "root@example.com");
        assert_eq!(validated.group, Some("生产".to_string()));
        assert_eq!(validated.host, "example.com");
        assert_eq!(validated.username, "root");
        assert_eq!(validated.port, 22);
    }

    #[test]
    fn validation_rejects_blank_host() {
        let input = ConnectionProfileInput {
            host: "  ".to_string(),
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_host_missing");
    }

    #[test]
    fn validation_rejects_missing_inline_password() {
        let input = ConnectionProfileInput {
            inline_password: Some(" ".to_string()),
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_password_missing");
    }

    #[test]
    fn validation_rejects_missing_saved_credential() {
        let input = ConnectionProfileInput {
            credential_mode: ConnectionCredentialMode::Saved,
            credential_id: Some(" ".to_string()),
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_credential_missing");
    }

    #[test]
    fn validation_prompt_mode_does_not_require_secret() {
        let input = ConnectionProfileInput {
            credential_mode: ConnectionCredentialMode::Prompt,
            inline_password: None,
            prompt_auth_kind: Some(ConnectionAuthKind::PrivateKey),
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.credential_mode, ConnectionCredentialMode::Prompt);
        assert_eq!(
            validated.prompt_auth_kind,
            Some(ConnectionAuthKind::PrivateKey)
        );
        assert_eq!(validated.inline_password, None);
    }

    #[test]
    fn validation_rejects_invalid_proxy() {
        let input = ConnectionProfileInput {
            proxy: ConnectionProxyConfig {
                kind: ConnectionProxyKind::Socks5,
                host: Some(" ".to_string()),
                port: Some(1080),
                username: None,
                password: None,
            },
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_proxy_host_missing");
    }

    #[test]
    fn validation_accepts_proxy_and_advanced() {
        let input = ConnectionProfileInput {
            proxy: ConnectionProxyConfig {
                kind: ConnectionProxyKind::HttpConnect,
                host: Some("  proxy.local ".to_string()),
                port: Some(8080),
                username: Some(" user ".to_string()),
                password: Some(" pass ".to_string()),
            },
            advanced: ConnectionAdvancedConfig {
                connect_timeout_ms: 10_000,
                auth_timeout_ms: 20_000,
                keepalive_interval_ms: 30_000,
                terminal_encoding: "gbk".to_string(),
            },
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.proxy.host, Some("proxy.local".to_string()));
        assert_eq!(validated.proxy.username, Some("user".to_string()));
        assert_eq!(validated.advanced.auth_timeout_ms, 20_000);
        assert_eq!(validated.advanced.terminal_encoding, "gbk");
    }

    #[test]
    fn validation_rejects_invalid_terminal_encoding() {
        let input = ConnectionProfileInput {
            advanced: ConnectionAdvancedConfig {
                terminal_encoding: "utf-16".to_string(),
                ..ConnectionAdvancedConfig::default()
            },
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_terminal_encoding_invalid");
    }

    #[test]
    fn validation_rejects_missing_jump_connection() {
        let input = ConnectionProfileInput {
            jump: ConnectionJumpConfig {
                kind: ConnectionJumpKind::SshJump,
                jump_connection_id: Some(" ".to_string()),
            },
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_jump_missing");
    }

    #[test]
    fn validation_accepts_ssh_jump_connection() {
        let input = ConnectionProfileInput {
            jump: ConnectionJumpConfig {
                kind: ConnectionJumpKind::SshJump,
                jump_connection_id: Some("  conn-bastion-001 ".to_string()),
            },
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.jump.kind, ConnectionJumpKind::SshJump);
        assert_eq!(
            validated.jump.jump_connection_id,
            Some("conn-bastion-001".to_string())
        );
    }

    #[test]
    fn store_upsert_persists_and_loads_profiles() {
        let path = temp_store_path("roundtrip");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();

        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        let reloaded = ConnectionStore::load(path.clone()).unwrap();
        let profiles = reloaded.list();

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, saved.id);
        assert_eq!(profiles[0].name, "root@example.com");
        assert_eq!(profiles[0].created_at, "2026-06-05T09:30:00+08:00");
        assert_eq!(profiles[0].auth_kind, None);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn store_delete_removes_profile_and_persists() {
        let path = temp_store_path("delete");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        store.delete(&saved.id).unwrap();

        let reloaded = ConnectionStore::load(path.clone()).unwrap();
        assert!(reloaded.list().is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn store_update_preserves_created_at_and_refreshes_updated_at() {
        let path = temp_store_path("update");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        let updated = store
            .upsert(
                ConnectionProfileInput {
                    id: Some(saved.id.clone()),
                    name: Some("prod".to_string()),
                    ..password_input()
                },
                "2026-06-05T09:45:00+08:00",
            )
            .unwrap();

        assert_eq!(updated.id, saved.id);
        assert_eq!(updated.name, "prod");
        assert_eq!(updated.created_at, "2026-06-05T09:30:00+08:00");
        assert_eq!(updated.updated_at, "2026-06-05T09:45:00+08:00");
        assert_eq!(store.list().len(), 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn store_tracks_favorite_and_last_connected_at() {
        let path = temp_store_path("activity");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        let favorited = store
            .set_favorite(&saved.id, true, "2026-06-05T09:35:00+08:00")
            .unwrap();
        assert!(favorited.is_favorite);
        assert_eq!(favorited.last_connected_at, None);

        let connected = store
            .mark_connected(&saved.id, "2026-06-05T09:40:00+08:00")
            .unwrap();
        assert!(connected.is_favorite);
        assert_eq!(
            connected.last_connected_at,
            Some("2026-06-05T09:40:00+08:00".to_string())
        );

        let reloaded = ConnectionStore::load(path.clone()).unwrap();
        let profile = reloaded.get(&saved.id).unwrap();
        assert!(profile.is_favorite);
        assert_eq!(
            profile.last_connected_at,
            Some("2026-06-05T09:40:00+08:00".to_string())
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn parse_remote_system_probe_reads_ubuntu_os_release() {
        let info = parse_remote_system_probe(
            br#"NAME="Ubuntu"
ID=ubuntu
VERSION_ID="22.04"
"#,
        );

        assert_eq!(info.os_id, Some("ubuntu".to_string()));
        assert_eq!(info.os_name, Some("Ubuntu".to_string()));
        assert_eq!(info.os_version, Some("22.04".to_string()));
    }

    #[test]
    fn parse_remote_system_probe_reads_centos7_os_release() {
        let info = parse_remote_system_probe(
            br#"NAME="CentOS Linux"
VERSION_ID="7"
ID="centos"
"#,
        );

        assert_eq!(info.os_id, Some("centos".to_string()));
        assert_eq!(info.os_name, Some("CentOS Linux".to_string()));
        assert_eq!(info.os_version, Some("7".to_string()));
    }

    #[test]
    fn store_updates_remote_system_and_persists() {
        let path = temp_store_path("remote-system");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        let updated = store
            .update_remote_system(
                &saved.id,
                ConnectionRemoteSystemInfo {
                    os_id: Some("ubuntu".to_string()),
                    os_name: Some("Ubuntu".to_string()),
                    os_version: Some("22.04".to_string()),
                },
                "2026-06-05T09:45:00+08:00",
            )
            .unwrap();

        assert_eq!(updated.remote_os_id, Some("ubuntu".to_string()));
        assert_eq!(updated.remote_os_name, Some("Ubuntu".to_string()));
        assert_eq!(updated.remote_os_version, Some("22.04".to_string()));

        let reloaded = ConnectionStore::load(path.clone()).unwrap();
        let profile = reloaded.get(&saved.id).unwrap();
        assert_eq!(profile.remote_os_id, Some("ubuntu".to_string()));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn store_upsert_preserves_remote_system_for_same_target() {
        let path = temp_store_path("remote-system-preserve");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();
        store
            .update_remote_system(
                &saved.id,
                ConnectionRemoteSystemInfo {
                    os_id: Some("centos".to_string()),
                    os_name: Some("CentOS Linux".to_string()),
                    os_version: Some("7".to_string()),
                },
                "2026-06-05T09:35:00+08:00",
            )
            .unwrap();

        let updated = store
            .upsert(
                ConnectionProfileInput {
                    id: Some(saved.id.clone()),
                    name: Some("renamed".to_string()),
                    ..password_input()
                },
                "2026-06-05T09:40:00+08:00",
            )
            .unwrap();

        assert_eq!(updated.remote_os_id, Some("centos".to_string()));
        assert_eq!(updated.remote_os_version, Some("7".to_string()));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn store_upsert_clears_remote_system_when_target_changes() {
        let path = temp_store_path("remote-system-clear");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();
        store
            .update_remote_system(
                &saved.id,
                ConnectionRemoteSystemInfo {
                    os_id: Some("ubuntu".to_string()),
                    os_name: Some("Ubuntu".to_string()),
                    os_version: Some("22.04".to_string()),
                },
                "2026-06-05T09:35:00+08:00",
            )
            .unwrap();

        let updated = store
            .upsert(
                ConnectionProfileInput {
                    id: Some(saved.id.clone()),
                    host: "other.example.com".to_string(),
                    ..password_input()
                },
                "2026-06-05T09:40:00+08:00",
            )
            .unwrap();

        assert_eq!(updated.remote_os_id, None);
        assert_eq!(updated.remote_os_name, None);
        assert_eq!(updated.remote_os_version, None);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_migrates_legacy_auth_fields_to_inline_mode() {
        let path = temp_store_path("legacy");
        let _ = fs::remove_file(&path);
        fs::write(
            &path,
            r#"{
  "version": 1,
  "profiles": [{
    "id": "old",
    "name": "old",
    "host": "example.com",
    "port": 22,
    "username": "root",
    "auth_kind": "password",
    "password": "secret",
    "private_key_path": "C:/old",
    "private_key_passphrase": "old",
    "notes": null,
    "created_at": "1",
    "updated_at": "1"
  }]
}"#,
        )
        .unwrap();

        let store = ConnectionStore::load(path.clone()).unwrap();
        let profile = store.get("old").unwrap();

        assert_eq!(profile.credential_mode, ConnectionCredentialMode::Inline);
        assert_eq!(profile.inline_auth_kind, Some(ConnectionAuthKind::Password));
        assert_eq!(profile.inline_password, Some("secret".to_string()));
        assert_eq!(profile.inline_private_key_path, None);
        assert_eq!(profile.password, None);

        let _ = fs::remove_file(path);
    }

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mxterm-connections-{name}-{}.json",
            uuid::Uuid::new_v4()
        ))
    }
}
