use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};

use crate::app_error::AppError;

#[derive(Clone, Copy)]
pub struct JsonStoreErrorLabels {
    pub create_dir_code: &'static str,
    pub create_dir_message: &'static str,
    pub parse_code: &'static str,
    pub parse_message: &'static str,
    pub read_code: &'static str,
    pub read_message: &'static str,
    pub serialize_code: &'static str,
    pub serialize_message: &'static str,
    pub write_code: &'static str,
    pub write_message: &'static str,
}

pub fn load_json_document<T, F>(
    path: &Path,
    default_document: F,
    labels: JsonStoreErrorLabels,
) -> Result<T, AppError>
where
    T: DeserializeOwned,
    F: FnOnce() -> T,
{
    if !path.exists() {
        return Ok(default_document());
    }

    match read_json_document(path, labels) {
        Ok(document) => Ok(document),
        Err(primary_error) => {
            let backup = backup_path(path);
            if backup.exists() {
                read_json_document(&backup, labels).map_err(|_| primary_error)
            } else {
                Err(primary_error)
            }
        }
    }
}

pub fn write_json_document<T>(
    path: &Path,
    document: &T,
    labels: JsonStoreErrorLabels,
) -> Result<(), AppError>
where
    T: Serialize,
{
    let content = serde_json::to_string_pretty(document).map_err(|error| {
        AppError::new(labels.serialize_code, labels.serialize_message, error, true)
    })?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                labels.create_dir_code,
                labels.create_dir_message,
                error,
                true,
            )
        })?;
    }

    let temp_path = temporary_path(path);
    let write_result = write_json_document_inner(path, &temp_path, content.as_bytes(), labels);
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

pub fn backup_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".bak");
    PathBuf::from(backup)
}

fn read_json_document<T>(path: &Path, labels: JsonStoreErrorLabels) -> Result<T, AppError>
where
    T: DeserializeOwned,
{
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::new(labels.read_code, labels.read_message, error, true))?;
    serde_json::from_str(&content)
        .map_err(|error| AppError::new(labels.parse_code, labels.parse_message, error, true))
}

fn write_json_document_inner(
    path: &Path,
    temp_path: &Path,
    content: &[u8],
    labels: JsonStoreErrorLabels,
) -> Result<(), AppError> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp_path)
        .map_err(|error| AppError::new(labels.write_code, labels.write_message, error, true))?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|error| AppError::new(labels.write_code, labels.write_message, error, true))?;
    drop(file);

    if path.exists() {
        fs::copy(path, backup_path(path))
            .map_err(|error| AppError::new(labels.write_code, labels.write_message, error, true))?;
    }

    replace_file(temp_path, path)
        .map_err(|error| AppError::new(labels.write_code, labels.write_message, error, true))
}

fn temporary_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("store");
    parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()))
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_wide = wide(from);
    let to_wide = wide(to);
    unsafe {
        MoveFileExW(
            PCWSTR(from_wide.as_ptr()),
            PCWSTR(to_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| std::io::Error::from_raw_os_error(error.code().0))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use serde::{Deserialize, Serialize};

    use super::{backup_path, load_json_document, write_json_document, JsonStoreErrorLabels};

    #[derive(Debug, Deserialize, PartialEq, Serialize)]
    struct SampleDocument {
        version: u16,
        items: Vec<String>,
    }

    fn labels() -> JsonStoreErrorLabels {
        JsonStoreErrorLabels {
            create_dir_code: "sample_create_dir_failed",
            create_dir_message: "sample create dir failed",
            parse_code: "sample_parse_failed",
            parse_message: "sample parse failed",
            read_code: "sample_read_failed",
            read_message: "sample read failed",
            serialize_code: "sample_serialize_failed",
            serialize_message: "sample serialize failed",
            write_code: "sample_write_failed",
            write_message: "sample write failed",
        }
    }

    #[test]
    fn load_returns_default_when_store_file_is_missing() {
        let path = temp_store_path("missing");

        let loaded: SampleDocument = load_json_document(
            &path,
            || SampleDocument {
                version: 1,
                items: Vec::new(),
            },
            labels(),
        )
        .unwrap();

        assert_eq!(loaded.version, 1);
        assert!(loaded.items.is_empty());
    }

    #[test]
    fn atomic_write_keeps_backup_and_load_recovers_when_primary_is_corrupt() {
        let path = temp_store_path("recover");
        let root = path.parent().unwrap().to_path_buf();
        let _ = fs::remove_dir_all(&root);

        write_json_document(
            &path,
            &SampleDocument {
                version: 1,
                items: vec!["first".to_string()],
            },
            labels(),
        )
        .unwrap();
        write_json_document(
            &path,
            &SampleDocument {
                version: 1,
                items: vec!["second".to_string()],
            },
            labels(),
        )
        .unwrap();

        assert!(backup_path(&path).exists());
        fs::write(&path, "{ broken json").unwrap();

        let loaded: SampleDocument = load_json_document(
            &path,
            || SampleDocument {
                version: 1,
                items: Vec::new(),
            },
            labels(),
        )
        .unwrap();

        assert_eq!(loaded.items, vec!["first".to_string()]);

        let _ = fs::remove_dir_all(root);
    }

    fn temp_store_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("mxterm-storage-{name}-{}", uuid::Uuid::new_v4()))
            .join("sample.json")
    }
}
