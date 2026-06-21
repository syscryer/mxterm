use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::connections::ConnectionAuthKind;
use crate::storage::{load_json_document, write_json_document, JsonStoreErrorLabels};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct CredentialProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    pub kind: ConnectionAuthKind,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub password_touched: bool,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub private_key_passphrase_touched: bool,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedCredentialProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub username: String,
    pub kind: ConnectionAuthKind,
    pub password: Option<String>,
    pub password_touched: bool,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub private_key_passphrase_touched: bool,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct CredentialProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub username: Option<String>,
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

#[allow(dead_code)]
pub struct CredentialStore {
    path: PathBuf,
    document: CredentialStoreDocument,
}

fn credential_store_error_labels() -> JsonStoreErrorLabels {
    JsonStoreErrorLabels {
        create_dir_code: "credential_store_create_dir_failed",
        create_dir_message: "凭据仓库目录创建失败。",
        parse_code: "credential_store_parse_failed",
        parse_message: "凭据仓库文件格式无效。",
        read_code: "credential_store_read_failed",
        read_message: "凭据仓库读取失败。",
        serialize_code: "credential_store_serialize_failed",
        serialize_message: "凭据仓库序列化失败。",
        write_code: "credential_store_write_failed",
        write_message: "凭据仓库写入失败。",
    }
}

#[allow(dead_code)]
impl CredentialStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = load_json_document(
            &path,
            || CredentialStoreDocument {
                version: 1,
                profiles: Vec::new(),
            },
            credential_store_error_labels(),
        )?;
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
            username: Some(validated.username),
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
        write_json_document(&self.path, &self.document, credential_store_error_labels())
    }
}

pub fn validate_credential_input(
    input: &CredentialProfileInput,
) -> Result<ValidatedCredentialProfileInput, AppError> {
    let name = trim_optional(input.name.as_ref()).ok_or_else(|| {
        AppError::new(
            "credential_name_missing",
            "请填写账号名称。",
            "credential name is empty",
            true,
        )
    })?;

    let username = trim_optional(input.username.as_ref()).ok_or_else(|| {
        AppError::new(
            "credential_username_missing",
            "请填写账号用户名。",
            "credential username is empty",
            true,
        )
    })?;

    let password = trim_optional(input.password.as_ref());
    let private_key_path = trim_optional(input.private_key_path.as_ref());
    let private_key_passphrase = trim_optional(input.private_key_passphrase.as_ref());
    let password_touched = input.password_touched || password.is_some();
    let private_key_passphrase_touched =
        input.private_key_passphrase_touched || private_key_passphrase.is_some();
    let existing_id = trim_optional(input.id.as_ref());

    match input.kind {
        ConnectionAuthKind::Password
            if password.is_none() && (password_touched || existing_id.is_none()) =>
        {
            return Err(AppError::new(
                "credential_password_missing",
                "请填写账号密码。",
                "credential password is empty",
                true,
            ));
        }
        ConnectionAuthKind::PrivateKey if private_key_path.is_none() => {
            return Err(AppError::new(
                "credential_private_key_missing",
                "请填写账号私钥路径。",
                "credential private key path is empty",
                true,
            ));
        }
        _ => {}
    }

    let (
        password,
        password_touched,
        private_key_path,
        private_key_passphrase,
        private_key_passphrase_touched,
    ) = match input.kind {
        ConnectionAuthKind::Password => (password, password_touched, None, None, false),
        ConnectionAuthKind::PrivateKey => (
            None,
            false,
            private_key_path,
            private_key_passphrase,
            private_key_passphrase_touched,
        ),
    };

    Ok(ValidatedCredentialProfileInput {
        id: existing_id,
        name,
        username,
        kind: input.kind.clone(),
        password,
        password_touched,
        private_key_path,
        private_key_passphrase,
        private_key_passphrase_touched,
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
            username: Some(" deploy ".to_string()),
            kind: ConnectionAuthKind::Password,
            password: Some(" secret ".to_string()),
            password_touched: true,
            private_key_path: None,
            private_key_passphrase: None,
            private_key_passphrase_touched: false,
            notes: Some(" 共享 ".to_string()),
        }
    }

    #[test]
    fn validation_trims_password_credential() {
        let validated = validate_credential_input(&password_input()).unwrap();

        assert_eq!(validated.name, "生产密码");
        assert_eq!(validated.username, "deploy");
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
    fn validation_rejects_missing_username() {
        let input = CredentialProfileInput {
            username: None,
            ..password_input()
        };

        let error = validate_credential_input(&input).unwrap_err();

        assert_eq!(error.code, "credential_username_missing");
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
            private_key_passphrase_touched: true,
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
