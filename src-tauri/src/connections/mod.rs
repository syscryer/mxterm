use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

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
pub struct ConnectionAdvancedConfig {
    pub connect_timeout_ms: u64,
    pub auth_timeout_ms: u64,
    pub keepalive_interval_ms: u64,
}

impl Default for ConnectionAdvancedConfig {
    fn default() -> Self {
        Self {
            connect_timeout_ms: 30_000,
            auth_timeout_ms: 45_000,
            keepalive_interval_ms: 20_000,
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
    pub advanced: ConnectionAdvancedConfig,
    #[serde(default)]
    pub notes: Option<String>,
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
    pub advanced: ConnectionAdvancedConfig,
    #[serde(default)]
    pub notes: Option<String>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ConnectionStoreDocument {
    version: u16,
    profiles: Vec<ConnectionProfile>,
}

pub struct ConnectionStore {
    path: PathBuf,
    document: ConnectionStoreDocument,
}

impl ConnectionStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = if path.exists() {
            let content = fs::read_to_string(&path).map_err(|error| {
                AppError::new(
                    "connection_store_read_failed",
                    "连接仓库读取失败。",
                    error,
                    true,
                )
            })?;
            serde_json::from_str(&content).map_err(|error| {
                AppError::new(
                    "connection_store_parse_failed",
                    "连接仓库文件格式无效。",
                    error,
                    true,
                )
            })?
        } else {
            ConnectionStoreDocument {
                version: 2,
                profiles: Vec::new(),
            }
        };

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
        let created_at = existing_index
            .and_then(|index| self.document.profiles.get(index))
            .map(|profile| profile.created_at.clone())
            .unwrap_or_else(|| now.to_string());

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
            advanced: validated.advanced,
            notes: validated.notes,
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

    fn save(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "connection_store_create_dir_failed",
                    "连接仓库目录创建失败。",
                    error,
                    true,
                )
            })?;
        }

        let content = serde_json::to_string_pretty(&ConnectionStoreDocument {
            version: 2,
            profiles: self
                .document
                .profiles
                .iter()
                .cloned()
                .map(strip_legacy_profile_fields)
                .collect(),
        })
        .map_err(|error| {
            AppError::new(
                "connection_store_serialize_failed",
                "连接仓库序列化失败。",
                error,
                true,
            )
        })?;
        fs::write(&self.path, content).map_err(|error| {
            AppError::new(
                "connection_store_write_failed",
                "连接仓库写入失败。",
                error,
                true,
            )
        })
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

    Ok(input.clone())
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{
        validate_profile_input, ConnectionAdvancedConfig, ConnectionAuthKind,
        ConnectionCredentialMode, ConnectionProfileInput, ConnectionProxyConfig,
        ConnectionProxyKind, ConnectionStore,
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
            advanced: ConnectionAdvancedConfig::default(),
            notes: None,
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
            },
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.proxy.host, Some("proxy.local".to_string()));
        assert_eq!(validated.proxy.username, Some("user".to_string()));
        assert_eq!(validated.advanced.auth_timeout_ms, 20_000);
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
