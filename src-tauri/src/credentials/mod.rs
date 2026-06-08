use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::connections::ConnectionAuthKind;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct CredentialProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub kind: ConnectionAuthKind,
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
pub struct ValidatedCredentialProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: ConnectionAuthKind,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct CredentialProfile {
    pub id: String,
    pub name: String,
    pub kind: ConnectionAuthKind,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CredentialStoreDocument {
    version: u16,
    profiles: Vec<CredentialProfile>,
}

pub struct CredentialStore {
    path: PathBuf,
    document: CredentialStoreDocument,
}

impl CredentialStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = if path.exists() {
            let content = fs::read_to_string(&path).map_err(|error| {
                AppError::new(
                    "credential_store_read_failed",
                    "凭据仓库读取失败。",
                    error,
                    true,
                )
            })?;
            serde_json::from_str(&content).map_err(|error| {
                AppError::new(
                    "credential_store_parse_failed",
                    "凭据仓库文件格式无效。",
                    error,
                    true,
                )
            })?
        } else {
            CredentialStoreDocument {
                version: 1,
                profiles: Vec::new(),
            }
        };
        document.version = 1;

        Ok(Self { path, document })
    }

    pub fn list(&self) -> Vec<CredentialProfile> {
        self.document.profiles.clone()
    }

    pub fn get(&self, id: &str) -> Option<CredentialProfile> {
        self.document
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
    }

    pub fn upsert(
        &mut self,
        input: CredentialProfileInput,
        now: &str,
    ) -> Result<CredentialProfile, AppError> {
        let validated = validate_credential_input(&input)?;
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

        let profile = CredentialProfile {
            id,
            name: validated.name,
            kind: validated.kind,
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
                "credential_missing",
                "凭据不存在。",
                format!("credential_id={id}"),
                false,
            ));
        }

        self.save()
    }

    fn save(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "credential_store_create_dir_failed",
                    "凭据仓库目录创建失败。",
                    error,
                    true,
                )
            })?;
        }

        let content = serde_json::to_string_pretty(&self.document).map_err(|error| {
            AppError::new(
                "credential_store_serialize_failed",
                "凭据仓库序列化失败。",
                error,
                true,
            )
        })?;
        fs::write(&self.path, content).map_err(|error| {
            AppError::new(
                "credential_store_write_failed",
                "凭据仓库写入失败。",
                error,
                true,
            )
        })
    }
}

pub fn validate_credential_input(
    input: &CredentialProfileInput,
) -> Result<ValidatedCredentialProfileInput, AppError> {
    let name = trim_optional(input.name.as_ref()).ok_or_else(|| {
        AppError::new(
            "credential_name_missing",
            "请填写凭据名称。",
            "credential name is empty",
            true,
        )
    })?;

    let password = trim_optional(input.password.as_ref());
    let private_key_path = trim_optional(input.private_key_path.as_ref());
    let private_key_passphrase = trim_optional(input.private_key_passphrase.as_ref());

    match input.kind {
        ConnectionAuthKind::Password if password.is_none() => {
            return Err(AppError::new(
                "credential_password_missing",
                "请填写凭据密码。",
                "credential password is empty",
                true,
            ));
        }
        ConnectionAuthKind::PrivateKey if private_key_path.is_none() => {
            return Err(AppError::new(
                "credential_private_key_missing",
                "请选择凭据私钥。",
                "credential private key path is empty",
                true,
            ));
        }
        _ => {}
    }

    let (password, private_key_path, private_key_passphrase) = match input.kind {
        ConnectionAuthKind::Password => (password, None, None),
        ConnectionAuthKind::PrivateKey => (None, private_key_path, private_key_passphrase),
    };

    Ok(ValidatedCredentialProfileInput {
        id: trim_optional(input.id.as_ref()),
        name,
        kind: input.kind.clone(),
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

    use super::{validate_credential_input, CredentialProfileInput, CredentialStore};
    use crate::connections::ConnectionAuthKind;

    fn password_input() -> CredentialProfileInput {
        CredentialProfileInput {
            id: None,
            name: Some(" 生产密码 ".to_string()),
            kind: ConnectionAuthKind::Password,
            password: Some(" secret ".to_string()),
            private_key_path: None,
            private_key_passphrase: None,
            notes: Some(" 共享 ".to_string()),
        }
    }

    #[test]
    fn validation_trims_password_credential() {
        let validated = validate_credential_input(&password_input()).unwrap();

        assert_eq!(validated.name, "生产密码");
        assert_eq!(validated.password, Some("secret".to_string()));
        assert_eq!(validated.private_key_path, None);
        assert_eq!(validated.notes, Some("共享".to_string()));
    }

    #[test]
    fn validation_rejects_missing_name() {
        let input = CredentialProfileInput {
            name: Some(" ".to_string()),
            ..password_input()
        };

        let error = validate_credential_input(&input).unwrap_err();

        assert_eq!(error.code, "credential_name_missing");
    }

    #[test]
    fn validation_rejects_missing_secret() {
        let input = CredentialProfileInput {
            password: None,
            ..password_input()
        };

        let error = validate_credential_input(&input).unwrap_err();

        assert_eq!(error.code, "credential_password_missing");
    }

    #[test]
    fn validation_clears_password_for_private_key() {
        let input = CredentialProfileInput {
            kind: ConnectionAuthKind::PrivateKey,
            password: Some("old".to_string()),
            private_key_path: Some(" ~/.ssh/id_ed25519 ".to_string()),
            private_key_passphrase: Some(" phrase ".to_string()),
            ..password_input()
        };

        let validated = validate_credential_input(&input).unwrap();

        assert_eq!(validated.password, None);
        assert_eq!(
            validated.private_key_path,
            Some("~/.ssh/id_ed25519".to_string())
        );
        assert_eq!(validated.private_key_passphrase, Some("phrase".to_string()));
    }

    #[test]
    fn store_roundtrip_and_delete() {
        let path = temp_store_path("roundtrip");
        let _ = fs::remove_file(&path);
        let mut store = CredentialStore::load(path.clone()).unwrap();

        let saved = store
            .upsert(password_input(), "2026-06-05T09:30:00+08:00")
            .unwrap();
        let reloaded = CredentialStore::load(path.clone()).unwrap();

        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.get(&saved.id).unwrap().name, "生产密码");

        let mut reloaded = CredentialStore::load(path.clone()).unwrap();
        reloaded.delete(&saved.id).unwrap();
        assert!(CredentialStore::load(path.clone())
            .unwrap()
            .list()
            .is_empty());

        let _ = fs::remove_file(path);
    }

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mxterm-credentials-{name}-{}.json",
            uuid::Uuid::new_v4()
        ))
    }
}
