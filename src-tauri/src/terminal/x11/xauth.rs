//! Local xauth execution and authority-file selection.
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::time::timeout;

use super::{error, parse_cookie, AppError, XAUTH_TIMEOUT};

struct AuthorityFile {
    path: Option<PathBuf>,
    environment_path: Option<PathBuf>,
    source: &'static str,
}

impl AuthorityFile {
    fn resolve(file: Option<&Path>) -> Result<Self, AppError> {
        #[cfg(windows)]
        {
            let default = Self::windows(|key| std::env::var_os(key))?;
            if let Some(file) = file {
                return Ok(Self {
                    path: Some(file.into()),
                    environment_path: default.path,
                    source: "temporary authority",
                });
            }
            return Ok(default);
        }
        #[cfg(not(windows))]
        Ok(if let Some(file) = file {
            Self {
                path: Some(file.into()),
                environment_path: None,
                source: "temporary authority",
            }
        } else {
            Self {
                path: None,
                environment_path: None,
                source: "xauth environment default",
            }
        })
    }

    #[cfg(windows)]
    fn windows(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> Result<Self, AppError> {
        let nonempty = |key| env(key).filter(|value| !value.is_empty());
        // An explicit authority file always wins, including intentional relative paths.
        if let Some(path) = nonempty("XAUTHORITY") {
            let path = PathBuf::from(path);
            return Ok(Self {
                path: Some(path.clone()),
                environment_path: Some(path),
                source: "XAUTHORITY",
            });
        }
        let (directory, source) = if let Some(home) = nonempty("HOME") {
            (PathBuf::from(home), "HOME")
        } else if let Some(profile) = nonempty("USERPROFILE") {
            (PathBuf::from(profile), "USERPROFILE")
        } else {
            return Err(error(
                "x11_authority_path_invalid",
                "无法确定本地 X11 认证目录，请设置 XAUTHORITY 为认证文件的绝对路径后重启应用。",
                "Windows HOME and USERPROFILE are missing",
            ));
        };
        // VcXsrv may otherwise use a drive-less path that depends on the app's working drive.
        // Do not reinterpret explicit MSYS/relative HOME values as a different user's directory.
        if !directory.is_absolute() {
            return Err(error("x11_authority_path_invalid", "本地 X11 认证目录不是 Windows 绝对路径，请设置 XAUTHORITY 为认证文件的绝对路径后重启应用。", format!("{source} is not a Windows absolute path")));
        }
        let path = directory.join(".Xauthority");
        Ok(Self {
            path: Some(path.clone()),
            environment_path: Some(path),
            source,
        })
    }

    fn diagnostic(&self) -> String {
        match &self.path {
            Some(path) => {
                let environment = self
                    .environment_path
                    .as_deref()
                    .map(|path| format!("; env_file={}", safe_path_text(path)))
                    .unwrap_or_default();
                format!(
                    "authority source={}; file={}{}",
                    self.source,
                    safe_path_text(path),
                    environment
                )
            }
            None => format!("authority source={}", self.source),
        }
    }
}

fn safe_path_text(path: &Path) -> String {
    // Paths are our selected arguments, never copied from xauth's secret-bearing output.
    path.to_string_lossy()
        .chars()
        .filter(|c| !c.is_control())
        .take(512)
        .collect()
}

fn execution_error(status: &str, stderr: &[u8], authority: &AuthorityFile) -> AppError {
    // xauth can echo an entire input command (including its Cookie) on failure. Extract
    // only known structural diagnostics, never arbitrary stderr lines or stdout.
    let text = String::from_utf8_lossy(stderr).to_lowercase();
    let (code, message, reason) = if text.contains("error in locking authority file")
        || text.contains("timeout in locking authority file")
    {
        (
            "x11_authority_lock_failed",
            "xauth 无法锁定认证文件，请检查文件路径、目录权限及是否有其他 xauth 进程正在使用。",
            "error locking authority file",
        )
    } else if text.contains("unable to open authority file")
        || text.contains("unable to read authority file")
        || text.contains("unable to write authority file")
    {
        (
            "x11_authority_access_failed",
            "xauth 无法读写认证文件，请检查文件路径和访问权限。",
            "unable to access authority file",
        )
    } else if text.contains("couldn't query security extension")
        || text.contains("could not query security extension")
    {
        (
            "x11_security_unavailable",
            "本地 X Server 不支持或无法查询 SECURITY 扩展，不能生成非信任授权。",
            "could not query SECURITY extension",
        )
    } else if text.contains("unable to open display") || text.contains("can't open display") {
        (
            "x11_xauth_display_failed",
            "xauth 无法打开本地 Display，请检查 X Server、Display 和认证文件。",
            "unable to open display",
        )
    } else if text.contains("couldn't generate authorization")
        || text.contains("could not generate authorization")
    {
        (
            "x11_untrusted_failed",
            "X Server 无法生成非信任授权，请检查 SECURITY 扩展和本地认证设置。",
            "could not generate authorization",
        )
    } else {
        (
            "x11_xauth_failed",
            "xauth 执行失败，请检查 Display、XAUTHORITY 和 X Server 的认证设置。",
            "unrecognized stderr omitted to protect authentication data",
        )
    };
    error(
        code,
        message,
        format!(
            "xauth exit status: {status}; {}; stderr: {reason} ({} bytes)",
            authority.diagnostic(),
            stderr.len()
        ),
    )
}

pub(super) fn resolve_xauth(configured: Option<&str>) -> PathBuf {
    if let Some(path) = configured {
        return PathBuf::from(path);
    }
    #[cfg(target_os = "macos")]
    if Path::new("/opt/X11/bin/xauth").is_file() {
        return PathBuf::from("/opt/X11/bin/xauth");
    }
    #[cfg(windows)]
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            for folder in ["VcXsrv", "Xming"] {
                let path = PathBuf::from(&root).join(folder).join("xauth.exe");
                if path.is_file() {
                    return path;
                }
            }
        }
    }
    PathBuf::from("xauth")
}

pub(super) async fn run_xauth(
    executable: &Path,
    file: Option<&Path>,
    args: &[&str],
    input: Option<Vec<u8>>,
) -> Result<Vec<u8>, AppError> {
    let authority = AuthorityFile::resolve(file)?;
    let mut command = Command::new(executable);
    command
        .kill_on_drop(true)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(file) = &authority.path {
        // VcXsrv's xauth uses XAUTHORITY while querying SECURITY even when -f is
        // supplied. Keep both views aligned so temporary and default files work.
        command.arg("-f").arg(file);
    }
    if let Some(file) = &authority.environment_path {
        command.env("XAUTHORITY", file);
    }
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW for desktop GUI builds.
    let mut child = command.spawn().map_err(|e| {
        error(
            "x11_xauth_start_failed",
            "无法启动 xauth，请安装或在高级设置中指定 xauth 路径。",
            e,
        )
    })?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut stdin = child.stdin.take();
    let result = timeout(XAUTH_TIMEOUT, async {
        let write = async {
            if let (Some(pipe), Some(bytes)) = (stdin.as_mut(), input) {
                pipe.write_all(&bytes).await?;
                pipe.shutdown().await?;
            }
            drop(stdin.take());
            Ok::<_, std::io::Error>(())
        };
        let out = async {
            let mut bytes = Vec::new();
            (&mut stdout)
                .take(64 * 1024 + 1)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let err = async {
            let mut bytes = Vec::new();
            (&mut stderr)
                .take(64 * 1024 + 1)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let (_, out, err) = tokio::try_join!(write, out, err)?;
        if out.len() > 64 * 1024 || err.len() > 64 * 1024 {
            return Err(std::io::Error::other("xauth output exceeds limit"));
        }
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, out, err))
    })
    .await;
    match result {
        Ok(Ok((status, out, _))) if status.success() => Ok(out),
        Ok(Ok((status, _, stderr))) => {
            Err(execution_error(&status.to_string(), &stderr, &authority))
        }
        other => {
            // Reap before the private authority directory is dropped (also on Windows).
            let _ = child.kill().await;
            match other {
                Err(_) => Err(error(
                    "x11_xauth_timeout",
                    "xauth 执行超时，请检查 X Server 是否正常。",
                    format!("xauth timed out; {}", authority.diagnostic()),
                )),
                Ok(Err(e)) => Err(error(
                    "x11_xauth_failed",
                    "读取 xauth 认证信息失败。",
                    format!("{e}; {}", authority.diagnostic()),
                )),
                _ => unreachable!(),
            }
        }
    }
}

pub(super) async fn load_cookie(
    executable: &Path,
    display: &str,
    file: Option<&Path>,
) -> Result<[u8; 16], AppError> {
    // Output contains secrets: never include it in logs or AppError.
    parse_cookie(&run_xauth(executable, file, &["list", display], None).await?).map_err(
        |mut error| {
            if let Ok(authority) = AuthorityFile::resolve(file) {
                error.raw_message = format!("{}; {}", error.raw_message, authority.diagnostic());
            }
            error
        },
    )
}

#[cfg(test)]
#[path = "xauth_tests.rs"]
mod tests;
