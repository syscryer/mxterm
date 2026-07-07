use std::collections::{HashMap, VecDeque};
use std::io::{ErrorKind, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

use russh_sftp::client::{error::Error as SftpError, SftpSession};
use russh_sftp::protocol::{OpenFlags, StatusCode};
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::ssh_config::ResolvedSshConfig;
use crate::terminal::session::{
    ExecOutput, ExecProgressCallback, ReusableExecSession, ReusableSftpSession,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteFileKind {
    Directory,
    File,
    Symlink,
    Other,
}

impl RemoteFileKind {
    #[cfg(test)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Directory => "directory",
            Self::File => "file",
            Self::Symlink => "symlink",
            Self::Other => "other",
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::Directory => 0,
            Self::Symlink => 1,
            Self::File => 2,
            Self::Other => 3,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: RemoteFileKind,
}

pub const REMOTE_FILE_EDIT_LIMIT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: u64,
    pub mode: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileEntryMetadata {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: u64,
    pub mode: Option<String>,
    #[serde(rename = "type")]
    pub kind: RemoteFileKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFilePathCheckResult {
    pub path: String,
    pub exists: bool,
    #[serde(rename = "type")]
    pub kind: Option<RemoteFileKind>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileReadResult {
    pub content: String,
    pub encoding: String,
    pub editable: bool,
    pub is_binary: bool,
    pub metadata: RemoteFileMetadata,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mtime: u64,
    pub mode: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileWriteResult {
    pub metadata: RemoteFileMetadata,
    pub conflict: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferConflictPolicy {
    Overwrite,
    Skip,
    Rename,
}

impl TransferConflictPolicy {
    pub fn from_request(value: Option<&str>) -> Self {
        match value
            .unwrap_or("rename")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "overwrite" => Self::Overwrite,
            "skip" => Self::Skip,
            // Frontend should resolve "ask" before invoking Rust. If an old caller sends it,
            // keep the non-destructive behavior.
            "ask" | "rename" => Self::Rename,
            _ => Self::Rename,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Overwrite => "overwrite",
            Self::Skip => "skip",
            Self::Rename => "rename",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileUploadResult {
    pub path: String,
    pub name: String,
    pub skipped: bool,
    pub metadata: Option<RemoteFileMetadata>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RemoteFileArchiveUploadResult {
    pub path: String,
    pub name: String,
    pub archive_path: Option<String>,
    pub skipped: bool,
}

pub type SftpProgressCallback = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;

const SFTP_TRANSFER_CHUNK_BYTES: usize = 256 * 1024;

#[derive(Clone, Default)]
pub struct RemoteFileManager {
    sessions: Arc<Mutex<HashMap<String, RemoteFileSessionHandle>>>,
    transfers: Arc<Mutex<HashMap<String, TransferCancelToken>>>,
}

#[derive(Clone)]
struct RemoteFileSessionHandle {
    signature: String,
    session: Arc<Mutex<ReusableExecSession>>,
}

struct RemoteFileSessionConfig {
    connection_id: String,
    signature: String,
    resolved: ResolvedSshConfig,
}

#[derive(Clone, Default)]
pub struct TransferCancelToken {
    cancelled: Arc<AtomicBool>,
}

impl TransferCancelToken {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

pub struct TransferRegistration {
    transfer_id: Option<String>,
    pub token: TransferCancelToken,
    transfers: Arc<Mutex<HashMap<String, TransferCancelToken>>>,
}

impl TransferRegistration {
    pub async fn finish(self) {
        if let Some(id) = self.transfer_id {
            self.transfers.lock().await.remove(&id);
        }
    }
}

#[derive(Debug)]
struct LocalTransferFile {
    source: PathBuf,
    relative_path: String,
    size: u64,
}

#[derive(Debug)]
struct LocalTransferPlan {
    directories: Vec<String>,
    files: Vec<LocalTransferFile>,
    total_bytes: u64,
}

#[derive(Debug)]
struct RemoteTransferFile {
    remote_path: String,
    relative_path: String,
    size: u64,
}

#[derive(Debug)]
struct RemoteTransferPlan {
    directories: Vec<String>,
    files: Vec<RemoteTransferFile>,
    total_bytes: u64,
}

pub fn quote_posix_shell(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn parse_remote_list_output(output: &[u8]) -> Vec<RemoteFileEntry> {
    let mut entries = Vec::new();
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();

    for chunk in fields.chunks(3) {
        let [kind, path, name] = chunk else {
            continue;
        };

        entries.push(RemoteFileEntry {
            name: String::from_utf8_lossy(name).to_string(),
            path: String::from_utf8_lossy(path).to_string(),
            kind: find_kind(kind.first().copied()),
        });
    }

    entries.sort_by(compare_remote_entries);
    entries
}

pub fn build_remote_list_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!(
        "dir={quoted_path}; \
         if [ ! -d \"$dir\" ]; then printf '%s\\n' \"not a directory: $dir\" >&2; exit 2; fi; \
         case \"$dir\" in /) prefix= ;; *) prefix=$dir ;; esac; \
         for entry in \"$prefix\"/* \"$prefix\"/.[!.]* \"$prefix\"/..?*; do \
           [ -e \"$entry\" ] || [ -L \"$entry\" ] || continue; \
           name=${{entry##*/}}; \
           if [ -L \"$entry\" ]; then kind=l; \
           elif [ -d \"$entry\" ]; then kind=d; \
           elif [ -f \"$entry\" ]; then kind=f; \
           else kind=o; fi; \
           printf '%s\\000%s\\000%s\\000' \"$kind\" \"$entry\" \"$name\"; \
         done"
    )
}

pub fn build_remote_metadata_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!(
        "path={quoted_path}; \
         if [ ! -f \"$path\" ]; then printf '%s\\n' \"not a regular file: $path\" >&2; exit 2; fi; \
         size=$(wc -c < \"$path\") || exit 3; \
         mtime=$(stat -c %Y \"$path\" 2>/dev/null || stat -f %m \"$path\" 2>/dev/null) || exit 4; \
         mode=$(stat -c %a \"$path\" 2>/dev/null || stat -f %Lp \"$path\" 2>/dev/null || printf ''); \
         printf '%s\\000%s\\000%s\\000%s\\000' \"$path\" \"$size\" \"$mtime\" \"$mode\""
    )
}

pub fn build_remote_entry_metadata_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!(
        "path={quoted_path}; \
         if [ ! -e \"$path\" ] && [ ! -L \"$path\" ]; then printf '%s\\n' \"missing: $path\" >&2; exit 2; fi; \
         if [ -L \"$path\" ]; then kind=l; elif [ -d \"$path\" ]; then kind=d; elif [ -f \"$path\" ]; then kind=f; else kind=o; fi; \
         size=$(stat -c %s \"$path\" 2>/dev/null || stat -f %z \"$path\" 2>/dev/null || printf 0); \
         mtime=$(stat -c %Y \"$path\" 2>/dev/null || stat -f %m \"$path\" 2>/dev/null) || exit 4; \
         mode=$(stat -c %a \"$path\" 2>/dev/null || stat -f %Lp \"$path\" 2>/dev/null || printf ''); \
         printf '%s\\000%s\\000%s\\000%s\\000%s\\000' \"$kind\" \"$path\" \"$size\" \"$mtime\" \"$mode\""
    )
}

pub fn build_remote_path_check_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!(
        "path={quoted_path}; \
         exists=0; kind=; \
         if [ -L \"$path\" ]; then exists=1; kind=l; \
         elif [ -d \"$path\" ]; then exists=1; kind=d; \
         elif [ -f \"$path\" ]; then exists=1; kind=f; \
         elif [ -e \"$path\" ]; then exists=1; kind=o; fi; \
         printf '%s\\000%s\\000%s\\000' \"$exists\" \"$path\" \"$kind\""
    )
}

pub fn build_remote_read_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    format!("path={quoted_path}; cat \"$path\"")
}

pub fn build_remote_write_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    let tmp_suffix = timestamp_millis();
    format!(
        "path={quoted_path}; \
         case \"$path\" in */*) dir=${{path%/*}}; [ -z \"$dir\" ] && dir=/ ;; *) dir=. ;; esac; \
         base=${{path##*/}}; \
         tmp=\"$dir/.${{base}}.mxterm.{tmp_suffix}.$$\"; \
         cleanup() {{ rm -f \"$tmp\"; }}; trap cleanup INT TERM HUP; \
         cat > \"$tmp\" || {{ cleanup; exit 2; }}; \
         if [ -f \"$path\" ]; then mode=$(stat -c %a \"$path\" 2>/dev/null || stat -f %Lp \"$path\" 2>/dev/null || printf ''); [ -n \"$mode\" ] && chmod \"$mode\" \"$tmp\" 2>/dev/null || true; fi; \
         mv \"$tmp\" \"$path\" || {{ cleanup; exit 3; }}; \
         trap - INT TERM HUP"
    )
}

pub fn build_remote_upload_command(path: &str, policy: TransferConflictPolicy) -> String {
    let quoted_path = quote_posix_shell(path);
    let policy = policy.as_str();
    let tmp_suffix = timestamp_millis();
    format!(
        "target={quoted_path}; policy={policy}; \
         final=\"$target\"; \
         if [ -e \"$target\" ] || [ -L \"$target\" ]; then \
           case \"$policy\" in \
             skip) printf 'SKIP\\000%s\\000' \"$target\"; exit 0 ;; \
             overwrite) final=\"$target\" ;; \
             *) final=$(mx_target=\"$target\" sh -c 'dir=${{mx_target%/*}}; base=${{mx_target##*/}}; [ \"$dir\" = \"$base\" ] && dir=.; case \"$base\" in .*|*.*) stem=${{base%.*}}; ext=.${{base##*.}} ;; *) stem=$base; ext= ;; esac; if [ -z \"$stem\" ] || [ \"$stem\" = \"$base\" ]; then stem=$base; ext=; fi; i=1; while :; do candidate=\"$dir/$stem ($i)$ext\"; [ \"$dir\" = . ] && candidate=\"$stem ($i)$ext\"; if [ ! -e \"$candidate\" ] && [ ! -L \"$candidate\" ]; then printf %s \"$candidate\"; exit 0; fi; i=$((i + 1)); done') ;; \
           esac; \
         fi; \
         path=\"$final\"; \
         case \"$path\" in */*) dir=${{path%/*}}; [ -z \"$dir\" ] && dir=/ ;; *) dir=. ;; esac; \
         base=${{path##*/}}; \
         tmp=\"$dir/.${{base}}.mxterm.{tmp_suffix}.$$\"; \
         cleanup() {{ rm -f \"$tmp\"; }}; trap cleanup INT TERM HUP; \
         cat > \"$tmp\" || {{ cleanup; exit 2; }}; \
         if [ -f \"$path\" ]; then mode=$(stat -c %a \"$path\" 2>/dev/null || stat -f %Lp \"$path\" 2>/dev/null || printf ''); [ -n \"$mode\" ] && chmod \"$mode\" \"$tmp\" 2>/dev/null || true; fi; \
         mv \"$tmp\" \"$path\" || {{ cleanup; exit 3; }}; \
         trap - INT TERM HUP; \
         printf 'OK\\000%s\\000' \"$path\""
    )
}

pub fn build_remote_resolve_child_command(
    parent_path: &str,
    name: &str,
    policy: TransferConflictPolicy,
) -> String {
    let quoted_parent = quote_posix_shell(parent_path);
    let quoted_name = quote_posix_shell(name);
    let policy = policy.as_str();
    format!(
        "parent={quoted_parent}; name={quoted_name}; policy={policy}; \
         [ -d \"$parent\" ] || {{ printf '%s\\n' \"not a directory: $parent\" >&2; exit 2; }}; \
         case \"$parent\" in /) target=\"/$name\" ;; *) target=\"$parent/$name\" ;; esac; \
         final=\"$target\"; skipped=0; \
         if [ -e \"$target\" ] || [ -L \"$target\" ]; then \
           case \"$policy\" in \
             skip) skipped=1 ;; \
             overwrite) final=\"$target\" ;; \
             *) dir=${{target%/*}}; base=${{target##*/}}; i=1; while :; do candidate=\"$dir/$base ($i)\"; if [ ! -e \"$candidate\" ] && [ ! -L \"$candidate\" ]; then final=\"$candidate\"; break; fi; i=$((i + 1)); done ;; \
           esac; \
         fi; \
         printf '%s\\000%s\\000' \"$skipped\" \"$final\""
    )
}

pub fn build_remote_extract_archive_command(
    archive_path: &str,
    target_dir: &str,
    root_name: &str,
    final_path: &str,
    overwrite: bool,
    keep_archive: bool,
) -> String {
    let quoted_archive = quote_posix_shell(archive_path);
    let quoted_target_dir = quote_posix_shell(target_dir);
    let quoted_root_name = quote_posix_shell(root_name);
    let quoted_final_path = quote_posix_shell(final_path);
    let tmp_suffix = timestamp_millis();
    let overwrite_flag = if overwrite { "1" } else { "0" };
    let keep_archive_flag = if keep_archive { "1" } else { "0" };
    format!(
        "archive={quoted_archive}; target_dir={quoted_target_dir}; root_name={quoted_root_name}; final_path={quoted_final_path}; overwrite={overwrite_flag}; keep_archive={keep_archive_flag}; \
         [ -d \"$target_dir\" ] || {{ printf '%s\\n' \"not a directory: $target_dir\" >&2; exit 2; }}; \
         tmp_dir=\"$target_dir/.mxterm-extract-{tmp_suffix}.$$\"; \
         cleanup() {{ rm -rf \"$tmp_dir\"; [ \"$keep_archive\" = 1 ] || rm -f \"$archive\"; }}; trap cleanup INT TERM HUP; \
         mkdir -p \"$tmp_dir\" || exit 3; \
         tar -xzf \"$archive\" -C \"$tmp_dir\" || {{ cleanup; exit 4; }}; \
         src=\"$tmp_dir/$root_name\"; \
         [ -e \"$src\" ] || {{ printf '%s\\n' \"archive root missing: $root_name\" >&2; cleanup; exit 5; }}; \
         if [ -e \"$final_path\" ] || [ -L \"$final_path\" ]; then \
           [ \"$overwrite\" = 1 ] || {{ printf '%s\\n' \"target exists: $final_path\" >&2; cleanup; exit 6; }}; \
           rm -rf -- \"$final_path\" || {{ cleanup; exit 7; }}; \
         fi; \
         mv \"$src\" \"$final_path\" || {{ cleanup; exit 8; }}; \
         cleanup; trap - INT TERM HUP"
    )
}

pub fn build_remote_archive_download_command(path: &str) -> String {
    let quoted_path = quote_posix_shell(path);
    let tmp_suffix = timestamp_millis();
    format!(
        "path={quoted_path}; \
         [ -d \"$path\" ] || {{ printf '%s\\n' \"not a directory: $path\" >&2; exit 2; }}; \
         case \"$path\" in */*) parent=${{path%/*}}; [ -z \"$parent\" ] && parent=/ ;; *) parent=. ;; esac; \
         name=${{path##*/}}; \
         tmp=\"${{TMPDIR:-/tmp}}/.mxterm-download-{tmp_suffix}.$.tar.gz\"; \
         cleanup() {{ rm -f \"$tmp\"; }}; trap cleanup INT TERM HUP; \
         tar -czf \"$tmp\" -C \"$parent\" \"$name\" || {{ cleanup; exit 3; }}; \
         cat \"$tmp\" || {{ cleanup; exit 4; }}; \
         cleanup; trap - INT TERM HUP"
    )
}

pub fn parse_remote_file_metadata(output: &[u8]) -> Option<RemoteFileMetadata> {
    let mut fields = output.split(|byte| *byte == 0);
    let path = fields.next()?;
    let size = fields.next()?;
    let mtime = fields.next()?;
    let mode = fields.next().unwrap_or_default();

    let path = String::from_utf8_lossy(path).to_string();
    let size = String::from_utf8_lossy(size).trim().parse::<u64>().ok()?;
    let mtime = String::from_utf8_lossy(mtime).trim().parse::<u64>().ok()?;
    let mode = String::from_utf8_lossy(mode).trim().to_string();
    Some(RemoteFileMetadata {
        name: remote_file_name(&path),
        path,
        size,
        mtime,
        mode: if mode.is_empty() { None } else { Some(mode) },
    })
}

pub fn parse_remote_entry_metadata(output: &[u8]) -> Option<RemoteFileEntryMetadata> {
    let mut fields = output.split(|byte| *byte == 0);
    let kind = fields.next()?;
    let path = fields.next()?;
    let size = fields.next()?;
    let mtime = fields.next()?;
    let mode = fields.next().unwrap_or_default();

    let path = String::from_utf8_lossy(path).to_string();
    let size = String::from_utf8_lossy(size).trim().parse::<u64>().ok()?;
    let mtime = String::from_utf8_lossy(mtime).trim().parse::<u64>().ok()?;
    let mode = String::from_utf8_lossy(mode).trim().to_string();
    Some(RemoteFileEntryMetadata {
        name: remote_file_name(&path),
        path,
        size,
        mtime,
        mode: if mode.is_empty() { None } else { Some(mode) },
        kind: find_kind(kind.first().copied()),
    })
}

pub fn parse_remote_path_check_output(output: &[u8]) -> Option<RemoteFilePathCheckResult> {
    let mut fields = output.split(|byte| *byte == 0);
    let exists = fields.next()?;
    let path = fields.next()?;
    let kind = fields.next().unwrap_or_default();

    let exists = String::from_utf8_lossy(exists).trim() == "1";
    let path = String::from_utf8_lossy(path).to_string();
    let kind = exists
        .then(|| kind.first().copied())
        .flatten()
        .map(|kind| find_kind(Some(kind)));
    Some(RemoteFilePathCheckResult { exists, path, kind })
}

pub fn parse_remote_transfer_path(output: &[u8]) -> Option<(bool, String)> {
    let mut fields = output.split(|byte| *byte == 0);
    let status = String::from_utf8_lossy(fields.next()?).to_string();
    let path = String::from_utf8_lossy(fields.next()?).to_string();
    Some((status == "SKIP" || status == "1", path))
}

pub fn looks_like_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|byte| *byte == 0)
}

impl RemoteFileManager {
    pub async fn register_transfer(&self, transfer_id: Option<&str>) -> TransferRegistration {
        let transfer_id = transfer_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let token = TransferCancelToken::default();
        if let Some(id) = transfer_id.as_ref() {
            self.transfers
                .lock()
                .await
                .insert(id.clone(), token.clone());
        }

        TransferRegistration {
            transfer_id,
            token,
            transfers: self.transfers.clone(),
        }
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) -> bool {
        let transfer_id = transfer_id.trim();
        if transfer_id.is_empty() {
            return false;
        }
        if let Some(token) = self.transfers.lock().await.get(transfer_id).cloned() {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn list_directory(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let command = build_remote_list_command(path);
        let output = self.exec_with_reconnect(app, &config, &command).await?;

        if output.exit_status != Some(0) {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::new(
                "remote_file_list_failed",
                "远程目录读取失败。",
                detail.trim(),
                true,
            ));
        }

        Ok(parse_remote_list_output(&output.stdout))
    }

    pub async fn check_path(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<RemoteFilePathCheckResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect(app, &config, &build_remote_path_check_command(path))
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_check_path_failed",
                "远程目标预检失败。",
                &output,
            ));
        }
        parse_remote_path_check_output(&output.stdout).ok_or_else(|| {
            AppError::new(
                "remote_file_check_path_parse_failed",
                "远程目标预检结果解析失败。",
                String::from_utf8_lossy(&output.stdout),
                true,
            )
        })
    }

    pub async fn read_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<RemoteFileReadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let metadata = self.metadata(app, &config, path).await?;

        if metadata.size > REMOTE_FILE_EDIT_LIMIT_BYTES {
            return Err(AppError::new(
                "remote_file_too_large",
                "文件超过 2 MB，已阻止直接编辑。",
                format!("path={} size={}", metadata.path, metadata.size),
                true,
            ));
        }

        let output = self
            .exec_with_reconnect(app, &config, &build_remote_read_command(&metadata.path))
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_read_failed",
                "远程文件读取失败。",
                &output,
            ));
        }

        if looks_like_binary(&output.stdout) {
            return Err(AppError::new(
                "remote_file_binary",
                "二进制文件不能直接编辑。",
                metadata.path,
                true,
            ));
        }

        let content = String::from_utf8(output.stdout).map_err(|error| {
            AppError::new("remote_file_not_utf8", "文件不是 UTF-8 文本。", error, true)
        })?;

        Ok(RemoteFileReadResult {
            content,
            editable: true,
            encoding: "utf-8".to_string(),
            is_binary: false,
            name: metadata.name.clone(),
            path: metadata.path.clone(),
            size: metadata.size,
            mtime: metadata.mtime,
            mode: metadata.mode.clone(),
            metadata,
        })
    }

    pub async fn write_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        content: &str,
        expected_mtime: u64,
        expected_size: u64,
        overwrite: bool,
    ) -> Result<RemoteFileWriteResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let current = self.metadata(app, &config, path).await?;
        let changed = current.mtime != expected_mtime || current.size != expected_size;
        if changed && !overwrite {
            return Err(AppError::new(
                "remote_file_conflict",
                "远端文件已变化。",
                format!(
                    "expected size={} mtime={}, current size={} mtime={}",
                    expected_size, expected_mtime, current.size, current.mtime
                ),
                true,
            ));
        }

        let output = self
            .exec_with_reconnect_stdin(
                app,
                &config,
                &build_remote_write_command(path),
                content.as_bytes(),
                None,
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_write_failed",
                "远程文件保存失败。",
                &output,
            ));
        }

        let metadata = self.metadata(app, &config, path).await?;
        Ok(RemoteFileWriteResult {
            metadata,
            conflict: false,
        })
    }

    pub async fn create_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<RemoteFileMetadata, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect(
                app,
                &config,
                &format!(
                    "path={}; if [ -e \"$path\" ] || [ -L \"$path\" ]; then printf '%s\\n' \"already exists: $path\" >&2; exit 2; fi; : > \"$path\"",
                    quote_posix_shell(path),
                ),
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_create_failed",
                "远程文件创建失败。",
                &output,
            ));
        }
        self.metadata(app, &config, path).await
    }

    pub async fn create_directory(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect(
                app,
                &config,
                &format!("path={}; mkdir -p \"$path\"", quote_posix_shell(path)),
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_create_directory_failed",
                "远程文件夹创建失败。",
                &output,
            ));
        }
        Ok(())
    }

    pub async fn rename_entry(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        new_path: &str,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect(
                app,
                &config,
                &format!(
                    "from={}; to={}; mv \"$from\" \"$to\"",
                    quote_posix_shell(path),
                    quote_posix_shell(new_path)
                ),
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_rename_failed",
                "远程条目重命名失败。",
                &output,
            ));
        }
        Ok(())
    }

    pub async fn entry_metadata(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
    ) -> Result<RemoteFileEntryMetadata, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect(app, &config, &build_remote_entry_metadata_command(path))
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_metadata_failed",
                "远程条目信息读取失败。",
                &output,
            ));
        }
        parse_remote_entry_metadata(&output.stdout).ok_or_else(|| {
            AppError::new(
                "remote_file_metadata_parse_failed",
                "远程条目信息解析失败。",
                String::from_utf8_lossy(&output.stdout),
                true,
            )
        })
    }

    pub async fn delete_entry(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        recursive: bool,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let command = if recursive {
            format!(
                "path={}; [ \"$path\" = / ] && {{ printf '%s\\n' 'refuse to delete /' >&2; exit 2; }}; rm -rf -- \"$path\"",
                quote_posix_shell(path)
            )
        } else {
            format!("path={}; rm -f -- \"$path\"", quote_posix_shell(path))
        };
        let output = self.exec_with_reconnect(app, &config, &command).await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_delete_failed",
                "远程条目删除失败。",
                &output,
            ));
        }
        Ok(())
    }

    pub async fn upload_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        content: &[u8],
        conflict_policy: TransferConflictPolicy,
        progress: Option<ExecProgressCallback>,
    ) -> Result<RemoteFileUploadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect_stdin(
                app,
                &config,
                &build_remote_upload_command(path, conflict_policy),
                content,
                progress,
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_upload_failed",
                "远程文件上传失败。",
                &output,
            ));
        }

        let (skipped, final_path) =
            parse_remote_transfer_path(&output.stdout).ok_or_else(|| {
                AppError::new(
                    "remote_file_upload_parse_failed",
                    "远程文件上传结果解析失败。",
                    String::from_utf8_lossy(&output.stdout),
                    true,
                )
            })?;
        let metadata = if skipped {
            None
        } else {
            Some(self.metadata(app, &config, &final_path).await?)
        };

        Ok(RemoteFileUploadResult {
            name: remote_file_name(&final_path),
            path: final_path,
            skipped,
            metadata,
        })
    }

    pub async fn upload_local_file_sftp(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        local_path: &Path,
        conflict_policy: TransferConflictPolicy,
        progress: SftpProgressCallback,
        cancel: TransferCancelToken,
    ) -> Result<RemoteFileUploadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let session = ReusableSftpSession::connect_resolved(app, &config.resolved).await?;
        let result = async {
            let (skipped, final_path) =
                resolve_remote_conflict_sftp(session.sftp(), path, conflict_policy, false).await?;
            if skipped {
                return Ok(RemoteFileUploadResult {
                    metadata: None,
                    name: remote_file_name(&final_path),
                    path: final_path,
                    skipped: true,
                });
            }

            let total_bytes = std::fs::metadata(local_path)
                .map_err(|error| {
                    AppError::new(
                        "remote_file_upload_local_metadata_failed",
                        "本地上传文件信息读取失败。",
                        error,
                        true,
                    )
                })?
                .len();
            upload_sftp_file(
                session.sftp(),
                local_path,
                &final_path,
                total_bytes,
                0,
                progress,
                &cancel,
            )
            .await?;
            let metadata = sftp_remote_file_metadata(session.sftp(), &final_path).await?;

            Ok(RemoteFileUploadResult {
                name: remote_file_name(&final_path),
                path: final_path,
                skipped: false,
                metadata: Some(metadata),
            })
        }
        .await;
        session.close().await;
        result
    }

    pub async fn upload_local_directory_sftp(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        target_dir: &str,
        root_name: &str,
        local_path: &Path,
        conflict_policy: TransferConflictPolicy,
        progress: SftpProgressCallback,
        cancel: TransferCancelToken,
    ) -> Result<RemoteFileArchiveUploadResult, AppError> {
        let plan = build_local_transfer_plan(local_path, &cancel)?;
        let config = RemoteFileSessionConfig::from_config(profile);
        let session = ReusableSftpSession::connect_resolved(app, &config.resolved).await?;
        let result = async {
            ensure_not_cancelled(&cancel)?;
            let target = join_remote_path(target_dir, root_name);
            let (skipped, final_path) =
                resolve_remote_conflict_sftp(session.sftp(), &target, conflict_policy, true)
                    .await?;
            if skipped {
                return Ok(RemoteFileArchiveUploadResult {
                    archive_path: None,
                    name: remote_file_name(&final_path),
                    path: final_path,
                    skipped: true,
                });
            }

            let transfer_root = remote_transfer_part_path(&final_path);
            progress(0, Some(plan.total_bytes));
            ensure_remote_directory_sftp(session.sftp(), &transfer_root).await?;
            for relative_path in &plan.directories {
                ensure_not_cancelled(&cancel)?;
                ensure_remote_directory_sftp(
                    session.sftp(),
                    &join_remote_relative_path(&transfer_root, relative_path),
                )
                .await?;
            }

            let mut base_loaded = 0;
            for file in &plan.files {
                ensure_not_cancelled(&cancel)?;
                let remote_path = join_remote_relative_path(&transfer_root, &file.relative_path);
                if let Some(parent) = remote_path.rsplit_once('/').map(|(parent, _)| parent) {
                    if !parent.is_empty() {
                        ensure_remote_directory_sftp(session.sftp(), parent).await?;
                    }
                }
                upload_sftp_file(
                    session.sftp(),
                    &file.source,
                    &remote_path,
                    file.size,
                    base_loaded,
                    progress.clone(),
                    &cancel,
                )
                .await?;
                base_loaded += file.size;
            }

            if sftp_try_exists(session.sftp(), &final_path).await? {
                remove_remote_tree_sftp(session.sftp(), &final_path).await?;
            }
            session
                .sftp()
                .rename(transfer_root, final_path.clone())
                .await
                .map_err(|error| {
                    sftp_app_error(
                        "remote_file_upload_failed",
                        "远程上传目录重命名失败。",
                        error,
                    )
                })?;
            progress(plan.total_bytes, Some(plan.total_bytes));

            Ok(RemoteFileArchiveUploadResult {
                archive_path: None,
                name: remote_file_name(&final_path),
                path: final_path,
                skipped: false,
            })
        }
        .await;
        session.close().await;
        result
    }

    pub async fn upload_archive(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        target_dir: &str,
        root_name: &str,
        archive_content: &[u8],
        conflict_policy: TransferConflictPolicy,
        keep_archive: bool,
        progress: Option<ExecProgressCallback>,
    ) -> Result<RemoteFileArchiveUploadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let resolve_output = self
            .exec_with_reconnect(
                app,
                &config,
                &build_remote_resolve_child_command(target_dir, root_name, conflict_policy),
            )
            .await?;
        if resolve_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_resolve_failed",
                "远程目录上传目标解析失败。",
                &resolve_output,
            ));
        }

        let (skipped, final_path) =
            parse_remote_transfer_path(&resolve_output.stdout).ok_or_else(|| {
                AppError::new(
                    "remote_file_archive_resolve_parse_failed",
                    "远程目录上传目标解析失败。",
                    String::from_utf8_lossy(&resolve_output.stdout),
                    true,
                )
            })?;
        if skipped {
            return Ok(RemoteFileArchiveUploadResult {
                archive_path: None,
                name: remote_file_name(&final_path),
                path: final_path,
                skipped: true,
            });
        }

        let archive_name = format!(
            ".mxterm-upload-{}-{}.tar.gz",
            timestamp_millis(),
            sanitize_remote_temp_name(root_name)
        );
        let archive_path = join_remote_path(target_dir, &archive_name);
        let upload_output = self
            .exec_with_reconnect_stdin(
                app,
                &config,
                &build_remote_write_command(&archive_path),
                archive_content,
                progress,
            )
            .await?;
        if upload_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_upload_failed",
                "远程目录归档上传失败。",
                &upload_output,
            ));
        }

        let extract_output = self
            .exec_with_reconnect(
                app,
                &config,
                &build_remote_extract_archive_command(
                    &archive_path,
                    target_dir,
                    root_name,
                    &final_path,
                    conflict_policy == TransferConflictPolicy::Overwrite,
                    keep_archive,
                ),
            )
            .await?;
        if extract_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_extract_failed",
                "远程目录解压失败。",
                &extract_output,
            ));
        }

        Ok(RemoteFileArchiveUploadResult {
            archive_path: keep_archive.then_some(archive_path),
            name: remote_file_name(&final_path),
            path: final_path,
            skipped: false,
        })
    }

    pub async fn upload_local_archive(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        target_dir: &str,
        root_name: &str,
        local_path: &Path,
        conflict_policy: TransferConflictPolicy,
        keep_archive: bool,
        progress: ExecProgressCallback,
    ) -> Result<RemoteFileArchiveUploadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let resolve_output = self
            .exec_with_reconnect(
                app,
                &config,
                &build_remote_resolve_child_command(target_dir, root_name, conflict_policy),
            )
            .await?;
        if resolve_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_resolve_failed",
                "远程目录上传目标解析失败。",
                &resolve_output,
            ));
        }

        let (skipped, final_path) =
            parse_remote_transfer_path(&resolve_output.stdout).ok_or_else(|| {
                AppError::new(
                    "remote_file_archive_resolve_parse_failed",
                    "远程目录上传目标解析失败。",
                    String::from_utf8_lossy(&resolve_output.stdout),
                    true,
                )
            })?;
        if skipped {
            return Ok(RemoteFileArchiveUploadResult {
                archive_path: None,
                name: remote_file_name(&final_path),
                path: final_path,
                skipped: true,
            });
        }

        let archive_name = format!(
            ".mxterm-upload-{}-{}.tar.gz",
            timestamp_millis(),
            sanitize_remote_temp_name(root_name)
        );
        let archive_path = join_remote_path(target_dir, &archive_name);
        let upload_output = self
            .exec_with_reconnect_stdin_file_progress(
                app,
                &config,
                &build_remote_write_command(&archive_path),
                local_path,
                progress,
            )
            .await?;
        if upload_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_upload_failed",
                "远程目录归档上传失败。",
                &upload_output,
            ));
        }

        let extract_output = self
            .exec_with_reconnect(
                app,
                &config,
                &build_remote_extract_archive_command(
                    &archive_path,
                    target_dir,
                    root_name,
                    &final_path,
                    conflict_policy == TransferConflictPolicy::Overwrite,
                    keep_archive,
                ),
            )
            .await?;
        if extract_output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_extract_failed",
                "远程目录解压失败。",
                &extract_output,
            ));
        }

        Ok(RemoteFileArchiveUploadResult {
            archive_path: keep_archive.then_some(archive_path),
            name: remote_file_name(&final_path),
            path: final_path,
            skipped: false,
        })
    }

    pub async fn download_file_to_local_sftp(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        target: &Path,
        progress: SftpProgressCallback,
        cancel: TransferCancelToken,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let session = ReusableSftpSession::connect_resolved(app, &config.resolved).await?;
        let result = async {
            let metadata = session
                .sftp()
                .metadata(path.to_string())
                .await
                .map_err(|error| {
                    sftp_app_error(
                        "remote_file_metadata_failed",
                        "远程文件信息读取失败。",
                        error,
                    )
                })?;
            if !metadata.file_type().is_file() {
                return Err(AppError::new(
                    "remote_file_download_failed",
                    "远程路径不是普通文件。",
                    path,
                    true,
                ));
            }
            let total_bytes = metadata.len();
            download_sftp_file(
                session.sftp(),
                path,
                target,
                total_bytes,
                0,
                progress,
                &cancel,
            )
            .await
        }
        .await;
        session.close().await;
        result
    }

    pub async fn download_directory_to_local_sftp(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        target: &Path,
        progress: SftpProgressCallback,
        cancel: TransferCancelToken,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let session = ReusableSftpSession::connect_resolved(app, &config.resolved).await?;
        let result = async {
            let plan = build_remote_transfer_plan(session.sftp(), path, &cancel).await?;
            progress(0, Some(plan.total_bytes));
            tokio::fs::create_dir_all(target).await.map_err(|error| {
                AppError::new(
                    "remote_file_download_create_dir_failed",
                    "本地下载目录创建失败。",
                    error,
                    true,
                )
            })?;
            for relative_path in &plan.directories {
                ensure_not_cancelled(&cancel)?;
                tokio::fs::create_dir_all(local_relative_path(target, relative_path))
                    .await
                    .map_err(|error| {
                        AppError::new(
                            "remote_file_download_create_dir_failed",
                            "本地下载目录创建失败。",
                            error,
                            true,
                        )
                    })?;
            }

            let mut base_loaded = 0;
            for file in &plan.files {
                ensure_not_cancelled(&cancel)?;
                download_sftp_file(
                    session.sftp(),
                    &file.remote_path,
                    &local_relative_path(target, &file.relative_path),
                    file.size,
                    base_loaded,
                    progress.clone(),
                    &cancel,
                )
                .await?;
                base_loaded += file.size;
            }
            progress(plan.total_bytes, Some(plan.total_bytes));
            Ok(())
        }
        .await;
        session.close().await;
        result
    }

    pub async fn download_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        progress: Option<ExecProgressCallback>,
    ) -> Result<Vec<u8>, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect_stdout_progress(
                app,
                &config,
                &build_remote_read_command(path),
                progress,
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_download_failed",
                "远程文件下载失败。",
                &output,
            ));
        }
        Ok(output.stdout)
    }

    /// Download a remote directory as a single in-memory `tar.gz` archive.
    /// Requires the remote host to provide `tar`. Used by the optional
    /// compressed directory-download path; callers should probe
    /// [`remote_tar_available`] first and fall back to SFTP when unavailable.
    pub async fn download_archive(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        progress: Option<ExecProgressCallback>,
    ) -> Result<Vec<u8>, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect_stdout_progress(
                app,
                &config,
                &build_remote_archive_download_command(path),
                progress,
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_archive_download_failed",
                "远程目录归档下载失败。",
                &output,
            ));
        }
        Ok(output.stdout)
    }

    /// Probe whether the remote host can run `tar`. Returns `false` on any
    /// exec error so callers can silently fall back to SFTP transfer.
    pub async fn remote_tar_available(&self, app: &AppHandle, profile: ResolvedSshConfig) -> bool {
        let config = RemoteFileSessionConfig::from_config(profile);
        let Ok(output) = self
            .exec_with_reconnect(app, &config, "command -v tar >/dev/null 2>&1")
            .await
        else {
            return false;
        };
        output.exit_status == Some(0)
    }

    async fn metadata(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
        path: &str,
    ) -> Result<RemoteFileMetadata, AppError> {
        let output = self
            .exec_with_reconnect(app, config, &build_remote_metadata_command(path))
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_metadata_failed",
                "远程文件信息读取失败。",
                &output,
            ));
        }
        parse_remote_file_metadata(&output.stdout).ok_or_else(|| {
            AppError::new(
                "remote_file_metadata_parse_failed",
                "远程文件信息解析失败。",
                String::from_utf8_lossy(&output.stdout),
                true,
            )
        })
    }

    async fn exec_with_reconnect(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
        command: &str,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        match self.exec_with_handle(&handle, command).await {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(app, config).await?;
                self.exec_with_handle(&refreshed, command).await
            }
        }
    }

    async fn exec_with_reconnect_stdin(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
        command: &str,
        stdin: &[u8],
        progress: Option<ExecProgressCallback>,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        match self
            .exec_with_handle_stdin(&handle, command, stdin, progress.clone())
            .await
        {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(app, config).await?;
                self.exec_with_handle_stdin(&refreshed, command, stdin, progress)
                    .await
            }
        }
    }

    async fn exec_with_reconnect_stdin_file_progress(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
        command: &str,
        path: &Path,
        progress: ExecProgressCallback,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        match self
            .exec_with_handle_stdin_file(&handle, command, path, progress.clone())
            .await
        {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(app, config).await?;
                self.exec_with_handle_stdin_file(&refreshed, command, path, progress)
                    .await
            }
        }
    }

    async fn exec_with_reconnect_stdout_progress(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
        command: &str,
        progress: Option<ExecProgressCallback>,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(app, config).await?;
        match self
            .exec_with_handle_stdout_progress(&handle, command, progress.clone())
            .await
        {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(app, config).await?;
                self.exec_with_handle_stdout_progress(&refreshed, command, progress)
                    .await
            }
        }
    }

    async fn exec_with_handle(
        &self,
        handle: &RemoteFileSessionHandle,
        command: &str,
    ) -> Result<ExecOutput, AppError> {
        let session = handle.session.lock().await;
        session.exec(command).await
    }

    async fn exec_with_handle_stdin(
        &self,
        handle: &RemoteFileSessionHandle,
        command: &str,
        stdin: &[u8],
        progress: Option<ExecProgressCallback>,
    ) -> Result<ExecOutput, AppError> {
        let session = handle.session.lock().await;
        if let Some(progress) = progress {
            session
                .exec_with_stdin_progress(command, stdin, progress)
                .await
        } else {
            session.exec_with_stdin(command, stdin).await
        }
    }

    async fn exec_with_handle_stdin_file(
        &self,
        handle: &RemoteFileSessionHandle,
        command: &str,
        path: &Path,
        progress: ExecProgressCallback,
    ) -> Result<ExecOutput, AppError> {
        let session = handle.session.lock().await;
        session
            .exec_with_stdin_file_progress(command, path, progress)
            .await
    }

    async fn exec_with_handle_stdout_progress(
        &self,
        handle: &RemoteFileSessionHandle,
        command: &str,
        progress: Option<ExecProgressCallback>,
    ) -> Result<ExecOutput, AppError> {
        let session = handle.session.lock().await;
        if let Some(progress) = progress {
            session.exec_with_stdout_progress(command, progress).await
        } else {
            session.exec(command).await
        }
    }

    async fn session_handle(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
    ) -> Result<RemoteFileSessionHandle, AppError> {
        if let Some(existing) = self.lookup_handle(&config.connection_id).await {
            if existing.signature == config.signature {
                return Ok(existing);
            }
            self.invalidate_handle(&config.connection_id, &existing)
                .await;
        }

        self.connect_and_store(app, config).await
    }

    async fn lookup_handle(&self, connection_id: &str) -> Option<RemoteFileSessionHandle> {
        self.sessions.lock().await.get(connection_id).cloned()
    }

    async fn connect_and_store(
        &self,
        app: &AppHandle,
        config: &RemoteFileSessionConfig,
    ) -> Result<RemoteFileSessionHandle, AppError> {
        let new_handle = RemoteFileSessionHandle {
            signature: config.signature.clone(),
            session: Arc::new(Mutex::new(
                ReusableExecSession::connect_resolved(app, &config.resolved).await?,
            )),
        };

        let replaced = {
            let mut sessions = self.sessions.lock().await;
            if let Some(existing) = sessions.get(&config.connection_id).cloned() {
                if existing.signature == config.signature {
                    existing
                } else {
                    sessions.insert(config.connection_id.clone(), new_handle.clone());
                    drop(sessions);
                    self.close_handle(existing).await;
                    return Ok(new_handle);
                }
            } else {
                sessions.insert(config.connection_id.clone(), new_handle.clone());
                return Ok(new_handle);
            }
        };

        self.close_handle(new_handle).await;
        Ok(replaced)
    }

    async fn invalidate_handle(&self, connection_id: &str, handle: &RemoteFileSessionHandle) {
        let removed = {
            let mut sessions = self.sessions.lock().await;
            if let Some(current) = sessions.get(connection_id) {
                if Arc::ptr_eq(&current.session, &handle.session) {
                    sessions.remove(connection_id)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(stale) = removed {
            self.close_handle(stale).await;
        }
    }

    async fn close_handle(&self, handle: RemoteFileSessionHandle) {
        let session = handle.session.lock().await;
        session.close().await;
    }
}

impl RemoteFileSessionConfig {
    fn from_config(config: ResolvedSshConfig) -> Self {
        let signature = config.signature();
        Self {
            connection_id: config.connection_id.clone(),
            signature,
            resolved: config,
        }
    }
}

fn build_local_transfer_plan(
    root: &Path,
    cancel: &TransferCancelToken,
) -> Result<LocalTransferPlan, AppError> {
    let mut plan = LocalTransferPlan {
        directories: Vec::new(),
        files: Vec::new(),
        total_bytes: 0,
    };
    let mut pending = VecDeque::from([root.to_path_buf()]);

    while let Some(directory) = pending.pop_front() {
        ensure_not_cancelled(cancel)?;
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            AppError::new(
                "remote_file_upload_local_scan_failed",
                "本地上传目录读取失败。",
                error,
                true,
            )
        })?;
        for entry in entries {
            ensure_not_cancelled(cancel)?;
            let entry = entry.map_err(|error| {
                AppError::new(
                    "remote_file_upload_local_scan_failed",
                    "本地上传目录读取失败。",
                    error,
                    true,
                )
            })?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                AppError::new(
                    "remote_file_upload_local_metadata_failed",
                    "本地上传文件信息读取失败。",
                    error,
                    true,
                )
            })?;
            let file_type = metadata.file_type();
            if file_type.is_dir() {
                let relative_path = local_upload_relative_path(root, &path)?;
                plan.directories.push(relative_path);
                pending.push_back(path);
            } else if file_type.is_file() || (file_type.is_symlink() && path.is_file()) {
                let file_metadata = std::fs::metadata(&path).map_err(|error| {
                    AppError::new(
                        "remote_file_upload_local_metadata_failed",
                        "本地上传文件信息读取失败。",
                        error,
                        true,
                    )
                })?;
                let size = file_metadata.len();
                let relative_path = local_upload_relative_path(root, &path)?;
                plan.total_bytes = plan.total_bytes.checked_add(size).ok_or_else(|| {
                    AppError::new(
                        "remote_file_upload_local_metadata_failed",
                        "本地上传目录过大。",
                        root.to_string_lossy(),
                        true,
                    )
                })?;
                plan.files.push(LocalTransferFile {
                    source: path,
                    relative_path,
                    size,
                });
            }
        }
    }

    plan.directories.sort();
    plan.files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(plan)
}

async fn build_remote_transfer_plan(
    sftp: &SftpSession,
    root_path: &str,
    cancel: &TransferCancelToken,
) -> Result<RemoteTransferPlan, AppError> {
    let root_metadata = sftp
        .metadata(root_path.to_string())
        .await
        .map_err(|error| {
            sftp_app_error(
                "remote_file_metadata_failed",
                "远程文件信息读取失败。",
                error,
            )
        })?;
    if !root_metadata.file_type().is_dir() {
        return Err(AppError::new(
            "remote_file_archive_download_failed",
            "远程路径不是目录。",
            root_path,
            true,
        ));
    }

    let mut plan = RemoteTransferPlan {
        directories: Vec::new(),
        files: Vec::new(),
        total_bytes: 0,
    };
    let mut pending =
        VecDeque::from([(root_path.trim_end_matches('/').to_string(), String::new())]);

    while let Some((directory, relative_directory)) = pending.pop_front() {
        ensure_not_cancelled(cancel)?;
        let entries = sftp.read_dir(directory.clone()).await.map_err(|error| {
            sftp_app_error(
                "remote_file_archive_download_failed",
                "远程目录读取失败。",
                error,
            )
        })?;
        for entry in entries {
            ensure_not_cancelled(cancel)?;
            let relative_path = join_relative_path(&relative_directory, &entry.file_name());
            let entry_path = entry.path();
            let entry_metadata = entry.metadata();
            if entry.file_type().is_dir() {
                plan.directories.push(relative_path.clone());
                pending.push_back((entry_path, relative_path));
            } else if entry.file_type().is_file() {
                let size = entry_metadata.len();
                plan.total_bytes = plan.total_bytes.checked_add(size).ok_or_else(|| {
                    AppError::new(
                        "remote_file_archive_download_failed",
                        "远程目录过大。",
                        root_path,
                        true,
                    )
                })?;
                plan.files.push(RemoteTransferFile {
                    remote_path: entry_path,
                    relative_path,
                    size,
                });
            }
        }
    }

    plan.directories.sort();
    plan.files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(plan)
}

fn local_upload_relative_path(root: &Path, path: &Path) -> Result<String, AppError> {
    let relative = path.strip_prefix(root).map_err(|error| {
        AppError::new(
            "remote_file_upload_local_scan_failed",
            "本地上传目录路径解析失败。",
            error,
            true,
        )
    })?;
    let mut segments = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => {
                let Some(text) = value.to_str() else {
                    return Err(AppError::new(
                        "remote_file_upload_local_scan_failed",
                        "本地上传路径包含无法识别的字符。",
                        path.to_string_lossy(),
                        true,
                    ));
                };
                if !text.is_empty() {
                    segments.push(text.to_string());
                }
            }
            Component::CurDir => {}
            _ => {
                return Err(AppError::new(
                    "remote_file_upload_local_scan_failed",
                    "本地上传路径包含无效片段。",
                    path.to_string_lossy(),
                    true,
                ));
            }
        }
    }

    if segments.is_empty() {
        return Err(AppError::new(
            "remote_file_upload_local_scan_failed",
            "本地上传路径缺少相对片段。",
            path.to_string_lossy(),
            true,
        ));
    }
    Ok(segments.join("/"))
}

fn join_relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn join_remote_relative_path(root: &str, relative_path: &str) -> String {
    relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .fold(
            root.trim_end_matches('/').to_string(),
            |current, segment| join_remote_path(&current, segment),
        )
}

fn local_relative_path(root: &Path, relative_path: &str) -> PathBuf {
    relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .fold(root.to_path_buf(), |mut current, segment| {
            current.push(segment);
            current
        })
}

async fn upload_sftp_file(
    sftp: &SftpSession,
    local_path: &Path,
    final_remote_path: &str,
    total_bytes: u64,
    base_loaded: u64,
    progress: SftpProgressCallback,
    cancel: &TransferCancelToken,
) -> Result<(), AppError> {
    let part_path = remote_transfer_part_path(final_remote_path);
    let existing_part_bytes = match sftp.metadata(part_path.clone()).await {
        Ok(metadata) => metadata.len(),
        Err(error) if sftp_is_not_found(&error) => 0,
        Err(error) => {
            return Err(sftp_app_error(
                "remote_file_upload_failed",
                "远程临时文件信息读取失败。",
                error,
            ));
        }
    };
    let resume_offset = resume_offset_for_partial(existing_part_bytes, total_bytes);
    if existing_part_bytes > total_bytes {
        ignore_sftp_not_found(sftp.remove_file(part_path.clone()).await)?;
    }

    let mut local_file = tokio::fs::File::open(local_path).await.map_err(|error| {
        AppError::new(
            "remote_file_upload_local_open_failed",
            "本地上传文件打开失败。",
            error,
            true,
        )
    })?;
    if resume_offset > 0 {
        local_file
            .seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_upload_local_seek_failed",
                    "本地上传文件续传定位失败。",
                    error,
                    true,
                )
            })?;
    }

    let flags = if resume_offset == 0 {
        OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE
    } else {
        OpenFlags::CREATE | OpenFlags::WRITE
    };
    let mut remote_file = sftp
        .open_with_flags(part_path.clone(), flags)
        .await
        .map_err(|error| {
            sftp_app_error("remote_file_upload_failed", "远程文件上传失败。", error)
        })?;
    if resume_offset > 0 {
        remote_file
            .seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_upload_failed",
                    "远程临时文件续传定位失败。",
                    error,
                    true,
                )
            })?;
    }

    let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
    let mut loaded = resume_offset;
    progress(base_loaded + loaded, Some(base_loaded + total_bytes));
    loop {
        ensure_not_cancelled(cancel)?;
        let read = local_file.read(&mut buffer).await.map_err(|error| {
            AppError::new(
                "remote_file_upload_local_read_failed",
                "本地上传文件读取失败。",
                error,
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        remote_file
            .write_all(&buffer[..read])
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_upload_failed",
                    "远程文件上传失败。",
                    error,
                    true,
                )
            })?;
        loaded += read as u64;
        progress(base_loaded + loaded, Some(base_loaded + total_bytes));
    }
    remote_file
        .shutdown()
        .await
        .map_err(remote_file_upload_confirm_error)?;

    ignore_sftp_not_found(sftp.remove_file(final_remote_path.to_string()).await)?;
    sftp.rename(part_path, final_remote_path.to_string())
        .await
        .map_err(|error| {
            sftp_app_error(
                "remote_file_upload_failed",
                "远程临时文件重命名失败。",
                error,
            )
        })?;
    progress(base_loaded + total_bytes, Some(base_loaded + total_bytes));
    Ok(())
}

async fn download_sftp_file(
    sftp: &SftpSession,
    remote_path: &str,
    final_local_path: &Path,
    total_bytes: u64,
    base_loaded: u64,
    progress: SftpProgressCallback,
    cancel: &TransferCancelToken,
) -> Result<(), AppError> {
    if let Some(parent) = final_local_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            AppError::new(
                "remote_file_download_create_dir_failed",
                "本地下载目录创建失败。",
                error,
                true,
            )
        })?;
    }

    let part_path = local_download_part_path(final_local_path);
    let existing_part_bytes = match std::fs::metadata(&part_path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == ErrorKind::NotFound => 0,
        Err(error) => {
            return Err(AppError::new(
                "remote_file_download_write_failed",
                "本地临时文件信息读取失败。",
                error,
                true,
            ));
        }
    };
    let resume_offset = resume_offset_for_partial(existing_part_bytes, total_bytes);
    if existing_part_bytes > total_bytes {
        let _ = tokio::fs::remove_file(&part_path).await;
    }

    let mut remote_file = sftp.open(remote_path.to_string()).await.map_err(|error| {
        sftp_app_error("remote_file_download_failed", "远程文件下载失败。", error)
    })?;
    if resume_offset > 0 {
        remote_file
            .seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_download_failed",
                    "远程文件续传定位失败。",
                    error,
                    true,
                )
            })?;
    }

    let mut local_options = tokio::fs::OpenOptions::new();
    local_options.create(true).write(true);
    if resume_offset == 0 {
        local_options.truncate(true);
    }
    let mut local_file = local_options.open(&part_path).await.map_err(|error| {
        AppError::new(
            "remote_file_download_write_failed",
            "本地临时文件打开失败。",
            error,
            true,
        )
    })?;
    if resume_offset > 0 {
        local_file
            .seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_download_write_failed",
                    "本地临时文件续传定位失败。",
                    error,
                    true,
                )
            })?;
    }

    let mut buffer = vec![0u8; SFTP_TRANSFER_CHUNK_BYTES];
    let mut loaded = resume_offset;
    progress(base_loaded + loaded, Some(base_loaded + total_bytes));
    while loaded < total_bytes {
        ensure_not_cancelled(cancel)?;
        let read_len = next_transfer_read_len(loaded, total_bytes, buffer.len());
        let read = remote_file
            .read(&mut buffer[..read_len])
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_download_failed",
                    "远程文件下载失败。",
                    error,
                    true,
                )
            })?;
        if read == 0 {
            return Err(AppError::new(
                "remote_file_download_failed",
                "远程文件提前结束。",
                format!("expected {total_bytes} bytes, received {loaded} bytes"),
                true,
            ));
        }
        local_file
            .write_all(&buffer[..read])
            .await
            .map_err(|error| {
                AppError::new(
                    "remote_file_download_write_failed",
                    "本地文件写入失败。",
                    error,
                    true,
                )
            })?;
        loaded += read as u64;
        progress(base_loaded + loaded, Some(base_loaded + total_bytes));
    }
    if loaded != total_bytes {
        return Err(AppError::new(
            "remote_file_download_failed",
            "远程文件下载不完整。",
            format!("expected {total_bytes} bytes, received {loaded} bytes"),
            true,
        ));
    }
    local_file.flush().await.map_err(|error| {
        AppError::new(
            "remote_file_download_write_failed",
            "本地文件刷新失败。",
            error,
            true,
        )
    })?;
    drop(local_file);
    if final_local_path.exists() {
        let _ = tokio::fs::remove_file(final_local_path).await;
    }
    tokio::fs::rename(&part_path, final_local_path)
        .await
        .map_err(|error| {
            AppError::new(
                "remote_file_download_write_failed",
                "本地临时文件重命名失败。",
                error,
                true,
            )
        })?;
    progress(base_loaded + total_bytes, Some(base_loaded + total_bytes));
    Ok(())
}

async fn resolve_remote_conflict_sftp(
    sftp: &SftpSession,
    target: &str,
    policy: TransferConflictPolicy,
    directory: bool,
) -> Result<(bool, String), AppError> {
    if !sftp_try_exists(sftp, target).await? {
        return Ok((false, target.to_string()));
    }
    match policy {
        TransferConflictPolicy::Skip => Ok((true, target.to_string())),
        TransferConflictPolicy::Overwrite => Ok((false, target.to_string())),
        TransferConflictPolicy::Rename => {
            let parent = remote_parent_path(target);
            let file_name = remote_file_name(target);
            let (stem, extension) = split_remote_name(&file_name, !directory);
            for index in 1..10_000 {
                let candidate_name = if extension.is_empty() {
                    format!("{stem} ({index})")
                } else {
                    format!("{stem} ({index}).{extension}")
                };
                let candidate = join_remote_path(&parent, &candidate_name);
                if !sftp_try_exists(sftp, &candidate).await? {
                    return Ok((false, candidate));
                }
            }
            Err(AppError::new(
                "remote_file_upload_rename_failed",
                "远程同名条目过多，无法自动重命名。",
                target,
                true,
            ))
        }
    }
}

async fn ensure_remote_directory_sftp(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    let path = path.trim().trim_end_matches('/');
    if path.is_empty() || path == "." || path == "/" {
        return Ok(());
    }

    let mut current = if path.starts_with('/') {
        "/".to_string()
    } else {
        String::new()
    };
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        current = if current.is_empty() {
            segment.to_string()
        } else if current == "/" {
            format!("/{segment}")
        } else {
            format!("{current}/{segment}")
        };

        match sftp.create_dir(current.clone()).await {
            Ok(()) => {}
            Err(error) => match sftp.metadata(current.clone()).await {
                Ok(metadata) if metadata.file_type().is_dir() => {}
                Ok(_) => {
                    return Err(AppError::new(
                        "remote_file_create_directory_failed",
                        "远程路径已存在但不是目录。",
                        current,
                        true,
                    ));
                }
                Err(_) => {
                    return Err(sftp_app_error(
                        "remote_file_create_directory_failed",
                        "远程目录创建失败。",
                        error,
                    ));
                }
            },
        }
    }

    Ok(())
}

async fn sftp_remote_file_metadata(
    sftp: &SftpSession,
    path: &str,
) -> Result<RemoteFileMetadata, AppError> {
    let metadata = sftp.metadata(path.to_string()).await.map_err(|error| {
        sftp_app_error(
            "remote_file_metadata_failed",
            "远程文件信息读取失败。",
            error,
        )
    })?;
    Ok(RemoteFileMetadata {
        mode: metadata
            .permissions
            .map(|mode| format!("{:o}", mode & 0o7777)),
        mtime: metadata.mtime.unwrap_or(0) as u64,
        name: remote_file_name(path),
        path: path.to_string(),
        size: metadata.len(),
    })
}

async fn remove_remote_tree_sftp(sftp: &SftpSession, path: &str) -> Result<(), AppError> {
    enum RemoveStep {
        Enter(String),
        RemoveDirectory(String),
    }

    let mut pending = vec![RemoveStep::Enter(path.to_string())];
    while let Some(step) = pending.pop() {
        match step {
            RemoveStep::Enter(current) => {
                let metadata = sftp.metadata(current.clone()).await.map_err(|error| {
                    sftp_app_error("remote_file_delete_failed", "远程条目删除失败。", error)
                })?;
                if metadata.file_type().is_dir() {
                    pending.push(RemoveStep::RemoveDirectory(current.clone()));
                    let entries = sftp.read_dir(current).await.map_err(|error| {
                        sftp_app_error("remote_file_delete_failed", "远程目录读取失败。", error)
                    })?;
                    for entry in entries {
                        pending.push(RemoveStep::Enter(entry.path()));
                    }
                } else {
                    sftp.remove_file(current).await.map_err(|error| {
                        sftp_app_error("remote_file_delete_failed", "远程文件删除失败。", error)
                    })?;
                }
            }
            RemoveStep::RemoveDirectory(current) => {
                sftp.remove_dir(current).await.map_err(|error| {
                    sftp_app_error("remote_file_delete_failed", "远程目录删除失败。", error)
                })?;
            }
        }
    }
    Ok(())
}

async fn sftp_try_exists(sftp: &SftpSession, path: &str) -> Result<bool, AppError> {
    sftp.try_exists(path.to_string()).await.map_err(|error| {
        sftp_app_error("remote_file_check_path_failed", "远程路径检查失败。", error)
    })
}

fn ensure_not_cancelled(cancel: &TransferCancelToken) -> Result<(), AppError> {
    if cancel.is_cancelled() {
        Err(AppError::new(
            "remote_file_transfer_canceled",
            "传输已取消。",
            "transfer canceled",
            true,
        ))
    } else {
        Ok(())
    }
}

fn sftp_is_not_found(error: &SftpError) -> bool {
    matches!(error, SftpError::Status(status) if status.status_code == StatusCode::NoSuchFile)
}

fn ignore_sftp_not_found(result: Result<(), SftpError>) -> Result<(), AppError> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if sftp_is_not_found(&error) => Ok(()),
        Err(error) => Err(sftp_app_error(
            "remote_file_transfer_failed",
            "远程文件操作失败。",
            error,
        )),
    }
}

fn sftp_app_error(code: &'static str, message: &'static str, error: SftpError) -> AppError {
    AppError::new(code, message, error, true)
}

fn remote_file_upload_confirm_error(error: std::io::Error) -> AppError {
    let raw_message = error.to_string();
    if raw_message.eq_ignore_ascii_case("timeout") {
        return AppError::new(
            "remote_file_upload_confirm_timeout",
            "远程写入确认超时。",
            raw_message,
            true,
        );
    }
    AppError::new(
        "remote_file_upload_confirm_failed",
        "远程文件上传确认失败。",
        raw_message,
        true,
    )
}

fn remote_parent_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((parent, _)) if !parent.is_empty() => parent.to_string(),
        _ => ".".to_string(),
    }
}

fn split_remote_name(name: &str, file_like: bool) -> (String, String) {
    if !file_like {
        return (name.to_string(), String::new());
    }
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem.to_string(), extension.to_string())
        }
        _ => (name.to_string(), String::new()),
    }
}

fn find_kind(kind: Option<u8>) -> RemoteFileKind {
    match kind {
        Some(b'd') => RemoteFileKind::Directory,
        Some(b'f') => RemoteFileKind::File,
        Some(b'l') => RemoteFileKind::Symlink,
        _ => RemoteFileKind::Other,
    }
}

fn compare_remote_entries(left: &RemoteFileEntry, right: &RemoteFileEntry) -> std::cmp::Ordering {
    left.kind
        .rank()
        .cmp(&right.kind.rank())
        .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        .then_with(|| left.name.cmp(&right.name))
}

fn remote_file_name(path: &str) -> String {
    path.rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn join_remote_path(parent: &str, name: &str) -> String {
    let parent = if parent.trim().is_empty() {
        "/"
    } else {
        parent.trim()
    };
    let name = name.trim().trim_start_matches('/');
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }
}

fn sanitize_remote_temp_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|ch| {
            if ch == '/' || ch == '\\' || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches(|ch| ch == ' ' || ch == '.');
    if sanitized.is_empty() {
        "archive".to_string()
    } else {
        sanitized.to_string()
    }
}

fn remote_file_command_error(code: &str, message: &str, output: &ExecOutput) -> AppError {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    AppError::new(code, message, detail, true)
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn remote_transfer_part_path(path: &str) -> String {
    format!("{path}.mxpart")
}

fn local_download_part_path(path: &Path) -> std::path::PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".mxpart");
    std::path::PathBuf::from(value)
}

fn resume_offset_for_partial(partial_bytes: u64, total_bytes: u64) -> u64 {
    if partial_bytes <= total_bytes {
        partial_bytes
    } else {
        0
    }
}

fn next_transfer_read_len(loaded_bytes: u64, total_bytes: u64, buffer_len: usize) -> usize {
    let remaining = total_bytes.saturating_sub(loaded_bytes);
    remaining.min(buffer_len as u64) as usize
}

#[cfg(test)]
mod tests {
    use super::{
        build_remote_list_command, build_remote_path_check_command, build_remote_write_command,
        join_remote_relative_path, local_download_part_path, local_relative_path,
        local_upload_relative_path, looks_like_binary, next_transfer_read_len,
        parse_remote_file_metadata, parse_remote_list_output, parse_remote_path_check_output,
        quote_posix_shell, remote_file_upload_confirm_error, remote_parent_path,
        remote_transfer_part_path, resume_offset_for_partial, split_remote_name,
        REMOTE_FILE_EDIT_LIMIT_BYTES,
    };
    use std::path::Path;

    #[test]
    fn quote_posix_shell_wraps_paths_and_escapes_single_quotes() {
        assert_eq!(quote_posix_shell("/opt/app"), "'/opt/app'");
        assert_eq!(
            quote_posix_shell("/srv/app's data"),
            "'/srv/app'\\''s data'"
        );
        assert_eq!(quote_posix_shell(""), "''");
    }

    #[test]
    fn parse_remote_list_output_maps_types_and_sorts_directories_first() {
        let output = b"f\0/opt/app/app.log\0app.log\0d\0/opt/app/logs\0logs\0l\0/opt/app/current\0current\0o\0/opt/app/socket\0socket\0";

        let entries = parse_remote_list_output(output);

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].name, "logs");
        assert_eq!(entries[0].kind.as_str(), "directory");
        assert_eq!(entries[1].name, "current");
        assert_eq!(entries[1].kind.as_str(), "symlink");
        assert_eq!(entries[2].name, "app.log");
        assert_eq!(entries[2].kind.as_str(), "file");
        assert_eq!(entries[3].name, "socket");
        assert_eq!(entries[3].kind.as_str(), "other");
    }

    #[test]
    fn parse_remote_list_output_ignores_malformed_trailing_chunks() {
        let output = b"d\0/root/logs\0logs\0f\0/root/app.log\0";

        let entries = parse_remote_list_output(output);

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "logs");
    }

    #[test]
    fn build_remote_list_command_uses_posix_shell_globs_not_find_printf() {
        let command = build_remote_list_command("/srv/app's data");

        assert!(command.contains("dir='/srv/app'\\''s data'"));
        assert!(!command.contains("-printf"));
        assert!(command.contains("printf '%s\\000%s\\000%s\\000'"));
        assert!(command.contains("\"$prefix\"/.[!.]*"));
    }

    #[test]
    fn build_remote_path_check_command_checks_only_one_target() {
        let command = build_remote_path_check_command("/srv/app's data/dist");

        assert!(command.contains("path='/srv/app'\\''s data/dist'"));
        assert!(command.contains("[ -L \"$path\" ]"));
        assert!(command.contains("[ -d \"$path\" ]"));
        assert!(command.contains("[ -f \"$path\" ]"));
        assert!(command.contains("printf '%s\\000%s\\000%s\\000'"));
        assert!(!command.contains("for entry"));
        assert!(!command.contains("tar "));
    }

    #[test]
    fn parse_remote_file_metadata_reads_nul_fields_and_empty_mode() {
        let metadata = parse_remote_file_metadata(b"/opt/app/app.conf\x0042\x001717711111\x00\x00")
            .expect("metadata should parse");

        assert_eq!(metadata.path, "/opt/app/app.conf");
        assert_eq!(metadata.name, "app.conf");
        assert_eq!(metadata.size, 42);
        assert_eq!(metadata.mtime, 1717711111);
        assert_eq!(metadata.mode, None);
    }

    #[test]
    fn parse_remote_file_metadata_keeps_mode_when_present() {
        let metadata =
            parse_remote_file_metadata(b"/opt/app/deploy.sh\x00128\x001717712222\x00755\x00")
                .expect("metadata should parse");

        assert_eq!(metadata.name, "deploy.sh");
        assert_eq!(metadata.mode.as_deref(), Some("755"));
    }

    #[test]
    fn parse_remote_path_check_output_maps_missing_and_existing_targets() {
        let missing = parse_remote_path_check_output(b"0\0/opt/app/dist\0\0")
            .expect("missing path check should parse");
        assert!(!missing.exists);
        assert_eq!(missing.path, "/opt/app/dist");
        assert!(missing.kind.is_none());

        let existing = parse_remote_path_check_output(b"1\0/opt/app/dist\0d\0")
            .expect("existing path check should parse");
        assert!(existing.exists);
        assert_eq!(existing.path, "/opt/app/dist");
        assert_eq!(
            existing.kind.as_ref().map(|kind| kind.as_str()),
            Some("directory")
        );
    }

    #[test]
    fn looks_like_binary_detects_nul_without_rejecting_plain_text() {
        assert!(!looks_like_binary(b"hello\nworld\n"));
        assert!(looks_like_binary(b"hello\0world"));
    }

    #[test]
    fn build_remote_write_command_uses_temp_file_and_does_not_embed_content() {
        let content = "literal content that must never appear";
        let command = build_remote_write_command("/srv/app's data/app.conf");

        assert!(command.contains("path='/srv/app'\\''s data/app.conf'"));
        assert!(command.contains("cat > \"$tmp\""));
        assert!(command.contains("mv \"$tmp\" \"$path\""));
        assert!(command.contains(".mxterm."));
        assert!(!command.contains(content));
    }

    #[test]
    fn edit_limit_is_two_megabytes() {
        assert_eq!(REMOTE_FILE_EDIT_LIMIT_BYTES, 2 * 1024 * 1024);
    }

    #[test]
    fn transfer_part_paths_stay_next_to_final_targets() {
        assert_eq!(
            remote_transfer_part_path("/opt/app/archive.tar.gz"),
            "/opt/app/archive.tar.gz.mxpart"
        );
        assert_eq!(
            local_download_part_path(Path::new(r"C:\Users\csm\Downloads\setup.exe"))
                .to_string_lossy()
                .replace('\\', "/"),
            "C:/Users/csm/Downloads/setup.exe.mxpart"
        );
    }

    #[test]
    fn resume_offset_uses_existing_partial_only_when_smaller_than_total() {
        assert_eq!(resume_offset_for_partial(0, 1024), 0);
        assert_eq!(resume_offset_for_partial(512, 1024), 512);
        assert_eq!(resume_offset_for_partial(1024, 1024), 1024);
        assert_eq!(resume_offset_for_partial(2048, 1024), 0);
    }

    #[test]
    fn next_transfer_read_len_stops_at_expected_total() {
        assert_eq!(next_transfer_read_len(0, 10, 64), 10);
        assert_eq!(next_transfer_read_len(7, 10, 64), 3);
        assert_eq!(next_transfer_read_len(10, 10, 64), 0);
        assert_eq!(next_transfer_read_len(12, 10, 64), 0);
        assert_eq!(next_transfer_read_len(0, 128, 32), 32);
    }

    #[test]
    fn upload_confirm_timeout_uses_specific_error_code() {
        let error = remote_file_upload_confirm_error(std::io::Error::other("Timeout"));
        assert_eq!(error.code, "remote_file_upload_confirm_timeout");
        assert_eq!(error.message, "远程写入确认超时。");
        assert_eq!(error.raw_message, "Timeout");
    }

    #[test]
    fn local_upload_relative_path_uses_posix_separators() {
        let root = Path::new("C:/Users/csm/upload-root");
        let file = Path::new("C:/Users/csm/upload-root/logs/app.log");

        assert_eq!(
            local_upload_relative_path(root, file).expect("relative path should parse"),
            "logs/app.log"
        );
    }

    #[test]
    fn transfer_relative_paths_join_under_roots() {
        assert_eq!(
            join_remote_relative_path("/opt/app", "logs/app.log"),
            "/opt/app/logs/app.log"
        );
        assert_eq!(
            local_relative_path(Path::new(r"C:\Downloads\app"), "logs/app.log")
                .to_string_lossy()
                .replace('\\', "/"),
            "C:/Downloads/app/logs/app.log"
        );
    }

    #[test]
    fn remote_parent_and_split_name_handle_roots_and_extensions() {
        assert_eq!(remote_parent_path("/opt/app/archive.tar.gz"), "/opt/app");
        assert_eq!(remote_parent_path("/archive.tar.gz"), "/");
        assert_eq!(remote_parent_path("archive.tar.gz"), ".");
        assert_eq!(
            split_remote_name("archive.tar.gz", true),
            ("archive.tar".to_string(), "gz".to_string())
        );
        assert_eq!(
            split_remote_name("dist", false),
            ("dist".to_string(), String::new())
        );
    }
}
