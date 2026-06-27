use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::app_error::AppError;
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::resolve_saved_connection;
use crate::terminal::session::ExecOutput;

#[derive(Clone, Default)]
pub(crate) struct NetworkDiagnosticSessionManager {
    pool: RemoteExecSessionPool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkDiagnosticKind {
    Ping,
    Tcp,
    Dns,
    Trace,
    Http,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NetworkDiagnosticRequest {
    pub connection_id: String,
    pub kind: NetworkDiagnosticKind,
    pub target: String,
    #[serde(default)]
    pub port: Option<u16>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NetworkDiagnosticResult {
    pub kind: NetworkDiagnosticKind,
    pub target: String,
    pub command_label: String,
    pub ok: bool,
    pub exit_status: Option<i32>,
    pub duration_ms: u64,
    pub summary: String,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Debug)]
pub(crate) struct NetworkDiagnosticCommand {
    target: String,
    command_label: String,
    command: String,
}

pub async fn run_diagnostic(
    app: &AppHandle,
    manager: &NetworkDiagnosticSessionManager,
    request: NetworkDiagnosticRequest,
) -> Result<NetworkDiagnosticResult, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "network_connection_missing",
        "请选择活动连接。",
    )?;
    let diagnostic = build_diagnostic_command(&request)?;
    let config = resolve_saved_connection(app, connection_id, None)?;
    let started_at = Instant::now();
    let output = manager
        .exec(
            app,
            &config,
            &diagnostic.command,
            RemoteExecRetry::ReconnectOnce,
        )
        .await?;
    let duration_ms = started_at.elapsed().as_millis() as u64;

    Ok(result_from_output(
        &request,
        diagnostic,
        output,
        duration_ms,
    ))
}

impl NetworkDiagnosticSessionManager {
    async fn exec(
        &self,
        app: &AppHandle,
        config: &crate::ssh_config::ResolvedSshConfig,
        command: &str,
        retry: RemoteExecRetry,
    ) -> Result<ExecOutput, AppError> {
        self.pool.exec(app, config, command, retry).await
    }
}

pub(crate) fn build_diagnostic_command(
    request: &NetworkDiagnosticRequest,
) -> Result<NetworkDiagnosticCommand, AppError> {
    let target = require_value(
        &request.target,
        "network_diagnostic_target_missing",
        "请输入诊断目标。",
    )?;

    match request.kind {
        NetworkDiagnosticKind::Ping => Ok(NetworkDiagnosticCommand {
            target: target.to_string(),
            command_label: "ping".to_string(),
            command: format!("timeout 12 ping -c 4 -W 2 {}", quote_posix_shell(target)),
        }),
        NetworkDiagnosticKind::Tcp => {
            let port = request.port.filter(|port| *port > 0).ok_or_else(|| {
                AppError::new(
                    "network_diagnostic_port_invalid",
                    "请输入有效的 TCP 端口。",
                    "port is required",
                    true,
                )
            })?;
            let script = "host=$1; port=$2; if command -v nc >/dev/null 2>&1; then nc -vz -w 5 \"$host\" \"$port\"; elif command -v bash >/dev/null 2>&1; then timeout 5 bash -c 'cat < /dev/null > \"/dev/tcp/$1/$2\"' bash \"$host\" \"$port\"; else echo \"nc/bash unavailable\"; exit 127; fi";
            Ok(NetworkDiagnosticCommand {
                target: target.to_string(),
                command_label: "tcp".to_string(),
                command: format!(
                    "timeout 8 sh -c {} sh {} {}",
                    quote_posix_shell(script),
                    quote_posix_shell(target),
                    port
                ),
            })
        }
        NetworkDiagnosticKind::Dns => {
            let script = "target=$1; if command -v dig >/dev/null 2>&1; then dig +short \"$target\"; elif command -v nslookup >/dev/null 2>&1; then nslookup \"$target\"; elif command -v getent >/dev/null 2>&1; then getent hosts \"$target\"; else echo \"dig/nslookup/getent unavailable\"; exit 127; fi";
            Ok(NetworkDiagnosticCommand {
                target: target.to_string(),
                command_label: "dns".to_string(),
                command: format!(
                    "timeout 10 sh -c {} sh {}",
                    quote_posix_shell(script),
                    quote_posix_shell(target)
                ),
            })
        }
        NetworkDiagnosticKind::Trace => {
            let script = "target=$1; if command -v tracepath >/dev/null 2>&1; then tracepath -m 16 \"$target\"; elif command -v traceroute >/dev/null 2>&1; then traceroute -m 16 \"$target\"; else echo \"tracepath/traceroute unavailable\"; exit 127; fi";
            Ok(NetworkDiagnosticCommand {
                target: target.to_string(),
                command_label: "trace".to_string(),
                command: format!(
                    "timeout 20 sh -c {} sh {}",
                    quote_posix_shell(script),
                    quote_posix_shell(target)
                ),
            })
        }
        NetworkDiagnosticKind::Http => {
            let url = normalize_http_target(target);
            let script = "url=$1; if command -v curl >/dev/null 2>&1; then curl -I -L --max-time 10 \"$url\"; else echo \"curl unavailable\"; exit 127; fi";
            Ok(NetworkDiagnosticCommand {
                target: url.clone(),
                command_label: "http".to_string(),
                command: format!(
                    "timeout 15 sh -c {} sh {}",
                    quote_posix_shell(script),
                    quote_posix_shell(&url)
                ),
            })
        }
    }
}

fn result_from_output(
    request: &NetworkDiagnosticRequest,
    command: NetworkDiagnosticCommand,
    output: ExecOutput,
    duration_ms: u64,
) -> NetworkDiagnosticResult {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let ok = output.exit_status == Some(0);
    let exit_status = output.exit_status.map(|status| status as i32);
    let detail = first_output_line(&stderr).or_else(|| first_output_line(&stdout));
    let summary = match (ok, detail) {
        (true, Some(line)) => line,
        (true, None) => "诊断完成。".to_string(),
        (false, Some(line)) => line,
        (false, None) => "诊断失败。".to_string(),
    };

    NetworkDiagnosticResult {
        kind: request.kind,
        target: command.target,
        command_label: command.command_label,
        ok,
        exit_status,
        duration_ms,
        summary,
        stdout,
        stderr,
    }
}

fn normalize_http_target(target: &str) -> String {
    if target.starts_with("http://") || target.starts_with("https://") {
        target.to_string()
    } else {
        format!("https://{}", target)
    }
}

fn require_value<'a>(value: &'a str, code: &str, message: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::new(code, message, "value is empty", true));
    }
    Ok(value)
}

fn first_output_line(value: &str) -> Option<String> {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        kind: NetworkDiagnosticKind,
        target: &str,
        port: Option<u16>,
    ) -> NetworkDiagnosticRequest {
        NetworkDiagnosticRequest {
            connection_id: "conn-1".to_string(),
            kind,
            target: target.to_string(),
            port,
        }
    }

    #[test]
    fn build_ping_command_quotes_target() {
        let command =
            build_diagnostic_command(&request(NetworkDiagnosticKind::Ping, "example'host", None))
                .expect("ping command should build");

        assert_eq!(command.target, "example'host");
        assert_eq!(command.command_label, "ping");
        assert!(command.command.contains("timeout 12"));
        assert!(command.command.contains("ping -c 4 -W 2"));
        assert!(command.command.contains(&quote_posix_shell("example'host")));
    }

    #[test]
    fn build_tcp_command_uses_nc_and_bash_fallback() {
        let command =
            build_diagnostic_command(&request(NetworkDiagnosticKind::Tcp, "10.0.0.5", Some(443)))
                .expect("tcp command should build");

        assert_eq!(command.command_label, "tcp");
        assert!(command.command.contains("command -v nc"));
        assert!(command.command.contains("nc -vz -w 5"));
        assert!(command.command.contains("/dev/tcp/$1/$2"));
        assert!(command.command.contains("'10.0.0.5' 443"));
    }

    #[test]
    fn build_dns_command_uses_dig_nslookup_getent_fallback() {
        let command =
            build_diagnostic_command(&request(NetworkDiagnosticKind::Dns, "example.com", None))
                .expect("dns command should build");

        assert_eq!(command.command_label, "dns");
        assert!(command.command.contains("command -v dig"));
        assert!(command.command.contains("dig +short"));
        assert!(command.command.contains("command -v nslookup"));
        assert!(command.command.contains("nslookup"));
        assert!(command.command.contains("getent hosts"));
        assert!(command.command.contains("'example.com'"));
    }

    #[test]
    fn build_trace_command_uses_tracepath_traceroute_fallback() {
        let command =
            build_diagnostic_command(&request(NetworkDiagnosticKind::Trace, "example.com", None))
                .expect("trace command should build");

        assert_eq!(command.command_label, "trace");
        assert!(command.command.contains("command -v tracepath"));
        assert!(command.command.contains("tracepath -m 16"));
        assert!(command.command.contains("command -v traceroute"));
        assert!(command.command.contains("traceroute -m 16"));
        assert!(command.command.contains("'example.com'"));
    }

    #[test]
    fn build_http_command_defaults_to_https() {
        let command = build_diagnostic_command(&request(
            NetworkDiagnosticKind::Http,
            "example.com/path",
            None,
        ))
        .expect("http command should build");

        assert_eq!(command.target, "https://example.com/path");
        assert_eq!(command.command_label, "http");
        assert!(command.command.contains("timeout 15"));
        assert!(command.command.contains("curl -I -L --max-time 10"));
        assert!(command.command.contains("'https://example.com/path'"));
    }

    #[test]
    fn build_tcp_command_rejects_missing_port() {
        let error =
            build_diagnostic_command(&request(NetworkDiagnosticKind::Tcp, "example.com", None))
                .expect_err("tcp should require a port");

        assert_eq!(error.code, "network_diagnostic_port_invalid");
        assert!(error.recoverable);
    }
}
