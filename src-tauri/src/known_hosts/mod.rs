use std::fs;
use std::path::PathBuf;

use russh::keys::ssh_key::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct KnownHostEntry {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub key_algorithm: String,
    pub fingerprint_sha256: String,
    pub public_key: String,
    pub trusted_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum KnownHostCheck {
    Trusted {
        entry: KnownHostEntry,
    },
    Unknown {
        host_key: HostKeyInfo,
    },
    Changed {
        current: KnownHostEntry,
        host_key: HostKeyInfo,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct HostKeyInfo {
    pub host: String,
    pub port: u16,
    pub key_algorithm: String,
    pub fingerprint_sha256: String,
    pub public_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct KnownHostStoreDocument {
    version: u16,
    entries: Vec<KnownHostEntry>,
}

pub struct KnownHostStore {
    path: PathBuf,
    document: KnownHostStoreDocument,
}

impl KnownHostStore {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut document = if path.exists() {
            let content = fs::read_to_string(&path).map_err(|error| {
                AppError::new(
                    "known_host_store_read_failed",
                    "主机密钥仓库读取失败。",
                    error,
                    true,
                )
            })?;
            serde_json::from_str(&content).map_err(|error| {
                AppError::new(
                    "known_host_store_parse_failed",
                    "主机密钥仓库文件格式无效。",
                    error,
                    true,
                )
            })?
        } else {
            KnownHostStoreDocument {
                version: 1,
                entries: Vec::new(),
            }
        };
        document.version = 1;

        Ok(Self { path, document })
    }

    #[cfg(test)]
    pub fn list(&self) -> Vec<KnownHostEntry> {
        self.document.entries.clone()
    }

    pub fn check(&self, host: &str, port: u16, info: HostKeyInfo) -> KnownHostCheck {
        match self.find(host, port) {
            Some(entry) if entry.fingerprint_sha256 == info.fingerprint_sha256 => {
                KnownHostCheck::Trusted {
                    entry: entry.clone(),
                }
            }
            Some(entry) => KnownHostCheck::Changed {
                current: entry.clone(),
                host_key: info,
            },
            None => KnownHostCheck::Unknown { host_key: info },
        }
    }

    pub fn trust(&mut self, info: HostKeyInfo, now: &str) -> Result<KnownHostEntry, AppError> {
        let existing_index = self
            .document
            .entries
            .iter()
            .position(|entry| entry.host == info.host && entry.port == info.port);
        let trusted_at = existing_index
            .and_then(|index| self.document.entries.get(index))
            .map(|entry| entry.trusted_at.clone())
            .unwrap_or_else(|| now.to_string());
        let id = existing_index
            .and_then(|index| self.document.entries.get(index))
            .map(|entry| entry.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let entry = KnownHostEntry {
            id,
            host: info.host,
            port: info.port,
            key_algorithm: info.key_algorithm,
            fingerprint_sha256: info.fingerprint_sha256,
            public_key: info.public_key,
            trusted_at,
            updated_at: now.to_string(),
        };

        if let Some(index) = existing_index {
            self.document.entries[index] = entry.clone();
        } else {
            self.document.entries.push(entry.clone());
        }

        self.save()?;
        Ok(entry)
    }

    fn find(&self, host: &str, port: u16) -> Option<&KnownHostEntry> {
        let host = host.trim();
        self.document
            .entries
            .iter()
            .find(|entry| entry.host == host && entry.port == port)
    }

    fn save(&self) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "known_host_store_create_dir_failed",
                    "主机密钥仓库目录创建失败。",
                    error,
                    true,
                )
            })?;
        }

        let content = serde_json::to_string_pretty(&self.document).map_err(|error| {
            AppError::new(
                "known_host_store_serialize_failed",
                "主机密钥仓库序列化失败。",
                error,
                true,
            )
        })?;
        fs::write(&self.path, content).map_err(|error| {
            AppError::new(
                "known_host_store_write_failed",
                "主机密钥仓库写入失败。",
                error,
                true,
            )
        })
    }
}

pub fn host_key_info(host: &str, port: u16, public_key: &PublicKey) -> HostKeyInfo {
    let fingerprint_sha256 = public_key.fingerprint(HashAlg::Sha256).to_string();
    let public_key = public_key
        .to_openssh()
        .unwrap_or_else(|_| public_key.to_string());
    let key_algorithm = public_key
        .split_whitespace()
        .next()
        .unwrap_or("unknown")
        .to_string();

    HostKeyInfo {
        host: host.trim().to_string(),
        port,
        key_algorithm,
        fingerprint_sha256,
        public_key,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::{HostKeyInfo, KnownHostCheck, KnownHostStore};

    fn host_key(fingerprint: &str) -> HostKeyInfo {
        HostKeyInfo {
            host: "example.com".to_string(),
            port: 22,
            key_algorithm: "ssh-ed25519".to_string(),
            fingerprint_sha256: fingerprint.to_string(),
            public_key: format!("ssh-ed25519 {fingerprint}"),
        }
    }

    #[test]
    fn store_reports_unknown_known_and_changed_key() {
        let path = temp_store_path("check");
        let _ = fs::remove_file(&path);
        let mut store = KnownHostStore::load(path.clone()).unwrap();

        assert!(matches!(
            store.check("example.com", 22, host_key("SHA256:first")),
            KnownHostCheck::Unknown { .. }
        ));

        store
            .trust(host_key("SHA256:first"), "2026-06-05T09:30:00+08:00")
            .unwrap();

        assert!(matches!(
            store.check("example.com", 22, host_key("SHA256:first")),
            KnownHostCheck::Trusted { .. }
        ));
        assert!(matches!(
            store.check("example.com", 22, host_key("SHA256:second")),
            KnownHostCheck::Changed { .. }
        ));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn trust_updates_existing_entry_without_resetting_trusted_at() {
        let path = temp_store_path("update");
        let _ = fs::remove_file(&path);
        let mut store = KnownHostStore::load(path.clone()).unwrap();

        let first = store
            .trust(host_key("SHA256:first"), "2026-06-05T09:30:00+08:00")
            .unwrap();
        let second = store
            .trust(host_key("SHA256:second"), "2026-06-05T09:40:00+08:00")
            .unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(second.trusted_at, "2026-06-05T09:30:00+08:00");
        assert_eq!(second.updated_at, "2026-06-05T09:40:00+08:00");
        assert_eq!(KnownHostStore::load(path.clone()).unwrap().list().len(), 1);

        let _ = fs::remove_file(path);
    }

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "mxterm-known-hosts-{name}-{}.json",
            uuid::Uuid::new_v4()
        ))
    }
}
