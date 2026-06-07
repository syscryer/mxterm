use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::Mutex;

use crate::app_error::AppError;
use crate::commands::TerminalConnectRequest;
use crate::connections::ConnectionProfile;
use crate::terminal::session::{ExecOutput, ReusableExecSession};

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
    request: TerminalConnectRequest,
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

pub fn looks_like_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|byte| *byte == 0)
}

impl RemoteFileManager {
    pub async fn list_directory(
        &self,
        profile: ConnectionProfile,
        path: &str,
    ) -> Result<Vec<RemoteFileEntry>, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let command = build_remote_list_command(path);
        let output = self.exec_with_reconnect(&config, &command).await?;

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

    pub async fn read_file(
        &self,
        profile: ConnectionProfile,
        path: &str,
    ) -> Result<RemoteFileReadResult, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let metadata = self.metadata(&config, path).await?;

        if metadata.size > REMOTE_FILE_EDIT_LIMIT_BYTES {
            return Err(AppError::new(
                "remote_file_too_large",
                "文件超过 2 MB，已阻止直接编辑。",
                format!("path={} size={}", metadata.path, metadata.size),
                true,
            ));
        }

        let output = self
            .exec_with_reconnect(&config, &build_remote_read_command(&metadata.path))
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
        profile: ConnectionProfile,
        path: &str,
        content: &str,
        expected_mtime: u64,
        expected_size: u64,
        overwrite: bool,
    ) -> Result<RemoteFileWriteResult, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let current = self.metadata(&config, path).await?;
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
                &config,
                &build_remote_write_command(path),
                content.as_bytes(),
            )
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_write_failed",
                "远程文件保存失败。",
                &output,
            ));
        }

        let metadata = self.metadata(&config, path).await?;
        Ok(RemoteFileWriteResult {
            metadata,
            conflict: false,
        })
    }

    pub async fn create_file(
        &self,
        profile: ConnectionProfile,
        path: &str,
    ) -> Result<RemoteFileMetadata, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let output = self
            .exec_with_reconnect(
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
        self.metadata(&config, path).await
    }

    pub async fn create_directory(
        &self,
        profile: ConnectionProfile,
        path: &str,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let output = self
            .exec_with_reconnect(
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
        profile: ConnectionProfile,
        path: &str,
        new_path: &str,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let output = self
            .exec_with_reconnect(
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

    pub async fn delete_entry(
        &self,
        profile: ConnectionProfile,
        path: &str,
        recursive: bool,
    ) -> Result<(), AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let command = if recursive {
            format!(
                "path={}; [ \"$path\" = / ] && {{ printf '%s\\n' 'refuse to delete /' >&2; exit 2; }}; rm -rf -- \"$path\"",
                quote_posix_shell(path)
            )
        } else {
            format!("path={}; rm -f -- \"$path\"", quote_posix_shell(path))
        };
        let output = self.exec_with_reconnect(&config, &command).await?;
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
        profile: ConnectionProfile,
        path: &str,
        content: &[u8],
    ) -> Result<RemoteFileMetadata, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let output = self
            .exec_with_reconnect_stdin(&config, &build_remote_write_command(path), content)
            .await?;
        if output.exit_status != Some(0) {
            return Err(remote_file_command_error(
                "remote_file_upload_failed",
                "远程文件上传失败。",
                &output,
            ));
        }
        self.metadata(&config, path).await
    }

    pub async fn download_file(
        &self,
        profile: ConnectionProfile,
        path: &str,
    ) -> Result<Vec<u8>, AppError> {
        let config = RemoteFileSessionConfig::from_profile(profile);
        let output = self
            .exec_with_reconnect(&config, &build_remote_read_command(path))
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

    async fn metadata(
        &self,
        config: &RemoteFileSessionConfig,
        path: &str,
    ) -> Result<RemoteFileMetadata, AppError> {
        let output = self
            .exec_with_reconnect(config, &build_remote_metadata_command(path))
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
        config: &RemoteFileSessionConfig,
        command: &str,
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(config).await?;
        match self.exec_with_handle(&handle, command).await {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(config).await?;
                self.exec_with_handle(&refreshed, command).await
            }
        }
    }

    async fn exec_with_reconnect_stdin(
        &self,
        config: &RemoteFileSessionConfig,
        command: &str,
        stdin: &[u8],
    ) -> Result<ExecOutput, AppError> {
        let handle = self.session_handle(config).await?;
        match self.exec_with_handle_stdin(&handle, command, stdin).await {
            Ok(output) => Ok(output),
            Err(_) => {
                self.invalidate_handle(&config.connection_id, &handle).await;
                let refreshed = self.connect_and_store(config).await?;
                self.exec_with_handle_stdin(&refreshed, command, stdin).await
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
    ) -> Result<ExecOutput, AppError> {
        let session = handle.session.lock().await;
        session.exec_with_stdin(command, stdin).await
    }

    async fn session_handle(
        &self,
        config: &RemoteFileSessionConfig,
    ) -> Result<RemoteFileSessionHandle, AppError> {
        if let Some(existing) = self.lookup_handle(&config.connection_id).await {
            if existing.signature == config.signature {
                return Ok(existing);
            }
            self.invalidate_handle(&config.connection_id, &existing).await;
        }

        self.connect_and_store(config).await
    }

    async fn lookup_handle(&self, connection_id: &str) -> Option<RemoteFileSessionHandle> {
        self.sessions.lock().await.get(connection_id).cloned()
    }

    async fn connect_and_store(
        &self,
        config: &RemoteFileSessionConfig,
    ) -> Result<RemoteFileSessionHandle, AppError> {
        let new_handle = RemoteFileSessionHandle {
            signature: config.signature.clone(),
            session: Arc::new(Mutex::new(ReusableExecSession::connect(&config.request).await?)),
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

    async fn invalidate_handle(
        &self,
        connection_id: &str,
        handle: &RemoteFileSessionHandle,
    ) {
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
    fn from_profile(profile: ConnectionProfile) -> Self {
        let signature = format!(
            "{}|{}|{}|{:?}|{:?}|{:?}",
            profile.host,
            profile.port,
            profile.username,
            profile.password,
            profile.private_key_path,
            profile.private_key_passphrase,
        );

        let request = TerminalConnectRequest {
            request_id: None,
            connection_id: Some(profile.id.clone()),
            host: profile.host,
            port: profile.port,
            username: profile.username,
            password: profile.password,
            private_key_path: profile.private_key_path,
            private_key_passphrase: profile.private_key_passphrase,
            cols: 80,
            rows: 24,
        };

        Self {
            connection_id: profile.id,
            signature,
            request,
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
        build_remote_list_command, build_remote_write_command, looks_like_binary,
        parse_remote_file_metadata, parse_remote_list_output, quote_posix_shell,
        REMOTE_FILE_EDIT_LIMIT_BYTES,
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
    fn parse_remote_file_metadata_reads_nul_fields_and_empty_mode() {
        let metadata =
            parse_remote_file_metadata(b"/opt/app/app.conf\x0042\x001717711111\x00\x00")
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
