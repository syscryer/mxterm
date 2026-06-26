use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;

use crate::app_error::AppError;
use crate::events::{
    DockerImagePullProgressEvent, DockerLogStreamEvent, DOCKER_IMAGE_PULL_PROGRESS,
    DOCKER_LOG_STREAM_EVENT,
};
use crate::remote_exec_pool::{RemoteExecRetry, RemoteExecSessionPool};
use crate::remote_files::quote_posix_shell;
use crate::ssh_config::resolve_saved_connection;
use crate::terminal::session::{ExecOutput, ExecOutputChunkCallback, ReusableExecSession};

const DOCKER_LIST_CONTAINERS_COMMAND: &str = "docker ps -a --no-trunc --format '{{json .}}'";
const DOCKER_LIST_IMAGES_COMMAND: &str = "docker images --no-trunc --format '{{json .}}'";
const DOCKER_LIST_NETWORKS_COMMAND: &str = "docker network ls --format '{{json .}}'";
const DOCKER_ENGINE_STATUS_COMMAND: &str = r#"
section() {
  name="$1"
  shift
  printf '\n__MXTERM_SECTION:%s__\n' "$name"
  "$@" 2>&1
  printf '\n__MXTERM_RC:%s__\n' "$?"
}
section service sh -c 'command -v systemctl >/dev/null 2>&1 && systemctl is-active docker || { echo systemctl unavailable; exit 127; }'
section info sh -c "docker info --format '{{json .}}'"
section networks sh -c 'docker network ls -q | wc -l'
section volumes sh -c 'docker volume ls -q | wc -l'
section ps sh -c "ps -C dockerd -o %cpu=,rss= | awk 'NF >= 2 { cpu += \$1; rss += \$2; count += 1 } END { if (count == 0) { print \"\" } else { printf \"%.2f %d\n\", cpu, rss } }'"
section root_dir sh -c "docker info --format '{{.DockerRootDir}}'"
root_dir="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
if [ -n "$root_dir" ]; then
  section root_df df -B1 "$root_dir"
  section root_du du -sb "$root_dir"
else
  section root_df sh -c 'echo docker root dir unavailable; exit 1'
  section root_du sh -c 'echo docker root dir unavailable; exit 1'
fi
section system_df sh -c "docker system df --format '{{json .}}'"
"#;
const DOCKER_DAEMON_CONFIG_PATH: &str = "/etc/docker/daemon.json";
const DEFAULT_LOG_TAIL: u16 = 120;
const MAX_LOG_TAIL: u16 = 500;

pub type DockerExecSessionManager = RemoteExecSessionPool;

#[derive(Clone)]
pub struct DockerLogStreamManager {
    streams: Arc<AsyncMutex<HashMap<String, DockerLogStreamHandle>>>,
}

struct DockerLogStreamHandle {
    session: Arc<ReusableExecSession>,
    stopped: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl Default for DockerLogStreamManager {
    fn default() -> Self {
        Self {
            streams: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }
}

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
pub struct DockerContainerLogsStartRequest {
    pub connection_id: String,
    pub container_id: String,
    pub stream_id: String,
    #[serde(default)]
    pub tail: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerLogsStopRequest {
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerLogsSaveRequest {
    pub local_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerInspectRequest {
    pub connection_id: String,
    pub container_id: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerContainerRestartPolicyRequest {
    pub connection_id: String,
    pub container_id: String,
    pub policy: DockerRestartPolicyKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DockerRestartPolicyKind {
    No,
    Always,
    UnlessStopped,
    OnFailure,
}

impl DockerRestartPolicyKind {
    fn as_docker_arg(self) -> &'static str {
        match self {
            Self::No => "no",
            Self::Always => "always",
            Self::UnlessStopped => "unless-stopped",
            Self::OnFailure => "on-failure",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DockerNetworkConnectRequest {
    pub connection_id: String,
    pub container_id: String,
    pub network_id: String,
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

#[derive(Debug, Deserialize)]
pub struct DockerImageRunRequest {
    pub connection_id: String,
    pub image: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub entrypoint: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub restart_policy: Option<DockerRestartPolicyKind>,
    #[serde(default)]
    pub privileged: bool,
    #[serde(default)]
    pub ports: Vec<DockerImageRunPort>,
    #[serde(default)]
    pub env: Vec<DockerImageRunKeyValue>,
    #[serde(default)]
    pub volumes: Vec<DockerImageRunVolume>,
}

#[derive(Debug, Deserialize)]
pub struct DockerImageRunPort {
    pub host_port: String,
    pub container_port: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerImageRunKeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerImageRunVolume {
    pub host_path: String,
    pub container_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerEngineAction {
    Start,
    Stop,
    Restart,
}

impl DockerEngineAction {
    fn command(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }

    fn success_message(self) -> &'static str {
        match self {
            Self::Start => "Docker 服务已启动。",
            Self::Stop => "Docker 服务已停止。",
            Self::Restart => "Docker 服务已重启。",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct DockerEngineActionRequest {
    pub connection_id: String,
    pub action: DockerEngineAction,
}

#[derive(Debug, Deserialize)]
pub struct DockerEngineConfigRequest {
    pub connection_id: String,
}

#[derive(Debug, Deserialize)]
pub struct DockerEngineSaveConfigRequest {
    pub connection_id: String,
    pub content: String,
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

#[derive(Debug, Serialize)]
pub struct DockerContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub image_id: Option<String>,
    pub created: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub status: String,
    pub running: bool,
    pub ip_address: Option<String>,
    pub command: Vec<String>,
    pub entrypoint: Vec<String>,
    pub working_dir: Option<String>,
    pub restart_policy: DockerRestartPolicy,
    pub ports: Vec<DockerContainerPort>,
    pub env: Vec<DockerKeyValue>,
    pub mounts: Vec<DockerContainerMount>,
    pub networks: Vec<DockerContainerNetworkAttachment>,
    pub labels: Vec<DockerKeyValue>,
    pub raw_json: String,
}

#[derive(Debug, Serialize)]
pub struct DockerRestartPolicy {
    pub name: String,
    pub maximum_retry_count: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct DockerContainerPort {
    pub private_port: String,
    pub host_ip: Option<String>,
    pub host_port: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerKeyValue {
    pub key: String,
    pub value: String,
    pub sensitive: bool,
}

#[derive(Debug, Serialize)]
pub struct DockerContainerMount {
    pub kind: Option<String>,
    pub source: Option<String>,
    pub destination: String,
    pub name: Option<String>,
    pub driver: Option<String>,
    pub rw: bool,
}

#[derive(Debug, Serialize)]
pub struct DockerContainerNetworkAttachment {
    pub name: String,
    pub ip_address: Option<String>,
    pub gateway: Option<String>,
    pub mac_address: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerNetworkSummary {
    pub id: String,
    pub name: String,
    pub driver: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerEngineStatus {
    pub installed: bool,
    pub running: bool,
    pub service_status: Option<String>,
    pub version: Option<String>,
    pub api_version: Option<String>,
    pub server_os: Option<String>,
    pub root_dir: Option<String>,
    pub storage_driver: Option<String>,
    pub cgroup_driver: Option<String>,
    pub containers: Option<u64>,
    pub containers_running: Option<u64>,
    pub images: Option<u64>,
    pub networks: Option<u64>,
    pub volumes: Option<u64>,
    pub daemon_cpu_percent: Option<f64>,
    pub daemon_memory_bytes: Option<u64>,
    pub docker_disk_used_bytes: Option<u64>,
    pub root_disk_used_bytes: Option<u64>,
    pub root_disk_total_bytes: Option<u64>,
    pub can_control_service: bool,
    pub raw_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerEngineConfigResult {
    pub path: String,
    pub exists: bool,
    pub content: String,
}

impl DockerLogStreamManager {
    async fn start(
        &self,
        app: AppHandle,
        request: DockerContainerLogsStartRequest,
    ) -> Result<(), AppError> {
        let connection_id = require_value(
            &request.connection_id,
            "docker_connection_missing",
            "请选择活动连接。",
        )?
        .to_string();
        let container_id = require_value(
            &request.container_id,
            "docker_container_missing",
            "请选择容器。",
        )?
        .to_string();
        let stream_id = require_value(
            &request.stream_id,
            "docker_log_stream_missing",
            "日志流标识缺失。",
        )?
        .to_string();
        let tail = request.tail.unwrap_or(DEFAULT_LOG_TAIL).min(MAX_LOG_TAIL);
        let command = format!(
            "docker logs -f --tail {} -- {} 2>&1",
            tail,
            quote_posix_shell(&container_id)
        );
        let config = resolve_saved_connection(&app, &connection_id, None)?;
        let session = Arc::new(ReusableExecSession::connect_resolved(&app, &config).await?);
        let stopped = Arc::new(AtomicBool::new(false));
        let callback = docker_log_stream_callback(&app, &stream_id, &connection_id, &container_id);
        let manager = self.clone();
        let task_session = Arc::clone(&session);
        let task_stopped = Arc::clone(&stopped);
        let task_stream_id = stream_id.clone();
        let task_connection_id = connection_id.clone();
        let task_container_id = container_id.clone();
        let task = tokio::spawn(async move {
            let result = task_session
                .exec_streaming_stdout_chunks(&command, callback)
                .await;

            if !task_stopped.load(Ordering::SeqCst) {
                match result {
                    Ok(output) if output.exit_status.is_some_and(|status| status != 0) => {
                        emit_log_stream_error(
                            &app,
                            &task_stream_id,
                            &task_connection_id,
                            &task_container_id,
                            "Docker 容器日志读取失败。",
                        );
                    }
                    Ok(_) => emit_log_stream_finished(
                        &app,
                        &task_stream_id,
                        &task_connection_id,
                        &task_container_id,
                    ),
                    Err(error) => emit_log_stream_error(
                        &app,
                        &task_stream_id,
                        &task_connection_id,
                        &task_container_id,
                        &error.message,
                    ),
                }
            }

            task_stopped.store(true, Ordering::SeqCst);
            task_session.close().await;
            manager.finish_stream(&task_stream_id, &task_session).await;
        });

        let previous = {
            let mut streams = self.streams.lock().await;
            streams.insert(
                stream_id,
                DockerLogStreamHandle {
                    session,
                    stopped,
                    task,
                },
            )
        };
        close_log_stream_handle(previous).await;

        Ok(())
    }

    async fn stop(&self, request: DockerContainerLogsStopRequest) -> Result<(), AppError> {
        let stream_id = require_value(
            &request.stream_id,
            "docker_log_stream_missing",
            "日志流标识缺失。",
        )?;
        self.stop_stream(stream_id).await;
        Ok(())
    }

    async fn stop_stream(&self, stream_id: &str) {
        let removed = self.streams.lock().await.remove(stream_id);
        close_log_stream_handle(removed).await;
    }

    async fn finish_stream(&self, stream_id: &str, session: &Arc<ReusableExecSession>) {
        let removed = {
            let mut streams = self.streams.lock().await;
            if streams
                .get(stream_id)
                .is_some_and(|handle| Arc::ptr_eq(&handle.session, session))
            {
                streams.remove(stream_id)
            } else {
                None
            }
        };
        if let Some(handle) = removed {
            handle.stopped.store(true, Ordering::SeqCst);
        }
    }
}

pub async fn start_log_stream(
    app: &AppHandle,
    manager: &DockerLogStreamManager,
    request: DockerContainerLogsStartRequest,
) -> Result<(), AppError> {
    manager.start(app.clone(), request).await
}

pub async fn stop_log_stream(
    manager: &DockerLogStreamManager,
    request: DockerContainerLogsStopRequest,
) -> Result<(), AppError> {
    manager.stop(request).await
}

pub fn save_logs_to_local(request: DockerContainerLogsSaveRequest) -> Result<(), AppError> {
    let local_path = require_value(
        &request.local_path,
        "docker_log_save_path_missing",
        "请选择日志保存位置。",
    )?;
    if request.content.is_empty() {
        return Err(AppError::new(
            "docker_log_save_content_missing",
            "当前没有可保存的日志。",
            "content is empty",
            true,
        ));
    }

    let path = PathBuf::from(local_path);
    if path.is_dir() {
        return Err(AppError::new(
            "docker_log_save_path_invalid",
            "请选择有效的日志文件路径。",
            local_path,
            true,
        ));
    }
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        if !parent.exists() {
            return Err(AppError::new(
                "docker_log_save_parent_missing",
                "日志保存目录不存在。",
                parent.to_string_lossy(),
                true,
            ));
        }
    }

    fs::write(&path, request.content.as_bytes()).map_err(|error| {
        AppError::new(
            "docker_log_save_failed",
            "Docker 容器日志保存失败。",
            error,
            true,
        )
    })
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

#[derive(Debug, Deserialize)]
struct DockerNetworkLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Driver")]
    driver: Option<String>,
    #[serde(rename = "Scope")]
    scope: Option<String>,
}

pub async fn list_containers(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerContainerSummary>, AppError> {
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        DOCKER_LIST_CONTAINERS_COMMAND,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_success(
        &output,
        "docker_list_containers_failed",
        "Docker 容器列表读取失败。",
    )?;
    parse_containers(&output.stdout)
}

pub async fn list_images(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerImageSummary>, AppError> {
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        DOCKER_LIST_IMAGES_COMMAND,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_success(
        &output,
        "docker_list_images_failed",
        "Docker 镜像列表读取失败。",
    )?;
    parse_images(&output.stdout)
}

pub async fn container_action(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
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
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
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
    manager: &DockerExecSessionManager,
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
        exec_docker_command_with_stdout_chunks(app, manager, connection_id, &command, callback)
            .await;
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
    manager: &DockerExecSessionManager,
    request: DockerImageRemoveRequest,
) -> Result<DockerActionResult, AppError> {
    let image_id = require_value(&request.image_id, "docker_image_missing", "请选择镜像。")?;
    let command = format!("docker rmi -- {}", quote_posix_shell(image_id));
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
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

pub async fn image_run(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerImageRunRequest,
) -> Result<DockerActionResult, AppError> {
    let command = build_image_run_command(&request)?;
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
    ensure_success(&output, "docker_image_run_failed", "Docker 容器运行失败。")?;

    Ok(DockerActionResult {
        ok: true,
        message: "容器已启动。".to_string(),
        output: output_text(&output),
    })
}

pub async fn container_logs(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
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
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
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

pub async fn container_inspect(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerContainerInspectRequest,
) -> Result<DockerContainerDetail, AppError> {
    let container_id = require_value(
        &request.container_id,
        "docker_container_missing",
        "请选择容器。",
    )?;
    let command = format!("docker inspect -- {}", quote_posix_shell(container_id));
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_success(
        &output,
        "docker_container_inspect_failed",
        "Docker 容器详情读取失败。",
    )?;
    parse_container_detail(&output.stdout)
}

pub async fn container_update_restart_policy(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerContainerRestartPolicyRequest,
) -> Result<DockerActionResult, AppError> {
    let container_id = require_value(
        &request.container_id,
        "docker_container_missing",
        "请选择容器。",
    )?;
    let command = format!(
        "docker update --restart {} -- {}",
        quote_posix_shell(request.policy.as_docker_arg()),
        quote_posix_shell(container_id)
    );
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
    ensure_success(
        &output,
        "docker_container_restart_policy_failed",
        "Docker 重启策略更新失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: "容器重启策略已更新。".to_string(),
        output: output_text(&output),
    })
}

pub async fn list_networks(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerConnectionRequest,
) -> Result<Vec<DockerNetworkSummary>, AppError> {
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        DOCKER_LIST_NETWORKS_COMMAND,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_success(
        &output,
        "docker_network_list_failed",
        "Docker 网络列表读取失败。",
    )?;
    parse_networks(&output.stdout)
}

pub async fn container_connect_network(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerNetworkConnectRequest,
) -> Result<DockerActionResult, AppError> {
    let container_id = require_value(
        &request.container_id,
        "docker_container_missing",
        "请选择容器。",
    )?;
    let network_id = require_value(
        &request.network_id,
        "docker_network_missing",
        "请选择 Docker 网络。",
    )?;
    let command = format!(
        "docker network connect {} {}",
        quote_posix_shell(network_id),
        quote_posix_shell(container_id)
    );
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
    ensure_success(
        &output,
        "docker_network_connect_failed",
        "Docker 网络加入失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: "容器已加入网络。".to_string(),
        output: output_text(&output),
    })
}

pub async fn engine_status(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerConnectionRequest,
) -> Result<DockerEngineStatus, AppError> {
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        DOCKER_ENGINE_STATUS_COMMAND,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    Ok(parse_engine_status(&output.stdout, &output.stderr))
}

pub async fn engine_action(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerEngineActionRequest,
) -> Result<DockerActionResult, AppError> {
    let command = format!(
        "command -v systemctl >/dev/null 2>&1 && systemctl {} docker",
        request.action.command()
    );
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
    ensure_success(
        &output,
        "docker_engine_action_failed",
        "Docker 服务操作失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: request.action.success_message().to_string(),
        output: output_text(&output),
    })
}

pub async fn engine_read_config(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerEngineConfigRequest,
) -> Result<DockerEngineConfigResult, AppError> {
    let command = format!(
        "if [ -f {path} ]; then printf '__MXTERM_EXISTS__:1\\n'; cat {path}; elif [ -e {path} ]; then echo 'Docker 配置路径不是普通文件。' >&2; exit 2; else printf '__MXTERM_EXISTS__:0\\n{{}}'; fi",
        path = quote_posix_shell(DOCKER_DAEMON_CONFIG_PATH)
    );
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::ReconnectOnce,
    )
    .await?;
    ensure_success(
        &output,
        "docker_engine_config_read_failed",
        "Docker 配置文件读取失败。",
    )?;
    let raw_content = String::from_utf8_lossy(&output.stdout).to_string();
    let (exists, content) = match raw_content.split_once('\n') {
        Some(("__MXTERM_EXISTS__:1", content)) => (true, content.to_string()),
        Some(("__MXTERM_EXISTS__:0", content)) => (false, content.to_string()),
        _ => (true, raw_content),
    };

    Ok(DockerEngineConfigResult {
        path: DOCKER_DAEMON_CONFIG_PATH.to_string(),
        exists,
        content,
    })
}

pub async fn engine_save_config(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    request: DockerEngineSaveConfigRequest,
) -> Result<DockerActionResult, AppError> {
    let content = request.content.trim();
    serde_json::from_str::<Value>(content).map_err(|error| {
        AppError::new(
            "docker_engine_config_json_invalid",
            "Docker 配置不是合法 JSON。",
            error,
            true,
        )
    })?;

    let encoded = general_purpose::STANDARD.encode(content.as_bytes());
    let command = format!(
        r#"tmp="$(mktemp /tmp/mxterm-daemon-json.XXXXXX)" || exit 1
base64 -d > "$tmp" <<'MXTERM_DOCKER_CONFIG'
{encoded}
MXTERM_DOCKER_CONFIG
mkdir -p /etc/docker
if [ -f {path} ]; then
  backup="/etc/docker/daemon.json.bak.$(date +%Y%m%d-%H%M%S)"
  cp {path} "$backup" || {{ rm -f "$tmp"; exit 1; }}
fi
cp "$tmp" {path}
chmod 0644 {path} 2>/dev/null || true
rm -f "$tmp"
"#,
        encoded = encoded,
        path = quote_posix_shell(DOCKER_DAEMON_CONFIG_PATH)
    );
    let output = exec_docker_command(
        app,
        manager,
        &request.connection_id,
        &command,
        RemoteExecRetry::None,
    )
    .await?;
    ensure_success(
        &output,
        "docker_engine_config_save_failed",
        "Docker 配置文件保存失败。",
    )?;

    Ok(DockerActionResult {
        ok: true,
        message: "Docker 配置已保存。".to_string(),
        output: output_text(&output),
    })
}

async fn exec_docker_command(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    connection_id: &str,
    command: &str,
    retry: RemoteExecRetry,
) -> Result<ExecOutput, AppError> {
    let connection_id = require_value(
        connection_id,
        "docker_connection_missing",
        "请选择活动连接。",
    )?;
    let config = resolve_saved_connection(app, connection_id, None)?;
    manager.exec(app, &config, command, retry).await
}

async fn exec_docker_command_with_stdout_chunks(
    app: &AppHandle,
    manager: &DockerExecSessionManager,
    connection_id: &str,
    command: &str,
    chunks: ExecOutputChunkCallback,
) -> Result<ExecOutput, AppError> {
    let config = resolve_saved_connection(app, connection_id, None)?;
    manager
        .exec_with_stdout_chunks(app, &config, command, chunks)
        .await
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

fn parse_networks(output: &[u8]) -> Result<Vec<DockerNetworkSummary>, AppError> {
    parse_json_lines::<DockerNetworkLine>(output, "docker_network_parse_failed").map(|items| {
        items
            .into_iter()
            .map(|item| DockerNetworkSummary {
                id: item.id,
                name: item.name,
                driver: item.driver.filter(|value| !value.trim().is_empty()),
                scope: item.scope.filter(|value| !value.trim().is_empty()),
            })
            .collect()
    })
}

fn build_image_run_command(request: &DockerImageRunRequest) -> Result<String, AppError> {
    let image = require_value(&request.image, "docker_image_missing", "请选择镜像。")?;
    let mut parts = vec!["docker".to_string(), "run".to_string(), "-d".to_string()];

    if let Some(name) = optional_value(request.name.as_deref()) {
        parts.push("--name".to_string());
        parts.push(quote_posix_shell(name));
    }
    if let Some(entrypoint) = optional_value(request.entrypoint.as_deref()) {
        parts.push("--entrypoint".to_string());
        parts.push(quote_posix_shell(entrypoint));
    }
    if let Some(network) = optional_value(request.network.as_deref()) {
        parts.push("--network".to_string());
        parts.push(quote_posix_shell(network));
    }
    if let Some(policy) = request.restart_policy {
        parts.push("--restart".to_string());
        parts.push(quote_posix_shell(policy.as_docker_arg()));
    }
    if request.privileged {
        parts.push("--privileged".to_string());
    }

    for port in &request.ports {
        let host_port = require_value(
            &port.host_port,
            "docker_run_port_invalid",
            "请输入主机端口。",
        )?;
        let container_port = require_value(
            &port.container_port,
            "docker_run_port_invalid",
            "请输入容器端口。",
        )?;
        parts.push("-p".to_string());
        parts.push(quote_posix_shell(&format!("{host_port}:{container_port}")));
    }

    for item in &request.env {
        let key = require_value(&item.key, "docker_run_env_invalid", "请输入环境变量名。")?;
        if key.contains('=') {
            return Err(AppError::new(
                "docker_run_env_invalid",
                "环境变量名不能包含等号。",
                key,
                true,
            ));
        }
        parts.push("-e".to_string());
        parts.push(quote_posix_shell(&format!("{}={}", key, item.value)));
    }

    for volume in &request.volumes {
        let host_path = require_value(
            &volume.host_path,
            "docker_run_volume_invalid",
            "请输入主机路径。",
        )?;
        let container_path = require_value(
            &volume.container_path,
            "docker_run_volume_invalid",
            "请输入容器路径。",
        )?;
        parts.push("-v".to_string());
        parts.push(quote_posix_shell(&format!("{host_path}:{container_path}")));
    }

    parts.push(quote_posix_shell(image));
    if let Some(command) = optional_value(request.command.as_deref()) {
        parts.push("sh".to_string());
        parts.push("-lc".to_string());
        parts.push(quote_posix_shell(command));
    }

    Ok(parts.join(" "))
}

fn parse_container_detail(output: &[u8]) -> Result<DockerContainerDetail, AppError> {
    let text = String::from_utf8_lossy(output);
    let values = serde_json::from_str::<Vec<Value>>(&text).map_err(|error| {
        AppError::new(
            "docker_container_inspect_parse_failed",
            "Docker 容器详情解析失败。",
            error,
            true,
        )
    })?;
    let value = values.first().ok_or_else(|| {
        AppError::new(
            "docker_container_inspect_empty",
            "Docker 容器详情为空。",
            "docker inspect returned an empty array",
            true,
        )
    })?;
    let state = value.get("State");
    let config = value.get("Config");
    let network_settings = value.get("NetworkSettings");
    let host_config = value.get("HostConfig");
    let restart_policy_value = host_config.and_then(|item| item.get("RestartPolicy"));
    let command = value_array_strings(config.and_then(|item| item.get("Cmd")))
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            let mut parts = Vec::new();
            if let Some(path) = value_string(value.get("Path")) {
                parts.push(path);
            }
            if let Some(args) = value_array_strings(value.get("Args")) {
                parts.extend(args);
            }
            parts
        });
    let raw_json = serde_json::to_string_pretty(value).unwrap_or_else(|_| text.to_string());

    Ok(DockerContainerDetail {
        id: value_string(value.get("Id")).unwrap_or_default(),
        name: value_string(value.get("Name"))
            .map(|name| name.trim_start_matches('/').to_string())
            .unwrap_or_default(),
        image: value_string(config.and_then(|item| item.get("Image"))).unwrap_or_default(),
        image_id: value_string(value.get("Image")),
        created: value_string(value.get("Created")),
        started_at: value_string(state.and_then(|item| item.get("StartedAt")))
            .filter(|value| !is_zero_docker_time(value)),
        finished_at: value_string(state.and_then(|item| item.get("FinishedAt")))
            .filter(|value| !is_zero_docker_time(value)),
        status: value_string(state.and_then(|item| item.get("Status")))
            .unwrap_or_else(|| "unknown".to_string()),
        running: state
            .and_then(|item| item.get("Running"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        ip_address: value_string(network_settings.and_then(|item| item.get("IPAddress"))),
        command,
        entrypoint: value_array_strings(config.and_then(|item| item.get("Entrypoint")))
            .unwrap_or_default(),
        working_dir: value_string(config.and_then(|item| item.get("WorkingDir"))),
        restart_policy: DockerRestartPolicy {
            name: value_string(restart_policy_value.and_then(|item| item.get("Name")))
                .unwrap_or_else(|| "no".to_string()),
            maximum_retry_count: restart_policy_value
                .and_then(|item| item.get("MaximumRetryCount"))
                .and_then(Value::as_u64),
        },
        ports: parse_container_ports(network_settings.and_then(|item| item.get("Ports"))),
        env: parse_env_values(config.and_then(|item| item.get("Env"))),
        mounts: parse_mounts(value.get("Mounts")),
        networks: parse_container_networks(network_settings.and_then(|item| item.get("Networks"))),
        labels: parse_label_values(config.and_then(|item| item.get("Labels"))),
        raw_json,
    })
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "<none>")
        .map(ToString::to_string)
}

fn value_array_strings(value: Option<&Value>) -> Option<Vec<String>> {
    match value? {
        Value::String(item) => {
            value_string(Some(&Value::String(item.clone()))).map(|item| vec![item])
        }
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|item| value_string(Some(item)))
                .collect(),
        ),
        _ => None,
    }
}

fn parse_container_ports(value: Option<&Value>) -> Vec<DockerContainerPort> {
    let Some(Value::Object(ports)) = value else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for (private_port, bindings) in ports {
        match bindings {
            Value::Array(items) if !items.is_empty() => {
                for binding in items {
                    result.push(DockerContainerPort {
                        private_port: private_port.clone(),
                        host_ip: value_string(binding.get("HostIp")),
                        host_port: value_string(binding.get("HostPort")),
                    });
                }
            }
            _ => result.push(DockerContainerPort {
                private_port: private_port.clone(),
                host_ip: None,
                host_port: None,
            }),
        }
    }
    result.sort_by(|left, right| left.private_port.cmp(&right.private_port));
    result
}

fn parse_env_values(value: Option<&Value>) -> Vec<DockerKeyValue> {
    let Some(items) = value_array_strings(value) else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|item| {
            let (key, value) = item.split_once('=')?;
            let sensitive = is_sensitive_env_key(key);
            Some(DockerKeyValue {
                key: key.to_string(),
                value: if sensitive {
                    "******".to_string()
                } else {
                    value.to_string()
                },
                sensitive,
            })
        })
        .collect()
}

fn is_sensitive_env_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("password")
        || key.contains("passwd")
        || key.ends_with("_pwd")
        || key == "pwd"
        || key.contains("secret")
        || key.contains("token")
        || key.contains("private_key")
        || key.contains("access_key")
}

fn parse_mounts(value: Option<&Value>) -> Vec<DockerContainerMount> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let destination = value_string(item.get("Destination"))?;
            Some(DockerContainerMount {
                kind: value_string(item.get("Type")),
                source: value_string(item.get("Source")),
                destination,
                name: value_string(item.get("Name")),
                driver: value_string(item.get("Driver")),
                rw: item.get("RW").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect()
}

fn parse_container_networks(value: Option<&Value>) -> Vec<DockerContainerNetworkAttachment> {
    let Some(Value::Object(networks)) = value else {
        return Vec::new();
    };
    let mut result = networks
        .iter()
        .map(|(name, item)| DockerContainerNetworkAttachment {
            name: name.clone(),
            ip_address: value_string(item.get("IPAddress")),
            gateway: value_string(item.get("Gateway")),
            mac_address: value_string(item.get("MacAddress")),
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| left.name.cmp(&right.name));
    result
}

fn parse_label_values(value: Option<&Value>) -> Vec<DockerKeyValue> {
    let Some(Value::Object(labels)) = value else {
        return Vec::new();
    };
    let mut result = labels
        .iter()
        .filter_map(|(key, value)| {
            Some(DockerKeyValue {
                key: key.clone(),
                value: value_string(Some(value))?,
                sensitive: false,
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| left.key.cmp(&right.key));
    result
}

fn is_zero_docker_time(value: &str) -> bool {
    value.starts_with("0001-01-01T00:00:00")
}

#[derive(Debug, Default)]
struct CommandSection {
    name: String,
    content: String,
    exit_status: Option<i32>,
}

fn parse_engine_status(stdout: &[u8], stderr: &[u8]) -> DockerEngineStatus {
    let sections = parse_command_sections(&String::from_utf8_lossy(stdout));
    let service = section(&sections, "service");
    let info = section(&sections, "info");
    let info_json = info
        .filter(|section| section.exit_status == Some(0))
        .and_then(|section| serde_json::from_str::<Value>(section.content.trim()).ok());
    let service_status = service
        .map(|section| section.content.trim().to_string())
        .filter(|value| !value.is_empty());
    let root_dir = info_value_string(info_json.as_ref(), "DockerRootDir")
        .or_else(|| section_text(&sections, "root_dir"));
    let raw_error = engine_raw_error(&sections, stderr);
    let system_df_used = parse_system_df_used(section_text(&sections, "system_df").as_deref());
    let root_df = parse_df_bytes(section_text(&sections, "root_df").as_deref());
    let (daemon_cpu_percent, daemon_memory_bytes) =
        parse_dockerd_process_usage(section_text(&sections, "ps").as_deref());

    DockerEngineStatus {
        installed: info.is_some_and(|section| section.exit_status == Some(0)),
        running: service_status.as_deref() == Some("active"),
        service_status,
        version: info_value_string(info_json.as_ref(), "ServerVersion"),
        api_version: info_value_string(info_json.as_ref(), "APIVersion"),
        server_os: info_value_string(info_json.as_ref(), "OperatingSystem"),
        root_dir,
        storage_driver: info_value_string(info_json.as_ref(), "Driver"),
        cgroup_driver: info_value_string(info_json.as_ref(), "CgroupDriver"),
        containers: info_value_u64(info_json.as_ref(), "Containers"),
        containers_running: info_value_u64(info_json.as_ref(), "ContainersRunning"),
        images: info_value_u64(info_json.as_ref(), "Images"),
        networks: section_u64(&sections, "networks"),
        volumes: section_u64(&sections, "volumes"),
        daemon_cpu_percent,
        daemon_memory_bytes,
        docker_disk_used_bytes: system_df_used.or_else(|| section_first_u64(&sections, "root_du")),
        root_disk_used_bytes: root_df.map(|(_, used)| used),
        root_disk_total_bytes: root_df.map(|(total, _)| total),
        can_control_service: service.is_some_and(|section| section.exit_status != Some(127)),
        raw_error,
    }
}

fn parse_command_sections(output: &str) -> Vec<CommandSection> {
    let mut sections = Vec::new();
    let mut current: Option<CommandSection> = None;

    for line in output.lines() {
        if let Some(name) = line
            .strip_prefix("__MXTERM_SECTION:")
            .and_then(|value| value.strip_suffix("__"))
        {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(CommandSection {
                name: name.to_string(),
                ..CommandSection::default()
            });
            continue;
        }

        if let Some(exit_status) = line
            .strip_prefix("__MXTERM_RC:")
            .and_then(|value| value.strip_suffix("__"))
            .and_then(|value| value.parse::<i32>().ok())
        {
            if let Some(section) = current.as_mut() {
                section.exit_status = Some(exit_status);
            }
            continue;
        }

        if let Some(section) = current.as_mut() {
            if !section.content.is_empty() {
                section.content.push('\n');
            }
            section.content.push_str(line);
        }
    }

    if let Some(section) = current {
        sections.push(section);
    }

    sections
}

fn section<'a>(sections: &'a [CommandSection], name: &str) -> Option<&'a CommandSection> {
    sections.iter().find(|section| section.name == name)
}

fn section_text(sections: &[CommandSection], name: &str) -> Option<String> {
    section(sections, name)
        .filter(|section| section.exit_status == Some(0))
        .map(|section| section.content.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn section_u64(sections: &[CommandSection], name: &str) -> Option<u64> {
    section_text(sections, name)?.trim().parse::<u64>().ok()
}

fn section_first_u64(sections: &[CommandSection], name: &str) -> Option<u64> {
    section_text(sections, name)?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()
}

fn info_value_string(info: Option<&Value>, key: &str) -> Option<String> {
    info?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn info_value_u64(info: Option<&Value>, key: &str) -> Option<u64> {
    info?.get(key)?.as_u64()
}

fn parse_dockerd_process_usage(value: Option<&str>) -> (Option<f64>, Option<u64>) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return (None, None);
    };
    let mut parts = value.split_whitespace();
    let cpu = parts.next().and_then(|value| value.parse::<f64>().ok());
    let memory = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|rss_kib| rss_kib.saturating_mul(1024));
    (cpu, memory)
}

fn parse_df_bytes(value: Option<&str>) -> Option<(u64, u64)> {
    let line = value?.lines().nth(1)?;
    let mut parts = line.split_whitespace();
    let _filesystem = parts.next()?;
    let total = parts.next()?.parse::<u64>().ok()?;
    let used = parts.next()?.parse::<u64>().ok()?;
    Some((total, used))
}

fn parse_system_df_used(value: Option<&str>) -> Option<u64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let mut total = 0u64;
    for line in value.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Ok(item) = serde_json::from_str::<Value>(line) {
            if let Some(size) = item
                .get("Size")
                .or_else(|| item.get("SIZE"))
                .and_then(Value::as_str)
                .and_then(parse_docker_size_bytes_u64)
            {
                total = total.saturating_add(size);
            }
        }
    }
    if total == 0 {
        None
    } else {
        Some(total)
    }
}

fn parse_docker_size_bytes_u64(value: &str) -> Option<u64> {
    parse_docker_size_bytes(value).map(|value| value.max(0.0).round() as u64)
}

fn engine_raw_error(sections: &[CommandSection], stderr: &[u8]) -> Option<String> {
    let mut details = Vec::new();
    for section in sections {
        if is_optional_engine_status_section(&section.name) {
            continue;
        }
        if section.exit_status.is_some_and(|status| status != 0) {
            let content = section.content.trim();
            if !content.is_empty() {
                details.push(format!("{}: {}", section.name, content));
            }
        }
    }
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        details.push(stderr);
    }
    if details.is_empty() {
        None
    } else {
        Some(truncate_raw(&details.join("\n")))
    }
}

fn is_optional_engine_status_section(name: &str) -> bool {
    matches!(
        name,
        "networks" | "volumes" | "ps" | "root_dir" | "root_df" | "root_du" | "system_df"
    )
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
    if normalized.contains("no such network") {
        return Err(AppError::new(
            "docker_network_missing",
            "Docker 网络不存在或已被删除。",
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

fn optional_value(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
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

fn docker_log_stream_callback(
    app: &AppHandle,
    stream_id: &str,
    connection_id: &str,
    container_id: &str,
) -> ExecOutputChunkCallback {
    let app = app.clone();
    let stream_id = stream_id.to_string();
    let connection_id = connection_id.to_string();
    let container_id = container_id.to_string();
    Arc::new(move |chunk| {
        let content = String::from_utf8_lossy(chunk).to_string();
        if content.is_empty() {
            return;
        }
        let _ = app.emit(
            DOCKER_LOG_STREAM_EVENT,
            DockerLogStreamEvent {
                stream_id: stream_id.clone(),
                connection_id: connection_id.clone(),
                container_id: container_id.clone(),
                kind: "chunk".to_string(),
                content: Some(content),
                message: None,
            },
        );
    })
}

fn emit_log_stream_error(
    app: &AppHandle,
    stream_id: &str,
    connection_id: &str,
    container_id: &str,
    message: &str,
) {
    let _ = app.emit(
        DOCKER_LOG_STREAM_EVENT,
        DockerLogStreamEvent {
            stream_id: stream_id.to_string(),
            connection_id: connection_id.to_string(),
            container_id: container_id.to_string(),
            kind: "error".to_string(),
            content: None,
            message: Some(message.to_string()),
        },
    );
}

fn emit_log_stream_finished(
    app: &AppHandle,
    stream_id: &str,
    connection_id: &str,
    container_id: &str,
) {
    let _ = app.emit(
        DOCKER_LOG_STREAM_EVENT,
        DockerLogStreamEvent {
            stream_id: stream_id.to_string(),
            connection_id: connection_id.to_string(),
            container_id: container_id.to_string(),
            kind: "finished".to_string(),
            content: None,
            message: Some("日志流已结束。".to_string()),
        },
    );
}

async fn close_log_stream_handle(handle: Option<DockerLogStreamHandle>) {
    if let Some(handle) = handle {
        handle.stopped.store(true, Ordering::SeqCst);
        handle.session.close().await;
        handle.task.abort();
    }
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
    use super::{
        build_image_run_command, parse_container_detail, parse_containers, parse_images,
        parse_networks, parse_pull_progress_line, save_logs_to_local,
        DockerContainerLogsSaveRequest, DockerImageRunKeyValue, DockerImageRunPort,
        DockerImageRunRequest, DockerImageRunVolume,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[test]
    fn save_logs_to_local_writes_utf8_text() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_millis();
        let path = std::env::temp_dir().join(format!("mxterm-docker-log-{timestamp}.log"));

        save_logs_to_local(DockerContainerLogsSaveRequest {
            local_path: path.to_string_lossy().to_string(),
            content: "容器日志\nline 2\n".to_string(),
        })
        .expect("log save should succeed");

        let content = fs::read_to_string(&path).expect("saved log should be readable");
        assert_eq!(content, "容器日志\nline 2\n");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn parse_container_detail_reads_inspect_fields() {
        let output = br#"[{
          "Id": "5d06bfab02bc9333ca352b943fd048973d33098c498d5bbf11fbb902bd0a0567",
          "Name": "/dm8-8.1.2.128",
          "Created": "2024-06-26T11:06:37.123456789Z",
          "Path": "/bin/bash",
          "Args": ["/opt/startup.sh"],
          "State": {
            "Status": "running",
            "Running": true,
            "StartedAt": "2026-04-20T09:08:32.000000000Z",
            "FinishedAt": "0001-01-01T00:00:00Z"
          },
          "Config": {
            "Image": "dm8:8.1.2.128",
            "Env": ["PATH=/usr/local/bin", "SYSDba_PWD=SYSDba002"],
            "Entrypoint": null,
            "Cmd": ["/bin/bash", "/opt/startup.sh"],
            "WorkingDir": "/opt/dmdbms",
            "Labels": {"com.example.role": "database"}
          },
          "HostConfig": {
            "RestartPolicy": {"Name": "always", "MaximumRetryCount": 0}
          },
          "NetworkSettings": {
            "IPAddress": "172.17.0.4",
            "Ports": {"5236/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5236"}]},
            "Networks": {
              "bridge": {
                "IPAddress": "172.17.0.4",
                "Gateway": "172.17.0.1",
                "MacAddress": "02:42:ac:11:00:04"
              }
            }
          },
          "Mounts": [{
            "Type": "bind",
            "Source": "/opt/dm/data",
            "Destination": "/opt/dmdbms/data",
            "RW": true
          }]
        }]"#;

        let detail = parse_container_detail(output).expect("container inspect should parse");

        assert_eq!(detail.name, "dm8-8.1.2.128");
        assert_eq!(detail.ip_address.as_deref(), Some("172.17.0.4"));
        assert_eq!(detail.restart_policy.name, "always");
        assert_eq!(detail.command, vec!["/bin/bash", "/opt/startup.sh"]);
        assert_eq!(detail.ports[0].private_port, "5236/tcp");
        assert_eq!(detail.mounts[0].destination, "/opt/dmdbms/data");
        assert_eq!(detail.networks[0].name, "bridge");
        assert_eq!(detail.labels[0].key, "com.example.role");
    }

    #[test]
    fn parse_container_detail_masks_sensitive_env_values() {
        let output = br#"[{
          "Id": "abc",
          "Name": "/secure",
          "Created": "2026-06-26T00:00:00Z",
          "State": {"Status": "exited", "Running": false},
          "Config": {
            "Image": "redis:7",
            "Env": ["TOKEN=abc123", "NORMAL=value"],
            "Labels": {}
          },
          "HostConfig": {"RestartPolicy": {"Name": "no", "MaximumRetryCount": 0}},
          "NetworkSettings": {"Networks": {}},
          "Mounts": []
        }]"#;

        let detail = parse_container_detail(output).expect("container inspect should parse");

        assert_eq!(detail.env[0].key, "TOKEN");
        assert!(detail.env[0].sensitive);
        assert_eq!(detail.env[0].value, "******");
        assert_eq!(detail.env[1].value, "value");
    }

    #[test]
    fn parse_networks_reads_json_lines() {
        let output = br#"{"ID":"1f4b","Name":"bridge","Driver":"bridge","Scope":"local"}
{"ID":"9a7c","Name":"app_net","Driver":"bridge","Scope":"local"}"#;

        let networks = parse_networks(output).expect("networks parse");

        assert_eq!(networks.len(), 2);
        assert_eq!(networks[0].name, "bridge");
        assert_eq!(networks[1].driver.as_deref(), Some("bridge"));
    }

    #[test]
    fn build_image_run_command_quotes_runtime_options() {
        let request = DockerImageRunRequest {
            connection_id: "conn-1".to_string(),
            image: "nginx:latest".to_string(),
            name: Some("mx web".to_string()),
            command: Some("nginx -g 'daemon off;'".to_string()),
            entrypoint: Some("/entry point".to_string()),
            network: Some("app net".to_string()),
            restart_policy: Some(super::DockerRestartPolicyKind::UnlessStopped),
            privileged: true,
            ports: vec![DockerImageRunPort {
                host_port: "8080".to_string(),
                container_port: "80/tcp".to_string(),
            }],
            env: vec![DockerImageRunKeyValue {
                key: "APP_ENV".to_string(),
                value: "prod value".to_string(),
            }],
            volumes: vec![DockerImageRunVolume {
                host_path: "/srv/app data".to_string(),
                container_path: "/usr/share/nginx/html".to_string(),
            }],
        };

        let command = build_image_run_command(&request).expect("run command should build");

        assert_eq!(
            command,
            "docker run -d --name 'mx web' --entrypoint '/entry point' --network 'app net' --restart 'unless-stopped' --privileged -p '8080:80/tcp' -e 'APP_ENV=prod value' -v '/srv/app data:/usr/share/nginx/html' 'nginx:latest' sh -lc 'nginx -g '\\''daemon off;'\\'''"
        );
    }
}
