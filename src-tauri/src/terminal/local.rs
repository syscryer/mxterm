use portable_pty::{native_pty_system, Child, MasterPty};
use std::io::{Read, Write};
use std::sync::Mutex;
use uuid::Uuid;

use crate::app_error::AppError;
use crate::commands::LocalTerminalOpenRequest;
use crate::terminal::local_profiles::{
    build_command, build_pty_size, list_local_terminal_profiles, LocalTerminalProfile,
    LocalTerminalProfileInput, LocalTerminalProfileQuery,
};

pub struct LocalTerminalSession {
    pub id: String,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
}

pub struct OpenLocalSession {
    pub session: std::sync::Arc<LocalTerminalSession>,
    pub request_id: Option<String>,
    pub reader: Box<dyn Read + Send>,
}

impl LocalTerminalSession {
    pub fn open(request: LocalTerminalOpenRequest) -> Result<OpenLocalSession, AppError> {
        validate_local_terminal_open_request(&request)?;
        let profile = profile_from_request(&request)?;
        let system = native_pty_system();
        let pair = system
            .openpty(build_pty_size(request.cols, request.rows))
            .map_err(|error| {
                AppError::new(
                    "local_terminal_open_failed",
                    "本地终端 PTY 打开失败。",
                    error,
                    true,
                )
            })?;
        let command = build_command(&profile, request.cwd.as_deref());
        let child = pair.slave.spawn_command(command).map_err(|error| {
            AppError::new(
                "local_terminal_spawn_failed",
                "本地终端启动失败。",
                error,
                true,
            )
        })?;
        let reader = pair.master.try_clone_reader().map_err(|error| {
            AppError::new(
                "local_terminal_reader_failed",
                "本地终端读取器创建失败。",
                error,
                true,
            )
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            AppError::new(
                "local_terminal_writer_failed",
                "本地终端写入器创建失败。",
                error,
                true,
            )
        })?;

        Ok(OpenLocalSession {
            request_id: sanitize_request_id(request.request_id),
            reader,
            session: std::sync::Arc::new(LocalTerminalSession {
                id: Uuid::new_v4().to_string(),
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child: Mutex::new(child),
            }),
        })
    }

    pub async fn write(&self, data: String) -> Result<(), AppError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| poisoned_lock_error("local_terminal_write_failed"))?;
        writer.write_all(data.as_bytes()).map_err(|error| {
            AppError::new(
                "local_terminal_write_failed",
                "本地终端输入发送失败。",
                error,
                true,
            )
        })?;
        writer.flush().map_err(|error| {
            AppError::new(
                "local_terminal_write_failed",
                "本地终端输入刷新失败。",
                error,
                true,
            )
        })
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        let master = self
            .master
            .lock()
            .map_err(|_| poisoned_lock_error("local_terminal_resize_failed"))?;
        master.resize(build_pty_size(cols, rows)).map_err(|error| {
            AppError::new(
                "local_terminal_resize_failed",
                "本地终端尺寸同步失败。",
                error,
                true,
            )
        })
    }

    pub async fn close(&self) -> Result<(), AppError> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| poisoned_lock_error("local_terminal_close_failed"))?;
        child.kill().map_err(|error| {
            AppError::new(
                "local_terminal_close_failed",
                "本地终端关闭失败。",
                error,
                true,
            )
        })
    }

    pub fn wait_exit_status(&self) -> Option<u32> {
        let mut child = self.child.lock().ok()?;
        child.wait().ok().map(|status| status.exit_code())
    }
}

pub fn list_profiles(
    hidden_profile_ids: Vec<String>,
    platform: Option<String>,
) -> Result<Vec<LocalTerminalProfile>, AppError> {
    list_local_terminal_profiles(LocalTerminalProfileQuery {
        platform,
        hidden_profile_ids,
    })
}

fn profile_from_request(
    request: &LocalTerminalOpenRequest,
) -> Result<LocalTerminalProfile, AppError> {
    let profile = request.profile.clone().ok_or_else(|| {
        AppError::new(
            "local_terminal_profile_missing",
            "请选择要打开的本地终端类型。",
            "profile is missing",
            true,
        )
    })?;
    validate_profile_input(&profile)?;
    Ok(LocalTerminalProfile {
        id: profile.id.unwrap_or_else(|| profile.kind.clone()),
        name: profile.name,
        kind: profile.kind,
        platform: profile.platform,
        source: profile.source,
        command: profile.command,
        args: profile.args,
        cwd: profile.cwd,
        env: profile.env,
        icon: profile.icon,
        hidden: profile.hidden,
        detected: profile.detected,
    })
}

pub fn validate_local_terminal_open_request(
    request: &LocalTerminalOpenRequest,
) -> Result<(), AppError> {
    crate::terminal::pty::validate_size(request.cols, request.rows)?;
    if request.profile.is_none() {
        return Err(AppError::new(
            "local_terminal_profile_missing",
            "请选择要打开的本地终端类型。",
            "profile is missing",
            true,
        ));
    }
    if let Some(cwd) = request.cwd.as_deref() {
        let cwd = cwd.trim();
        if cwd.is_empty() {
            return Err(AppError::new(
                "local_terminal_cwd_invalid",
                "本地终端启动目录无效。",
                "cwd is empty",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_profile_input(profile: &LocalTerminalProfileInput) -> Result<(), AppError> {
    if profile.name.trim().is_empty() {
        return Err(AppError::new(
            "local_terminal_profile_name_missing",
            "本地终端名称不能为空。",
            "profile.name is empty",
            true,
        ));
    }
    if profile.command.trim().is_empty() {
        return Err(AppError::new(
            "local_terminal_profile_command_missing",
            "本地终端命令不能为空。",
            "profile.command is empty",
            true,
        ));
    }
    if profile.kind.trim().is_empty() {
        return Err(AppError::new(
            "local_terminal_profile_kind_missing",
            "本地终端类型不能为空。",
            "profile.kind is empty",
            true,
        ));
    }
    Ok(())
}

fn sanitize_request_id(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn poisoned_lock_error(code: &str) -> AppError {
    AppError::new(code, "本地终端内部状态异常。", "poisoned lock", true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn sample_profile() -> LocalTerminalProfileInput {
        LocalTerminalProfileInput {
            id: Some("pwsh".to_string()),
            name: "PowerShell 7".to_string(),
            kind: "pwsh".to_string(),
            platform: "windows".to_string(),
            source: "builtin".to_string(),
            command: "pwsh.exe".to_string(),
            args: vec!["-NoLogo".to_string(), "-NoProfile".to_string()],
            cwd: None,
            env: BTreeMap::new(),
            icon: "siPowershell".to_string(),
            hidden: false,
            detected: true,
        }
    }

    #[test]
    fn local_open_request_rejects_missing_profile() {
        let error = validate_local_terminal_open_request(&LocalTerminalOpenRequest {
            request_id: None,
            profile: None,
            cols: 80,
            rows: 24,
            cwd: None,
        })
        .unwrap_err();

        assert_eq!(error.code, "local_terminal_profile_missing");
    }

    #[test]
    fn local_profile_rejects_blank_command() {
        let mut profile = sample_profile();
        profile.command = " ".to_string();

        let error = validate_profile_input(&profile).unwrap_err();

        assert_eq!(error.code, "local_terminal_profile_command_missing");
    }

    #[cfg(windows)]
    #[test]
    fn local_session_accepts_input_and_returns_output() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let mut profile = sample_profile();
        profile.id = Some("cmd".to_string());
        profile.name = "Command Prompt".to_string();
        profile.kind = "cmd".to_string();
        profile.command = "cmd.exe".to_string();
        profile.args = vec!["/Q".to_string()];

        let opened = LocalTerminalSession::open(LocalTerminalOpenRequest {
            request_id: Some("local-test".to_string()),
            profile: Some(profile),
            cols: 80,
            rows: 24,
            cwd: None,
        })
        .unwrap();

        let session = opened.session.clone();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = opened.reader;
            let mut output = Vec::new();
            let mut buffer = [0_u8; 1024];
            let deadline = Instant::now() + Duration::from_secs(5);

            while Instant::now() < deadline {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        output.extend_from_slice(&buffer[..read]);
                        if String::from_utf8_lossy(&output).contains("mxterm-local-ready") {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        return;
                    }
                }
            }

            let _ = sender.send(Ok(String::from_utf8_lossy(&output).to_string()));
        });

        {
            let mut writer = session.writer.lock().unwrap();
            writer
                .write_all(b"echo mxterm-local-ready\r\nexit\r\n")
                .unwrap();
            writer.flush().unwrap();
        }

        let output = receiver
            .recv_timeout(Duration::from_secs(6))
            .expect("local PTY reader should return before timeout")
            .unwrap();

        session.child.lock().unwrap().kill().ok();
        assert!(
            output.contains("mxterm-local-ready"),
            "local PTY output did not include echoed command output: {output:?}"
        );
    }
}
