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
pub struct ConnectionProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: ConnectionAuthKind,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedConnectionProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: ConnectionAuthKind,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_kind: ConnectionAuthKind,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
        let document = if path.exists() {
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
                version: 1,
                profiles: Vec::new(),
            }
        };

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
            host: validated.host,
            port: validated.port,
            username: validated.username,
            auth_kind: validated.auth_kind,
            password: validated.password,
            private_key_path: validated.private_key_path,
            private_key_passphrase: validated.private_key_passphrase,
            notes: validated.notes,
            created_at,
            updated_at: now.to_string(),
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

        let content = serde_json::to_string_pretty(&self.document).map_err(|error| {
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

    let password = trim_optional(input.password.as_ref());
    let private_key_path = trim_optional(input.private_key_path.as_ref());
    let private_key_passphrase = trim_optional(input.private_key_passphrase.as_ref());
    match input.auth_kind {
        ConnectionAuthKind::Password if password.is_none() => {
            return Err(AppError::new(
                "connection_password_missing",
                "请填写 SSH 密码。",
                "password is empty",
                true,
            ));
        }
        ConnectionAuthKind::PrivateKey if private_key_path.is_none() => {
            return Err(AppError::new(
                "connection_private_key_missing",
                "请选择 SSH 私钥。",
                "private_key_path is empty",
                true,
            ));
        }
        _ => {}
    }
    let (password, private_key_path, private_key_passphrase) = match input.auth_kind {
        ConnectionAuthKind::Password => (password, None, None),
        ConnectionAuthKind::PrivateKey => (None, private_key_path, private_key_passphrase),
    };

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
        host,
        port: input.port,
        username,
        auth_kind: input.auth_kind.clone(),
        password,
        private_key_path,
        private_key_passphrase,
        notes: trim_optional(input.notes.as_ref()),
    })
}

fn trim_optional(value: Option<&String>) -> Option<String> {
    value
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{
        validate_profile_input, ConnectionAuthKind, ConnectionProfileInput, ConnectionStore,
    };

    fn password_input() -> ConnectionProfileInput {
        ConnectionProfileInput {
            id: None,
            name: None,
            host: "  example.com  ".to_string(),
            port: 22,
            username: "  root  ".to_string(),
            auth_kind: ConnectionAuthKind::Password,
            password: Some("secret".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            notes: None,
        }
    }

    #[test]
    fn validation_trims_fields_and_defaults_name() {
        let validated = validate_profile_input(&password_input()).unwrap();

        assert_eq!(validated.name, "root@example.com");
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
    fn validation_rejects_missing_password_auth_secret() {
        let input = ConnectionProfileInput {
            password: Some(" ".to_string()),
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_password_missing");
    }

    #[test]
    fn validation_rejects_missing_private_key_path() {
        let input = ConnectionProfileInput {
            auth_kind: ConnectionAuthKind::PrivateKey,
            password: None,
            private_key_path: Some(" ".to_string()),
            ..password_input()
        };

        let error = validate_profile_input(&input).unwrap_err();

        assert_eq!(error.code, "connection_private_key_missing");
    }

    #[test]
    fn validation_clears_private_key_fields_for_password_auth() {
        let input = ConnectionProfileInput {
            private_key_path: Some("C:/Users/csm/.ssh/id_rsa".to_string()),
            private_key_passphrase: Some("old-passphrase".to_string()),
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.password, Some("secret".to_string()));
        assert_eq!(validated.private_key_path, None);
        assert_eq!(validated.private_key_passphrase, None);
    }

    #[test]
    fn validation_clears_password_for_private_key_auth() {
        let input = ConnectionProfileInput {
            auth_kind: ConnectionAuthKind::PrivateKey,
            password: Some("old-password".to_string()),
            private_key_path: Some("C:/Users/csm/.ssh/id_rsa".to_string()),
            private_key_passphrase: Some("key-passphrase".to_string()),
            ..password_input()
        };

        let validated = validate_profile_input(&input).unwrap();

        assert_eq!(validated.password, None);
        assert_eq!(
            validated.private_key_path,
            Some("C:/Users/csm/.ssh/id_rsa".to_string())
        );
        assert_eq!(
            validated.private_key_passphrase,
            Some("key-passphrase".to_string())
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
    fn store_get_returns_profile_by_id() {
        let path = temp_store_path("get");
        let _ = fs::remove_file(&path);
        let mut store = ConnectionStore::load(path.clone()).unwrap();
        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();

        let found = store.get(&saved.id).unwrap();

        assert_eq!(found.id, saved.id);
        assert_eq!(found.host, "example.com");

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

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mxterm-connections-{name}-{}.json",
            uuid::Uuid::new_v4()
        ))
    }
}
