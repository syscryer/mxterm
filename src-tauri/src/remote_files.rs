use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::ssh_config::ResolvedSshConfig;
use crate::terminal::session::{ExecOutput, ExecProgressCallback, ReusableExecSession};

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

#[derive(Clone, Default)]
pub struct RemoteFileManager {
    sessions: Arc<Mutex<HashMap<String, RemoteFileSessionHandle>>>,
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
         tmp=\"${{TMPDIR:-/tmp}}/.mxterm-download-{tmp_suffix}.$$.tar.gz\"; \
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

    pub async fn upload_local_file(
        &self,
        app: &AppHandle,
        profile: ResolvedSshConfig,
        path: &str,
        local_path: &Path,
        conflict_policy: TransferConflictPolicy,
        progress: ExecProgressCallback,
    ) -> Result<RemoteFileUploadResult, AppError> {
        let config = RemoteFileSessionConfig::from_config(profile);
        let output = self
            .exec_with_reconnect_stdin_file_progress(
                app,
                &config,
                &build_remote_upload_command(path, conflict_policy),
                local_path,
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

#[cfg(test)]
mod tests {
    use super::{
        build_remote_list_command, build_remote_path_check_command, build_remote_write_command,
        looks_like_binary, parse_remote_file_metadata, parse_remote_list_output,
        parse_remote_path_check_output, quote_posix_shell, REMOTE_FILE_EDIT_LIMIT_BYTES,
    };

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
        assert_eq!(existing.kind.as_ref().map(|kind| kind.as_str()), Some("directory"));
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
}
