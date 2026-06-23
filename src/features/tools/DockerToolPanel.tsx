import * as Dialog from "@radix-ui/react-dialog";
import {
  Box,
  Copy,
  Download,
  Image as ImageIcon,
  Network,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Square,
  SquareTerminal,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import {
  dockerContainerAction,
  dockerContainerLogs,
  dockerImagePull,
  dockerImageRemove,
  dockerListContainers,
  dockerListImages,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { listenDockerImagePullProgress } from "../../shared/tauri/events";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import type {
  DockerContainerAction,
  DockerContainerSummary,
  DockerImagePullProgressEvent,
  DockerImagePullStatus,
  DockerImageSummary,
  DockerLogsResult,
} from "./dockerTypes";

type ToolboxView = "docker" | "network" | "schedule";
type DockerView = "containers" | "images";

interface DockerImagePullTask {
  pullId: string;
  connectionId: string;
  image: string;
  status: DockerImagePullStatus;
  message: string;
  percent: number | null;
  currentLayer: string | null;
}

interface DockerToolPanelProps {
  active: boolean;
  connection: ConnectionProfile | null;
  onCopyText?: (text: string) => void | Promise<void>;
  onOpenContainerTerminal?: (container: DockerContainerSummary) => void;
}

const toolboxViews: Array<{ icon: LucideIcon; label: string; value: ToolboxView }> = [
  { icon: Box, label: "Docker", value: "docker" },
  { icon: Network, label: "网络诊断", value: "network" },
  { icon: Timer, label: "定时任务", value: "schedule" },
];

export function DockerToolPanel({
  active,
  connection,
  onCopyText,
  onOpenContainerTerminal,
}: DockerToolPanelProps) {
  const [toolboxView, setToolboxView] = useState<ToolboxView>("docker");
  const [dockerView, setDockerView] = useState<DockerView>("containers");
  const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
  const [images, setImages] = useState<DockerImageSummary[]>([]);
  const [imagePullTasks, setImagePullTasks] = useState<DockerImagePullTask[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [containerDeleteTarget, setContainerDeleteTarget] =
    useState<DockerContainerSummary | null>(null);
  const [imageDeleteTarget, setImageDeleteTarget] = useState<DockerImageSummary | null>(null);
  const [logsTarget, setLogsTarget] = useState<DockerContainerSummary | null>(null);
  const [logsResult, setLogsResult] = useState<DockerLogsResult | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [pullImage, setPullImage] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const connectionId = connection?.id || null;
  const runningCount = useMemo(
    () => containers.filter((container) => isContainerRunning(container)).length,
    [containers],
  );

  useEffect(() => {
    setContainers([]);
    setImages([]);
    setError(null);
    setNotice(null);
    setLogsTarget(null);
    setLogsResult(null);
    setLogsError(null);
    setImagePullTasks([]);
  }, [connectionId]);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenDockerImagePullProgress((event) => {
      if (event.connection_id !== connectionId) {
        return;
      }
      applyImagePullProgress(event);
      if (event.status === "success") {
        void refreshImages();
        window.setTimeout(() => {
          if (!disposed) {
            setImagePullTasks((items) =>
              items.filter((item) => item.pullId !== event.pull_id),
            );
          }
        }, 2200);
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [connectionId]);

  useEffect(() => {
    if (!active || toolboxView !== "docker" || !connectionId) {
      return;
    }
    void refreshDocker();
  }, [active, toolboxView, connectionId]);

  async function refreshDocker() {
    await Promise.all([refreshContainers(), refreshImages()]);
  }

  async function refreshContainers() {
    if (!connectionId) {
      return;
    }
    setLoadingContainers(true);
    setError(null);
    try {
      setContainers(
        hasTauriRuntime()
          ? await dockerListContainers(connectionId)
          : previewDockerContainers(),
      );
    } catch (nextError) {
      setError(formatDockerError(nextError));
    } finally {
      setLoadingContainers(false);
    }
  }

  async function refreshImages() {
    if (!connectionId) {
      return;
    }
    setLoadingImages(true);
    setError(null);
    try {
      setImages(hasTauriRuntime() ? await dockerListImages(connectionId) : previewDockerImages());
    } catch (nextError) {
      setError(formatDockerError(nextError));
    } finally {
      setLoadingImages(false);
    }
  }

  async function runContainerAction(
    container: DockerContainerSummary,
    action: DockerContainerAction,
  ) {
    if (!connectionId) {
      return;
    }
    const nextBusyKey = `${action}:${container.id}`;
    setBusyKey(nextBusyKey);
    setError(null);
    setNotice(null);
    try {
      const result = hasTauriRuntime()
        ? await dockerContainerAction(connectionId, container.id, action)
        : previewDockerActionResult(action);
      setNotice(result.message);
      await refreshContainers();
    } catch (nextError) {
      setError(formatDockerError(nextError));
      await refreshContainers();
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmRemoveContainer() {
    if (!containerDeleteTarget) {
      return;
    }
    await runContainerAction(containerDeleteTarget, "remove");
    setContainerDeleteTarget(null);
  }

  async function confirmRemoveImage() {
    if (!connectionId || !imageDeleteTarget) {
      return;
    }
    const target = imageDeleteTarget;
    setBusyKey(`image-remove:${target.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = hasTauriRuntime()
        ? await dockerImageRemove(connectionId, target.id)
        : { ok: true, message: "镜像已删除。", output: null };
      setNotice(result.message);
      await refreshImages();
    } catch (nextError) {
      setError(formatDockerError(nextError));
      await refreshImages();
    } finally {
      setBusyKey(null);
      setImageDeleteTarget(null);
    }
  }

  async function openLogs(container: DockerContainerSummary) {
    if (!connectionId) {
      return;
    }
    setLogsTarget(container);
    setLogsResult(null);
    setLogsError(null);
    setLogsLoading(true);
    try {
      setLogsResult(
        hasTauriRuntime()
          ? await dockerContainerLogs(connectionId, container.id, 120)
          : previewDockerLogs(container),
      );
    } catch (nextError) {
      setLogsError(formatDockerError(nextError));
    } finally {
      setLogsLoading(false);
    }
  }

  async function submitPullImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectionId) {
      return;
    }
    const image = pullImage.trim();
    if (!image) {
      setPullError("请输入镜像名称。");
      return;
    }
    const pullId = createDockerPullId();
    const nextTask: DockerImagePullTask = {
      pullId,
      connectionId,
      image,
      status: "running",
      message: "等待 Docker 返回拉取进度。",
      percent: null,
      currentLayer: null,
    };
    setPulling(true);
    setPullError(null);
    setError(null);
    setNotice(null);
    setDockerView("images");
    setImagePullTasks((items) => [
      nextTask,
      ...items.filter((item) => item.pullId !== pullId && item.image !== image),
    ]);
    setPullDialogOpen(false);
    setPullImage("");
    try {
      const result = hasTauriRuntime()
        ? await dockerImagePull(connectionId, image, pullId)
        : await previewDockerPullTask(pullId, connectionId, image, applyImagePullProgress);
      setNotice(result.message);
      await refreshImages();
      window.setTimeout(() => {
        setImagePullTasks((items) => items.filter((item) => item.pullId !== pullId));
      }, 2200);
    } catch (nextError) {
      const message = formatDockerError(nextError);
      setImagePullTasks((items) =>
        items.map((item) =>
          item.pullId === pullId
            ? { ...item, status: "failed", message, percent: null, currentLayer: null }
            : item,
        ),
      );
    } finally {
      setPulling(false);
    }
  }

  function applyImagePullProgress(event: DockerImagePullProgressEvent) {
    setImagePullTasks((items) => {
      const nextTask: DockerImagePullTask = {
        pullId: event.pull_id,
        connectionId: event.connection_id,
        image: event.image,
        status: event.status,
        message: event.message,
        percent: event.percent ?? null,
        currentLayer: event.current_layer ?? null,
      };
      const existingIndex = items.findIndex((item) => item.pullId === event.pull_id);
      if (existingIndex === -1) {
        return [nextTask, ...items];
      }
      return items.map((item, index) => (index === existingIndex ? nextTask : item));
    });
  }

  async function copyValue(value: string, label: string) {
    try {
      if (onCopyText) {
        await onCopyText(value);
      } else {
        await navigator.clipboard?.writeText(value);
      }
      setNotice(`已复制${label}。`);
    } catch (nextError) {
      setError(`复制失败：${formatDockerError(nextError)}`);
    }
  }

  return (
    <section className="toolbox-tool" aria-label="工具">
      <header className="toolbox-head">
        <div className="toolbox-title">
          <strong>工具</strong>
          <span>{connection ? `${connection.name} · 远端工具箱` : "打开 SSH 会话后可用"}</span>
        </div>
      </header>

      <nav className="toolbox-mode-tabs" aria-label="工具类型">
        {toolboxViews.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={toolboxView === item.value ? "active" : ""}
              key={item.value}
              type="button"
              onClick={() => setToolboxView(item.value)}
            >
              <Icon className="ui-icon" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {toolboxView === "docker" ? (
        <div className="docker-tool">
          <header className="docker-tool-summary">
            <div>
              <strong>Docker</strong>
              <span>
                {connection
                  ? `容器 ${containers.length.toString()} 个 · 运行 ${runningCount.toString()} 个 · 镜像 ${images.length.toString()} 个`
                  : "需要当前 SSH 连接"}
              </span>
            </div>
            <Tooltip label="刷新 Docker 数据">
              <button
                className="toolbox-icon-button"
                type="button"
                aria-label="刷新 Docker 数据"
                disabled={!connection || loadingContainers || loadingImages}
                onClick={() => void refreshDocker()}
              >
                <RefreshCw
                  className={`ui-icon ${loadingContainers || loadingImages ? "spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </Tooltip>
          </header>

          <div className="docker-view-tabs" aria-label="Docker 视图">
            <button
              className={dockerView === "containers" ? "active" : ""}
              type="button"
              onClick={() => setDockerView("containers")}
            >
              <Box className="ui-icon" aria-hidden="true" />
              容器
            </button>
            <button
              className={dockerView === "images" ? "active" : ""}
              type="button"
              onClick={() => setDockerView("images")}
            >
              <ImageIcon className="ui-icon" aria-hidden="true" />
              镜像
            </button>
          </div>

          {error ? <div className="docker-inline-error">{error}</div> : null}
          {notice ? <div className="docker-inline-notice">{notice}</div> : null}

          {!connection ? (
            <ToolboxEmptyState
              icon={Box}
              title="暂无 SSH 会话"
              description="打开或切换到一个 SSH 会话后，可以查看远端 Docker 容器和镜像。"
            />
          ) : dockerView === "containers" ? (
            <ContainerList
              busyKey={busyKey}
              containers={containers}
              loading={loadingContainers}
              onCopy={(container) => void copyValue(container.name || container.id, "容器名称")}
              onLogs={(container) => void openLogs(container)}
              onOpenTerminal={onOpenContainerTerminal}
              onRefresh={() => void refreshContainers()}
              onRemove={setContainerDeleteTarget}
              onRunAction={(container, action) => void runContainerAction(container, action)}
            />
          ) : (
            <ImageList
              busyKey={busyKey}
              images={images}
              pullDisabled={pulling}
              pullTasks={imagePullTasks}
              loading={loadingImages}
              onCopy={(image) => void copyValue(formatImageReference(image), "镜像名称")}
              onCopyPullImage={(image) => void copyValue(image, "镜像名称")}
              onDismissPullTask={(pullId) =>
                setImagePullTasks((items) => items.filter((item) => item.pullId !== pullId))
              }
              onPull={() => {
                setPullError(null);
                setPullDialogOpen(true);
              }}
              onRefresh={() => void refreshImages()}
              onRemove={setImageDeleteTarget}
            />
          )}
        </div>
      ) : toolboxView === "network" ? (
        <ToolboxEmptyState
          icon={Network}
          title="网络诊断待接入"
          description="后续会在这里放 ping、traceroute、dig 等远端排障工具。"
        />
      ) : (
        <ToolboxEmptyState
          icon={Timer}
          title="定时任务待接入"
          description="后续会在这里维护轻量定时命令和执行记录。"
        />
      )}

      <DockerLogsDialog
        loading={logsLoading}
        result={logsResult}
        target={logsTarget}
        error={logsError}
        onClose={() => {
          setLogsTarget(null);
          setLogsResult(null);
          setLogsError(null);
        }}
        onRefresh={() => logsTarget && void openLogs(logsTarget)}
      />

      <Dialog.Root
        open={pullDialogOpen}
        onOpenChange={(open) => {
          if (!pulling) {
            setPullDialogOpen(open);
            if (!open) {
              setPullError(null);
            }
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop" />
          <Dialog.Content className="docker-pull-dialog">
            <Dialog.Title className="docker-dialog-title">拉取镜像</Dialog.Title>
            <form className="docker-pull-form" onSubmit={submitPullImage}>
              <label>
                <span>镜像名称</span>
                <input
                  autoFocus
                  placeholder="nginx:latest"
                  spellCheck={false}
                  value={pullImage}
                  onChange={(event) => setPullImage(event.currentTarget.value)}
                />
              </label>
              {pullError ? <p className="docker-form-error">{pullError}</p> : null}
              <footer className="docker-dialog-actions">
                <Dialog.Close asChild>
                  <button className="secondary-button" type="button" disabled={pulling}>
                    取消
                  </button>
                </Dialog.Close>
                <button className="primary-button" type="submit" disabled={pulling}>
                  <Download className={`ui-icon ${pulling ? "spin" : ""}`} aria-hidden="true" />
                  拉取
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={Boolean(containerDeleteTarget)}
        title="删除容器"
        description={
          containerDeleteTarget
            ? `确认删除容器“${containerDeleteTarget.name || containerDeleteTarget.id}”吗？运行中的容器需要先停止。`
            : ""
        }
        confirmLabel="删除"
        onConfirm={confirmRemoveContainer}
        onOpenChange={(open) => {
          if (!open) {
            setContainerDeleteTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(imageDeleteTarget)}
        title="删除镜像"
        description={
          imageDeleteTarget
            ? `确认删除镜像“${formatImageReference(imageDeleteTarget)}”吗？被容器占用时 Docker 会拒绝删除。`
            : ""
        }
        confirmLabel="删除"
        onConfirm={confirmRemoveImage}
        onOpenChange={(open) => {
          if (!open) {
            setImageDeleteTarget(null);
          }
        }}
      />
    </section>
  );
}

function ContainerList({
  busyKey,
  containers,
  loading,
  onCopy,
  onLogs,
  onOpenTerminal,
  onRefresh,
  onRemove,
  onRunAction,
}: {
  busyKey: string | null;
  containers: DockerContainerSummary[];
  loading: boolean;
  onCopy: (container: DockerContainerSummary) => void;
  onLogs: (container: DockerContainerSummary) => void;
  onOpenTerminal?: (container: DockerContainerSummary) => void;
  onRefresh: () => void;
  onRemove: (container: DockerContainerSummary) => void;
  onRunAction: (container: DockerContainerSummary, action: DockerContainerAction) => void;
}) {
  if (containers.length === 0) {
    return (
      <ToolboxEmptyState
        icon={Box}
        title={loading ? "正在读取容器..." : "暂无容器"}
        description={loading ? "正在通过 SSH 执行 docker ps。" : "远端 Docker 当前没有容器。"}
      />
    );
  }

  return (
    <div className="docker-list" aria-label="Docker 容器">
      {containers.map((container) => {
        const running = isContainerRunning(container);
        return (
          <article className="docker-row" key={container.id}>
            <div className="docker-row-main">
              <span className="docker-row-title">
                <Box className="ui-icon" aria-hidden="true" />
                <strong title={container.name}>{container.name || shortDockerId(container.id)}</strong>
                <em className={`docker-status ${normalizeState(container.state)}`}>
                  {container.state || "unknown"}
                </em>
              </span>
              <code title={container.image}>{container.image}</code>
              <small title={container.status}>
                {container.status}
                {container.ports ? ` · ${container.ports}` : ""}
              </small>
            </div>
            <div className="docker-row-actions">
              <Tooltip label={running ? "停止容器" : "启动容器"}>
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label={running ? "停止容器" : "启动容器"}
                  disabled={busyKey === `${running ? "stop" : "start"}:${container.id}`}
                  onClick={() => onRunAction(container, running ? "stop" : "start")}
                >
                  {running ? (
                    <Square className="ui-icon" aria-hidden="true" />
                  ) : (
                    <Play className="ui-icon" aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
              <Tooltip label="重启容器">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="重启容器"
                  disabled={busyKey === `restart:${container.id}`}
                  onClick={() => onRunAction(container, "restart")}
                >
                  <RotateCw className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="查看日志">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="查看日志"
                  onClick={() => onLogs(container)}
                >
                  <ScrollText className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="进入容器终端">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="进入容器终端"
                  disabled={!running || !onOpenTerminal}
                  onClick={() => onOpenTerminal?.(container)}
                >
                  <SquareTerminal className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="复制容器名称">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="复制容器名称"
                  onClick={() => onCopy(container)}
                >
                  <Copy className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="删除容器">
                <button
                  className="toolbox-icon-button danger"
                  type="button"
                  aria-label="删除容器"
                  disabled={Boolean(busyKey)}
                  onClick={() => onRemove(container)}
                >
                  <Trash2 className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </article>
        );
      })}
      <button className="toolbox-refresh-row" type="button" onClick={onRefresh}>
        <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
        刷新容器
      </button>
    </div>
  );
}

function ImageList({
  busyKey,
  images,
  loading,
  onCopy,
  onCopyPullImage,
  onDismissPullTask,
  onPull,
  onRefresh,
  onRemove,
  pullDisabled,
  pullTasks,
}: {
  busyKey: string | null;
  images: DockerImageSummary[];
  loading: boolean;
  onCopy: (image: DockerImageSummary) => void;
  onCopyPullImage: (image: string) => void;
  onDismissPullTask: (pullId: string) => void;
  onPull: () => void;
  onRefresh: () => void;
  onRemove: (image: DockerImageSummary) => void;
  pullDisabled: boolean;
  pullTasks: DockerImagePullTask[];
}) {
  const hasRows = images.length > 0 || pullTasks.length > 0;
  return (
    <div className="docker-image-view">
      <div className="docker-list-head">
        <span>镜像列表</span>
        <button
          className="toolbox-mini-button primary"
          type="button"
          disabled={pullDisabled}
          onClick={onPull}
        >
          <Download className="ui-icon" aria-hidden="true" />
          拉取
        </button>
      </div>
      {!hasRows ? (
        <ToolboxEmptyState
          icon={ImageIcon}
          title={loading ? "正在读取镜像..." : "暂无镜像"}
          description={loading ? "正在通过 SSH 执行 docker images。" : "远端 Docker 当前没有镜像。"}
        />
      ) : (
        <div className="docker-list" aria-label="Docker 镜像">
          {pullTasks.map((task) => (
            <article
              className={`docker-row docker-pull-row ${task.status}`}
              key={task.pullId}
            >
              <div className="docker-row-main">
                <span className="docker-row-title">
                  <Download
                    className={`ui-icon ${task.status === "running" ? "spin" : ""}`}
                    aria-hidden="true"
                  />
                  <strong title={task.image}>{task.image}</strong>
                  <em className={`docker-status ${task.status}`}>
                    {formatPullStatus(task.status)}
                  </em>
                </span>
                <div
                  className={`docker-pull-progress ${task.percent === null ? "indeterminate" : ""}`}
                  aria-label={formatPullProgressLabel(task)}
                  title={formatPullProgressLabel(task)}
                >
                  <span style={pullProgressStyle(task.percent)} />
                </div>
                <small title={formatPullProgressLabel(task)}>
                  {task.currentLayer ? `${task.currentLayer} · ${task.message}` : task.message}
                </small>
              </div>
              <div className="docker-row-actions">
                <Tooltip label="复制镜像名称">
                  <button
                    className="toolbox-icon-button"
                    type="button"
                    aria-label="复制镜像名称"
                    onClick={() => onCopyPullImage(task.image)}
                  >
                    <Copy className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                {task.status !== "running" ? (
                  <Tooltip label="移除拉取记录">
                    <button
                      className="toolbox-icon-button"
                      type="button"
                      aria-label="移除拉取记录"
                      onClick={() => onDismissPullTask(task.pullId)}
                    >
                      <X className="ui-icon" aria-hidden="true" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            </article>
          ))}
          {images.map((image) => (
            <article className="docker-row" key={`${image.id}-${image.repository}-${image.tag}`}>
              <div className="docker-row-main">
                <span className="docker-row-title">
                  <ImageIcon className="ui-icon" aria-hidden="true" />
                  <strong title={formatImageReference(image)}>{formatImageReference(image)}</strong>
                </span>
                <code title={image.id}>{shortDockerId(image.id)}</code>
                <small>
                  {image.size}
                  {image.created_since || image.created_at
                    ? ` · ${image.created_since || image.created_at}`
                    : ""}
                </small>
              </div>
              <div className="docker-row-actions">
                <Tooltip label="复制镜像名称">
                  <button
                    className="toolbox-icon-button"
                    type="button"
                    aria-label="复制镜像名称"
                    onClick={() => onCopy(image)}
                  >
                    <Copy className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label="删除镜像">
                  <button
                    className="toolbox-icon-button danger"
                    type="button"
                    aria-label="删除镜像"
                    disabled={busyKey === `image-remove:${image.id}`}
                    onClick={() => onRemove(image)}
                  >
                    <Trash2 className="ui-icon" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </article>
          ))}
          <button className="toolbox-refresh-row" type="button" onClick={onRefresh}>
            <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
            刷新镜像
          </button>
        </div>
      )}
    </div>
  );
}

function DockerLogsDialog({
  error,
  loading,
  result,
  target,
  onClose,
  onRefresh,
}: {
  error: string | null;
  loading: boolean;
  result: DockerLogsResult | null;
  target: DockerContainerSummary | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="docker-logs-dialog">
          <header className="docker-logs-head">
            <Dialog.Title>{target ? `${target.name || shortDockerId(target.id)} 日志` : "容器日志"}</Dialog.Title>
            <div className="docker-logs-actions">
              <Tooltip label="刷新日志">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="刷新日志"
                  disabled={loading}
                  onClick={onRefresh}
                >
                  <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
                </button>
              </Tooltip>
              <Dialog.Close asChild>
                <button className="toolbox-icon-button" type="button" aria-label="关闭日志">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
          </header>
          {error ? <p className="docker-form-error">{error}</p> : null}
          <pre className="docker-log-output">
            {loading ? "正在读取日志..." : result?.content || "没有日志输出。"}
          </pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ToolboxEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="toolbox-empty">
      <Icon className="ui-icon" aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function isContainerRunning(container: DockerContainerSummary) {
  return normalizeState(container.state) === "running";
}

function normalizeState(state: string) {
  return state.trim().toLowerCase() || "unknown";
}

function shortDockerId(id: string) {
  return id.replace(/^sha256:/, "").slice(0, 12) || id;
}

function formatImageReference(image: DockerImageSummary) {
  const repository = image.repository && image.repository !== "<none>" ? image.repository : "";
  const tag = image.tag && image.tag !== "<none>" ? image.tag : "";
  if (repository && tag) {
    return `${repository}:${tag}`;
  }
  return repository || shortDockerId(image.id);
}

function createDockerPullId() {
  return `pull-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPullStatus(status: DockerImagePullStatus) {
  const labels: Record<DockerImagePullStatus, string> = {
    failed: "失败",
    running: "拉取中",
    success: "完成",
  };
  return labels[status];
}

function formatPullProgressLabel(task: DockerImagePullTask) {
  const percent = task.percent === null ? "" : ` ${task.percent.toString()}%`;
  return `${formatPullStatus(task.status)}${percent} · ${task.message}`;
}

function pullProgressStyle(percent: number | null): CSSProperties | undefined {
  if (percent === null) {
    return undefined;
  }
  return { width: `${percent.toString()}%` };
}

function formatDockerError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function previewDockerContainers(): DockerContainerSummary[] {
  return [
    {
      id: "d9b100f2f6364d21a0a3",
      name: "mxterm-nginx",
      image: "nginx:latest",
      command: "nginx -g 'daemon off;'",
      created_at: "2026-06-23 08:30:00 +0800 CST",
      running_for: "2 hours ago",
      ports: "0.0.0.0:8080->80/tcp",
      state: "running",
      status: "Up 2 hours",
    },
    {
      id: "a07b12f9be994e88be31",
      name: "redis-cache",
      image: "redis:7",
      command: "redis-server",
      created_at: "2026-06-22 21:10:00 +0800 CST",
      running_for: "12 hours ago",
      ports: "6379/tcp",
      state: "exited",
      status: "Exited (0) 1 hour ago",
    },
  ];
}

function previewDockerImages(): DockerImageSummary[] {
  return [
    {
      id: "sha256:4f67c83422ec7a8f",
      repository: "nginx",
      tag: "latest",
      digest: null,
      created_at: null,
      created_since: "2 weeks ago",
      size: "192MB",
    },
    {
      id: "sha256:183c7b2e4f1f9c2d",
      repository: "redis",
      tag: "7",
      digest: null,
      created_at: null,
      created_since: "3 weeks ago",
      size: "117MB",
    },
  ];
}

function previewDockerActionResult(action: DockerContainerAction) {
  const messages: Record<DockerContainerAction, string> = {
    remove: "容器已删除。",
    restart: "容器已重启。",
    start: "容器已启动。",
    stop: "容器已停止。",
  };
  return {
    ok: true,
    message: messages[action],
    output: null,
  };
}

async function previewDockerPullTask(
  pullId: string,
  connectionId: string,
  image: string,
  applyProgress: (event: DockerImagePullProgressEvent) => void,
) {
  const steps: Array<Pick<DockerImagePullProgressEvent, "message" | "percent" | "current_layer">> =
    [
      { message: `${image}: Pulling from preview`, percent: null, current_layer: null },
      { message: "Downloading 12.4MB/48MB", percent: 26, current_layer: "7c2f8a9d3b1e" },
      { message: "Downloading 35.7MB/48MB", percent: 74, current_layer: "7c2f8a9d3b1e" },
      { message: "Download complete", percent: 100, current_layer: "7c2f8a9d3b1e" },
    ];
  for (const step of steps) {
    await delay(180);
    applyProgress({
      connection_id: connectionId,
      current_layer: step.current_layer,
      image,
      message: step.message,
      percent: step.percent,
      pull_id: pullId,
      status: "running",
    });
  }
  await delay(180);
  applyProgress({
    connection_id: connectionId,
    current_layer: null,
    image,
    message: "镜像拉取完成。",
    percent: 100,
    pull_id: pullId,
    status: "success",
  });
  return { ok: true, message: "镜像拉取完成。", output: null };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function previewDockerLogs(container: DockerContainerSummary): DockerLogsResult {
  return {
    container_id: container.id,
    tail: 120,
    content: [
      `${container.name}: listening on 0.0.0.0`,
      `${container.name}: health check passed`,
      `${container.name}: request completed in 18ms`,
    ].join("\n"),
  };
}
