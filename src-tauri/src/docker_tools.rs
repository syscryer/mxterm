use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::app_error::AppError;
use crate::events::{DockerImagePullProgressEvent, DOCKER_IMAGE_PULL_PROGRESS};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::resolve_saved_connection;
use crate::terminal::session::{ExecOutput, ExecOutputChunkCallback, ReusableExecSession};

const DOCKER_LIST_CONTAINERS_COMMAND: &str = "docker ps -a --no-trunc --format '{{json .}}'";
const DOCKER_LIST_IMAGES_COMMAND: &str = "docker images --no-trunc --format '{{json .}}'";
const DEFAULT_LOG_TAIL: u16 = 120;
const MAX_LOG_TAIL: u16 = 500;

#[derive(Debug, Deserialize)]
pub struct DockerConnectionRequest {
    pub connection_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerContainerAction {
    Start,
    Stop,
    Restart,
    Remove,
}

impl DockerContainerAction {
    fn command(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
            Self::Remove => "rm",
        }
    }

    fn success_message(self) -> &'static str {
        match self {
            Self::Start => "容器已启动。",
            Self::Stop => "容器已停止。",
            Self::Restart => "容器已重启。",
            Self::Remove => "容器已删除。",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerActionRequest {
    pub connection_id: String,
    pub container_id: String,
    pub action: DockerContainerAction,
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerLogsRequest {
    pub connection_id: String,
    pub container_id: String,
    #[serde(default)]
    pub tail: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct DockerImagePullRequest {
    pub connection_id: String,
    pub image: String,
    #[serde(default)]
    pub pull_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DockerImageRemoveRequest {
    pub connection_id: String,
    pub image_id: String,
}

#[derive(Debug, Serialize)]
pub struct DockerContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub command: Option<String>,
    pub created_at: Option<String>,
    pub running_for: Option<String>,
    pub ports: Option<String>,
    pub state: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct DockerImageSummary {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub digest: Option<String>,
    pub created_at: Option<String>,
    pub created_since: Option<String>,
    pub size: String,
}

#[derive(Debug, Serialize)]
pub struct DockerActionResult {
    pub ok: bool,
    pub message: String,
    pub output: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerLogsResult {
    pub container_id: String,
    pub tail: u16,
    pub content: String,
}

#[derive(Debug, Deserialize)]
struct DockerContainerLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Command")]
    command: Option<String>,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
    #[serde(rename = "RunningFor")]
    running_for: Option<String>,
    #[serde(rename = "Ports")]
    ports: Option<String>,
    #[serde(rename = "State")]
    state: Option<String>,
    #[serde(rename = "Status")]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DockerImageLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Repository")]
    repository: String,
    #[serde(rename = "Tag")]
    tag: String,
    #[serde(rename = "Digest")]
    digest: Option<String>,
    #[serde(rename = "CreatedAt")]
    created_at: Option<String>,
    #[serde(rename = "CreatedSince")]
    created_since: Option<String>,
    #[serde(rename = "Size")]
    size: String,
}

pub async fn list_containers(
    app: &AppHandle,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerContainerSummary>, AppError> {
    let output =
        exec_docker_command(app, &request.connection_id, DOCKER_LIST_CONTAINERS_COMMAND).await?;
    ensure_success(
        &output,
        "docker_list_containers_failed",
        "Docker 容器列表读取失败。",
    )?;
    parse_containers(&output.stdout)
}

pub async fn list_images(
    app: &AppHandle,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerImageSummary>, AppError> {
    let output =
        exec_docker_command(app, &request.connection_id, DOCKER_LIST_IMAGES_COMMAND).await?;
    ensure_success(
        &output,
        "docker_list_images_failed",
        "Docker 镜像列表读取失败。",
    )?;
    parse_images(&output.stdout)
}

pub async fn container_action(
    app: &AppHandle,
    request: DockerContainerActionRequest,
) -> Result<DockerActionResult, AppError> {
    let container_id = require_value(
        &request.container_id,
        "docker_container_missing",
        "请选择容器。",
    )?;
    let command = format!(
        "docker {} -- {}",
        request.action.command(),
        quote_posix_shell(container_id)
    );
    let output = exec_docker_command(app, &request.connection_id, &command).await?;
    ensure_success(
        &output,
        "docker_container_action_failed",
        "Docker 容器操作失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: request.action.success_message().to_string(),
        output: output_text(&output),
    })
}

pub async fn image_pull(
    app: &AppHandle,
    request: DockerImagePullRequest,
) -> Result<DockerActionResult, AppError> {
    let connection_id = require_value(
        &request.connection_id,
        "docker_connection_missing",
        "请选择活动连接。",
    )?;
    let image = require_value(&request.image, "docker_image_missing", "请输入镜像名称。")?;
    let pull_id = request
        .pull_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(image);
    emit_pull_progress(
        app,
        pull_id,
        connection_id,
        image,
        "running",
        "开始拉取镜像。",
        None,
        None,
    );
    let callback = docker_pull_progress_callback(app, pull_id, connection_id, image);
    let command = format!("docker pull {} 2>&1", quote_posix_shell(image));
    let output_result =
        exec_docker_command_with_stdout_chunks(app, connection_id, &command, callback).await;
    let output = match output_result {
        Ok(output) => output,
        Err(error) => {
            emit_pull_progress(
                app,
                pull_id,
                connection_id,
                image,
                "failed",
                &error.message,
                None,
                None,
            );
            return Err(error);
        }
    };
    if let Err(error) = ensure_success(&output, "docker_image_pull_failed", "Docker 镜像拉取失败。")
    {
        emit_pull_progress(
            app,
            pull_id,
            connection_id,
            image,
            "failed",
            &error.message,
            None,
            None,
        );
        return Err(error);
    }
    emit_pull_progress(
        app,
        pull_id,
        connection_id,
        image,
        "success",
        "镜像拉取完成。",
        Some(100),
        None,
    );

    Ok(DockerActionResult {
        ok: true,
        message: "镜像拉取完成。".to_string(),
        output: output_text(&output),
    })
}

pub async fn image_remove(
    app: &AppHandle,
    request: DockerImageRemoveRequest,
) -> Result<DockerActionResult, AppError> {
    let image_id = require_value(&request.image_id, "docker_image_missing", "请选择镜像。")?;
    let command = format!("docker rmi -- {}", quote_posix_shell(image_id));
    let output = exec_docker_command(app, &request.connection_id, &command).await?;
    ensure_success(
        &output,
        "docker_image_remove_failed",
        "Docker 镜像删除失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: "镜像已删除。".to_string(),
        output: output_text(&output),
    })
}

pub async fn container_logs(
    app: &AppHandle,
    request: DockerContainerLogsRequest,
) -> Result<DockerLogsResult, AppError> {
    let container_id = require_value(
        &request.container_id,
        "docker_container_missing",
        "请选择容器。",
    )?;
    let tail = request
        .tail
        .unwrap_or(DEFAULT_LOG_TAIL)
        .clamp(1, MAX_LOG_TAIL);
    let command = format!(
        "docker logs --tail {} -- {} 2>&1",
        tail,
        quote_posix_shell(container_id)
    );
    let output = exec_docker_command(app, &request.connection_id, &command).await?;
    ensure_success(
        &output,
        "docker_container_logs_failed",
        "Docker 容器日志读取失败。",
    )?;

    Ok(DockerLogsResult {
        container_id: container_id.to_string(),
        tail,
        content: String::from_utf8_lossy(&output.stdout).to_string(),
    })
}

async fn exec_docker_command(
    app: &AppHandle,
    connection_id: &str,
    command: &str,
) -> Result<ExecOutput, AppError> {
    let connection_id = require_value(
        connection_id,
        "docker_connection_missing",
        "请选择活动连接。",
    )?;
    let config = resolve_saved_connection(app, connection_id, None)?;
    let session = ReusableExecSession::connect_resolved(app, &config).await?;
    let output = session.exec(command).await;
    session.close().await;
    output
}

async fn exec_docker_command_with_stdout_chunks(
    app: &AppHandle,
    connection_id: &str,
    command: &str,
    chunks: ExecOutputChunkCallback,
) -> Result<ExecOutput, AppError> {
    let config = resolve_saved_connection(app, connection_id, None)?;
    let session = ReusableExecSession::connect_resolved(app, &config).await?;
    let output = session.exec_with_stdout_chunks(command, chunks).await;
    session.close().await;
    output
}

fn parse_containers(output: &[u8]) -> Result<Vec<DockerContainerSummary>, AppError> {
    parse_json_lines::<DockerContainerLine>(output, "docker_container_parse_failed").map(|items| {
        items
            .into_iter()
            .map(|item| DockerContainerSummary {
                id: item.id,
                name: item.names,
                image: item.image,
                command: item.command.filter(|value| !value.trim().is_empty()),
                created_at: item.created_at.filter(|value| !value.trim().is_empty()),
                running_for: item.running_for.filter(|value| !value.trim().is_empty()),
                ports: item.ports.filter(|value| !value.trim().is_empty()),
                state: item.state.unwrap_or_else(|| "unknown".to_string()),
                status: item.status.unwrap_or_else(|| "未知状态".to_string()),
            })
            .collect()
    })
}

fn parse_images(output: &[u8]) -> Result<Vec<DockerImageSummary>, AppError> {
    parse_json_lines::<DockerImageLine>(output, "docker_image_parse_failed").map(|items| {
        items
            .into_iter()
            .map(|item| DockerImageSummary {
                id: item.id,
                repository: item.repository,
                tag: item.tag,
                digest: item.digest.filter(|value| !value.trim().is_empty()),
                created_at: item.created_at.filter(|value| !value.trim().is_empty()),
                created_since: item.created_since.filter(|value| !value.trim().is_empty()),
                size: item.size,
            })
            .collect()
    })
}

fn parse_json_lines<T>(output: &[u8], code: &str) -> Result<Vec<T>, AppError>
where
    T: for<'de> Deserialize<'de>,
{
    let text = String::from_utf8_lossy(output);
    let mut items = Vec::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let item = serde_json::from_str::<T>(line).map_err(|error| {
            AppError::new(
                code,
                "Docker 输出解析失败。",
                format!("{}: {}", error, truncate_raw(line)),
                true,
            )
        })?;
        items.push(item);
    }
    Ok(items)
}

fn ensure_success(output: &ExecOutput, code: &str, message: &str) -> Result<(), AppError> {
    if output.exit_status == Some(0) {
        return Ok(());
    }

    let detail = output_detail(output);
    let normalized = detail.to_lowercase();
    if normalized.contains("docker: command not found")
        || normalized.contains("docker: not found")
        || normalized.contains("command not found: docker")
        || normalized.contains("no such file or directory")
    {
        return Err(AppError::new(
            "docker_command_missing",
            "远端未安装 Docker CLI，或 docker 不在 PATH 中。",
            detail,
            true,
        ));
    }
    if normalized.contains("permission denied")
        || normalized.contains("got permission denied")
        || normalized.contains("connect: permission denied")
    {
        return Err(AppError::new(
            "docker_permission_denied",
            "当前用户没有访问 Docker 的权限。",
            detail,
            true,
        ));
    }
    if normalized.contains("no such container") {
        return Err(AppError::new(
            "docker_container_missing",
            "容器不存在或已被删除。",
            detail,
            true,
        ));
    }
    if normalized.contains("no such image") || normalized.contains("not found: image") {
        return Err(AppError::new(
            "docker_image_missing",
            "镜像不存在或已被删除。",
            detail,
            true,
        ));
    }

    Err(AppError::new(code, message, detail, true))
}

fn require_value<'a>(value: &'a str, code: &str, message: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::new(code, message, "value is empty", true));
    }
    Ok(value)
}

fn output_detail(output: &ExecOutput) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    format!("exit_status={:?}", output.exit_status)
}

fn output_text(output: &ExecOutput) -> Option<String> {
    let detail = output_detail(output);
    if detail.trim().is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn truncate_raw(value: &str) -> String {
    const MAX_RAW_CHARS: usize = 400;
    if value.chars().count() <= MAX_RAW_CHARS {
        return value.to_string();
    }
    format!(
        "{}...",
        value.chars().take(MAX_RAW_CHARS).collect::<String>()
    )
}

fn docker_pull_progress_callback(
    app: &AppHandle,
    pull_id: &str,
    connection_id: &str,
    image: &str,
) -> ExecOutputChunkCallback {
    let app = app.clone();
    let pull_id = pull_id.to_string();
    let connection_id = connection_id.to_string();
    let image = image.to_string();
    let parser = Arc::new(Mutex::new(DockerPullProgressParser::default()));
    Arc::new(move |chunk| {
        let mut parser = parser
            .lock()
            .expect("docker pull progress parser lock poisoned");
        parser.push_chunk(chunk, |progress| {
            emit_pull_progress(
                &app,
                &pull_id,
                &connection_id,
                &image,
                "running",
                &progress.message,
                progress.percent,
                progress.current_layer.as_deref(),
            );
        });
    })
}

fn emit_pull_progress(
    app: &AppHandle,
    pull_id: &str,
    connection_id: &str,
    image: &str,
    status: &str,
    message: &str,
    percent: Option<u8>,
    current_layer: Option<&str>,
) {
    let _ = app.emit(
        DOCKER_IMAGE_PULL_PROGRESS,
        DockerImagePullProgressEvent {
            pull_id: pull_id.to_string(),
            connection_id: connection_id.to_string(),
            image: image.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            percent,
            current_layer: current_layer.map(ToString::to_string),
        },
    );
}

#[derive(Default)]
struct DockerPullProgressParser {
    line_buffer: String,
    last_message: Option<String>,
}

struct DockerPullLineProgress {
    message: String,
    percent: Option<u8>,
    current_layer: Option<String>,
}

impl DockerPullProgressParser {
    fn push_chunk(&mut self, chunk: &[u8], mut emit: impl FnMut(DockerPullLineProgress)) {
        let text = String::from_utf8_lossy(chunk);
        for character in text.chars() {
            if character == '\n' || character == '\r' {
                self.flush_line(&mut emit);
            } else {
                self.line_buffer.push(character);
            }
        }
    }

    fn flush_line(&mut self, emit: &mut impl FnMut(DockerPullLineProgress)) {
        let line = self.line_buffer.trim().to_string();
        self.line_buffer.clear();
        if line.is_empty() || self.last_message.as_deref() == Some(line.as_str()) {
            return;
        }
        self.last_message = Some(line.clone());
        emit(parse_pull_progress_line(&line));
    }
}

fn parse_pull_progress_line(line: &str) -> DockerPullLineProgress {
    let (current_layer, detail) = line
        .split_once(':')
        .map(|(layer, rest)| {
            let layer = layer.trim();
            let current_layer = if looks_like_docker_layer_id(layer) {
                Some(layer.to_string())
            } else {
                None
            };
            (current_layer, rest.trim())
        })
        .unwrap_or((None, line.trim()));
    DockerPullLineProgress {
        message: line.trim().to_string(),
        percent: parse_progress_percent(detail),
        current_layer,
    }
}

fn looks_like_docker_layer_id(value: &str) -> bool {
    let len = value.len();
    (8..=64).contains(&len) && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn parse_progress_percent(value: &str) -> Option<u8> {
    value
        .split_whitespace()
        .filter_map(|token| token.split_once('/'))
        .filter_map(|(loaded, total)| {
            let loaded = parse_docker_size_bytes(loaded)?;
            let total = parse_docker_size_bytes(total)?;
            if total == 0.0 {
                return None;
            }
            let percent = ((loaded as f64 / total as f64) * 100.0).round();
            Some(percent.clamp(0.0, 100.0) as u8)
        })
        .next()
}

fn parse_docker_size_bytes(value: &str) -> Option<f64> {
    let value = value.trim_matches(|character: char| {
        character == ','
            || character == ';'
            || character == ')'
            || character == '('
            || character == ']'
            || character == '['
    });
    let split_index = value
        .find(|character: char| !(character.is_ascii_digit() || character == '.'))
        .unwrap_or(value.len());
    let number = value[..split_index].parse::<f64>().ok()?;
    let unit = value[split_index..].trim().to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "" | "b" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(number * multiplier)
}

#[cfg(test)]
mod tests {
    use super::{parse_containers, parse_images, parse_pull_progress_line};

    #[test]
    fn parse_containers_reads_json_lines() {
        let output = br#"{"ID":"abc123","Names":"web","Image":"nginx:latest","Command":"\"nginx\"","CreatedAt":"2026-06-23 10:00:00 +0800 CST","RunningFor":"2 hours ago","Ports":"0.0.0.0:80->80/tcp","State":"running","Status":"Up 2 hours"}
{"ID":"def456","Names":"redis","Image":"redis:7","State":"exited","Status":"Exited (0) 1 hour ago"}"#;

        let containers = parse_containers(output).expect("containers parse");

        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].name, "web");
        assert_eq!(containers[0].state, "running");
        assert_eq!(containers[1].state, "exited");
    }

    #[test]
    fn parse_images_reads_json_lines() {
        let output = br#"{"ID":"sha256:abc","Repository":"nginx","Tag":"latest","Digest":"<none>","CreatedSince":"2 weeks ago","Size":"192MB"}
{"ID":"sha256:def","Repository":"redis","Tag":"7","CreatedAt":"2026-06-23 10:00:00 +0800 CST","Size":"117MB"}"#;

        let images = parse_images(output).expect("images parse");

        assert_eq!(images.len(), 2);
        assert_eq!(images[0].repository, "nginx");
        assert_eq!(images[1].tag, "7");
    }

    #[test]
    fn parse_pull_progress_reads_current_layer_percent() {
        let progress = parse_pull_progress_line("7c2f8a9d3b1e: Downloading 12.4MB/48MB");

        assert_eq!(progress.current_layer.as_deref(), Some("7c2f8a9d3b1e"));
        assert_eq!(progress.percent, Some(26));
    }

    #[test]
    fn parse_pull_progress_keeps_stage_without_percent() {
        let progress = parse_pull_progress_line("latest: Pulling from library/nginx");

        assert_eq!(progress.current_layer, None);
        assert_eq!(progress.percent, None);
        assert_eq!(progress.message, "latest: Pulling from library/nginx");
    }
}
