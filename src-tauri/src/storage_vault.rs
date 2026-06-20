use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, Nonce as AeadNonce};
use aes_gcm::{Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::{general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;

pub const VAULT_SERVICE: &str = "mxterm";
pub const VAULT_FILE_NAME: &str = "secrets.enc";
const LOCAL_KEY_FILE_NAME: &str = "secrets.local.key";

const VAULT_VERSION: u16 = 1;
const VAULT_CIPHER: &str = "aes-256-gcm";
const VAULT_KDF: &str = "argon2id";
const VAULT_SALT_BYTES: usize = 16;
const VAULT_NONCE_BYTES: usize = 12;
const VAULT_KEY_BYTES: usize = 32;
const VAULT_MEMORY_COST_KIB: u32 = 19 * 1024;
const VAULT_TIME_COST: u32 = 2;
const VAULT_PARALLELISM: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SecretKind {
    Password,
    PrivateKeyPassphrase,
    InlinePassword,
    InlinePrivateKeyPassphrase,
}

impl SecretKind {
    fn account_suffix(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PrivateKeyPassphrase => "private_key_passphrase",
            Self::InlinePassword => "inline_password",
            Self::InlinePrivateKeyPassphrase => "inline_private_key_passphrase",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SecretReference {
    pub service: &'static str,
    pub account: String,
    pub slot_id: String,
    pub kind: SecretKind,
}

impl SecretReference {
    pub fn connection(connection_id: &str, kind: SecretKind) -> Self {
        let account = format!("connection:{}:{}", connection_id, kind.account_suffix());
        Self {
            service: VAULT_SERVICE,
            slot_id: account.clone(),
            account,
            kind,
        }
    }

    pub fn credential(credential_id: &str, kind: SecretKind) -> Self {
        let account = format!("credential:{}:{}", credential_id, kind.account_suffix());
        Self {
            service: VAULT_SERVICE,
            slot_id: account.clone(),
            account,
            kind,
        }
    }
}

pub trait SecretStore: Send + Sync {
    fn set_secret(&self, reference: &SecretReference, secret: &str) -> Result<(), AppError>;
    fn get_secret(&self, reference: &SecretReference) -> Result<String, AppError>;
    fn delete_secret(&self, reference: &SecretReference) -> Result<(), AppError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SecretStoreFailure {
    Write,
    Read,
    Delete,
}

#[derive(Clone, Default)]
pub struct InMemorySecretStore {
    secrets: Arc<Mutex<HashMap<String, String>>>,
    failure: Option<SecretStoreFailure>,
}

impl InMemorySecretStore {
    pub fn failing(failure: SecretStoreFailure) -> Self {
        Self {
            secrets: Arc::default(),
            failure: Some(failure),
        }
    }
}

impl SecretStore for InMemorySecretStore {
    fn set_secret(&self, reference: &SecretReference, secret: &str) -> Result<(), AppError> {
        if self.failure == Some(SecretStoreFailure::Write) {
            return Err(secret_store_write_failed(
                &reference.account,
                "in-memory failure",
            ));
        }
        self.secrets
            .lock()
            .map_err(|_| {
                secret_store_write_failed(&reference.account, "secret store lock poisoned")
            })?
            .insert(reference.account.clone(), secret.to_string());
        Ok(())
    }

    fn get_secret(&self, reference: &SecretReference) -> Result<String, AppError> {
        if self.failure == Some(SecretStoreFailure::Read) {
            return Err(secret_store_read_failed(
                &reference.account,
                "in-memory failure",
            ));
        }
        self.secrets
            .lock()
            .map_err(|_| {
                secret_store_read_failed(&reference.account, "secret store lock poisoned")
            })?
            .get(&reference.account)
            .cloned()
            .ok_or_else(|| secret_missing(&reference.account))
    }

    fn delete_secret(&self, reference: &SecretReference) -> Result<(), AppError> {
        if self.failure == Some(SecretStoreFailure::Delete) {
            return Err(secret_store_delete_failed(
                &reference.account,
                "in-memory failure",
            ));
        }
        self.secrets
            .lock()
            .map_err(|_| {
                secret_store_delete_failed(&reference.account, "secret store lock poisoned")
            })?
            .remove(&reference.account);
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct VaultEnvelope {
    version: u16,
    kdf: VaultKdf,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct VaultKdf {
    name: String,
    memory_cost_kib: u32,
    time_cost: u32,
    parallelism: u32,
}

impl Default for VaultKdf {
    fn default() -> Self {
        Self {
            name: VAULT_KDF.to_string(),
            memory_cost_kib: VAULT_MEMORY_COST_KIB,
            time_cost: VAULT_TIME_COST,
            parallelism: VAULT_PARALLELISM,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct VaultPlaintext {
    version: u16,
    secrets: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

#[derive(Default)]
pub struct VaultState {
    store: Mutex<Option<Arc<VaultSecretStore>>>,
}

impl VaultState {
    pub fn unlock_local(&self, root: impl AsRef<Path>) -> Result<VaultStatus, AppError> {
        let root = root.as_ref();
        let master_password = local_master_password(root)?;
        self.unlock(root, &master_password)
    }

    pub fn unlock(
        &self,
        root: impl AsRef<Path>,
        master_password: &str,
    ) -> Result<VaultStatus, AppError> {
        if master_password.trim().is_empty() {
            return Err(AppError::new(
                "vault_password_missing",
                "请输入主密码。",
                "master password is empty",
                true,
            ));
        }
        let store = Arc::new(VaultSecretStore::open(root.as_ref(), master_password)?);
        let status = VaultStatus {
            initialized: true,
            unlocked: true,
        };
        *self.store.lock().map_err(|_| {
            secret_store_write_failed(VAULT_FILE_NAME, "vault state lock poisoned")
        })? = Some(store);
        Ok(status)
    }

    pub fn enable_master_password(
        &self,
        root: impl AsRef<Path>,
        master_password: &str,
    ) -> Result<VaultStatus, AppError> {
        if master_password.trim().is_empty() {
            return Err(AppError::new(
                "vault_password_missing",
                "请输入主密码。",
                "master password is empty",
                true,
            ));
        }
        self.rekey(root, master_password)
    }

    pub fn disable_master_password(&self, root: impl AsRef<Path>) -> Result<VaultStatus, AppError> {
        let root = root.as_ref();
        let master_password = local_master_password(root)?;
        self.rekey(root, &master_password)
    }

    pub fn status(&self, root: impl AsRef<Path>) -> Result<VaultStatus, AppError> {
        let unlocked = self
            .store
            .lock()
            .map_err(|_| secret_store_read_failed(VAULT_FILE_NAME, "vault state lock poisoned"))?
            .is_some();
        Ok(VaultStatus {
            initialized: VaultSecretStore::exists(root),
            unlocked,
        })
    }

    pub fn secret_store(&self) -> Result<Arc<dyn SecretStore>, AppError> {
        let store = self
            .store
            .lock()
            .map_err(|_| secret_store_read_failed(VAULT_FILE_NAME, "vault state lock poisoned"))?
            .clone()
            .ok_or_else(vault_locked)?;
        Ok(store)
    }

    fn rekey(
        &self,
        root: impl AsRef<Path>,
        master_password: &str,
    ) -> Result<VaultStatus, AppError> {
        let root = root.as_ref();
        let current_store = {
            self.store
                .lock()
                .map_err(|_| {
                    secret_store_read_failed(VAULT_FILE_NAME, "vault state lock poisoned")
                })?
                .clone()
        };
        let plaintext = current_store.ok_or_else(vault_locked)?.clone_plaintext()?;
        let store = Arc::new(VaultSecretStore::replace_with_plaintext(
            root,
            master_password,
            plaintext,
        )?);
        *self.store.lock().map_err(|_| {
            secret_store_write_failed(VAULT_FILE_NAME, "vault state lock poisoned")
        })? = Some(store);
        Ok(VaultStatus {
            initialized: true,
            unlocked: true,
        })
    }
}

pub struct VaultSecretStore {
    path: PathBuf,
    key: [u8; VAULT_KEY_BYTES],
    kdf: VaultKdf,
    salt: [u8; VAULT_SALT_BYTES],
    plaintext: Mutex<VaultPlaintext>,
}

impl fmt::Debug for VaultSecretStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VaultSecretStore")
            .field("path", &self.path)
            .field("kdf", &self.kdf)
            .finish_non_exhaustive()
    }
}

impl VaultSecretStore {
    pub fn open(root: impl AsRef<Path>, master_password: &str) -> Result<Self, AppError> {
        let path = root.as_ref().join(VAULT_FILE_NAME);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
        }

        if path.exists() {
            Self::open_existing(path, master_password)
        } else {
            Self::create_new(path, master_password)
        }
    }

    pub fn exists(root: impl AsRef<Path>) -> bool {
        root.as_ref().join(VAULT_FILE_NAME).exists()
    }

    fn create_new(path: PathBuf, master_password: &str) -> Result<Self, AppError> {
        let kdf = VaultKdf::default();
        let salt = random_array::<VAULT_SALT_BYTES>()?;
        let key = derive_key(master_password, &salt, &kdf)?;
        let store = Self {
            path,
            key,
            kdf,
            salt,
            plaintext: Mutex::new(VaultPlaintext {
                version: VAULT_VERSION,
                secrets: BTreeMap::new(),
            }),
        };
        store.persist()?;
        Ok(store)
    }

    fn replace_with_plaintext(
        root: impl AsRef<Path>,
        master_password: &str,
        plaintext: VaultPlaintext,
    ) -> Result<Self, AppError> {
        let root = root.as_ref();
        let path = root.join(VAULT_FILE_NAME);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
        }
        let kdf = VaultKdf::default();
        let salt = random_array::<VAULT_SALT_BYTES>()?;
        let key = derive_key(master_password, &salt, &kdf)?;
        let store = Self {
            path,
            key,
            kdf,
            salt,
            plaintext: Mutex::new(plaintext),
        };
        store.persist()?;
        Ok(store)
    }

    fn open_existing(path: PathBuf, master_password: &str) -> Result<Self, AppError> {
        let envelope_text = fs::read_to_string(&path)
            .map_err(|error| secret_store_read_failed(VAULT_FILE_NAME, error))?;
        let envelope: VaultEnvelope = serde_json::from_str(&envelope_text)
            .map_err(|error| secret_store_read_failed(VAULT_FILE_NAME, error))?;
        validate_envelope(&envelope)?;
        let salt_vec = decode_base64(&envelope.salt, "salt")?;
        let nonce_vec = decode_base64(&envelope.nonce, "nonce")?;
        let ciphertext = decode_base64(&envelope.ciphertext, "ciphertext")?;
        let salt = fixed_array::<VAULT_SALT_BYTES>(&salt_vec, "salt")?;
        let nonce = fixed_array::<VAULT_NONCE_BYTES>(&nonce_vec, "nonce")?;
        let key = derive_key(master_password, &salt, &envelope.kdf)?;
        let plaintext_bytes =
            decrypt_bytes(&key, &nonce, &ciphertext).map_err(|_| vault_unlock_failed())?;
        let plaintext: VaultPlaintext = serde_json::from_slice(&plaintext_bytes)
            .map_err(|error| secret_store_read_failed(VAULT_FILE_NAME, error))?;

        Ok(Self {
            path,
            key,
            kdf: envelope.kdf,
            salt,
            plaintext: Mutex::new(plaintext),
        })
    }

    fn persist(&self) -> Result<(), AppError> {
        let plaintext = self
            .plaintext
            .lock()
            .map_err(|_| secret_store_write_failed(VAULT_FILE_NAME, "vault lock poisoned"))?;
        self.persist_locked(&plaintext)
    }

    fn clone_plaintext(&self) -> Result<VaultPlaintext, AppError> {
        self.plaintext
            .lock()
            .map_err(|_| secret_store_read_failed(VAULT_FILE_NAME, "vault lock poisoned"))
            .map(|plaintext| plaintext.clone())
    }

    fn persist_locked(&self, plaintext: &VaultPlaintext) -> Result<(), AppError> {
        let nonce = random_array::<VAULT_NONCE_BYTES>()?;
        let plaintext_bytes = serde_json::to_vec(plaintext)
            .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
        let ciphertext = encrypt_bytes(&self.key, &nonce, &plaintext_bytes)?;
        let envelope = VaultEnvelope {
            version: VAULT_VERSION,
            kdf: self.kdf.clone(),
            cipher: VAULT_CIPHER.to_string(),
            salt: STANDARD.encode(self.salt),
            nonce: STANDARD.encode(nonce),
            ciphertext: STANDARD.encode(ciphertext),
        };
        let envelope_text = serde_json::to_string_pretty(&envelope)
            .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
        fs::write(&self.path, envelope_text)
            .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
        Ok(())
    }
}

impl SecretStore for VaultSecretStore {
    fn set_secret(&self, reference: &SecretReference, secret: &str) -> Result<(), AppError> {
        let mut plaintext = self
            .plaintext
            .lock()
            .map_err(|_| secret_store_write_failed(&reference.account, "vault lock poisoned"))?;
        plaintext
            .secrets
            .insert(reference.account.clone(), secret.to_string());
        self.persist_locked(&plaintext)
    }

    fn get_secret(&self, reference: &SecretReference) -> Result<String, AppError> {
        self.plaintext
            .lock()
            .map_err(|_| secret_store_read_failed(&reference.account, "vault lock poisoned"))?
            .secrets
            .get(&reference.account)
            .cloned()
            .ok_or_else(|| secret_missing(&reference.account))
    }

    fn delete_secret(&self, reference: &SecretReference) -> Result<(), AppError> {
        let mut plaintext = self
            .plaintext
            .lock()
            .map_err(|_| secret_store_delete_failed(&reference.account, "vault lock poisoned"))?;
        plaintext.secrets.remove(&reference.account);
        self.persist_locked(&plaintext)
    }
}

fn validate_envelope(envelope: &VaultEnvelope) -> Result<(), AppError> {
    if envelope.version != VAULT_VERSION {
        return Err(secret_store_read_failed(
            VAULT_FILE_NAME,
            format!("unsupported vault version {}", envelope.version),
        ));
    }
    if envelope.cipher != VAULT_CIPHER {
        return Err(secret_store_read_failed(
            VAULT_FILE_NAME,
            format!("unsupported vault cipher {}", envelope.cipher),
        ));
    }
    if envelope.kdf.name != VAULT_KDF {
        return Err(secret_store_read_failed(
            VAULT_FILE_NAME,
            format!("unsupported vault kdf {}", envelope.kdf.name),
        ));
    }
    Ok(())
}

fn derive_key(
    master_password: &str,
    salt: &[u8; VAULT_SALT_BYTES],
    kdf: &VaultKdf,
) -> Result<[u8; VAULT_KEY_BYTES], AppError> {
    let params = Params::new(
        kdf.memory_cost_kib,
        kdf.time_cost,
        kdf.parallelism,
        Some(VAULT_KEY_BYTES),
    )
    .map_err(|error| secret_store_read_failed(VAULT_FILE_NAME, error))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; VAULT_KEY_BYTES];
    argon2
        .hash_password_into(master_password.as_bytes(), salt, &mut key)
        .map_err(|error| vault_unlock_raw_failed(error))?;
    Ok(key)
}

fn encrypt_bytes(
    key: &[u8; VAULT_KEY_BYTES],
    nonce: &[u8; VAULT_NONCE_BYTES],
    plaintext: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| secret_store_write_failed(VAULT_FILE_NAME, "invalid nonce length"))?;
    cipher
        .encrypt(&nonce, plaintext)
        .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))
}

fn decrypt_bytes(
    key: &[u8; VAULT_KEY_BYTES],
    nonce: &[u8; VAULT_NONCE_BYTES],
    ciphertext: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| secret_store_read_failed(VAULT_FILE_NAME, "invalid nonce length"))?;
    cipher.decrypt(&nonce, ciphertext).map_err(|error| {
        AppError::new(
            "vault_unlock_failed",
            "主密码不正确，无法解锁加密保险库。",
            error,
            true,
        )
    })
}

fn random_array<const N: usize>() -> Result<[u8; N], AppError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|error| secret_store_write_failed(VAULT_FILE_NAME, error))?;
    Ok(bytes)
}

fn local_master_password(root: &Path) -> Result<String, AppError> {
    let path = root.join(LOCAL_KEY_FILE_NAME);
    if path.exists() {
        return fs::read_to_string(&path)
            .map(|value| value.trim().to_string())
            .map_err(|error| secret_store_read_failed(LOCAL_KEY_FILE_NAME, error));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| secret_store_write_failed(LOCAL_KEY_FILE_NAME, error))?;
    }
    let key = STANDARD.encode(random_array::<VAULT_KEY_BYTES>()?);
    fs::write(&path, &key)
        .map_err(|error| secret_store_write_failed(LOCAL_KEY_FILE_NAME, error))?;
    Ok(key)
}

fn decode_base64(value: &str, label: &str) -> Result<Vec<u8>, AppError> {
    STANDARD
        .decode(value)
        .map_err(|error| secret_store_read_failed(VAULT_FILE_NAME, format!("{label}: {error}")))
}

fn fixed_array<const N: usize>(bytes: &[u8], label: &str) -> Result<[u8; N], AppError> {
    bytes.try_into().map_err(|_| {
        secret_store_read_failed(VAULT_FILE_NAME, format!("{label} length must be {N} bytes"))
    })
}

fn secret_store_write_failed(account: &str, raw: impl ToString) -> AppError {
    AppError::new(
        "secret_store_write_failed",
        "加密保险库写入失败。",
        format!("account={account}: {}", raw.to_string()),
        true,
    )
}

fn secret_store_read_failed(account: &str, raw: impl ToString) -> AppError {
    AppError::new(
        "secret_store_read_failed",
        "加密保险库读取失败。",
        format!("account={account}: {}", raw.to_string()),
        true,
    )
}

fn secret_store_delete_failed(account: &str, raw: impl ToString) -> AppError {
    AppError::new(
        "secret_store_delete_failed",
        "加密保险库删除失败。",
        format!("account={account}: {}", raw.to_string()),
        true,
    )
}

fn secret_missing(account: &str) -> AppError {
    AppError::new(
        "secret_missing",
        "加密保险库中不存在该凭据。",
        format!("account={account}"),
        true,
    )
}

fn vault_locked() -> AppError {
    AppError::new(
        "vault_locked",
        "请先解锁加密保险库。",
        "vault is locked",
        true,
    )
}

fn vault_unlock_failed() -> AppError {
    AppError::new(
        "vault_unlock_failed",
        "主密码不正确，无法解锁加密保险库。",
        "decrypt failed",
        true,
    )
}

fn vault_unlock_raw_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "vault_unlock_failed",
        "主密码不正确，无法解锁加密保险库。",
        raw,
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        InMemorySecretStore, SecretKind, SecretReference, SecretStore, SecretStoreFailure,
        VaultSecretStore, VaultState,
    };

    #[test]
    fn secret_reference_account_is_stable() {
        let reference = SecretReference::connection("conn-001", SecretKind::InlinePassword);

        assert_eq!(reference.service, "mxterm");
        assert_eq!(reference.account, "connection:conn-001:inline_password");
        assert_eq!(reference.slot_id, "connection:conn-001:inline_password");
    }

    #[test]
    fn fake_secret_store_roundtrips_secret() {
        let store = InMemorySecretStore::default();
        let reference = SecretReference::credential("cred-001", SecretKind::Password);

        store.set_secret(&reference, "secret").unwrap();

        assert_eq!(store.get_secret(&reference).unwrap(), "secret");
        store.delete_secret(&reference).unwrap();
        assert_eq!(
            store.get_secret(&reference).unwrap_err().code,
            "secret_missing"
        );
    }

    #[test]
    fn fake_secret_store_maps_backend_failure() {
        let store = InMemorySecretStore::failing(SecretStoreFailure::Write);
        let reference = SecretReference::credential("cred-001", SecretKind::Password);

        let error = store.set_secret(&reference, "secret").unwrap_err();

        assert_eq!(error.code, "secret_store_write_failed");
    }

    #[test]
    fn vault_secret_store_persists_encrypted_secrets() {
        let root =
            std::env::temp_dir().join(format!("mxterm-vault-encrypted-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let reference = SecretReference::connection("conn-001", SecretKind::InlinePassword);

        let store = VaultSecretStore::open(&root, "master-password").unwrap();
        store.set_secret(&reference, "ssh-secret").unwrap();

        let encrypted = std::fs::read_to_string(root.join("secrets.enc")).unwrap();
        assert!(!encrypted.contains("ssh-secret"));
        drop(store);

        let reopened = VaultSecretStore::open(&root, "master-password").unwrap();
        assert_eq!(reopened.get_secret(&reference).unwrap(), "ssh-secret");
    }

    #[test]
    fn vault_state_local_unlock_roundtrips_secret() {
        let root =
            std::env::temp_dir().join(format!("mxterm-vault-local-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = VaultState::default();
        let reference = SecretReference::connection("conn-001", SecretKind::InlinePassword);

        let status = state.unlock_local(&root).unwrap();
        assert!(status.unlocked);
        state
            .secret_store()
            .unwrap()
            .set_secret(&reference, "local-secret")
            .unwrap();
        drop(state);

        let reopened = VaultState::default();
        reopened.unlock_local(&root).unwrap();
        assert_eq!(
            reopened
                .secret_store()
                .unwrap()
                .get_secret(&reference)
                .unwrap(),
            "local-secret"
        );
    }

    #[test]
    fn vault_state_rekey_requires_unlocked_store() {
        let root = std::env::temp_dir().join(format!(
            "mxterm-vault-rekey-locked-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let state = VaultState::default();

        let error = state
            .enable_master_password(&root, "master-password")
            .unwrap_err();

        assert_eq!(error.code, "vault_locked");
    }

    #[test]
    fn vault_state_rekeys_between_local_and_master_password() {
        let root =
            std::env::temp_dir().join(format!("mxterm-vault-rekey-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = VaultState::default();
        let reference = SecretReference::credential("cred-001", SecretKind::Password);

        state.unlock_local(&root).unwrap();
        state
            .secret_store()
            .unwrap()
            .set_secret(&reference, "credential-secret")
            .unwrap();
        state
            .enable_master_password(&root, "master-password")
            .unwrap();
        assert_eq!(
            state
                .secret_store()
                .unwrap()
                .get_secret(&reference)
                .unwrap(),
            "credential-secret"
        );
        drop(state);

        let locked_state = VaultState::default();
        assert_eq!(
            locked_state.unlock_local(&root).unwrap_err().code,
            "vault_unlock_failed"
        );
        locked_state.unlock(&root, "master-password").unwrap();
        assert_eq!(
            locked_state
                .secret_store()
                .unwrap()
                .get_secret(&reference)
                .unwrap(),
            "credential-secret"
        );
        locked_state.disable_master_password(&root).unwrap();
        drop(locked_state);

        let local_state = VaultState::default();
        local_state.unlock_local(&root).unwrap();
        assert_eq!(
            local_state
                .secret_store()
                .unwrap()
                .get_secret(&reference)
                .unwrap(),
            "credential-secret"
        );
    }

    #[test]
    fn vault_secret_store_rejects_wrong_master_password() {
        let root = std::env::temp_dir().join(format!(
            "mxterm-vault-wrong-password-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let reference = SecretReference::credential("cred-001", SecretKind::Password);

        let store = VaultSecretStore::open(&root, "master-password").unwrap();
        store.set_secret(&reference, "credential-secret").unwrap();
        drop(store);

        let error = VaultSecretStore::open(&root, "wrong-password").unwrap_err();

        assert_eq!(error.code, "vault_unlock_failed");
    }
}
