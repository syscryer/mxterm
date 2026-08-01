use std::fmt::{Display, Formatter};

use aes_gcm::aead::{Aead, Nonce as AeadNonce, Payload};
use aes_gcm::{Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::{general_purpose::STANDARD, Engine as _};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub(crate) const PASSWORD_MEMORY_COST_KIB: u32 = 19 * 1024;
pub(crate) const PASSWORD_TIME_COST: u32 = 2;
pub(crate) const PASSWORD_PARALLELISM: u32 = 1;

pub(crate) const PASSWORD_CIPHER: &str = "aes-256-gcm";
pub(crate) const PASSWORD_KDF: &str = "argon2id";
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct EncryptedJsonEnvelope {
    pub kdf: PasswordKdf,
    pub cipher: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct PasswordKdf {
    pub name: String,
    pub memory_cost_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

impl Default for PasswordKdf {
    fn default() -> Self {
        Self {
            name: PASSWORD_KDF.to_string(),
            memory_cost_kib: PASSWORD_MEMORY_COST_KIB,
            time_cost: PASSWORD_TIME_COST,
            parallelism: PASSWORD_PARALLELISM,
        }
    }
}

#[derive(Debug)]
pub(crate) struct SecureBundleError(String);

impl Display for SecureBundleError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

pub(crate) fn encrypt_json<T: Serialize>(
    aad: &[u8],
    password: &str,
    value: &T,
) -> Result<EncryptedJsonEnvelope, SecureBundleError> {
    let kdf = PasswordKdf::default();
    let salt = random_array::<SALT_BYTES>()?;
    let nonce = random_array::<NONCE_BYTES>()?;
    let key = derive_key(password, &salt, &kdf)?;
    let plaintext = serde_json::to_vec(value).map_err(secure_bundle_error)?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce_value = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| secure_bundle_error("invalid nonce length"))?;
    let ciphertext = cipher
        .encrypt(
            &nonce_value,
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(secure_bundle_error)?;

    Ok(EncryptedJsonEnvelope {
        kdf,
        cipher: PASSWORD_CIPHER.to_string(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

pub(crate) fn decrypt_json<T: DeserializeOwned>(
    aad: &[u8],
    password: &str,
    envelope: &EncryptedJsonEnvelope,
) -> Result<T, SecureBundleError> {
    validate_envelope(envelope)?;
    let salt = decode_base64_fixed::<SALT_BYTES>(&envelope.salt, "salt")?;
    let nonce = decode_base64_fixed::<NONCE_BYTES>(&envelope.nonce, "nonce")?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(secure_bundle_error)?;
    let key = derive_key(password, &salt, &envelope.kdf)?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce_value = AeadNonce::<Aes256Gcm>::try_from(nonce.as_slice())
        .map_err(|_| secure_bundle_error("invalid nonce length"))?;
    let plaintext = cipher
        .decrypt(
            &nonce_value,
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map_err(secure_bundle_error)?;
    serde_json::from_slice(&plaintext).map_err(secure_bundle_error)
}

fn validate_envelope(envelope: &EncryptedJsonEnvelope) -> Result<(), SecureBundleError> {
    if envelope.cipher != PASSWORD_CIPHER || envelope.kdf.name != PASSWORD_KDF {
        return Err(secure_bundle_error("unsupported encrypted JSON envelope"));
    }
    Ok(())
}

fn derive_key(
    password: &str,
    salt: &[u8; SALT_BYTES],
    kdf: &PasswordKdf,
) -> Result<[u8; KEY_BYTES], SecureBundleError> {
    let params = Params::new(
        kdf.memory_cost_kib,
        kdf.time_cost,
        kdf.parallelism,
        Some(KEY_BYTES),
    )
    .map_err(secure_bundle_error)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_BYTES];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(secure_bundle_error)?;
    Ok(key)
}

fn random_array<const N: usize>() -> Result<[u8; N], SecureBundleError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(secure_bundle_error)?;
    Ok(bytes)
}

fn decode_base64_fixed<const N: usize>(
    value: &str,
    label: &str,
) -> Result<[u8; N], SecureBundleError> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|error| secure_bundle_error(format!("{label}: {error}")))?;
    bytes
        .try_into()
        .map_err(|_| secure_bundle_error(format!("{label} length must be {N} bytes")))
}

fn secure_bundle_error(error: impl ToString) -> SecureBundleError {
    SecureBundleError(error.to_string())
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::{decrypt_json, encrypt_json};

    #[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
    struct TestSecret {
        value: String,
    }

    #[test]
    fn encrypted_json_round_trips_with_matching_aad() {
        let encrypted = encrypt_json(
            b"mxterm-test:v1:data-hash",
            "password",
            &TestSecret {
                value: "secret".to_string(),
            },
        )
        .unwrap();

        let restored: TestSecret =
            decrypt_json(b"mxterm-test:v1:data-hash", "password", &encrypted).unwrap();

        assert_eq!(restored.value, "secret");
    }

    #[test]
    fn encrypted_json_rejects_wrong_password_and_changed_aad() {
        let encrypted = encrypt_json(
            b"mxterm-test:v1:original",
            "password",
            &TestSecret {
                value: "secret".to_string(),
            },
        )
        .unwrap();

        assert!(
            decrypt_json::<TestSecret>(b"mxterm-test:v1:original", "wrong", &encrypted,).is_err()
        );
        assert!(
            decrypt_json::<TestSecret>(b"mxterm-test:v1:changed", "password", &encrypted,).is_err()
        );
    }
}
