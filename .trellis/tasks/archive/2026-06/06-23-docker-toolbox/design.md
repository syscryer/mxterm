# Docker Toolbox Design

## Scope

本任务新增一个可扩展的右侧“工具”tab，并实现其中的 Docker 管理页。Docker 功能基于现有 SSH 连接资料与远程 exec 能力执行 `docker` CLI，将结果解析为结构化数据给前端展示。

## UI Model

- `RemoteFilePanel` 的一级工具枚举新增 `tools`。
- `tools` 面板内使用紧凑 segmented/tab：`Docker / 网络诊断 / 定时任务`。
- Docker 页内部再分 `容器 / 镜像 / 引擎` 三个视图。
- 列表采用右侧窄栏高密度行，不做大卡片；详情和长字段通过 tooltip/title 展示。
- 高频动作使用图标按钮加 tooltip；危险动作通过共享确认弹窗。
- 网络诊断和定时任务只显示安静占位，避免用户误以为已可用。
- 引擎视图使用同一右侧窄栏信息密度：顶部服务状态条，下方基础信息和配置文件两个紧凑区块。

## Backend Commands

新增 Rust 模块 `docker_tools.rs`，在 `commands.rs` 暴露 typed Tauri commands：

```text
docker_list_containers(connection_id) -> Vec<DockerContainerSummary>
docker_list_images(connection_id) -> Vec<DockerImageSummary>
docker_container_action(connection_id, container_id, action) -> DockerActionResult
docker_image_remove(connection_id, image_id) -> DockerActionResult
docker_image_pull(connection_id, image, pull_id?) -> DockerActionResult
docker_container_logs(connection_id, container_id, tail) -> DockerLogsResult
docker_engine_status(connection_id) -> DockerEngineStatus
docker_engine_action(connection_id, action) -> DockerActionResult
docker_engine_read_config(connection_id) -> DockerEngineConfigResult
docker_engine_save_config(connection_id, content) -> DockerActionResult
```

命令使用已有连接解析和 `ReusableExecSession` 执行远端命令。所有命令必须：

- 只接收已保存连接 id，不接收明文密码。
- 复用 SSH jump/proxy/known_hosts/timeout 等现有连接路径。
- 对 shell 参数做 POSIX quote，不拼接未转义用户输入。
- 对 `docker` 缺失、权限不足、容器/镜像不存在返回可恢复 `AppError`。
- Docker 引擎服务控制第一版面向 systemd 主机；不做 sudo 密码交互，权限不足直接返回原始错误。

## Command Strategy

容器列表使用格式化输出，避免解析表格列宽：

```sh
docker ps -a --no-trunc --format '{{json .}}'
```

镜像列表：

```sh
docker images --no-trunc --format '{{json .}}'
```

日志：

```sh
docker logs --tail <n> <container>
```

容器操作：

```sh
docker start|stop|restart|rm <container>
```

镜像操作：

```sh
docker pull <image>
docker rmi <image>
```

引擎状态：

```sh
systemctl is-active docker
docker info --format '{{json .}}'
docker network ls -q | wc -l
docker volume ls -q | wc -l
```

引擎配置固定读取 `/etc/docker/daemon.json`。保存时 Rust 侧先校验 JSON，
再通过远端临时文件写回，并在覆盖前备份原文件为
`/etc/docker/daemon.json.bak.<timestamp>`。

`docker pull` 会把远端 CLI 输出合并到 stdout，并按行解析为
`docker:image_pull_progress` 事件。前端生成 `pull_id` 传给命令，事件用
`pull_id + connection_id` 关联到镜像列表里的临时拉取行。进度百分比只在
Docker 输出包含当前层 `loaded/total` 时展示；否则显示当前阶段文案和运行态进度条。

## Frontend Data Flow

- `src/shared/tauri/commands.ts` 增加 typed wrappers。
- 新增 `src/features/tools/dockerTypes.ts` 和 `DockerToolPanel.tsx`。
- `WorkspaceShell` 将当前 SSH 连接、容器 exec 入口、复制能力传入工具面板。
- Docker 页加载时按当前连接拉取容器/镜像；切换连接后刷新。
- 操作成功后刷新对应列表；失败时保留列表并显示错误。
- 拉取镜像提交后立即关闭弹窗，在镜像列表顶部插入拉取任务行；成功后刷新真实镜像列表并短暂展示完成状态，失败时保留失败行供用户查看。
- “进入容器终端”复用现有创建 SSH 终端路径，创建 tab 后写入 `docker exec -it ... sh` 命令。
- 进入“引擎”视图时再加载引擎状态和配置；容器/镜像列表刷新不触发磁盘统计，避免拖慢常用列表。

## Security And Safety

- 删除容器和删除镜像需要确认。
- 第一版不提供 prune、批量删除、run、build、push。
- 停止/重启 Docker 服务、保存并重启 Docker 需要确认。
- 拉取镜像需要用户输入镜像名；空值不提交。
- 不记录 Docker 命令输出到命令历史。
- 错误信息可以展示 docker 原始 stderr，但不得包含凭据。

## Compatibility

- 远端 Linux 主机为主；如果远端 docker CLI 不存在，显示安装/权限提示。
- Podman 不作为第一版正式目标，但如果远端 `docker` 是 podman-docker 兼容命令，按 docker CLI 结果处理。
- Docker 输出 JSON 行解析失败时返回明确错误，并在 raw 中保留截断后的原始输出便于排查。
