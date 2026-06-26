import * as Dialog from "@radix-ui/react-dialog";
import { siDocker } from "simple-icons";
import {
  ArrowDownToLine,
  Box,
  Copy,
  Cpu,
  Eraser,
  Download,
  FileJson,
  HardDrive,
  Image as ImageIcon,
  ListRestart,
  LoaderCircle,
  MemoryStick,
  Network,
  Play,
  Power,
  PowerOff,
  Pause,
  RefreshCw,
  RotateCw,
  ScrollText,
  Save,
  Settings2,
  Square,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
  type SVGProps,
} from "react";

import type { ConnectionProfile } from "../connections/connectionTypes";
import {
  dockerContainerAction,
  dockerContainerLogsSave,
  dockerContainerLogsStart,
  dockerContainerLogsStop,
  dockerEngineAction,
  dockerEngineReadConfig,
  dockerEngineSaveConfig,
  dockerEngineStatus,
  dockerImagePull,
  dockerImageRemove,
  dockerListContainers,
  dockerListImages,
} from "../../shared/tauri/commands";
import { selectDockerLogSavePath } from "../../shared/tauri/dialog";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { listenDockerImagePullProgress, listenDockerLogStream } from "../../shared/tauri/events";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { TabContextMenu, type TabContextMenuAction } from "../../shared/ui/TabContextMenu";
import { Tooltip } from "../../shared/ui/Tooltip";
import type {
  DockerContainerAction,
  DockerContainerSummary,
  DockerEngineAction,
  DockerEngineConfigResult,
  DockerEngineStatus,
  DockerImagePullProgressEvent,
  DockerImagePullStatus,
  DockerImageSummary,
  DockerLogStreamEvent,
  DockerLogsResult,
} from "./dockerTypes";

type ToolboxView = "docker" | "network" | "schedule";
type DockerView = "containers" | "images" | "engine";
type DockerRefreshKind = "containers" | "images" | "engine" | "engineConfig";

interface RefreshRunState {
  inFlight: boolean;
  pending: boolean;
  runId: number;
}

interface RefreshOptions {
  onlyIfMissing?: boolean;
  preserveDirty?: boolean;
  queueIfBusy?: boolean;
  silent?: boolean;
}

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

const containerAutoRefreshMs = 10_000;
const imageAutoRefreshMs = 30_000;
const engineAutoRefreshMs = 30_000;

function createRefreshRunState(): RefreshRunState {
  return {
    inFlight: false,
    pending: false,
    runId: 0,
  };
}

function formatDockerJsonConfig(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return `${JSON.stringify(JSON.parse(trimmed), null, 2)}\n`;
  } catch {
    return content;
  }
}

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
  const [engineStatus, setEngineStatus] = useState<DockerEngineStatus | null>(null);
  const [engineConfig, setEngineConfig] = useState<DockerEngineConfigResult | null>(null);
  const [engineConfigDraft, setEngineConfigDraft] = useState("");
  const [imagePullTasks, setImagePullTasks] = useState<DockerImagePullTask[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [loadingEngineConfig, setLoadingEngineConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [engineActionTarget, setEngineActionTarget] = useState<DockerEngineAction | null>(null);
  const [restartAfterSave, setRestartAfterSave] = useState(false);
  const [containerDeleteTarget, setContainerDeleteTarget] =
    useState<DockerContainerSummary | null>(null);
  const [imageDeleteTarget, setImageDeleteTarget] = useState<DockerImageSummary | null>(null);
  const [logsTarget, setLogsTarget] = useState<DockerContainerSummary | null>(null);
  const [logsContent, setLogsContent] = useState("");
  const [logsStreamId, setLogsStreamId] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [followLogs, setFollowLogs] = useState(true);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [pullImage, setPullImage] = useState("");
  const [pullError, setPullError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );

  const connectionId = connection?.id || null;
  const containersRefreshRef = useRef<RefreshRunState>(createRefreshRunState());
  const imagesRefreshRef = useRef<RefreshRunState>(createRefreshRunState());
  const engineRefreshRef = useRef<RefreshRunState>(createRefreshRunState());
  const engineConfigRefreshRef = useRef<RefreshRunState>(createRefreshRunState());
  const engineConfigRef = useRef<DockerEngineConfigResult | null>(null);
  const engineConfigDraftRef = useRef("");
  const connectionIdRef = useRef<string | null>(connectionId);
  const logsStreamIdRef = useRef<string | null>(null);
  const logOutputRef = useRef<HTMLPreElement | null>(null);
  const dockerInitialLoadRef = useRef(false);
  const engineInitialLoadRef = useRef(false);
  const runningCount = useMemo(
    () => containers.filter((container) => isContainerRunning(container)).length,
    [containers],
  );
  const dockerAutoRefreshActive = active && toolboxView === "docker" && Boolean(connectionId) && documentVisible;

  useEffect(() => {
    engineConfigRef.current = engineConfig;
  }, [engineConfig]);

  useEffect(() => {
    engineConfigDraftRef.current = engineConfigDraft;
  }, [engineConfigDraft]);

  useEffect(() => {
    function handleVisibilityChange() {
      setDocumentVisible(document.visibilityState !== "hidden");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    connectionIdRef.current = connectionId;
    const previousStreamId = logsStreamIdRef.current;
    if (previousStreamId && hasTauriRuntime()) {
      void dockerContainerLogsStop(previousStreamId);
    }
    logsStreamIdRef.current = null;
    setContainers([]);
    setImages([]);
    setEngineStatus(null);
    setEngineConfig(null);
    setEngineConfigDraft("");
    setError(null);
    setNotice(null);
    setLogsTarget(null);
    setLogsContent("");
    setLogsStreamId(null);
    setLogsLoading(false);
    setLogsStreaming(false);
    setLogsPaused(false);
    setFollowLogs(true);
    setLogsError(null);
    setImagePullTasks([]);
    setEngineActionTarget(null);
    setRestartAfterSave(false);
    dockerInitialLoadRef.current = false;
    engineInitialLoadRef.current = false;
    containersRefreshRef.current = createRefreshRunState();
    imagesRefreshRef.current = createRefreshRunState();
    engineRefreshRef.current = createRefreshRunState();
    engineConfigRefreshRef.current = createRefreshRunState();
  }, [connectionId]);

  useEffect(() => {
    logsStreamIdRef.current = logsStreamId;
  }, [logsStreamId]);

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
    if (!hasTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenDockerLogStream((event) => {
      if (disposed || event.stream_id !== logsStreamIdRef.current) {
        return;
      }
      applyDockerLogStreamEvent(event);
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
  }, []);

  useEffect(() => {
    if (!followLogs) {
      return;
    }
    scrollLogsToBottom();
  }, [logsContent, followLogs]);

  useEffect(() => {
    return () => {
      const streamId = logsStreamIdRef.current;
      if (streamId && hasTauriRuntime()) {
        void dockerContainerLogsStop(streamId);
      }
      logsStreamIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dockerAutoRefreshActive || dockerInitialLoadRef.current) {
      return;
    }
    dockerInitialLoadRef.current = true;
    void refreshDocker();
  }, [dockerAutoRefreshActive, connectionId]);

  useEffect(() => {
    if (
      !dockerAutoRefreshActive ||
      dockerView !== "engine" ||
      !connectionId ||
      engineInitialLoadRef.current
    ) {
      return;
    }
    engineInitialLoadRef.current = true;
    void refreshEngineView();
  }, [dockerAutoRefreshActive, dockerView, connectionId]);

  useEffect(() => {
    if (!dockerAutoRefreshActive) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshContainers({ silent: true, queueIfBusy: true });
    }, containerAutoRefreshMs);
    return () => window.clearInterval(timer);
  }, [dockerAutoRefreshActive, connectionId]);

  useEffect(() => {
    if (!dockerAutoRefreshActive) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshImages({ silent: true, queueIfBusy: true });
    }, imageAutoRefreshMs);
    return () => window.clearInterval(timer);
  }, [dockerAutoRefreshActive, connectionId]);

  useEffect(() => {
    if (!dockerAutoRefreshActive || dockerView !== "engine") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshEngineStatus({ silent: true, queueIfBusy: true });
      void refreshEngineConfig({ preserveDirty: true, silent: true, onlyIfMissing: true });
    }, engineAutoRefreshMs);
    return () => window.clearInterval(timer);
  }, [dockerAutoRefreshActive, dockerView, connectionId]);

  async function refreshDocker() {
    await Promise.all([refreshContainers(), refreshImages()]);
  }

  async function refreshContainers(options: RefreshOptions = {}) {
    if (!connectionId) {
      return;
    }
    await runRefresh("containers", containersRefreshRef.current, options, async (runId, requestConnectionId) => {
      if (!options.silent) {
        setLoadingContainers(true);
      }
      setError(null);
      try {
        const nextContainers = hasTauriRuntime()
          ? await dockerListContainers(requestConnectionId)
          : previewDockerContainers();
        if (isCurrentRefresh("containers", runId, requestConnectionId)) {
          setContainers(nextContainers);
        }
      } catch (nextError) {
        if (isCurrentRefresh("containers", runId, requestConnectionId)) {
          setError(formatDockerError(nextError));
        }
      } finally {
        if (isCurrentRefresh("containers", runId, requestConnectionId)) {
          setLoadingContainers(false);
        }
      }
    });
  }

  async function refreshImages(options: RefreshOptions = {}) {
    if (!connectionId) {
      return;
    }
    await runRefresh("images", imagesRefreshRef.current, options, async (runId, requestConnectionId) => {
      if (!options.silent) {
        setLoadingImages(true);
      }
      setError(null);
      try {
        const nextImages = hasTauriRuntime()
          ? await dockerListImages(requestConnectionId)
          : previewDockerImages();
        if (isCurrentRefresh("images", runId, requestConnectionId)) {
          setImages(nextImages);
        }
      } catch (nextError) {
        if (isCurrentRefresh("images", runId, requestConnectionId)) {
          setError(formatDockerError(nextError));
        }
      } finally {
        if (isCurrentRefresh("images", runId, requestConnectionId)) {
          setLoadingImages(false);
        }
      }
    });
  }

  async function refreshEngineView() {
    await Promise.all([
      refreshEngineStatus(),
      refreshEngineConfig({ preserveDirty: true }),
    ]);
  }

  async function refreshEngineStatus(options: RefreshOptions = {}) {
    if (!connectionId) {
      return;
    }
    await runRefresh("engine", engineRefreshRef.current, options, async (runId, requestConnectionId) => {
      if (!options.silent) {
        setLoadingEngine(true);
      }
      setError(null);
      try {
        const nextStatus = hasTauriRuntime()
          ? await dockerEngineStatus(requestConnectionId)
          : previewDockerEngineStatus();
        if (isCurrentRefresh("engine", runId, requestConnectionId)) {
          setEngineStatus(nextStatus);
        }
      } catch (nextError) {
        if (isCurrentRefresh("engine", runId, requestConnectionId)) {
          setError(formatDockerError(nextError));
        }
      } finally {
        if (isCurrentRefresh("engine", runId, requestConnectionId)) {
          setLoadingEngine(false);
        }
      }
    });
  }

  async function refreshEngineConfig(options: RefreshOptions = {}) {
    if (!connectionId) {
      return;
    }
    if (options.onlyIfMissing && engineConfigRef.current) {
      return;
    }
    await runRefresh("engineConfig", engineConfigRefreshRef.current, options, async (runId, requestConnectionId) => {
      if (!options.silent) {
        setLoadingEngineConfig(true);
      }
      setError(null);
      try {
        const result = hasTauriRuntime()
          ? await dockerEngineReadConfig(requestConnectionId)
          : previewDockerEngineConfig();
        if (!isCurrentRefresh("engineConfig", runId, requestConnectionId)) {
          return;
        }
        const formattedContent = formatDockerJsonConfig(result.content);
        const formattedResult = {
          ...result,
          content: formattedContent,
        };
        setEngineConfig(formattedResult);
        const currentConfig = engineConfigRef.current;
        const draftDirty = Boolean(currentConfig && currentConfig.content !== engineConfigDraftRef.current);
        if (!options.preserveDirty || !draftDirty) {
          setEngineConfigDraft(formattedContent);
        }
      } catch (nextError) {
        if (isCurrentRefresh("engineConfig", runId, requestConnectionId)) {
          setError(formatDockerError(nextError));
        }
      } finally {
        if (isCurrentRefresh("engineConfig", runId, requestConnectionId)) {
          setLoadingEngineConfig(false);
        }
      }
    });
  }

  async function runRefresh(
    kind: DockerRefreshKind,
    state: RefreshRunState,
    options: RefreshOptions,
    task: (runId: number, requestConnectionId: string) => Promise<void>,
  ) {
    if (!connectionId) {
      return;
    }
    if (state.inFlight) {
      if (options.queueIfBusy) {
        state.pending = true;
      }
      return;
    }

    state.inFlight = true;
    state.pending = false;
    state.runId += 1;
    const runId = state.runId;
    const requestConnectionId = connectionId;
    await task(runId, requestConnectionId);
    state.inFlight = false;

    if (state.pending && connectionIdRef.current === requestConnectionId) {
      state.pending = false;
      await runRefresh(kind, state, { ...options, queueIfBusy: false }, task);
    }
  }

  function isCurrentRefresh(
    kind: DockerRefreshKind,
    runId: number,
    requestConnectionId: string,
  ) {
    return (
      connectionIdRef.current === requestConnectionId &&
      refreshStateForKind(kind).runId === runId
    );
  }

  function refreshStateForKind(kind: DockerRefreshKind) {
    if (kind === "containers") {
      return containersRefreshRef.current;
    }
    if (kind === "images") {
      return imagesRefreshRef.current;
    }
    if (kind === "engine") {
      return engineRefreshRef.current;
    }
    return engineConfigRefreshRef.current;
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

  async function runEngineAction(action: DockerEngineAction) {
    if (!connectionId) {
      return;
    }
    setBusyKey(`engine:${action}`);
    setError(null);
    setNotice(null);
    try {
      const result = hasTauriRuntime()
        ? await dockerEngineAction(connectionId, action)
        : previewDockerEngineAction(action);
      setNotice(result.message);
      await refreshEngineStatus();
    } catch (nextError) {
      setError(formatDockerError(nextError));
      await refreshEngineStatus();
    } finally {
      setBusyKey(null);
      setEngineActionTarget(null);
    }
  }

  async function saveEngineConfig(shouldRestart: boolean) {
    if (!connectionId) {
      return;
    }
    let normalized: string;
    try {
      normalized = `${JSON.stringify(JSON.parse(engineConfigDraft), null, 2)}\n`;
    } catch {
      setError("Docker 配置不是合法 JSON。");
      return;
    }

    setBusyKey(shouldRestart ? "engine:save-restart" : "engine:save");
    setError(null);
    setNotice(null);
    try {
      const result = hasTauriRuntime()
        ? await dockerEngineSaveConfig(connectionId, normalized)
        : { ok: true, message: "Docker 配置已保存。", output: null };
      setEngineConfigDraft(normalized);
      setEngineConfig((current) => ({
        content: normalized,
        exists: true,
        path: current?.path || "/etc/docker/daemon.json",
      }));
      if (shouldRestart) {
        const restartResult = hasTauriRuntime()
          ? await dockerEngineAction(connectionId, "restart")
          : previewDockerEngineAction("restart");
        setNotice(`${result.message}${restartResult.message}`);
        await refreshEngineStatus();
      } else {
        setNotice(result.message);
      }
    } catch (nextError) {
      setError(formatDockerError(nextError));
    } finally {
      setBusyKey(null);
      setRestartAfterSave(false);
    }
  }

  async function openLogs(container: DockerContainerSummary) {
    await startLogsStream(container, 300, true);
  }

  async function startLogsStream(
    container: DockerContainerSummary,
    tail: number,
    resetContent: boolean,
  ) {
    if (!connectionId) {
      return;
    }
    const previousStreamId = logsStreamIdRef.current;
    if (previousStreamId && hasTauriRuntime()) {
      void dockerContainerLogsStop(previousStreamId);
    }
    const streamId = createDockerLogStreamId(container.id);
    logsStreamIdRef.current = streamId;
    setLogsTarget(container);
    setLogsStreamId(streamId);
    if (resetContent) {
      setLogsContent("");
    }
    setLogsError(null);
    setLogsStreaming(false);
    setLogsPaused(false);
    setFollowLogs(true);
    setLogsLoading(true);

    if (!hasTauriRuntime()) {
      const preview = previewDockerLogs(container);
      if (resetContent) {
        setLogsContent(preview.content);
      }
      setLogsLoading(false);
      setLogsStreaming(true);
      return;
    }

    try {
      await dockerContainerLogsStart(connectionId, container.id, streamId, tail);
      setLogsStreaming(true);
    } catch (nextError) {
      if (logsStreamIdRef.current === streamId) {
        setLogsError(formatDockerError(nextError));
        setLogsStreamId(null);
        logsStreamIdRef.current = null;
        setLogsPaused(false);
      }
    } finally {
      if (logsStreamIdRef.current === streamId) {
        setLogsLoading(false);
      }
    }
  }

  async function closeLogs() {
    const streamId = logsStreamIdRef.current;
    if (streamId && hasTauriRuntime()) {
      void dockerContainerLogsStop(streamId);
    }
    logsStreamIdRef.current = null;
    setLogsTarget(null);
    setLogsStreamId(null);
    setLogsContent("");
    setLogsError(null);
    setLogsLoading(false);
    setLogsStreaming(false);
    setLogsPaused(false);
    setFollowLogs(true);
  }

  function restartLogs() {
    if (logsTarget) {
      void openLogs(logsTarget);
    }
  }

  async function pauseLogStreaming() {
    const streamId = logsStreamIdRef.current;
    if (streamId && hasTauriRuntime()) {
      void dockerContainerLogsStop(streamId);
    }
    logsStreamIdRef.current = null;
    setLogsStreamId(null);
    setLogsLoading(false);
    setLogsStreaming(false);
    setLogsPaused(true);
  }

  function enableLogStreaming() {
    if (logsTarget) {
      void startLogsStream(logsTarget, 0, false);
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

  function applyDockerLogStreamEvent(event: DockerLogStreamEvent) {
    if (event.kind === "chunk") {
      const chunk = stripAnsiControlCodes(event.content || "");
      if (!chunk) {
        return;
      }
      setLogsContent((content) => trimDockerLogContent(`${content}${chunk}`));
      setLogsLoading(false);
      setLogsStreaming(true);
      return;
    }

    setLogsLoading(false);
    setLogsStreaming(false);
    if (event.kind === "error") {
      setLogsError(event.message || "Docker 容器日志读取失败。");
    }
  }

  function scrollLogsToBottom() {
    window.requestAnimationFrame(() => {
      const output = logOutputRef.current;
      if (!output) {
        return;
      }
      output.scrollTop = output.scrollHeight;
    });
  }

  function handleLogOutputScroll() {
    const output = logOutputRef.current;
    if (!output) {
      return;
    }
    const distanceToBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    if (distanceToBottom < 24) {
      setFollowLogs(true);
    } else {
      setFollowLogs(false);
    }
  }

  function resumeLogFollowing() {
    setFollowLogs(true);
    scrollLogsToBottom();
  }

  function clearLogs() {
    setLogsContent("");
    setLogsError(null);
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

  async function copyLogs() {
    if (!logsContent.trim()) {
      setLogsError("当前没有可复制的日志。");
      return;
    }
    await copyValue(logsContent, "日志");
  }

  async function downloadLogs() {
    if (!logsTarget || !logsContent.trim()) {
      setLogsError("当前没有可下载的日志。");
      return;
    }
    const fileName = dockerLogFileName(logsTarget);
    try {
      if (!hasTauriRuntime()) {
        downloadBrowserTextFile(fileName, logsContent);
        setLogsError(null);
        setNotice("日志已下载。");
        return;
      }
      const localPath = await selectDockerLogSavePath(fileName);
      if (!localPath) {
        return;
      }
      await dockerContainerLogsSave(localPath, logsContent);
      setLogsError(null);
      setNotice(`日志已保存：${localPath}`);
    } catch (nextError) {
      setLogsError(formatDockerError(nextError));
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
            <button
              className={dockerView === "engine" ? "active" : ""}
              type="button"
              onClick={() => setDockerView("engine")}
            >
              <DockerBrandIcon className="ui-icon" aria-hidden="true" />
              引擎
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
          ) : dockerView === "images" ? (
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
          ) : (
            <DockerEngineView
              busyKey={busyKey}
              config={engineConfig}
              configDraft={engineConfigDraft}
              loading={loadingEngine}
              loadingConfig={loadingEngineConfig}
              status={engineStatus}
              onAction={(action) => {
                if (action === "start") {
                  void runEngineAction(action);
                } else {
                  setEngineActionTarget(action);
                }
              }}
              onChangeConfig={setEngineConfigDraft}
              onRefresh={refreshEngineStatus}
              onRefreshConfig={refreshEngineConfig}
              onSave={() => void saveEngineConfig(false)}
              onSaveRestart={() => setRestartAfterSave(true)}
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
        content={logsContent}
        loading={logsLoading}
        outputRef={logOutputRef}
        following={followLogs}
        paused={logsPaused}
        streaming={logsStreaming}
        target={logsTarget}
        error={logsError}
        onClear={clearLogs}
        onClose={() => void closeLogs()}
        onCopy={() => void copyLogs()}
        onDownload={() => void downloadLogs()}
        onFollow={resumeLogFollowing}
        onRealtimeToggle={logsStreaming ? () => void pauseLogStreaming() : enableLogStreaming}
        onRefresh={restartLogs}
        onScroll={handleLogOutputScroll}
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
                  {pulling ? (
                    <LoaderCircle className="ui-icon spin" aria-hidden="true" />
                  ) : (
                    <Download className="ui-icon" aria-hidden="true" />
                  )}
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

      <ConfirmDialog
        open={Boolean(engineActionTarget)}
        title={engineActionTarget === "stop" ? "停止 Docker 服务" : "重启 Docker 服务"}
        description={
          engineActionTarget === "stop"
            ? "停止 Docker 服务会影响该主机上的所有容器，确认继续吗？"
            : "重启 Docker 服务可能中断正在运行的容器和网络连接，确认继续吗？"
        }
        confirmLabel={engineActionTarget === "stop" ? "停止" : "重启"}
        onConfirm={() => (engineActionTarget ? runEngineAction(engineActionTarget) : undefined)}
        onOpenChange={(open) => {
          if (!open) {
            setEngineActionTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={restartAfterSave}
        title="保存并重启 Docker"
        description="保存配置后会立即重启 Docker 服务，可能影响该主机上的所有容器。确认继续吗？"
        confirmLabel="保存并重启"
        onConfirm={() => saveEngineConfig(true)}
        onOpenChange={(open) => setRestartAfterSave(open)}
      />
    </section>
  );
}

function DockerEngineView({
  busyKey,
  config,
  configDraft,
  loading,
  loadingConfig,
  status,
  onAction,
  onChangeConfig,
  onRefresh,
  onRefreshConfig,
  onSave,
  onSaveRestart,
}: {
  busyKey: string | null;
  config: DockerEngineConfigResult | null;
  configDraft: string;
  loading: boolean;
  loadingConfig: boolean;
  status: DockerEngineStatus | null;
  onAction: (action: DockerEngineAction) => void;
  onChangeConfig: (value: string) => void;
  onRefresh: () => void;
  onRefreshConfig: () => void;
  onSave: () => void;
  onSaveRestart: () => void;
}) {
  const configDirty = Boolean(config && config.content !== configDraft);
  const controlDisabled = !status?.can_control_service || Boolean(busyKey);
  const engineStateClass = status ? (status.running ? "running" : "stopped") : "unknown";
  const engineStateLabel = status ? (status.running ? "引擎运行中" : "引擎已停止") : "引擎状态未知";
  const engineResourceMetrics: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: Cpu, label: "CPU", value: formatPercent(status?.daemon_cpu_percent) },
    { icon: MemoryStick, label: "RAM", value: formatBytes(status?.daemon_memory_bytes) },
    {
      icon: HardDrive,
      label: "Disk",
      value: formatBytePair(
        status?.docker_disk_used_bytes ?? status?.root_disk_used_bytes,
        status?.root_disk_total_bytes,
      ),
    },
  ];
  const engineResourceSummary = engineResourceMetrics
    .map((metric) => `${metric.label} ${metric.value}`)
    .join(" · ");
  const engineFacts: Array<[string, string | null | undefined]> = [
    ["Docker 版本", status?.version],
    ["API 版本", status?.api_version],
    ["Server OS", status?.server_os],
    ["Root Dir", status?.root_dir],
    ["Storage", status?.storage_driver],
    ["Cgroup", status?.cgroup_driver],
    [
      "容器",
      status?.containers === undefined || status?.containers === null
        ? null
        : `${status.containers.toString()} / ${formatOptionalNumber(
            status.containers_running,
          )} running`,
    ],
    ["镜像", formatOptionalNumber(status?.images)],
    ["网络", formatOptionalNumber(status?.networks)],
    ["卷", formatOptionalNumber(status?.volumes)],
  ];

  return (
    <div className="docker-engine-view">
      <section className="docker-engine-profile">
        <span className="docker-engine-brand" aria-hidden="true">
          <DockerBrandIcon className="ui-icon" aria-hidden="true" />
        </span>
        <div className="docker-engine-profile-main">
          <div className="docker-engine-profile-title">
            <strong>Docker Engine</strong>
            <span
              aria-label={engineStateLabel}
              className={`docker-engine-state ${engineStateClass}`}
              title={engineStateLabel}
            >
              <span className={`docker-engine-dot ${engineStateClass}`} aria-hidden="true" />
            </span>
          </div>
        </div>
        <div className="docker-engine-actions">
          <Tooltip label="刷新引擎状态">
            <button
              aria-label="刷新引擎状态"
              className="toolbox-icon-button"
              type="button"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="启动 Docker">
            <button
              aria-label="启动 Docker"
              className="toolbox-icon-button"
              type="button"
              disabled={controlDisabled || busyKey === "engine:start"}
              onClick={() => onAction("start")}
            >
              <Power className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="停止 Docker">
            <button
              aria-label="停止 Docker"
              className="toolbox-icon-button danger"
              type="button"
              disabled={controlDisabled || busyKey === "engine:stop"}
              onClick={() => onAction("stop")}
            >
              <PowerOff className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="重启 Docker">
            <button
              aria-label="重启 Docker"
              className="toolbox-icon-button"
              type="button"
              disabled={controlDisabled || busyKey === "engine:restart"}
              onClick={() => onAction("restart")}
            >
              <RotateCw className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="docker-engine-resource-line" title={engineResourceSummary}>
          {engineResourceMetrics.map(({ icon: Icon, label, value }) => (
            <span className="docker-engine-resource-metric" key={label} title={`${label} ${value}`}>
              <Icon className="ui-icon" aria-hidden="true" />
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="docker-engine-section">
        <header>
          <span>
            <Settings2 className="ui-icon" aria-hidden="true" />
            基础信息
          </span>
        </header>
        <dl className="docker-engine-facts">
          {engineFacts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd title={value || undefined}>{value || "-"}</dd>
            </div>
          ))}
        </dl>
        {status?.raw_error ? <p className="docker-engine-warning">{status.raw_error}</p> : null}
      </section>

      <section className="docker-engine-section">
        <header>
          <span>
            <FileJson className="ui-icon" aria-hidden="true" />
            配置文件
          </span>
          <button
            className="toolbox-mini-button"
            type="button"
            disabled={loadingConfig}
            onClick={onRefreshConfig}
          >
            <RefreshCw className={`ui-icon ${loadingConfig ? "spin" : ""}`} aria-hidden="true" />
            刷新
          </button>
        </header>
        <div className="docker-engine-config-toolbar">
          <span
            className="docker-engine-config-path"
            title={config?.path || "/etc/docker/daemon.json"}
          >
            {config?.path || "/etc/docker/daemon.json"}
            {config && !config.exists ? <em>未创建</em> : null}
          </span>
        </div>
        <textarea
          className="docker-engine-config-editor"
          spellCheck={false}
          value={configDraft}
          onChange={(event) => onChangeConfig(event.currentTarget.value)}
        />
        <div className="docker-engine-config-actions">
          <button
            className="toolbox-mini-button"
            type="button"
            disabled={!configDirty || Boolean(busyKey)}
            onClick={onSave}
          >
            <Save className="ui-icon" aria-hidden="true" />
            保存配置
          </button>
          <button
            className="toolbox-mini-button primary"
            type="button"
            disabled={!configDirty || Boolean(busyKey)}
            onClick={onSaveRestart}
          >
            <RotateCw className="ui-icon" aria-hidden="true" />
            保存并重启 Docker
          </button>
        </div>
      </section>
    </div>
  );
}

function DockerBrandIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...props}>
      <path fill="currentColor" d={siDocker.path} />
    </svg>
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
        const detailLine = formatContainerDetailLine(container);
        const detailTitle = formatContainerDetailTitle(container);
        const contextActions: TabContextMenuAction[] = [
          {
            label: "进入终端",
            disabled: !running || !onOpenTerminal,
            onSelect: () => onOpenTerminal?.(container),
          },
          {
            label: "复制名称",
            onSelect: () => onCopy(container),
          },
          {
            label: "删除容器",
            danger: true,
            separatorBefore: true,
            disabled: Boolean(busyKey),
            onSelect: () => onRemove(container),
          },
        ];
        return (
          <TabContextMenu actions={contextActions} key={container.id}>
            <article className="docker-row docker-row--container" tabIndex={0}>
              <div className="docker-row-primary">
                <span className="docker-row-title">
                  <Box className="ui-icon" aria-hidden="true" />
                  <strong title={container.name}>
                    {container.name || shortDockerId(container.id)}
                  </strong>
                  <em className={`docker-status ${normalizeState(container.state)}`}>
                    {container.state || "unknown"}
                  </em>
                </span>
              </div>
              <div className="docker-row-meta">
                <code title={container.image}>{container.image}</code>
                <small title={detailTitle}>
                  {detailLine || "-"}
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
              </div>
            </article>
          </TabContextMenu>
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
                  {task.status === "running" ? (
                    <LoaderCircle className="ui-icon spin" aria-hidden="true" />
                  ) : (
                    <Download className="ui-icon" aria-hidden="true" />
                  )}
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
  content,
  error,
  following,
  loading,
  outputRef,
  paused,
  streaming,
  target,
  onClear,
  onClose,
  onCopy,
  onDownload,
  onFollow,
  onRealtimeToggle,
  onRefresh,
  onScroll,
}: {
  content: string;
  error: string | null;
  following: boolean;
  loading: boolean;
  outputRef: RefObject<HTMLPreElement | null>;
  paused: boolean;
  streaming: boolean;
  target: DockerContainerSummary | null;
  onClear: () => void;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onFollow: () => void;
  onRealtimeToggle: () => void;
  onRefresh: () => void;
  onScroll: () => void;
}) {
  const statusLabel = loading ? "连接中" : streaming ? "实时" : paused ? "已暂停" : "已结束";
  const displayContent = loading && !content ? "正在连接日志流..." : content || "没有日志输出。";

  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="docker-logs-dialog">
          <header className="docker-logs-head">
            <div className="docker-logs-title">
              <Dialog.Title>
                {target ? `${target.name || shortDockerId(target.id)} 日志` : "容器日志"}
              </Dialog.Title>
              <span
                className={`docker-log-state ${streaming ? "streaming" : paused ? "paused" : ""}`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="docker-logs-actions">
              <Tooltip label="重连日志流">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="重连日志流"
                  disabled={loading}
                  onClick={onRefresh}
                >
                  <ListRestart className={`ui-icon ${loading ? "spin" : ""}`} aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="复制日志">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="复制日志"
                  disabled={!content.trim()}
                  onClick={onCopy}
                >
                  <Copy className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="下载日志">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="下载日志"
                  disabled={!content.trim()}
                  onClick={onDownload}
                >
                  <Download className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="清空显示">
                <button
                  className="toolbox-icon-button"
                  type="button"
                  aria-label="清空显示"
                  disabled={!content && !error}
                  onClick={onClear}
                >
                  <Eraser className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Dialog.Close asChild>
                <button className="toolbox-icon-button" type="button" aria-label="关闭日志">
                  <X className="ui-icon" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
          </header>
          <div className="docker-logs-toolbar">
            {error ? <p className="docker-form-error">{error}</p> : <span />}
            <div className="docker-log-toolbar-actions">
              <button
                className={`docker-log-live ${streaming ? "active" : "paused"}`}
                type="button"
                aria-pressed={streaming}
                disabled={loading}
                onClick={onRealtimeToggle}
              >
                {streaming ? (
                  <Pause className="ui-icon" aria-hidden="true" />
                ) : (
                  <Play className="ui-icon" aria-hidden="true" />
                )}
                {streaming ? "暂停实时" : "启用实时"}
              </button>
              <button
                className={`docker-log-follow ${following ? "active" : "paused"}`}
                type="button"
                aria-pressed={following}
                onClick={onFollow}
              >
                <ArrowDownToLine className="ui-icon" aria-hidden="true" />
                {following ? "跟随尾部" : "恢复跟随"}
              </button>
            </div>
          </div>
          <pre
            className={`docker-log-output ${following ? "is-following" : ""}`}
            ref={outputRef}
            onScroll={onScroll}
          >
            {displayContent}
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

function formatContainerDetailLine(container: DockerContainerSummary) {
  const parts = [container.status, formatContainerPorts(container.ports)].filter(Boolean);
  return parts.join(" · ");
}

function formatContainerDetailTitle(container: DockerContainerSummary) {
  const parts = [container.status, container.ports || ""].filter(Boolean);
  return parts.join(" · ");
}

function formatContainerPorts(ports: string | null | undefined) {
  if (!ports) {
    return "";
  }
  const summaries = ports
    .split(",")
    .map((part) => formatContainerPortSegment(part))
    .filter(Boolean);
  const uniqueSummaries = Array.from(new Set(summaries));
  if (uniqueSummaries.length === 0) {
    return "";
  }
  if (uniqueSummaries.length <= 2) {
    return uniqueSummaries.join(", ");
  }
  return `${uniqueSummaries.slice(0, 2).join(", ")} +${(uniqueSummaries.length - 2).toString()}`;
}

function formatContainerPortSegment(segment: string) {
  const text = segment.trim();
  if (!text) {
    return "";
  }
  const mapping = text.match(/(?:(?:0\.0\.0\.0|\[?:::\]?|\*)\s*:)?(\d+)->(\d+\/[a-z]+)/i);
  if (mapping) {
    return `${mapping[1]}->${mapping[2]}`;
  }
  return text
    .replace(/^0\.0\.0\.0:/, "")
    .replace(/^\[?:::\]?:/, "")
    .replace(/^\*:/, "");
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

function createDockerLogStreamId(containerId: string) {
  return `logs-${shortDockerId(containerId)}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function dockerLogFileName(container: DockerContainerSummary) {
  const targetName = sanitizeLocalFileName(container.name || shortDockerId(container.id));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${targetName}-${timestamp}.log`;
}

function sanitizeLocalFileName(value: string) {
  const name = Array.from(value)
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[ .]+$/g, "");
  return name || "docker-container";
}

function downloadBrowserTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function stripAnsiControlCodes(content: string) {
  const escape = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  return content
    .replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
    .replace(new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, "g"), "")
    .replace(new RegExp(`${escape}[PX^_].*?${escape}\\\\`, "g"), "");
}

function trimDockerLogContent(content: string) {
  const maxLogChars = 400_000;
  if (content.length <= maxLogChars) {
    return content;
  }
  return content.slice(content.length - maxLogChars);
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

function formatOptionalNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : value.toString();
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || nextValue >= 100 ? 0 : 2;
  return `${nextValue.toFixed(digits)} ${units[unitIndex]}`;
}

function formatBytePair(used: number | null | undefined, total: number | null | undefined) {
  if (used === null || used === undefined || total === null || total === undefined) {
    return `${formatBytes(used)} / ${formatBytes(total)}`;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let nextTotal = total;
  while (nextTotal >= 1024 && unitIndex < units.length - 1) {
    nextTotal /= 1024;
    unitIndex += 1;
  }
  const divisor = 1024 ** unitIndex;
  const nextUsed = used / divisor;
  const digits = unitIndex === 0 || nextTotal >= 100 ? 0 : 2;
  return `${nextUsed.toFixed(digits)} / ${nextTotal.toFixed(digits)} ${units[unitIndex]}`;
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

function previewDockerEngineStatus(): DockerEngineStatus {
  return {
    api_version: "1.45",
    can_control_service: true,
    cgroup_driver: "systemd",
    containers: 11,
    containers_running: 10,
    daemon_cpu_percent: 0,
    daemon_memory_bytes: 3.76 * 1024 * 1024 * 1024,
    docker_disk_used_bytes: 58.91 * 1024 * 1024 * 1024,
    images: 159,
    installed: true,
    networks: 8,
    raw_error: null,
    root_dir: "/var/lib/docker",
    root_disk_total_bytes: 1006.85 * 1024 * 1024 * 1024,
    root_disk_used_bytes: 58.91 * 1024 * 1024 * 1024,
    running: true,
    server_os: "Ubuntu 22.04",
    service_status: "active",
    storage_driver: "overlay2",
    version: "26.1.4",
    volumes: 23,
  };
}

function previewDockerEngineConfig(): DockerEngineConfigResult {
  return {
    content: `${JSON.stringify(
      {
        "log-driver": "json-file",
        "log-opts": {
          "max-file": "3",
          "max-size": "100m",
        },
        "registry-mirrors": [],
      },
      null,
      2,
    )}\n`,
    exists: true,
    path: "/etc/docker/daemon.json",
  };
}

function previewDockerEngineAction(action: DockerEngineAction) {
  const messages: Record<DockerEngineAction, string> = {
    restart: "Docker 服务已重启。",
    start: "Docker 服务已启动。",
    stop: "Docker 服务已停止。",
  };
  return {
    ok: true,
    message: messages[action],
    output: null,
  };
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
