//! SSH X11 forwarding. Authentication is checked before opening any local socket.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::{client, Channel, ChannelMsg};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{watch, Semaphore};
use tokio::time::{timeout, Instant};

use crate::app_error::AppError;
use crate::connections::X11ForwardingConfig;

mod xauth;
use xauth::{load_cookie, resolve_xauth, run_xauth};

const AUTH_PROTOCOL: &[u8] = b"MIT-MAGIC-COOKIE-1";
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);
const XAUTH_TIMEOUT: Duration = Duration::from_secs(10);
const UNTRUSTED_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const MAX_CHANNELS: usize = 32;

fn error(code: &str, message: &str, detail: impl ToString) -> AppError {
    AppError::new(code, message, detail, true)
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DisplayTarget {
    Tcp(String, u16),
    Unix(PathBuf),
}

#[derive(Debug, PartialEq, Eq)]
struct Display {
    target: DisplayTarget,
    screen: u32,
}

impl Display {
    fn parse(value: &str) -> Result<Self, AppError> {
        let invalid = || {
            error(
                "x11_display_invalid",
                "X11 Display 格式无效，请使用 :0、127.0.0.1:0 或 Unix socket 路径。",
                "invalid display syntax",
            )
        };
        // Also used as one xauth command token: reject whitespace and command delimiters.
        if value.is_empty()
            || value.len() > 1024
            || value
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\'' | '"' | '\\'))
        {
            return Err(invalid());
        }
        let (host, suffix) = value.rsplit_once(':').ok_or_else(invalid)?;
        let (number, screen) = suffix.split_once('.').unwrap_or((suffix, "0"));
        if number.is_empty()
            || screen.is_empty()
            || !number.bytes().all(|c| c.is_ascii_digit())
            || !screen.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(invalid());
        }
        let number: u16 = number.parse().map_err(|_| invalid())?;
        let screen = screen.parse().map_err(|_| invalid())?;
        let target = if host.starts_with('/') {
            // XQuartz uses /private/tmp/.../org.xquartz:0 as the socket path.
            DisplayTarget::Unix(PathBuf::from(format!("{host}:{number}")))
        } else if host.is_empty() || host == "unix" || host.ends_with("/unix") || host == "unix/" {
            if cfg!(unix) {
                DisplayTarget::Unix(PathBuf::from(format!("/tmp/.X11-unix/X{number}")))
            } else {
                DisplayTarget::Tcp(
                    "127.0.0.1".into(),
                    6000_u16.checked_add(number).ok_or_else(invalid)?,
                )
            }
        } else {
            let host = host.strip_prefix("tcp/").unwrap_or(host);
            let host = if host.starts_with('[') {
                let ip = host
                    .strip_prefix('[')
                    .and_then(|h| h.strip_suffix(']'))
                    .ok_or_else(invalid)?;
                ip.parse::<std::net::Ipv6Addr>().map_err(|_| invalid())?;
                ip
            } else {
                if host.contains([':', '/', '[', ']']) {
                    return Err(invalid());
                }
                host
            };
            if host.is_empty()
                || !host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '%'))
            {
                return Err(invalid());
            }
            DisplayTarget::Tcp(
                host.to_owned(),
                6000_u16.checked_add(number).ok_or_else(invalid)?,
            )
        };
        if cfg!(windows) && matches!(target, DisplayTarget::Unix(_)) {
            return Err(error(
                "x11_display_unsupported",
                "Windows 请使用本机 X Server 的 TCP Display，例如 127.0.0.1:0。",
                "Unix display is not supported on Windows",
            ));
        }
        Ok(Self { target, screen })
    }
}

pub(crate) fn validate_config(
    config: &X11ForwardingConfig,
) -> Result<X11ForwardingConfig, AppError> {
    let trim = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let display = trim(&config.display);
    let xauth_path = trim(&config.xauth_path);
    if config.enabled {
        if let Some(display) = &display {
            Display::parse(display)?;
        }
        if xauth_path
            .as_ref()
            .is_some_and(|p| p.chars().any(char::is_control))
        {
            return Err(error(
                "x11_xauth_path_invalid",
                "xauth 路径包含无效字符。",
                "control character in executable path",
            ));
        }
    }
    Ok(X11ForwardingConfig {
        enabled: config.enabled,
        trusted: config.trusted,
        display,
        xauth_path,
    })
}

trait XStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> XStream for T {}
type LocalStream = Box<dyn XStream>;

impl DisplayTarget {
    async fn connect(&self) -> Result<LocalStream, AppError> {
        let connect = async {
            match self {
                Self::Tcp(host, port) => {
                    Ok(Box::new(TcpStream::connect((host.as_str(), *port)).await?) as LocalStream)
                }
                #[cfg(unix)]
                Self::Unix(path) => {
                    Ok(Box::new(tokio::net::UnixStream::connect(path).await?) as LocalStream)
                }
                #[cfg(not(unix))]
                Self::Unix(_) => Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "Unix socket not available",
                )),
            }
        };
        timeout(Duration::from_secs(5), connect)
            .await
            .map_err(|_| {
                error(
                    "x11_local_connect_timeout",
                    "连接本地 X Server 超时，请检查 Display 和 X Server。",
                    "local socket connect timed out",
                )
            })?
            .map_err(|e| {
                error(
                    "x11_local_connect_failed",
                    "无法连接本地 X Server，请先启动 X Server 并检查 Display。",
                    e,
                )
            })
    }
}

/// The non-cloneable owner cancels all X11 streams on shell close, failed open or drop.
pub(crate) struct X11Session(pub(crate) Arc<X11Forwarder>);

impl Drop for X11Session {
    fn drop(&mut self) {
        self.0.stop();
    }
}

pub(crate) struct X11Forwarder {
    display: Display,
    fake_cookie: [u8; 16],
    local_cookie: [u8; 16],
    active: AtomicBool,
    cancel: watch::Sender<bool>,
    slots: Arc<Semaphore>,
    deadline: Option<Instant>,
}

impl X11Session {
    pub(crate) async fn prepare(config: &X11ForwardingConfig) -> Result<Option<Self>, AppError> {
        if !config.enabled {
            return Ok(None);
        }
        let config = validate_config(config)?;
        let display_name = config
            .display
            .or_else(|| {
                std::env::var("DISPLAY")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            })
            // Windows has no system DISPLAY; display 0 is the conventional local X Server.
            .or_else(|| cfg!(windows).then(|| "127.0.0.1:0".to_string()))
            .ok_or_else(|| {
                error(
                    "x11_display_missing",
                    "未找到本地 DISPLAY，请在连接高级设置中填写。",
                    "DISPLAY is not set",
                )
            })?;
        let display = Display::parse(&display_name)?;
        let executable = resolve_xauth(config.xauth_path.as_deref());
        let local_cookie = load_cookie(&executable, &display_name, None).await?;
        probe_server(&display.target, &local_cookie).await?;
        let deadline = (!config.trusted).then(|| Instant::now() + UNTRUSTED_TIMEOUT);
        let local_cookie = if config.trusted {
            local_cookie
        } else {
            generate_untrusted_cookie(&executable, &display_name, &local_cookie).await?
        };
        let mut fake_cookie = [0; 16];
        getrandom::fill(&mut fake_cookie)
            .map_err(|e| error("x11_random_failed", "无法生成 X11 会话认证信息。", e))?;
        Ok(Some(Self(Arc::new(X11Forwarder {
            display,
            fake_cookie,
            local_cookie,
            active: AtomicBool::new(false),
            cancel: watch::channel(false).0,
            slots: Arc::new(Semaphore::new(MAX_CHANNELS)),
            deadline,
        }))))
    }
}

impl X11Forwarder {
    pub(crate) async fn request(&self, channel: &mut Channel<client::Msg>) -> Result<(), AppError> {
        timeout(SETUP_TIMEOUT, async {
            channel
                .request_x11(
                    true,
                    false,
                    "MIT-MAGIC-COOKIE-1",
                    hex_encode(&self.fake_cookie),
                    self.display.screen,
                )
                .await
                .map_err(|e| error("x11_request_failed", "X11 转发请求发送失败。", e))?;
            // request_x11() only enqueues the request. This must be the first session request,
            // so no PTY/shell success can be mistaken for the X11 acknowledgement.
            match channel.wait().await {
                Some(ChannelMsg::Success) => {
                    self.active.store(true, Ordering::Release);
                    Ok(())
                }
                Some(ChannelMsg::Failure) => Err(error(
                    "x11_request_denied",
                    "SSH 服务端拒绝 X11 转发，请检查 X11Forwarding 和远端 xauth 配置。",
                    "SSH_MSG_CHANNEL_FAILURE for x11-req",
                )),
                _ => Err(error(
                    "x11_request_closed",
                    "SSH 通道未确认 X11 转发，连接已终止。",
                    "channel ended or unexpected reply before X11 acknowledgement",
                )),
            }
        })
        .await
        .map_err(|_| {
            error(
                "x11_request_timeout",
                "SSH 服务端未及时确认 X11 转发。",
                "x11-req acknowledgement timed out",
            )
        })?
    }

    pub(crate) fn stop(&self) {
        self.active.store(false, Ordering::Release);
        self.cancel.send_replace(true);
    }

    pub(crate) async fn forward<R: AsyncRead + AsyncWrite + Unpin + Send>(
        &self,
        mut remote: R,
    ) -> Result<(), AppError> {
        let _slot = self.slots.clone().try_acquire_owned().map_err(|_| {
            error(
                "x11_channel_limit",
                "X11 并发连接数已达到上限。",
                "too many X11 channels",
            )
        })?;
        let mut cancelled = self.cancel.subscribe();
        if *cancelled.borrow() || !self.active.load(Ordering::Acquire) {
            return Err(error(
                "x11_not_active",
                "X11 转发未启用或会话已关闭。",
                "unsolicited X11 channel",
            ));
        }
        if self.deadline.is_some_and(|d| Instant::now() >= d) {
            return Err(error(
                "x11_auth_expired",
                "非信任 X11 转发已超过 20 分钟，请重新连接 SSH 后启动新的图形程序。",
                "untrusted forwarding deadline expired",
            ));
        }
        tokio::select! {
            _ = cancelled.changed() => Ok(()),
            result = async {
                let mut local = timeout(SETUP_TIMEOUT, async {
                    let setup = read_setup(&mut remote, &self.fake_cookie, &self.local_cookie).await?;
                    let mut local = self.display.target.connect().await?;
                    local.write_all(&setup).await.map_err(stream_error)?;
                    let reply = read_server_reply(&mut local, setup[0] == b'l').await?;
                    remote.write_all(&reply).await.map_err(stream_error)?;
                    validate_server_reply(&reply)?;
                    Ok::<_, AppError>(local)
                }).await.map_err(|_| error("x11_setup_timeout", "X11 认证握手超时。", "X11 setup timed out"))??;
                tokio::io::copy_bidirectional(&mut remote, &mut local).await.map_err(stream_error)?;
                Ok(())
            } => result,
        }
    }
}

fn stream_error(e: std::io::Error) -> AppError {
    error("x11_stream_failed", "X11 数据转发中断。", e)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_cookie(value: &str) -> Option<[u8; 16]> {
    if value.len() != 32 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut result = [0; 16];
    for (i, byte) in result.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(result)
}

fn parse_cookie(output: &[u8]) -> Result<[u8; 16], AppError> {
    for line in String::from_utf8_lossy(output).lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() == 3 && fields[1].as_bytes() == AUTH_PROTOCOL {
            if let Some(cookie) = decode_cookie(fields[2]) {
                return Ok(cookie);
            }
        }
    }
    Err(error(
        "x11_cookie_missing",
        "找不到本地 X Server 的 MIT-MAGIC-COOKIE-1 认证信息，请检查 XAUTHORITY 和 xauth 配置。",
        "no valid MIT-MAGIC-COOKIE-1 entry for display",
    ))
}

async fn generate_untrusted_cookie(
    executable: &Path,
    display: &str,
    original: &[u8; 16],
) -> Result<[u8; 16], AppError> {
    // Do not replace the user's normal authority entry or expose the temporary copy.
    let mut builder = tempfile::Builder::new();
    builder.prefix("mxterm-x11-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    let dir = builder
        .tempdir()
        .map_err(|e| error("x11_authority_failed", "无法创建临时 X11 认证文件。", e))?;
    let file = dir.path().join("authority");
    let input = format!("add {display} MIT-MAGIC-COOKIE-1 {}\ngenerate {display} MIT-MAGIC-COOKIE-1 untrusted timeout 1260\n", hex_encode(original));
    run_xauth(executable, Some(&file), &[], Some(input.into_bytes())).await?;
    let cookie = load_cookie(executable, display, Some(&file)).await?;
    if cookie == *original {
        return Err(error(
            "x11_untrusted_failed",
            "X Server 未生成非信任 X11 授权，请检查 SECURITY 扩展。",
            "xauth generate did not replace the temporary authority entry",
        ));
    }
    Ok(cookie)
}

fn setup_header(header: &[u8; 12]) -> Result<(usize, usize), AppError> {
    let invalid = || {
        error(
            "x11_setup_invalid",
            "已拒绝无效的 X11 认证请求。",
            "invalid X11 setup header",
        )
    };
    let read = |a, b| {
        if header[0] == b'l' {
            u16::from_le_bytes([a, b])
        } else {
            u16::from_be_bytes([a, b])
        }
    };
    if !matches!(header[0], b'l' | b'B')
        || read(header[2], header[3]) != 11
        || read(header[4], header[5]) != 0
    {
        return Err(invalid());
    }
    let name = usize::from(read(header[6], header[7]));
    let data = usize::from(read(header[8], header[9]));
    if name != AUTH_PROTOCOL.len() || data != 16 {
        return Err(invalid());
    }
    Ok((name, data))
}

async fn read_setup<R: AsyncRead + Unpin>(
    remote: &mut R,
    fake: &[u8; 16],
    real: &[u8; 16],
) -> Result<Vec<u8>, AppError> {
    let mut header = [0; 12];
    remote.read_exact(&mut header).await.map_err(stream_error)?;
    let (name_len, cookie_len) = setup_header(&header)?;
    let cookie_start = (name_len + 3) & !3;
    let mut payload = vec![0; cookie_start + cookie_len];
    remote
        .read_exact(&mut payload)
        .await
        .map_err(stream_error)?;
    let difference = payload[cookie_start..]
        .iter()
        .zip(fake)
        .fold(0_u8, |diff, (a, b)| diff | (a ^ b));
    if &payload[..name_len] != AUTH_PROTOCOL || difference != 0 {
        return Err(error(
            "x11_auth_rejected",
            "已拒绝 Cookie 不匹配的 X11 连接。",
            "X11 authentication protocol or session cookie mismatch",
        ));
    }
    payload[cookie_start..].copy_from_slice(real);
    Ok([header.as_slice(), &payload].concat())
}

fn local_setup(cookie: &[u8; 16]) -> Vec<u8> {
    let mut setup = vec![b'l', 0, 11, 0, 0, 0, 18, 0, 16, 0, 0, 0];
    setup.extend_from_slice(AUTH_PROTOCOL);
    setup.extend_from_slice(&[0, 0]);
    setup.extend_from_slice(cookie);
    setup
}

async fn read_server_reply<S: AsyncRead + Unpin>(
    stream: &mut S,
    little: bool,
) -> Result<Vec<u8>, AppError> {
    let mut header = [0; 8];
    stream.read_exact(&mut header).await.map_err(stream_error)?;
    read_reply_body(stream, header, little).await
}

async fn read_reply_body<S: AsyncRead + Unpin>(
    stream: &mut S,
    header: [u8; 8],
    little: bool,
) -> Result<Vec<u8>, AppError> {
    let length = if little {
        u16::from_le_bytes([header[6], header[7]])
    } else {
        u16::from_be_bytes([header[6], header[7]])
    };
    let mut body = vec![0; usize::from(length) * 4];
    stream.read_exact(&mut body).await.map_err(stream_error)?;
    Ok([header.as_slice(), &body].concat())
}

fn validate_server_reply(reply: &[u8]) -> Result<(), AppError> {
    if reply[0] == 1 {
        return Ok(());
    }
    let reason_len = usize::from(reply[1]).min(reply.len() - 8);
    let reason: String = String::from_utf8_lossy(&reply[8..8 + reason_len])
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    Err(error(
        "x11_local_auth_rejected",
        "本地 X Server 拒绝认证，请检查 XAUTHORITY 和访问控制。",
        format!("X11 setup status={}: {reason}", reply[0]),
    ))
}

async fn probe_server(target: &DisplayTarget, cookie: &[u8; 16]) -> Result<(), AppError> {
    timeout(SETUP_TIMEOUT, async {
        let mut stream = target.connect().await?;
        stream
            .write_all(&local_setup(cookie))
            .await
            .map_err(stream_error)?;
        validate_server_reply(&read_server_reply(&mut stream, true).await?)
    })
    .await
    .map_err(|_| {
        error(
            "x11_setup_timeout",
            "本地 X Server 认证握手超时。",
            "local X11 setup timed out",
        )
    })?
}

#[cfg(test)]
mod tests;
