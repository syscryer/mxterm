use std::collections::{BTreeMap, BTreeSet};

use aes_gcm::aead::{Aead, Nonce as AeadNonce, Payload};
use aes_gcm::{Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::{general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app_error::AppError;
use crate::connections::{
    ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionCredentialMode, ConnectionJumpConfig,
    ConnectionProtocol, ConnectionProxyConfig, RdpConnectionConfig,
};
use crate::known_hosts::KnownHostEntry;
use crate::storage_repository::StorageRepository;
use crate::storage_sqlite::SQLITE_SCHEMA_VERSION;
use crate::tunnels::TunnelRule;

pub const SYNC_FORMAT: &str = "mxterm-sync";
pub const SYNC_PROTOCOL_VERSION: u16 = 1;
pub const DATA_ARTIFACT: &str = "data.json";
pub const SECRETS_ARTIFACT: &str = "secrets.enc";

const SYNC_CIPHER: &str = "aes-256-gcm";
const SYNC_KDF: &str = "argon2id";
const SYNC_SALT_BYTES: usize = 16;
const SYNC_NONCE_BYTES: usize = 12;
const SYNC_KEY_BYTES: usize = 32;
const SYNC_MEMORY_COST_KIB: u32 = 19 * 1024;
const SYNC_TIME_COST: u32 = 2;
const SYNC_PARALLELISM: u32 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncManifest {
    pub format: String,
    pub protocol_version: u16,
    pub snapshot_id: String,
    pub device_id: String,
    pub device_name: String,
    pub created_at: String,
    pub db_schema_version: u32,
    pub artifacts: BTreeMap<String, ArtifactMeta>,
    pub encryption: SyncEncryptionInfo,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ArtifactMeta {
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncEncryptionInfo {
    pub secrets_cipher: String,
    pub secrets_kdf: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SyncDataDocument {
    pub version: u16,
    pub connections: Vec<SyncConnectionRecord>,
    pub credentials: Vec<SyncCredentialRecord>,
    pub known_hosts: Vec<KnownHostEntry>,
    pub tunnels: Vec<TunnelRule>,
    pub connection_groups: Vec<SyncConnectionGroup>,
    pub settings: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncConnectionGroup {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncConnectionRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub protocol: ConnectionProtocol,
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub credential_mode: ConnectionCredentialMode,
    pub credential_id: Option<String>,
    pub inline_auth_kind: Option<ConnectionAuthKind>,
    pub inline_secret_slot_id: Option<String>,
    pub inline_private_key_path: Option<String>,
    pub prompt_auth_kind: Option<ConnectionAuthKind>,
    pub proxy: ConnectionProxyConfig,
    pub jump: ConnectionJumpConfig,
    pub advanced: ConnectionAdvancedConfig,
    #[serde(default)]
    pub rdp: Option<RdpConnectionConfig>,
    pub notes: Option<String>,
    pub is_favorite: bool,
    pub last_connected_at: Option<String>,
    pub remote_os_id: Option<String>,
    pub remote_os_name: Option<String>,
    pub remote_os_version: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncCredentialRecord {
    pub id: String,
    pub name: String,
    pub username: String,
    pub kind: ConnectionAuthKind,
    pub secret_slot_id: Option<String>,
    pub private_key_path: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncSecretsPlaintext {
    pub version: u16,
    pub secrets: Vec<SyncSecretEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct SyncSecretEntry {
    pub slot_id: String,
    pub kind: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Clone, Debug)]
pub struct SyncSnapshotBundle {
    pub manifest: SyncManifest,
    pub manifest_json: Vec<u8>,
    pub data_json: Vec<u8>,
    pub remote_secrets_enc: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct SyncExportOptions {
    pub device_id: String,
    pub device_name: String,
    pub created_at: String,
    pub sync_password: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SyncImportOptions {
    pub sync_password: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct SyncImportResult {
    pub connections: usize,
    pub credentials: usize,
    pub known_hosts: usize,
    pub tunnels: usize,
    pub secrets: usize,
    pub secrets_skipped: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RemoteSecretsEnvelope {
    format: String,
    protocol_version: u16,
    kdf: RemoteSecretsKdf,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RemoteSecretsKdf {
    name: String,
    memory_cost_kib: u32,
    time_cost: u32,
    parallelism: u32,
}

impl Default for RemoteSecretsKdf {
    fn default() -> Self {
        Self {
            name: SYNC_KDF.to_string(),
            memory_cost_kib: SYNC_MEMORY_COST_KIB,
            time_cost: SYNC_TIME_COST,
            parallelism: SYNC_PARALLELISM,
        }
    }
}

pub struct SyncSnapshotService;

impl SyncSnapshotService {
    pub fn export_bundle(
        repository: &StorageRepository,
        options: SyncExportOptions,
    ) -> Result<SyncSnapshotBundle, AppError> {
        let data = repository.export_sync_data()?;
        let data_json = serde_json::to_vec_pretty(&data).map_err(sync_snapshot_serialize_failed)?;
        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let data_hash = sha256_hex(&data_json);
        let remote_secrets_enc = match options.sync_password.as_deref() {
            Some(password) if !password.trim().is_empty() => {
                let secrets = SyncSecretsPlaintext {
                    version: SYNC_PROTOCOL_VERSION,
                    secrets: repository.export_sync_secrets()?,
                };
                Some(encrypt_remote_secrets(
                    &snapshot_id,
                    &data_hash,
                    password,
                    &secrets,
                )?)
            }
            _ => None,
        };
        let manifest = build_manifest(
            snapshot_id,
            options.device_id,
            options.device_name,
            options.created_at,
            &data_json,
            remote_secrets_enc.as_deref(),
        );
        let manifest_json =
            serde_json::to_vec_pretty(&manifest).map_err(sync_snapshot_serialize_failed)?;
        Ok(SyncSnapshotBundle {
            manifest,
            manifest_json,
            data_json,
            remote_secrets_enc,
        })
    }

    pub fn import_bundle(
        repository: &mut StorageRepository,
        bundle: &SyncSnapshotBundle,
        options: SyncImportOptions,
    ) -> Result<SyncImportResult, AppError> {
        validate_bundle_artifacts(
            &bundle.manifest,
            &bundle.data_json,
            bundle.remote_secrets_enc.as_deref(),
        )?;
        let data: SyncDataDocument = serde_json::from_slice(&bundle.data_json)
            .map_err(|error| sync_snapshot_incompatible(error))?;
        if data.version != SYNC_PROTOCOL_VERSION {
            return Err(sync_snapshot_incompatible(format!(
                "unsupported data version {}",
                data.version
            )));
        }

        repository.create_sync_backup()?;
        validate_sync_data_document(&data)?;

        let secrets = match (
            options.sync_password.as_deref(),
            bundle.remote_secrets_enc.as_deref(),
        ) {
            (Some(password), Some(encrypted)) if !password.trim().is_empty() => {
                Some(Self::decrypt_remote_secrets(
                    &bundle.manifest,
                    &bundle.data_json,
                    encrypted,
                    password,
                )?)
            }
            _ => None,
        };
        if let Some(secrets) = secrets.as_ref() {
            repository.import_sync_secrets(secrets)?;
        }
        let stats = repository.replace_sync_data(&data, secrets.is_some())?;
        Ok(SyncImportResult {
            connections: stats.connections,
            credentials: stats.credentials,
            known_hosts: stats.known_hosts,
            tunnels: stats.tunnels,
            secrets: secrets.as_ref().map_or(0, |item| item.secrets.len()),
            secrets_skipped: bundle.remote_secrets_enc.is_some() && secrets.is_none(),
        })
    }

    pub fn decrypt_remote_secrets(
        manifest: &SyncManifest,
        data_json: &[u8],
        encrypted: &[u8],
        sync_password: &str,
    ) -> Result<SyncSecretsPlaintext, AppError> {
        validate_manifest_summary(manifest)?;
        let envelope: RemoteSecretsEnvelope = serde_json::from_slice(encrypted)
            .map_err(|error| sync_snapshot_secret_decrypt_failed(error))?;
        validate_remote_secret_envelope(&envelope)?;
        let salt = decode_base64_fixed::<SYNC_SALT_BYTES>(&envelope.salt, "salt")?;
        let nonce = decode_base64_fixed::<SYNC_NONCE_BYTES>(&envelope.nonce, "nonce")?;
        let ciphertext = STANDARD
            .decode(&envelope.ciphertext)
            .map_err(|error| sync_snapshot_secret_decrypt_failed(error))?;
        let key = derive_sync_key(sync_password, &salt, &envelope.kdf)?;
        let plaintext_bytes = decrypt_bytes(
            &key,
            &nonce,
            &ciphertext,
            &remote_secret_aad(&manifest.snapshot_id, &sha256_hex(data_json)),
        )?;
        let plaintext: SyncSecretsPlaintext = serde_json::from_slice(&plaintext_bytes)
            .map_err(|error| sync_snapshot_secret_decrypt_failed(error))?;
        if plaintext.version != SYNC_PROTOCOL_VERSION {
            return Err(sync_snapshot_secret_decrypt_failed(format!(
                "unsupported secrets version {}",
                plaintext.version
            )));
        }
        Ok(plaintext)
    }
}

pub fn validate_bundle_artifacts(
    manifest: &SyncManifest,
    data_json: &[u8],
    remote_secrets_enc: Option<&[u8]>,
) -> Result<(), AppError> {
    validate_manifest_summary(manifest)?;
    validate_artifact(manifest, DATA_ARTIFACT, data_json)?;
    match remote_secrets_enc {
        Some(bytes) => validate_artifact(manifest, SECRETS_ARTIFACT, bytes),
        None if manifest.artifacts.contains_key(SECRETS_ARTIFACT) => Err(AppError::new(
            "sync_snapshot_incompatible",
            "同步快照缺少 secrets.enc。",
            "manifest declares secrets.enc but bundle does not contain it",
            true,
        )),
        None => Ok(()),
    }
}

fn validate_sync_data_document(data: &SyncDataDocument) -> Result<(), AppError> {
    let mut group_ids = BTreeSet::new();
    for group in &data.connection_groups {
        if !group_ids.insert(group.id.as_str()) {
            return Err(sync_snapshot_import_failed(format!(
                "duplicate group id {}",
                group.id
            )));
        }
    }

    let mut credential_ids = BTreeSet::new();
    for credential in &data.credentials {
        if !credential_ids.insert(credential.id.as_str()) {
            return Err(sync_snapshot_import_failed(format!(
                "duplicate credential id {}",
                credential.id
            )));
        }
    }

    let mut connection_ids = BTreeSet::new();
    for connection in &data.connections {
        if !connection_ids.insert(connection.id.as_str()) {
            return Err(sync_snapshot_import_failed(format!(
                "duplicate connection id {}",
                connection.id
            )));
        }
        if let Some(group_id) = connection.group_id.as_deref() {
            if !group_ids.contains(group_id) {
                return Err(sync_snapshot_import_failed(format!(
                    "connection {} references missing group {}",
                    connection.id, group_id
                )));
            }
        }
        if matches!(connection.credential_mode, ConnectionCredentialMode::Saved) {
            let Some(credential_id) = connection.credential_id.as_deref() else {
                return Err(sync_snapshot_import_failed(format!(
                    "connection {} missing credential id",
                    connection.id
                )));
            };
            if !credential_ids.contains(credential_id) {
                return Err(sync_snapshot_import_failed(format!(
                    "connection {} references missing credential {}",
                    connection.id, credential_id
                )));
            }
        }
    }

    let mut tunnel_ids = BTreeSet::new();
    for tunnel in &data.tunnels {
        if !tunnel_ids.insert(tunnel.id.as_str()) {
            return Err(sync_snapshot_import_failed(format!(
                "duplicate tunnel id {}",
                tunnel.id
            )));
        }
        if !connection_ids.contains(tunnel.connection_id.as_str()) {
            return Err(sync_snapshot_import_failed(format!(
                "tunnel {} references missing connection {}",
                tunnel.id, tunnel.connection_id
            )));
        }
    }

    Ok(())
}
fn build_manifest(
    snapshot_id: String,
    device_id: String,
    device_name: String,
    created_at: String,
    data_json: &[u8],
    remote_secrets_enc: Option<&[u8]>,
) -> SyncManifest {
    let mut artifacts = BTreeMap::new();
    artifacts.insert(DATA_ARTIFACT.to_string(), artifact_meta(data_json));
    if let Some(secrets) = remote_secrets_enc {
        artifacts.insert(SECRETS_ARTIFACT.to_string(), artifact_meta(secrets));
    }
    SyncManifest {
        format: SYNC_FORMAT.to_string(),
        protocol_version: SYNC_PROTOCOL_VERSION,
        snapshot_id,
        device_id,
        device_name,
        created_at,
        db_schema_version: SQLITE_SCHEMA_VERSION as u32,
        artifacts,
        encryption: SyncEncryptionInfo {
            secrets_cipher: SYNC_CIPHER.to_string(),
            secrets_kdf: SYNC_KDF.to_string(),
        },
    }
}

pub fn validate_manifest_summary(manifest: &SyncManifest) -> Result<(), AppError> {
    if manifest.format != SYNC_FORMAT {
        return Err(sync_snapshot_incompatible(format!(
            "unsupported sync format {}",
            manifest.format
        )));
    }
    if manifest.protocol_version != SYNC_PROTOCOL_VERSION {
        return Err(sync_snapshot_incompatible(format!(
            "unsupported protocol version {}",
            manifest.protocol_version
        )));
    }
    if manifest.db_schema_version > SQLITE_SCHEMA_VERSION as u32 {
        return Err(sync_snapshot_incompatible(format!(
            "unsupported db schema version {}",
            manifest.db_schema_version
        )));
    }
    if !manifest.artifacts.contains_key(DATA_ARTIFACT) {
        return Err(sync_snapshot_incompatible("manifest missing data.json"));
    }
    Ok(())
}

fn validate_artifact(manifest: &SyncManifest, name: &str, bytes: &[u8]) -> Result<(), AppError> {
    let Some(meta) = manifest.artifacts.get(name) else {
        return Err(sync_snapshot_incompatible(format!(
            "manifest missing artifact {name}"
        )));
    };
    if meta.size != bytes.len() as u64 {
        return Err(AppError::new(
            "sync_snapshot_size_mismatch",
            "同步快照文件大小不匹配。",
            format!("artifact={name}"),
            true,
        ));
    }
    let actual = sha256_hex(bytes);
    if meta.sha256 != actual {
        return Err(AppError::new(
            "sync_snapshot_hash_mismatch",
            "同步快照文件校验失败。",
            format!("artifact={name}"),
            true,
        ));
    }
    Ok(())
}

fn artifact_meta(bytes: &[u8]) -> ArtifactMeta {
    ArtifactMeta {
        sha256: sha256_hex(bytes),
        size: bytes.len() as u64,
    }
}

fn encrypt_remote_secrets(
    snapshot_id: &str,
    data_hash: &str,
    sync_password: &str,
    plaintext: &SyncSecretsPlaintext,
) -> Result<Vec<u8>, AppError> {
    let kdf = RemoteSecretsKdf::default();
    let salt = random_array::<SYNC_SALT_BYTES>()?;
    let nonce = random_array::<SYNC_NONCE_BYTES>()?;
    let key = derive_sync_key(sync_password, &salt, &kdf)?;
    let plaintext_bytes = serde_json::to_vec(plaintext).map_err(sync_snapshot_serialize_failed)?;
    let ciphertext = encrypt_bytes(
        &key,
        &nonce,
        &plaintext_bytes,
        &remote_secret_aad(snapshot_id, data_hash),
    )?;
    let envelope = RemoteSecretsEnvelope {
        format: SYNC_FORMAT.to_string(),
        protocol_version: SYNC_PROTOCOL_VERSION,
        kdf,
        cipher: SYNC_CIPHER.to_string(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    };
    serde_json::to_vec_pretty(&envelope).map_err(sync_snapshot_serialize_failed)
}

fn validate_remote_secret_envelope(envelope: &RemoteSecretsEnvelope) -> Result<(), AppError> {
    if envelope.format != SYNC_FORMAT
        || envelope.protocol_version != SYNC_PROTOCOL_VERSION
        || envelope.cipher != SYNC_CIPHER
        || envelope.kdf.name != SYNC_KDF
    {
        return Err(sync_snapshot_secret_decrypt_failed(
            "unsupported remote secrets envelope",
        ));
    }
    Ok(())
}

fn derive_sync_key(
    sync_password: &str,
    salt: &[u8; SYNC_SALT_BYTES],
    kdf: &RemoteSecretsKdf,
) -> Result<[u8; SYNC_KEY_BYTES], AppError> {
    let params = Params::new(
        kdf.memory_cost_kib,
        kdf.time_cost,
        kdf.parallelism,
        Some(SYNC_KEY_BYTES),
    )
    .map_err(|error| sync_snapshot_secret_decrypt_failed(error))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; SYNC_KEY_BYTES];
    argon2
        .hash_password_into(sync_password.as_bytes(), salt, &mut key)
        .map_err(|error| sync_snapshot_secret_decrypt_failed(error))?;
    Ok(key)
}

fn encrypt_bytes(
    key: &[u8; SYNC_KEY_BYTES],
    nonce: &[u8; SYNC_NONCE_BYTES],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| sync_snapshot_serialize_failed("invalid nonce length"))?;
    cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|error| sync_snapshot_serialize_failed(error))
}

fn decrypt_bytes(
    key: &[u8; SYNC_KEY_BYTES],
    nonce: &[u8; SYNC_NONCE_BYTES],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| sync_snapshot_secret_decrypt_failed("invalid nonce length"))?;
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|error| sync_snapshot_secret_decrypt_failed(error))
}

fn random_array<const N: usize>() -> Result<[u8; N], AppError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(sync_snapshot_serialize_failed)?;
    Ok(bytes)
}

fn decode_base64_fixed<const N: usize>(value: &str, label: &str) -> Result<[u8; N], AppError> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|error| sync_snapshot_secret_decrypt_failed(format!("{label}: {error}")))?;
    bytes.try_into().map_err(|_| {
        sync_snapshot_secret_decrypt_failed(format!("{label} length must be {N} bytes"))
    })
}

fn remote_secret_aad(snapshot_id: &str, data_hash: &str) -> Vec<u8> {
    format!("{SYNC_FORMAT}|{SYNC_PROTOCOL_VERSION}|{snapshot_id}|{data_hash}").into_bytes()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn sync_snapshot_import_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_import_failed",
        "同步快照导入失败，本地数据未替换。",
        raw,
        true,
    )
}
fn sync_snapshot_incompatible(raw: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_incompatible",
        "同步快照格式不兼容。",
        raw,
        true,
    )
}

fn sync_snapshot_secret_decrypt_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_secret_decrypt_failed",
        "同步密码不正确或 secrets.enc 已损坏。",
        raw,
        true,
    )
}

fn sync_snapshot_serialize_failed(raw: impl ToString) -> AppError {
    AppError::new(
        "sync_snapshot_serialize_failed",
        "同步快照序列化失败。",
        raw,
        true,
    )
}

#[cfg(test)]
impl SyncExportOptions {
    fn test(device_id: &str, device_name: &str, sync_password: Option<&str>) -> Self {
        Self {
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            created_at: "2026-06-20T00:00:00+08:00".to_string(),
            sync_password: sync_password.map(ToOwned::to_owned),
        }
    }
}

#[cfg(test)]
impl SyncImportOptions {
    fn test(sync_password: Option<&str>) -> Self {
        Self {
            sync_password: sync_password.map(ToOwned::to_owned),
        }
    }
}

#[cfg(test)]
impl SyncSnapshotBundle {
    fn from_data_for_test(data_json: Vec<u8>) -> Self {
        let manifest = build_manifest(
            uuid::Uuid::new_v4().to_string(),
            "test-device".to_string(),
            "Test Device".to_string(),
            "2026-06-20T00:00:00+08:00".to_string(),
            &data_json,
            None,
        );
        let manifest_json = serde_json::to_vec_pretty(&manifest).unwrap();
        Self {
            manifest,
            manifest_json,
            data_json,
            remote_secrets_enc: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::connections::{
        ConnectionAdvancedConfig, ConnectionAuthKind, ConnectionCredentialMode,
        ConnectionJumpConfig, ConnectionProfileInput, ConnectionProtocol, ConnectionProxyConfig,
    };
    use crate::credentials::CredentialProfileInput;
    use crate::storage_repository::StorageRepository;
    use crate::storage_vault::InMemorySecretStore;

    use super::{
        validate_bundle_artifacts, SyncExportOptions, SyncImportOptions, SyncSnapshotBundle,
        SyncSnapshotService,
    };

    #[test]
    fn export_data_excludes_local_secret_references_and_plaintext_secrets() {
        let (repo, _secrets) = temp_repository("export-sanitizes");
        seed_secret_profiles(&repo);

        let bundle = SyncSnapshotService::export_bundle(
            &repo,
            SyncExportOptions::test("device-a", "Desk A", Some("sync-password")),
        )
        .unwrap();

        let data_text = std::str::from_utf8(&bundle.data_json).unwrap();
        assert!(!data_text.contains("secret_ref"));
        assert!(!data_text.contains("\"inline_password\""));
        assert!(!data_text.contains("\"private_key_passphrase\""));
        assert!(!data_text.contains("inline-secret"));
        assert!(!data_text.contains("credential-secret"));
        assert!(!data_text.contains("account="));
    }

    #[test]
    fn remote_secrets_are_encrypted_with_sync_password() {
        let (repo, _secrets) = temp_repository("encrypted-secrets");
        seed_secret_profiles(&repo);

        let bundle = SyncSnapshotService::export_bundle(
            &repo,
            SyncExportOptions::test("device-a", "Desk A", Some("sync-password")),
        )
        .unwrap();

        let encrypted_text = std::str::from_utf8(bundle.remote_secrets_enc.as_ref().unwrap())
            .expect("encrypted secrets should be json text");
        assert!(!encrypted_text.contains("inline-secret"));
        assert!(!encrypted_text.contains("credential-secret"));

        let wrong_password = SyncSnapshotService::decrypt_remote_secrets(
            &bundle.manifest,
            &bundle.data_json,
            bundle.remote_secrets_enc.as_ref().unwrap(),
            "wrong-password",
        )
        .unwrap_err();
        assert_eq!(wrong_password.code, "sync_snapshot_secret_decrypt_failed");

        let plaintext = SyncSnapshotService::decrypt_remote_secrets(
            &bundle.manifest,
            &bundle.data_json,
            bundle.remote_secrets_enc.as_ref().unwrap(),
            "sync-password",
        )
        .unwrap();
        assert!(plaintext
            .secrets
            .iter()
            .any(|item| item.value == "inline-secret"));
    }

    #[test]
    fn manifest_validation_rejects_hash_and_size_mismatches() {
        let (repo, _secrets) = temp_repository("manifest-validation");
        seed_secret_profiles(&repo);
        let bundle = SyncSnapshotService::export_bundle(
            &repo,
            SyncExportOptions::test("device-a", "Desk A", Some("sync-password")),
        )
        .unwrap();

        let mut tampered_data = bundle.data_json.clone();
        tampered_data.push(b'\n');
        let error = validate_bundle_artifacts(
            &bundle.manifest,
            &tampered_data,
            bundle.remote_secrets_enc.as_deref(),
        )
        .unwrap_err();
        assert_eq!(error.code, "sync_snapshot_size_mismatch");

        let same_size_tampered = vec![b'x'; bundle.data_json.len()];
        let error = validate_bundle_artifacts(
            &bundle.manifest,
            &same_size_tampered,
            bundle.remote_secrets_enc.as_deref(),
        )
        .unwrap_err();
        assert_eq!(error.code, "sync_snapshot_hash_mismatch");
    }

    #[test]
    fn import_without_sync_password_imports_data_and_skips_secrets() {
        let (source, _source_secrets) = temp_repository("import-skip-source");
        seed_secret_profiles(&source);
        let bundle = SyncSnapshotService::export_bundle(
            &source,
            SyncExportOptions::test("device-a", "Desk A", Some("sync-password")),
        )
        .unwrap();
        let (mut target, _target_secrets) = temp_repository("import-skip-target");

        let result =
            SyncSnapshotService::import_bundle(&mut target, &bundle, SyncImportOptions::test(None))
                .unwrap();

        assert!(result.secrets_skipped);
        assert_eq!(target.connection_list().unwrap().len(), 1);
        assert_eq!(
            target
                .resolve_saved_connection("conn-inline", None)
                .unwrap_err()
                .code,
            "secret_missing"
        );
    }

    #[test]
    fn import_with_sync_password_restores_local_vault_secrets_by_slot_id() {
        let (source, _source_secrets) = temp_repository("import-secrets-source");
        seed_secret_profiles(&source);
        let bundle = SyncSnapshotService::export_bundle(
            &source,
            SyncExportOptions::test("device-a", "Desk A", Some("sync-password")),
        )
        .unwrap();
        let (mut target, _target_secrets) = temp_repository("import-secrets-target");

        let result = SyncSnapshotService::import_bundle(
            &mut target,
            &bundle,
            SyncImportOptions::test(Some("sync-password")),
        )
        .unwrap();

        assert!(!result.secrets_skipped);
        let resolved = target
            .resolve_saved_connection("conn-inline", None)
            .unwrap();
        assert_eq!(resolved.password.as_deref(), Some("inline-secret"));
    }

    #[test]
    fn import_failure_creates_backup_and_keeps_existing_rows() {
        let (mut target, _target_secrets) = temp_repository("import-failure-target");
        seed_secret_profiles(&target);
        let invalid_data = br#"{
  "version": 1,
  "connections": [],
  "credentials": [],
  "known_hosts": [],
  "tunnels": [{
    "id": "bad-tunnel",
    "name": "bad",
    "kind": "local",
    "connection_id": "missing-connection",
    "local_host": "127.0.0.1",
    "local_port": 18080,
    "remote_host": "127.0.0.1",
    "remote_port": 80,
    "auto_start": false,
    "created_at": "2026-06-20T00:00:00+08:00",
    "updated_at": "2026-06-20T00:00:00+08:00"
  }],
  "connection_groups": [],
  "settings": {}
}"#;
        let bundle = SyncSnapshotBundle::from_data_for_test(invalid_data.to_vec());

        let error =
            SyncSnapshotService::import_bundle(&mut target, &bundle, SyncImportOptions::test(None))
                .unwrap_err();

        assert_eq!(error.code, "sync_snapshot_import_failed");
        assert_eq!(target.connection_list().unwrap().len(), 1);
        assert!(target.sync_backup_root().join("mxterm.db").exists());
    }

    fn seed_secret_profiles(repo: &StorageRepository) {
        repo.credential_upsert(
            CredentialProfileInput {
                id: Some("cred-password".to_string()),
                name: Some("生产凭据".to_string()),
                username: Some("deploy".to_string()),
                kind: ConnectionAuthKind::Password,
                password: Some("credential-secret".to_string()),
                password_touched: true,
                private_key_path: None,
                private_key_passphrase: None,
                private_key_passphrase_touched: false,
                notes: None,
            },
            "2026-06-20T00:00:00+08:00",
        )
        .unwrap();
        repo.connection_upsert(
            ConnectionProfileInput {
                id: Some("conn-inline".to_string()),
                protocol: ConnectionProtocol::Ssh,
                name: Some("生产连接".to_string()),
                group: Some("生产".to_string()),
                host: "example.com".to_string(),
                port: 22,
                username: "root".to_string(),
                credential_mode: ConnectionCredentialMode::Inline,
                credential_id: None,
                inline_auth_kind: Some(ConnectionAuthKind::Password),
                inline_password: Some("inline-secret".to_string()),
                inline_password_touched: true,
                inline_private_key_path: None,
                inline_private_key_passphrase: None,
                inline_private_key_passphrase_touched: false,
                prompt_auth_kind: None,
                proxy: ConnectionProxyConfig::default(),
                jump: ConnectionJumpConfig::default(),
                advanced: ConnectionAdvancedConfig::default(),
                rdp: None,
                notes: Some("不要同步明文".to_string()),
                is_favorite: Some(true),
                last_connected_at: None,
                remote_os_id: None,
                remote_os_name: None,
                remote_os_version: None,
                auth_kind: None,
                password: None,
                private_key_path: None,
                private_key_passphrase: None,
            },
            "2026-06-20T00:00:00+08:00",
        )
        .unwrap();
    }

    fn temp_repository(name: &str) -> (StorageRepository, Arc<InMemorySecretStore>) {
        let root =
            std::env::temp_dir().join(format!("mxterm-sync-{name}-{}", uuid::Uuid::new_v4()));
        let db_path = root.join("mxterm.db");
        let secrets = Arc::new(InMemorySecretStore::default());
        let repo = StorageRepository::open(db_path, secrets.clone()).unwrap();
        (repo, secrets)
    }
}
