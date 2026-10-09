import {
  Activity,
  Ban,
  Bot,
  Check,
  ClipboardList,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  CornerDownLeft,
  FileText,
  FolderOpen,
  Globe,
  History,
  Image as ImageIcon,
  BookOpen,
  ListPlus,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Save,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ClipboardEvent,
  type ReactNode,
} from "react";

import { copyTextToClipboard } from "../../shared/clipboard";
import {
  aiChatSessionClear,
  aiChatSessionDelete,
  aiChatSessionGet,
  aiFileChangesUndo,
  aiChatSessionList,
  aiChatStreamStart,
  aiChatStreamStop,
  aiChatToolAnswer,
  aiChatToolDecision,
  aiAuditList,
  aiChatAttachmentRead,
  aiCommandAssess,
  aiProviderConfigSave,
  aiProviderConfigList,
} from "../../shared/tauri/commands";
import { selectAiWorkspaceDirectory } from "../../shared/tauri/dialog";
import { listenAiChatStream } from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { AppSelect, type AppSelectOption } from "../../shared/ui/AppSelect";
import { AnchoredSurfacePortal } from "../../shared/ui/AnchoredSurfacePortal";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { AttachmentPreviewDialog } from "../../shared/ui/AttachmentPreviewDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useScrollFollow } from "../../shared/ui/useScrollFollow";
import type { CommandHistoryEntry } from "../commands/commandLibraryTypes";
import type { ConnectionProfile } from "../connections/connectionTypes";
import { keyboardEventMatchesShortcut } from "../shortcuts/shortcutKeys";
import { AiModelPicker } from "./AiModelPicker";
import { AiMessageTimeline } from "./AiMessageTimeline";
import { AiFileActivitySummary } from "./AiFileActivitySummary";
import { AiFileChangesSummary } from "./AiFileChangesSummary";
import { applyFileChangeSummaries } from "./aiFileChanges";
import { getFileActivity, isFileActivity } from "./aiFileActivity";
import {
  AI_HISTORY_SCOPE_CURRENT,
  emitAiScopeEffect,
  normalizeAiScopeKey,
  readAiScopeState,
  setAiScopeEffectHandler,
  updateEveryAiScopeState,
  useAiScopeField,
  type AiAssistantScopeEffect,
  type AiAssistantScopeState,
  type AiAssistantStreamState,
} from "./aiAssistantScopeStore";
import { appendThinkingDelta, finishThinkingBlock } from "./aiMessageFlow";
import type {
  AiChatMessage,
  AiFileChangeSummary,
  AiChatStreamEvent,
  AiChatSessionSummary,
  AiAuditEvent,
  AiCommandAssessment,
  AiCommandSuggestion,
  AiContextBlock,
  AiExecutionMode,
  AiProviderConfig,
  AiProviderModelOption,
  AiToolCallRecord,
} from "./aiTypes";

export interface AiAssistantPanelProps {
  active: boolean;
  stateScopeKey?: string | null;
  commandDraft: string;
  connection: ConnectionProfile | null;
  connections: ConnectionProfile[];
  contextRequestKey?: number;
  initialContexts?: AiContextBlock[];
  recentCommands: CommandHistoryEntry[];
  recentTerminalOutput?: string | null;
  sendShortcutBinding?: string | null;
  terminalDirectory?: string | null;
  terminalSessionId?: string | null;
  terminalTitle?: string | null;
  onInsertCommand: (command: string) => void;
  onOpenSettings: () => void;
  onSaveCommand: (command: string) => void;
  onSendCommand: (command: string) => Promise<void>;
}

type StreamState = AiAssistantStreamState;

let aiScopeStreamListener: Promise<void> | null = null;
let aiScopeStreamUnlisten: (() => void) | null = null;
let aiScopeStreamListenerGeneration = 0;
let lastConsumedContextRequestKey = 0;
let aiProviderConfigsCache: AiProviderConfig[] | null = null;

const selectedProviderStorageKey = "mxterm.ai.selectedProviderConfigId";
const selectedAgentModeStorageKey = "mxterm.ai.selectedExecutionMode";
const selectedModelsStorageKey = "mxterm.ai.selectedModelsByProvider";
const selectedReasoningLevelsStorageKey = "mxterm.ai.selectedReasoningLevelsByModel";
const selectedLocalWorkspaceStorageKey = "mxterm.ai.selectedLocalWorkspace";
const selectedRemoteWorkspacesStorageKey = "mxterm.ai.selectedRemoteWorkspacesByConnection";
const agentTerminalOutputLimit = 20000;
const maxImageAttachmentBytes = 12 * 1024 * 1024;
const maxImageAttachments = 4;
const maxTextAttachments = 8;
const textAttachmentExtensions = new Set([
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "log", "csv", "tsv", "rs", "js", "jsx", "ts", "tsx", "py", "go", "java", "kt",
  "sh", "bash", "zsh", "ps1", "sql", "html", "htm", "css", "scss", "xml", "env",
  "gitignore", "dockerfile",
]);
const HISTORY_SCOPE_CURRENT = AI_HISTORY_SCOPE_CURRENT;
const HISTORY_SCOPE_ALL = "__all__";
const HISTORY_SCOPE_NONE = "__none__";

type StoredAiSelectionMap = Record<string, string>;

function readStoredAiSelectionMap(storageKey: string): StoredAiSelectionMap {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const selections: StoredAiSelectionMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.trim().length > 0 && typeof value === "string" && value.trim().length > 0) {
        selections[key] = value;
      }
    }
    return selections;
  } catch {
    return {};
  }
}

function writeStoredAiSelectionMap(storageKey: string, selections: StoredAiSelectionMap) {
  window.localStorage.setItem(storageKey, JSON.stringify(selections));
}

function rememberAiSelection(storageKey: string, key: string, value: string) {
  const selections = readStoredAiSelectionMap(storageKey);
  if (value.trim()) {
    selections[key] = value;
  } else {
    delete selections[key];
  }
  writeStoredAiSelectionMap(storageKey, selections);
}

function isAiExecutionMode(value: string | null): value is AiExecutionMode {
  return value === "chat" || value === "execute" || value === "full";
}

export function AiAssistantPanel({
  active,
  stateScopeKey = null,
  commandDraft,
  connection,
  connections,
  contextRequestKey = 0,
  initialContexts = [],
  recentCommands,
  recentTerminalOutput,
  sendShortcutBinding,
  terminalDirectory,
  terminalSessionId,
  terminalTitle,
  onInsertCommand,
  onOpenSettings,
  onSaveCommand,
  onSendCommand,
}: AiAssistantPanelProps) {
  const runtimeAvailable = hasTauriRuntime();
  const scopeKey = normalizeAiScopeKey(stateScopeKey);
  const [providerConfigs, setProviderConfigs] = useState<AiProviderConfig[]>(
    () => aiProviderConfigsCache ?? [],
  );
  const [providerConfigsLoaded, setProviderConfigsLoaded] = useState(
    () => !runtimeAvailable || aiProviderConfigsCache !== null,
  );
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    window.localStorage.getItem(selectedProviderStorageKey) || "",
  );
  const [sessions, setSessions] = useState<AiChatSessionSummary[]>([]);
  const [historyScopeChoice, setHistoryScopeChoice] = useAiScopeField(
    scopeKey,
    "historyScopeChoice", active,
  );
  const [activeSessionId, setActiveSessionId] = useAiScopeField(scopeKey, "activeSessionId", active);
  const [messages, setMessages] = useAiScopeField(scopeKey, "messages", active);
  const [contextBlocks, setContextBlocks] = useAiScopeField(scopeKey, "contextBlocks", active);
  const [input, setInput] = useAiScopeField(scopeKey, "input", active);
  const [remoteWorkspacePath, setRemoteWorkspacePath] = useAiScopeField(scopeKey, "remoteWorkspacePath", active);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AiAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditExpandedId, setAuditExpandedId] = useState<number | null>(null);
  const [historyScopeOpen, setHistoryScopeOpen] = useState(false);
  const [historyScopeQuery, setHistoryScopeQuery] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [remoteWorkspaceDialogOpen, setRemoteWorkspaceDialogOpen] = useState(false);
  const [remoteWorkspaceDraft, setRemoteWorkspaceDraft] = useState("");
  const [remoteWorkspaceError, setRemoteWorkspaceError] = useState<string | null>(null);
  const remoteWorkspaceHydratedConnectionRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamState, setCurrentStreamState] = useAiScopeField(scopeKey, "streamState", active);
  const loadingRef = useRef(false);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const auditTriggerRef = useRef<HTMLButtonElement | null>(null);
  const contextTriggerRef = useRef<HTMLButtonElement | null>(null);
  const {
    viewportRef: messageListRef,
    contentRef: messageListContentRef,
    hasNewContent: messageListHasNewContent,
    resetFollow: resetMessageListScrollFollow,
    scrollToBottom: scrollMessageListToBottom,
  } = useScrollFollow(messages, scopeKey, active);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [imageAttachmentLoading, setImageAttachmentLoading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AiContextBlock | null>(null);
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<AiChatSessionSummary | null>(null);
  const [clearSessionOpen, setClearSessionOpen] = useState(false);
  const [pendingDangerousCommand, setPendingDangerousCommand] =
    useState<AiCommandAssessment | null>(null);
  const [agentMode, setAgentMode] = useState<AiExecutionMode>(() => {
    const stored = window.localStorage.getItem(selectedAgentModeStorageKey);
    return isAiExecutionMode(stored) ? stored : "execute";
  });
  const [decidingToolCallIds, setDecidingToolCallIds] = useState<string[]>([]);
  const [answeringToolCallIds, setAnsweringToolCallIds] = useState<string[]>([]);
  const [selectedUserOptionIds, setSelectedUserOptionIds] = useAiScopeField(
    scopeKey,
    "selectedUserOptionIds", active,
  );
  const [userInputDrafts, setUserInputDrafts] = useAiScopeField(scopeKey, "userInputDrafts", active);
  const [expandedToolCallIds, setExpandedToolCallIds] = useAiScopeField(
    scopeKey,
    "expandedToolCallIds", active,
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningLevels, setReasoningLevels] = useState<string[]>([]);
  const [selectedReasoningLevel, setSelectedReasoningLevel] = useState("");
  const [localWorkspace, setLocalWorkspace] = useState<string | null>(() => {
    const stored = window.localStorage.getItem(selectedLocalWorkspaceStorageKey)?.trim();
    return stored || null;
  });
  const skipModelResetRef = useRef(false);

  const agentModeAvailable = true;
  const effectiveAgentMode: AiExecutionMode = agentModeAvailable ? agentMode : "chat";
  const agentModeEnabled = effectiveAgentMode !== "chat" && agentModeAvailable;
  const agentModeOptions: Array<AppSelectOption<AiExecutionMode>> = [
    {
      value: "chat",
      label: "对话",
      triggerLabel: "对话",
      icon: <Bot className="ui-icon ai-agent-mode-icon ai-agent-mode-chat" aria-hidden="true" />,
    },
    {
      value: "execute",
      label: "执行",
      triggerLabel: "执行",
      icon: <Zap className="ui-icon ai-agent-mode-icon ai-agent-mode-execute" aria-hidden="true" />,
    },
    {
      value: "full",
      label: "完全访问",
      triggerLabel: "完全访问",
      icon: <Shield className="ui-icon ai-agent-mode-icon ai-agent-mode-full-icon" aria-hidden="true" />,
    },
  ];
  const agentModeOptionDescriptions: Record<AiExecutionMode, string> = {
    chat: "仅对话和建议，不执行命令",
    execute: "执行排查命令，高风险命令会先请你确认",
    full: "完全访问：AI 可执行高风险命令，请确认当前终端主机",
  };
  const agentModeDescription = effectiveAgentMode === "chat"
      ? "仅对话和建议，不执行命令"
      : effectiveAgentMode === "full"
        ? "完全访问：AI 可执行高风险命令，请确认当前终端主机"
        : connection
          ? "当前 SSH 主机执行；本地文件工作区可单独操作"
          : localWorkspace
            ? "当前本机终端执行；可操作本地文件"
            : "当前本机终端执行；选择本地文件工作区后可操作文件";
  const hostDisplay = connection
    ? `${connection.username}@${connection.host}`
    : terminalTitle || "本机终端";
  const localFileDisplay = localWorkspace || "本地文件未选择";
  const remoteFileDisplay = connection
    ? remoteWorkspacePath?.trim() || "~"
    : terminalDirectory?.trim() || "~";
  const scopeDisplay = `主机：${hostDisplay}；${connection ? "SSH 工作区" : "本机目录"}：${remoteFileDisplay}${localWorkspace ? `；本机工作区：${localFileDisplay}` : ""}`;
  const currentHostScope = connection
    ? `${connection.username}@${connection.host}:${connection.port}`
    : null;
  const effectiveRemoteWorkspace = connection
    ? remoteWorkspacePath?.trim() || terminalDirectory?.trim() || null
    : null;
  const connectionById = new Map(connections.map((item) => [item.id, item]));
  const sessionCountByConnection = new Map<string, number>();
  let unboundSessionCount = 0;
  for (const session of sessions) {
    const connId = session.connection_id?.trim();
    if (connId && connectionById.has(connId)) {
      sessionCountByConnection.set(connId, (sessionCountByConnection.get(connId) ?? 0) + 1);
    } else {
      unboundSessionCount += 1;
    }
  }
  const listedConnections = connections.filter(
    (item) =>
      (!item.protocol || item.protocol === "ssh") &&
      (item.id === connection?.id || sessionCountByConnection.has(item.id)),
  );
  const nameUsage = new Map<string, number>();
  for (const item of listedConnections) {
    const name = item.name.trim();
    if (name) nameUsage.set(name, (nameUsage.get(name) ?? 0) + 1);
  }
  const historyScopeOptions: Array<AppSelectOption<string>> = [];
  for (const item of listedConnections) {
    const scope = `${item.username}@${item.host}:${item.port}`;
    const name = item.name.trim() || scope;
    const dupSuffix = (nameUsage.get(item.name.trim()) ?? 0) > 1 ? `（${scope}）` : "";
    const isCurrent = item.id === connection?.id;
    historyScopeOptions.push({
      value: isCurrent ? HISTORY_SCOPE_CURRENT : `conn:${item.id}`,
      label: `${name}${dupSuffix}${isCurrent ? " · 当前" : ""}`,
    });
  }
  if (unboundSessionCount > 0) {
    historyScopeOptions.push({ value: HISTORY_SCOPE_NONE, label: "未绑定" });
  }
  historyScopeOptions.push({ value: HISTORY_SCOPE_ALL, label: "全部会话" });
  const historyScopeFilter = historyScopeOptions.some(
    (option) => option.value === historyScopeChoice,
  )
    ? historyScopeChoice
    : HISTORY_SCOPE_ALL;
  const historySessions = sessions.filter((session) => {
    if (historyScopeFilter === HISTORY_SCOPE_ALL) return true;
    if (historyScopeFilter === HISTORY_SCOPE_NONE) {
      const connId = session.connection_id?.trim();
      return !connId || !connectionById.has(connId);
    }
    const target =
      historyScopeFilter === HISTORY_SCOPE_CURRENT
        ? connection?.id
        : historyScopeFilter.slice(5);
    return session.connection_id === target;
  });
  const activeSessionTitle =
    sessions.find((session) => session.id === activeSessionId)?.title?.trim() || "新会话";
  const historyScopeLabel =
    historyScopeOptions.find((option) => option.value === historyScopeFilter)?.label ??
    "全部会话";
  const normalizedScopeQuery = historyScopeQuery.trim().toLocaleLowerCase();
  const visibleScopeOptions = normalizedScopeQuery
    ? historyScopeOptions.filter((option) =>
        String(option.label).toLocaleLowerCase().includes(normalizedScopeQuery),
      )
    : historyScopeOptions;
  const selectedProvider = providerConfigs.find((config) => config.id === selectedProviderId) || null;
  const reasoningOptions: Array<AppSelectOption<string>> = reasoningLevels.map((level) => ({
    value: level,
    label: formatReasoningLevel(level),
    icon: reasoningLevelIcon(level),
    searchText: level,
  }));
  const sendDisabled =
    Boolean(streamState) || loading || imageAttachmentLoading || !selectedProvider ||
    (input.trim().length === 0 && contextBlocks.length === 0);
  const visibleAuditEvents = auditEvents.filter((entry) => {
    const query = auditQuery.trim().toLocaleLowerCase();
    if (!query) {
      return true;
    }
    const event = entry.event as Record<string, unknown>;
    return [event.name, event.status, entry.id.toString()]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
  useEffect(() => {
    if (!historyOpen) {
      setHistoryScopeOpen(false);
      setHistoryScopeQuery("");
    }
  }, [historyOpen]);

  useEffect(() => {
    if (!auditOpen || !activeSessionId || !runtimeAvailable) {
      return;
    }
    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);
    void aiAuditList(activeSessionId)
      .then((events) => {
        if (!cancelled) {
          setAuditEvents(events);
          setAuditHasMore(events.length === 200);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setAuditEvents([]);
          setAuditHasMore(false);
          setAuditError(formatAiError(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuditLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, auditOpen, runtimeAvailable]);

  const readCurrentStreamState = useCallback((): StreamState | null => {
    return readAiScopeState(scopeKey).streamState;
  }, [scopeKey]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    if (!active) {
      setHistoryOpen(false);
      setAuditOpen(false);
      setContextMenuOpen(false);
      setRemoteWorkspaceDialogOpen(false);
      setPendingDeleteSession(null);
      setClearSessionOpen(false);
      setPendingDangerousCommand(null);
      setPreviewAttachment(null);
      return;
    }
    void reloadProviderConfigs();
    void reloadSessions();
  }, [active]);

  useEffect(() => {
    if (!providerConfigsLoaded) {
      return;
    }
    if (!selectedProviderId && providerConfigs.length > 0) {
      setSelectedProviderId(providerConfigs[0].id);
      window.localStorage.setItem(selectedProviderStorageKey, providerConfigs[0].id);
      return;
    }
    if (providerConfigs.length === 0 && selectedProviderId) {
      setSelectedProviderId("");
      window.localStorage.removeItem(selectedProviderStorageKey);
      return;
    }
    if (
      selectedProviderId &&
      providerConfigs.length > 0 &&
      !providerConfigs.some((config) => config.id === selectedProviderId)
    ) {
      setSelectedProviderId(providerConfigs[0].id);
      window.localStorage.setItem(selectedProviderStorageKey, providerConfigs[0].id);
    }
  }, [providerConfigs, providerConfigsLoaded, selectedProviderId]);

  const handleModelCapabilitiesChange = useCallback(
    (providerId: string, model: AiProviderModelOption | null) => {
      if (providerId !== selectedProviderId) {
        return;
      }
      const levels = (model?.reasoning_levels || []).filter((level, index, values) => {
        const normalized = level.trim();
        return normalized.length > 0 && values.findIndex((item) => item.trim() === normalized) === index;
      });
      setReasoningLevels(levels);
      setSelectedReasoningLevel((current) => {
        const remembered = readStoredAiSelectionMap(selectedReasoningLevelsStorageKey)[
          `${providerId}:${model?.id || ""}`
        ]?.trim() || "";
        if (remembered && levels.includes(remembered)) {
          return remembered;
        }
        if (current && levels.includes(current)) {
          return current;
        }
        const declaredDefault = model?.reasoning_default_level?.trim() || "";
        const defaultLevel = declaredDefault || levels[levels.length - 1] || "";
        return defaultLevel && levels.includes(defaultLevel) ? defaultLevel : "";
      });
    },
    [selectedProviderId],
  );

  useEffect(() => {
    const provider =
      providerConfigs.find((config) => config.id === selectedProviderId) || null;
    if (skipModelResetRef.current) {
      skipModelResetRef.current = false;
      return;
    }
    const rememberedModel = provider
      ? readStoredAiSelectionMap(selectedModelsStorageKey)[provider.id]?.trim() || ""
      : "";
    const enabledModelIds = new Set(
      provider?.models.filter((model) => model.enabled).map((model) => model.id) || [],
    );
    const restoredModel = rememberedModel && (enabledModelIds.size === 0 || enabledModelIds.has(rememberedModel))
      ? rememberedModel
      : provider?.model ?? "";
    setSelectedModel(restoredModel);
  }, [providerConfigs, selectedProviderId]);

  useEffect(() => {
    let disposed = false;
    void ensureAiScopeStreamListener().catch((nextError) => {
      if (!disposed) {
        setError(formatAiError(nextError));
      }
    });
    const removeEffectHandler = setAiScopeEffectHandler(scopeKey, (effect) => {
      if (effect.kind === "background_task") {
        setNotice(
          effect.status === "succeeded"
            ? "后台任务已完成。"
            : effect.status === "cancelled"
              ? "后台任务已停止。"
              : effect.status === "stop_requested_unconfirmed"
                ? "后台任务已发出停止请求，但远端停止状态尚未确认。"
                : "后台任务执行失败。",
        );
        return;
      }
      if (effect.status === "error") {
        setError(effect.error || "AI 回复失败。");
      } else if (effect.status === "stopped") {
        setNotice("已停止生成，当前内容已保留。");
      }
      void reloadSessions();
    });
    return () => {
      disposed = true;
      removeEffectHandler();
    };
  }, [scopeKey]);

  useEffect(() => {
    if (!contextRequestKey || contextRequestKey === lastConsumedContextRequestKey) {
      return;
    }
    lastConsumedContextRequestKey = contextRequestKey;
    appendContextBlocks(initialContexts);
  }, [contextRequestKey, initialContexts]);

  async function reloadProviderConfigs() {
    if (!runtimeAvailable) {
      setProviderConfigs([]);
      setProviderConfigsLoaded(true);
      return;
    }
    try {
      const configs = await aiProviderConfigList();
      aiProviderConfigsCache = configs;
      setProviderConfigs(configs);
      setError(null);
    } catch (nextError) {
      setError(formatAiError(nextError));
    } finally {
      setProviderConfigsLoaded(true);
    }
  }

  async function reloadSessions() {
    if (!runtimeAvailable) {
      setSessions([]);
      return;
    }
    try {
      setSessions(await aiChatSessionList());
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }

  async function openSession(sessionId: string) {
    if (!runtimeAvailable || streamState || loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const session = await aiChatSessionGet(sessionId);
      resetMessageListScrollFollow();
      setActiveSessionId(session.summary.id);
      setMessages(session.messages);
      setContextBlocks([]);
      setHistoryOpen(false);
      if (session.summary.provider_config_id) {
        setSelectedProviderId(session.summary.provider_config_id);
        window.localStorage.setItem(selectedProviderStorageKey, session.summary.provider_config_id);
      }
      setNotice(null);
    } catch (nextError) {
      setError(formatAiError(nextError));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function startNewSession() {
    if (streamState) {
      return;
    }
    resetMessageListScrollFollow();
    setActiveSessionId(null);
    setMessages([]);
    setContextBlocks([]);
    setInput("");
    setError(null);
    setHistoryOpen(false);
    setPendingDangerousCommand(null);
    setNotice("已切换到新对话。");
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await sendMessage(input, contextBlocks);
  }

  async function sendMessage(content: string, contexts: AiContextBlock[]) {
    if (readCurrentStreamState() || loadingRef.current) {
      return;
    }
    const normalizedContent = content.trim();
    if (!runtimeAvailable) {
      setError("桌面端才能调用 AI 服务。");
      return;
    }
    if (!selectedProvider) {
      setError("请先在设置中添加 AI 配置。");
      return;
    }
    if (!normalizedContent && contexts.length === 0) {
      setError("请输入问题或添加附件。");
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    resetMessageListScrollFollow();
    try {
      const terminalOutput = (recentTerminalOutput || "").trim();
      const response = await aiChatStreamStart({
        provider_config_id: selectedProvider.id,
        session_id: activeSessionId,
        content: normalizedContent,
        contexts,
        host_scope: currentHostScope,
        connection_id: connection?.id ?? null,
        reasoning_level: selectedReasoningLevel || null,
        agent: agentModeEnabled
          ? {
              connection_id: connection?.id ?? null,
              workspace_type: connection ? "remote" : "local",
              workspace_path: connection ? effectiveRemoteWorkspace : terminalDirectory ?? null,
              local_workspace_path: localWorkspace,
              mode: effectiveAgentMode,
              working_directory: connection ? effectiveRemoteWorkspace : terminalDirectory ?? null,
              terminal_output: terminalOutput ? tailByChars(terminalOutput, agentTerminalOutputLimit) : null,
              terminal_session_id: terminalSessionId ?? null,
            }
          : null,
        model: selectedModel.trim() || null,
      });
      const now = Date.now().toString();
      setActiveSessionId(response.session_id);
      setMessages((items) => [
        ...items,
        {
          id: response.user_message_id,
          session_id: response.session_id,
          role: "user",
          content: normalizedContent,
          thinking: "",
          contexts,
          commands: [],
          tool_calls: [],
          status: "complete",
          created_at: now,
          updated_at: now,
        },
        {
          id: response.assistant_message_id,
          session_id: response.session_id,
          role: "assistant",
          content: "",
          thinking: "",
          contexts: [],
          commands: [],
          tool_calls: [],
          status: "streaming",
          created_at: now,
          updated_at: now,
        },
      ]);
      const nextStreamState = {
        assistantMessageId: response.assistant_message_id,
        sessionId: response.session_id,
        streamId: response.stream_id,
      };
      setCurrentStreamState(nextStreamState);
      setDecidingToolCallIds([]);
      setInput("");
      setContextBlocks([]);
      void reloadSessions();
    } catch (nextError) {
      setError(formatAiError(nextError));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (localWorkspace) {
      window.localStorage.setItem(selectedLocalWorkspaceStorageKey, localWorkspace);
    } else {
      window.localStorage.removeItem(selectedLocalWorkspaceStorageKey);
    }
  }, [localWorkspace]);

  useEffect(() => {
    const connectionId = connection?.id?.trim() || "";
    if (!connectionId || remoteWorkspaceHydratedConnectionRef.current === connectionId) {
      return;
    }
    remoteWorkspaceHydratedConnectionRef.current = connectionId;
    const stored = readStoredAiSelectionMap(selectedRemoteWorkspacesStorageKey)[connectionId]?.trim() || "";
    setRemoteWorkspacePath(stored || null);
  }, [connection?.id, remoteWorkspacePath, setRemoteWorkspacePath]);

  const decideToolCall = useCallback(async (call: AiToolCallRecord, approved: boolean) => {
    const current = readCurrentStreamState();
    if (!current || decidingToolCallIds.includes(call.id)) {
      return;
    }
    setDecidingToolCallIds((ids) => [...ids, call.id]);
    setError(null);
    try {
      await aiChatToolDecision(current.streamId, call.id, approved);
    } catch (nextError) {
      setDecidingToolCallIds((ids) => ids.filter((id) => id !== call.id));
      setError(formatAiError(nextError));
    }
  }, [readCurrentStreamState, decidingToolCallIds]);

  const answerToolCall = useCallback(async (call: AiToolCallRecord, cancelled = false) => {
    const current = readCurrentStreamState();
    if (!current || answeringToolCallIds.includes(call.id)) {
      return;
    }
    const optionId = selectedUserOptionIds[call.id] || null;
    const text = userInputDrafts[call.id]?.trim() || null;
    if (!cancelled && !optionId && !text) {
      setError("请选择一个选项，或填写补充回答。");
      return;
    }
    setAnsweringToolCallIds((ids) => [...ids, call.id]);
    setError(null);
    try {
      await aiChatToolAnswer(current.streamId, call.id, {
        option_id: optionId,
        text,
        cancelled,
      });
      setExpandedToolCallIds((current) => ({ ...current, [call.id]: false }));
      setSelectedUserOptionIds((current) => {
        const next = { ...current };
        delete next[call.id];
        return next;
      });
      setUserInputDrafts((current) => {
        const next = { ...current };
        delete next[call.id];
        return next;
      });
    } catch (nextError) {
      setError(formatAiError(nextError));
    } finally {
      setAnsweringToolCallIds((ids) => ids.filter((id) => id !== call.id));
    }
  }, [readCurrentStreamState, answeringToolCallIds, selectedUserOptionIds, userInputDrafts, setExpandedToolCallIds, setSelectedUserOptionIds, setUserInputDrafts]);

  async function stopStreaming() {
    if (!streamState) {
      return;
    }
    try {
      await aiChatStreamStop(streamState.streamId);
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }

  async function confirmDeleteSession() {
    if (!pendingDeleteSession) {
      return;
    }
    try {
      const currentStream = readCurrentStreamState();
      if (currentStream?.sessionId === pendingDeleteSession.id) {
        await aiChatStreamStop(currentStream.streamId).catch(() => undefined);
        setCurrentStreamState(null);
      }
      await aiChatSessionDelete(pendingDeleteSession.id);
      if (activeSessionId === pendingDeleteSession.id) {
        resetMessageListScrollFollow();
        setActiveSessionId(null);
        setMessages([]);
        setContextBlocks([]);
        setPendingDangerousCommand(null);
      }
      setPendingDeleteSession(null);
      await reloadSessions();
      setNotice("AI 会话已删除。");
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }

  async function clearCurrentSession() {
    if (!activeSessionId) {
      return;
    }
    if (readCurrentStreamState()) {
      setError("请先停止生成，再清空当前会话。");
      setClearSessionOpen(false);
      return;
    }
    try {
      const cleared = await aiChatSessionClear(activeSessionId);
      resetMessageListScrollFollow();
      setMessages(cleared.messages);
      setContextBlocks([]);
      setPendingDangerousCommand(null);
      setClearSessionOpen(false);
      await reloadSessions();
      setNotice("当前 AI 会话已清空。");
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }

  const copyMessage = useCallback(async (content: string) => {
    try {
      await copyTextToClipboard(content);
      setNotice("消息已复制。");
    } catch {
      setError("复制消息失败。");
    }
  }, []);

  const copyCommand = useCallback(async (command: string) => {
    try {
      await copyTextToClipboard(command);
      setNotice("命令已复制。");
    } catch {
      setError("复制命令失败。");
    }
  }, []);

  const runSendCommand = useCallback(async (command: string) => {
    try {
      await onSendCommand(command);
      setNotice("命令已发送到终端。");
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }, [onSendCommand]);

  const requestSendCommand = useCallback(async (command: string) => {
    setError(null);
    const assessment = runtimeAvailable
      ? await aiCommandAssess(command).catch(() => assessCommandLocally(command))
      : assessCommandLocally(command);
    if (assessment.risk === "dangerous") {
      setPendingDangerousCommand(assessment);
      return;
    }
    await runSendCommand(command);
  }, [runtimeAvailable, runSendCommand]);



  function appendContextBlocks(blocks: AiContextBlock[]) {
    if (blocks.length === 0) {
      return;
    }
    setContextBlocks((current) => {
      const next = [...current];
      blocks.forEach((block) => {
        if (
          !["image", "file"].includes(block.kind) &&
          next.some(
            (item) => item.kind === block.kind && item.source === block.source && item.content === block.content,
          )
        ) {
          return;
        }
        next.push({ ...block, id: `${block.id}-${Date.now().toString()}` });
      });
      return next;
    });
    setError(null);
    setNotice(null);
  }

  const openAttachmentPreview = useCallback(async (block: AiContextBlock, sessionId?: string) => {
    setPreviewAttachment(block);
    if (!block.artifact_id || !sessionId || !runtimeAvailable) {
      return;
    }
    try {
      const hydrated = await aiChatAttachmentRead(sessionId, block.artifact_id);
      setPreviewAttachment({
        ...block,
        content: hydrated.content,
        data_url: hydrated.data_url ?? block.data_url,
        mime_type: hydrated.mime_type ?? block.mime_type,
      });
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }, [runtimeAvailable]);

  async function addAttachments(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) {
      return;
    }
    const existingImages = contextBlocks.filter((block) => block.kind === "image").length;
    const existingFiles = contextBlocks.filter((block) => block.kind === "file").length;
    const selectedImages = selected.filter((file) => isImageAttachment(file)).length;
    const selectedFiles = selected.length - selectedImages;
    if (existingImages + selectedImages > maxImageAttachments) {
      setError(`一次最多添加 ${maxImageAttachments.toString()} 张图片。`);
      return;
    }
    if (existingFiles + selectedFiles > maxTextAttachments) {
      setError(`一次最多添加 ${maxTextAttachments.toString()} 个文本附件。`);
      return;
    }
    setImageAttachmentLoading(true);
    setError(null);
    try {
      const blocks: AiContextBlock[] = [];
      for (const file of selected) {
        const id = `attachment-${Date.now().toString()}-${blocks.length.toString()}`;
        if (isImageAttachment(file)) {
          if (file.size <= 0 || file.size > maxImageAttachmentBytes) {
            throw new Error(`图片超过 12 MB 限制：${file.name}`);
          }
          const dataUrl = await readFileAsDataUrl(file);
          blocks.push({
            id,
            kind: "image",
            title: file.name || "图片附件",
            content: `图片附件：${file.name || "未命名图片"}`,
            source: "本地附件",
            line_count: 1,
            char_count: file.size,
            data_url: dataUrl,
          });
          continue;
        }
        if (!isTextAttachment(file)) {
          throw new Error(`不支持的附件格式：${file.name || "未命名文件"}`);
        }
        const content = await readFileAsText(file);
        blocks.push({
          id,
          kind: "file",
          title: file.name || "文本附件",
          content,
          source: "本地附件",
          line_count: content.split(/\r?\n/).length,
          char_count: Array.from(content).length,
        });
      }
      appendContextBlocks(blocks);
      setNotice(`已添加 ${blocks.length.toString()} 个附件。`);
    } catch (nextError) {
      setError(formatAiError(nextError));
    } finally {
      setImageAttachmentLoading(false);
    }
  }

  function handleAttachmentPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = Array.from(event.clipboardData.files);
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = pastedFiles.length > 0 ? pastedFiles : itemFiles;
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void addAttachments(files.map((file, index) => {
      if (file.name) {
        return file;
      }
      return new File([file], `pasted-image-${Date.now().toString()}-${index.toString()}.png`, {
        type: file.type || "image/png",
      });
    }));
  }

  function addRecentTerminalOutputContext() {
    const content = (recentTerminalOutput || "").trim();
    if (!content) {
      return;
    }
    appendContextBlocks([
      buildContextBlock({
        kind: "terminal_output",
        title: "最近终端输出",
        source: terminalTitle || "当前终端",
        content: tailByChars(content, 8000),
      }),
    ]);
  }

  function openRemoteWorkspaceDialog() {
    if (!connection || streamState) {
      return;
    }
    setRemoteWorkspaceDraft(remoteWorkspacePath?.trim() || terminalDirectory?.trim() || "/");
    setRemoteWorkspaceError(null);
    setContextMenuOpen(false);
    setRemoteWorkspaceDialogOpen(true);
  }

  function submitRemoteWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = remoteWorkspaceDraft.trim();
    if (path && !path.startsWith("/")) {
      setRemoteWorkspaceError("请输入 SSH 主机上的绝对路径，例如 /home/user/project。");
      return;
    }
    setRemoteWorkspacePath(path || null);
    if (connection?.id) {
      rememberAiSelection(selectedRemoteWorkspacesStorageKey, connection.id, path);
    }
    setRemoteWorkspaceError(null);
    setRemoteWorkspaceDialogOpen(false);
    setNotice(path ? `已切换 SSH 工作区：${path}` : "已恢复跟随当前终端目录。");
  }

  function addConnectionContext() {
    if (!connection) {
      return;
    }
    const lines = [
      `连接名称: ${connection.name}`,
      `目标: ${connection.username}@${connection.host}:${connection.port.toString()}`,
      connection.group ? `分组: ${connection.group}` : null,
      connection.remote_os_name ? `系统: ${connection.remote_os_name}` : null,
      terminalDirectory ? `当前目录: ${terminalDirectory}` : null,
    ].filter(Boolean);
    appendContextBlocks([
      buildContextBlock({
        kind: "connection",
        title: "当前连接信息",
        source: "已脱敏连接元数据",
        content: lines.join("\n"),
      }),
    ]);
  }

  function addCommandDraftContext() {
    const content = commandDraft.trim();
    if (!content) {
      return;
    }
    appendContextBlocks([
      buildContextBlock({
        kind: "command_draft",
        title: "命令草稿",
        source: "Command Sender",
        content,
      }),
    ]);
  }

  function addRecentCommandsContext() {
    const content = recentCommands
      .slice(0, 8)
      .map((entry, index) => `${(index + 1).toString()}. ${entry.command}`)
      .join("\n");
    if (!content.trim()) {
      return;
    }
    appendContextBlocks([
      buildContextBlock({
        kind: "recent_commands",
        title: "最近命令",
        source: "命令历史",
        content,
      }),
    ]);
  }

  async function loadMoreAuditEvents() {
    if (!activeSessionId || auditLoading || auditLoadingMore || !auditHasMore || auditEvents.length === 0) {
      return;
    }
    setAuditLoadingMore(true);
    setAuditError(null);
    try {
      const lastId = auditEvents[auditEvents.length - 1]?.id;
      const events = await aiAuditList(activeSessionId, lastId);
      setAuditEvents((current) => [...current, ...events]);
      setAuditHasMore(events.length === 200);
    } catch (nextError) {
      setAuditError(formatAiError(nextError));
    } finally {
      setAuditLoadingMore(false);
    }
  }

  async function exportAuditLog() {
    if (!activeSessionId || auditExporting || auditLoading) {
      return;
    }
    setAuditExporting(true);
    setAuditError(null);
    try {
      const allEvents: AiAuditEvent[] = [];
      let beforeId: number | undefined;
      do {
        const page = await aiAuditList(activeSessionId, beforeId);
        allEvents.push(...page);
        beforeId = page.length === 200 ? page[page.length - 1]?.id : undefined;
        if (page.length === 0) {
          break;
        }
      } while (beforeId !== undefined);
      if (allEvents.length === 0) {
        return;
      }
      const payload = allEvents
        .map((entry) => JSON.stringify({ ...entry, session_id: activeSessionId }))
        .join("\n");
      const url = URL.createObjectURL(new Blob([payload], { type: "application/jsonl" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mxterm-ai-audit-${activeSessionId}.jsonl`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (nextError) {
      setAuditError(formatAiError(nextError));
    } finally {
      setAuditExporting(false);
    }
  }

  const renderToolCallCard = useCallback((call: AiToolCallRecord, flowing = false) => {
    const fileTool = isFileActivity(call);
    const fileActivity = getFileActivity(call);
    const pendingApproval = call.status === "pending_approval";
    const pendingUserInput = call.name === "ask_user" && call.status === "pending_user_input";
    const userInputOptions = call.options ?? [];
    const selectedOptionId = selectedUserOptionIds[call.id] || "";
    const answerDraft = userInputDrafts[call.id] ?? "";
    const allowFreeText = call.allow_free_text !== false || userInputOptions.length === 0;
    const pending = pendingApproval;
    const deciding = decidingToolCallIds.includes(call.id);
    const answering = answeringToolCallIds.includes(call.id);
    const danger = pendingApproval || call.risk === "dangerous";
    const ToolIcon =
      fileTool ? (call.name === "read_file" ? FileText : Pencil) : call.name === "server_monitor"
        ? Activity
        : call.name === "read_terminal_output"
          ? FileText
          : call.name === "update_plan"
            ? ListPlus
            : call.name === "ask_user"
              ? Bot
              : call.name === "web_search"
                ? Globe
                : call.name === "web_fetch"
                  ? BookOpen
                : Terminal;
    const expanded = expandedToolCallIds[call.id] ?? (pendingApproval || pendingUserInput);
    const detailId = `ai-tool-detail-${call.id}`;
    const answeredOption = call.answer?.option_id
      ? userInputOptions.find((option) => option.id === call.answer?.option_id)
      : null;
    const answerSummary = call.answer?.cancelled
      ? "用户取消了选择。"
      : [
          answeredOption?.label,
          call.answer?.text?.trim() ? `补充：${call.answer.text.trim()}` : null,
        ]
          .filter(Boolean)
          .join("；");
    const outputMeta = [
      call.exit_status !== null && call.exit_status !== undefined
        ? `退出码 ${call.exit_status.toString()}`
        : null,
      call.duration_ms !== null && call.duration_ms !== undefined ? formatDuration(call.duration_ms) : null,
      call.output_truncated ? "仅显示末尾" : null,
      call.output_artifact_id ? "完整输出已保存" : null,
    ].filter(Boolean);
    return (
      <article
        className={`ai-tool-card ${fileTool ? "file-activity" : ""} ${expanded ? "expanded" : ""} ${danger ? "danger" : ""} ${flowing ? "flowing" : ""} ${
          call.name === "update_plan" ? "plan" : call.name === "ask_user" ? "question" : ""
        }`}
        key={call.id}
      >
        <button
          className="ai-tool-summary"
          type="button"
          aria-controls={detailId}
          aria-expanded={expanded}
          onClick={() =>
            setExpandedToolCallIds((current) => ({ ...current, [call.id]: !expanded }))
          }
        >
          <ToolIcon className="ui-icon" aria-hidden="true" />
          {fileTool ? <AiFileActivitySummary call={call} /> : (
            <>
              <span className="ai-tool-label">{formatToolCallTitle(call.name)}</span>
              <span className="ai-tool-summary-text">{formatToolCallSummary(call)}</span>
            </>
          )}
          {!fileTool || call.status !== "completed" || Boolean(call.exit_status) ? <span className={`ai-tool-status ${toolCallStatusTone(call)}`}>
            {call.status === "running" ? (
              <LoaderCircle className="ui-icon ai-tool-spinner" aria-hidden="true" />
            ) : pendingApproval ? (
              <ShieldAlert className="ui-icon" aria-hidden="true" />
            ) : pendingUserInput ? (
              <Clock3 className="ui-icon" aria-hidden="true" />
            ) : null}
            {formatToolCallStatus(call)}
          </span> : null}
        </button>
        {call.status === "running" && call.output && (call.name === "run_command" || call.name === "start_task") ? (
          <pre className="ai-tool-live-output" aria-live="polite">
            {tailByChars(call.output, 2_400)}
          </pre>
        ) : null}
        {expanded ? (
          <div className="ai-tool-detail" id={detailId}>
            {fileActivity ? (
              <small className="ai-tool-meta ai-file-path">
                {fileActivity.path}{fileActivity.destination ? ` → ${fileActivity.destination}` : ""}
              </small>
            ) : null}
            {call.name === "update_plan" ? (
              <div className="ai-plan-content">
                <strong>当前计划</strong>
                <pre>{formatPlanOutput(call.output)}</pre>
              </div>
            ) : null}
            {call.name === "ask_user" ? (
              <div className="ai-question-content">
                <strong>{pendingUserInput ? "需要你的选择" : call.answer ? "已记录回答" : "AI 提问"}</strong>
                <p>{call.question || call.output || "AI 正在等待你的回答。"}</p>
                {pendingUserInput ? (
                  <>
                    {userInputOptions.length > 0 ? (
                      <div className="ai-user-options" role="radiogroup" aria-label="选择一个选项">
                        {userInputOptions.map((option) => {
                          const selected = selectedOptionId === option.id;
                          return (
                            <button
                              aria-checked={selected}
                              className={`ai-user-option ${selected ? "selected" : ""}`}
                              key={option.id}
                              role="radio"
                              type="button"
                              onClick={() =>
                                setSelectedUserOptionIds((current) => ({ ...current, [call.id]: option.id }))
                              }
                            >
                              <span>
                                <strong>{option.label}</strong>
                                {option.description ? <small>{option.description}</small> : null}
                              </span>
                              {selected ? <Check className="ui-icon" aria-hidden="true" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {allowFreeText ? (
                      <textarea
                        aria-label="补充回答"
                        className="ai-user-answer-input"
                        placeholder={userInputOptions.length > 0 ? "也可以补充说明（可选）" : "输入你的回答"}
                        rows={2}
                        value={answerDraft}
                        onChange={(event) =>
                          setUserInputDrafts((current) => ({ ...current, [call.id]: event.currentTarget.value }))
                        }
                      />
                    ) : null}
                    <div className="ai-tool-card-actions ai-user-answer-actions">
                      <button
                        className="ai-mini-button"
                        disabled={answering || !streamState}
                        type="button"
                        onClick={() => void answerToolCall(call, true)}
                      >
                        <Ban className="ui-icon" aria-hidden="true" />
                        <span>取消</span>
                      </button>
                      <button
                        className="ai-mini-button active"
                        disabled={answering || !streamState || (!selectedOptionId && !answerDraft.trim())}
                        type="button"
                        onClick={() => void answerToolCall(call)}
                      >
                        {answering ? <LoaderCircle className="ui-icon ai-tool-spinner" aria-hidden="true" /> : <Check className="ui-icon" aria-hidden="true" />}
                        <span>提交</span>
                      </button>
                    </div>
                  </>
                ) : answerSummary ? (
                  <small className="ai-tool-meta">{answerSummary}</small>
                ) : null}
              </div>
            ) : null}
            {(call.name === "run_command" || call.name === "start_task") && call.command ? <code>{call.command}</code> : null}
            {pendingApproval && call.reasons.length > 0 ? <p>{call.reasons.join("；")}</p> : null}
            {call.error ? <p>{call.error}</p> : null}
            {call.output && call.name !== "ask_user" ? (
              <div className="ai-tool-output">
                <small className="ai-tool-meta">{[call.name.startsWith("preview_") ? "变更预览" : "输出", ...outputMeta].join(" · ")}</small>
                <pre>{call.output}</pre>
              </div>
            ) : outputMeta.length > 0 && call.status === "completed" ? (
              <small className="ai-tool-meta">{["无输出", ...outputMeta].join(" · ")}</small>
            ) : null}
          </div>
        ) : null}
        {pending ? (
          <div className="ai-tool-card-actions">
            <button
              className="ai-mini-button"
              type="button"
              disabled={deciding || !streamState}
              onClick={() => void decideToolCall(call, false)}
            >
              <Ban className="ui-icon" aria-hidden="true" />
              <span>拒绝</span>
            </button>
            <button
              className="ai-mini-button danger"
              type="button"
              disabled={deciding || !streamState}
              onClick={() => void decideToolCall(call, true)}
            >
              <Check className="ui-icon" aria-hidden="true" />
              <span>执行</span>
            </button>
          </div>
        ) : null}
      </article>
    );
  }, [selectedUserOptionIds, userInputDrafts, decidingToolCallIds, answeringToolCallIds, expandedToolCallIds, streamState, setExpandedToolCallIds, setSelectedUserOptionIds, setUserInputDrafts, decideToolCall, answerToolCall]);

  const renderCommandSuggestions = useCallback((message: AiChatMessage) => {
    const suggestions = extractCommandSuggestions(message.content);
    if (suggestions.length === 0) {
      return null;
    }
    return (
      <div className="ai-command-suggestions ai-command-suggestions-compact">
        {suggestions.map((suggestion, index) => (
          <article
            aria-label={`命令建议：${suggestion.command}`}
            className={`ai-command-card ai-command-card-compact ${suggestion.risk === "dangerous" ? "danger" : ""}`}
            key={`${message.id}-${index.toString()}`}
          >
            <div className="ai-command-card-main">
              <code title={suggestion.command}>{suggestion.command}</code>
              {suggestion.risk === "dangerous" ? (
                <span
                  className="ai-command-card-risk"
                  title={suggestion.reasons.join("；") || "高风险命令"}
                >
                  <ShieldAlert className="ui-icon" aria-hidden="true" />
                  高风险
                </span>
              ) : null}
            </div>
            <footer>
              <Tooltip label="复制命令">
                <button type="button" aria-label="复制命令" onClick={() => void copyCommand(suggestion.command)}>
                  <Copy className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="插入到命令操作台">
                <button
                  type="button"
                  aria-label="插入到命令操作台"
                  onClick={() => {
                    onInsertCommand(suggestion.command);
                    setNotice("命令已插入命令操作台。");
                  }}
                >
                  <CornerDownLeft className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="保存为命令片段">
                <button
                  type="button"
                  aria-label="保存为命令片段"
                  onClick={() => {
                    onSaveCommand(suggestion.command);
                    setNotice("已打开命令片段保存窗口。");
                  }}
                >
                  <Save className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip label="发送到终端">
                <button
                  className="primary"
                  type="button"
                  aria-label="发送到终端"
                  onClick={() => void requestSendCommand(suggestion.command)}
                >
                  <Play className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
            </footer>
          </article>
        ))}
      </div>
    );
  }, [copyCommand, onInsertCommand, onSaveCommand, requestSendCommand]);

  const undoMessageFileChanges = useCallback(async (message: AiChatMessage, change: AiFileChangeSummary) => {
    try {
      const result = await aiFileChangesUndo(message.session_id, message.id, change.checkpoint_id);
      setMessages((items) => applyFileChangeSummaries(items, message.session_id, [result.summary]));
      return result.error ?? null;
    } catch (error) {
      return formatAiError(error);
    }
  }, [setMessages]);

  return (
    <section className="ai-assistant-tool" aria-label="AI">
      <header className="ai-assistant-head">
        <div className="ai-assistant-title">
          <strong title={activeSessionTitle}>{activeSessionTitle}</strong>
          <Tooltip label={scopeDisplay}>
            <div className="ai-workspace-indicator" title={scopeDisplay}>
              <div className="ai-workspace-row ai-workspace-remote-row">
                <Terminal className="ui-icon ai-scope-host-icon" aria-hidden="true" />
                <span className="ai-scope-host">{hostDisplay}</span>
                <span className="ai-scope-colon" aria-hidden="true">:</span>
                <FolderOpen className="ui-icon ai-scope-remote-icon" aria-hidden="true" />
                <span className="ai-scope-remote" title={remoteFileDisplay}>{remoteFileDisplay}</span>
              </div>
              {localWorkspace ? (
                <div className="ai-workspace-row ai-workspace-local-row">
                  <span className="ai-scope-local-label">本机工作区：</span>
                  <FolderOpen className="ui-icon ai-scope-local-icon" aria-hidden="true" />
                  <span className="ai-scope-local" title={localFileDisplay}>{localFileDisplay}</span>
                </div>
              ) : null}
            </div>
          </Tooltip>
        </div>
        <div className="ai-assistant-head-actions">
          <Tooltip label="新对话">
            <button type="button" aria-label="新对话" onClick={startNewSession}>
              <Plus className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="历史会话">
            <button
              ref={historyTriggerRef}
              className={historyOpen ? "active" : ""}
              type="button"
              aria-label="历史会话"
              aria-expanded={historyOpen}
              aria-haspopup="menu"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="AI 设置">
            <button
              ref={auditTriggerRef}
              className={auditOpen ? "active" : ""}
              type="button"
              aria-label="审计日志"
              aria-expanded={auditOpen}
              aria-haspopup="dialog"
              onClick={() => setAuditOpen((open) => !open)}
            >
              <ClipboardList className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="AI 设置">
            <button type="button" aria-label="AI 设置" onClick={onOpenSettings}>
              <Settings className="ui-icon" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </header>

      <AnchoredSurfacePortal
        align="end"
        anchorRef={historyTriggerRef}
        ariaLabel="AI 历史会话"
        className="ai-history-menu popover-content"
        desiredHeight={340}
        minHeight={96}
        open={active && historyOpen}
        role="menu"
        width={300}
        onOpenChange={setHistoryOpen}
      >
        <div className="ai-history-menu-header">
          <strong>历史会话</strong>
          <button
            aria-expanded={historyScopeOpen}
            aria-haspopup="listbox"
            aria-label="会话范围"
            className="ai-history-scope-toggle"
            type="button"
            onClick={() => setHistoryScopeOpen((open) => !open)}
          >
            <span className="ai-history-scope-toggle-label">{historyScopeLabel}</span>
            <ChevronDown className="ui-icon" aria-hidden="true" />
          </button>
          <span>{historySessions.length.toString()} 条</span>
        </div>
        <div className="ai-history-menu-body">
          {historyScopeOpen ? (
            <div aria-label="会话范围" className="ai-history-scope-panel" role="listbox">
              {historyScopeOptions.length > 8 ? (
                <div className="app-select-search-shell">
                  <input
                    autoFocus
                    aria-label="搜索连接"
                    className="app-select-search-input"
                    placeholder="搜索连接"
                    type="search"
                    value={historyScopeQuery}
                    onChange={(event) => setHistoryScopeQuery(event.currentTarget.value)}
                  />
                </div>
              ) : null}
              <div className="ai-history-scope-options">
                {visibleScopeOptions.map((option) => (
                  <button
                    aria-selected={option.value === historyScopeFilter}
                    className="ai-history-scope-option app-select-item select-menu-item"
                    data-state={option.value === historyScopeFilter ? "checked" : undefined}
                    key={option.value}
                    role="option"
                    type="button"
                    onClick={() => {
                      setHistoryScopeChoice(option.value);
                      setHistoryScopeOpen(false);
                      setHistoryScopeQuery("");
                    }}
                  >
                    {option.value === historyScopeFilter ? (
                      <Check className="ui-icon" aria-hidden="true" />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <span>{option.label}</span>
                  </button>
                ))}
                {visibleScopeOptions.length === 0 ? (
                  <div className="app-select-empty">没有匹配项</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {historySessions.length === 0 ? (
            <p className="ai-history-empty">
              {historyScopeFilter === HISTORY_SCOPE_ALL
                ? "暂无历史会话。"
                : historyScopeFilter === HISTORY_SCOPE_NONE
                  ? "暂无未绑定的会话。"
                  : "该连接暂无历史会话。"}
            </p>
          ) : (
            <div className="ai-history-menu-list">
              {historySessions.map((session) => (
                <div
                  className={`ai-history-menu-item ${activeSessionId === session.id ? "active" : ""}`}
                  key={session.id}
                >
                  <button
                    className="ai-history-menu-item-main"
                    type="button"
                    role="menuitem"
                    onClick={() => void openSession(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <small>{session.last_message_preview || `${session.message_count.toString()} 条消息`}</small>
                  </button>
                  <button
                    className="ai-history-menu-item-delete"
                    type="button"
                    aria-label={`删除会话 ${session.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setHistoryOpen(false);
                      setPendingDeleteSession(session);
                    }}
                  >
                    <Trash2 className="ui-icon" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </AnchoredSurfacePortal>

      <AnchoredSurfacePortal
        align="end"
        anchorRef={auditTriggerRef}
        ariaLabel="审计日志"
        className="ai-audit-menu popover-content"
        desiredHeight={360}
        minHeight={120}
        open={active && auditOpen}
        role="dialog"
        width={360}
        onOpenChange={setAuditOpen}
      >
        <div className="ai-history-menu-header">
          <strong>审计日志</strong>
          <span>{activeSessionId ? `${visibleAuditEvents.length.toString()}${auditHasMore ? "+" : ""} 条` : "暂无会话"}</span>
          <button
            className="ai-audit-export"
            type="button"
            aria-label="导出审计日志"
            disabled={!activeSessionId || auditExporting || auditLoading}
            onClick={exportAuditLog}
          >
            {auditExporting ? <LoaderCircle className="ui-icon spin" aria-hidden="true" /> : <Download className="ui-icon" aria-hidden="true" />}
          </button>
        </div>
        <div className="ai-audit-menu-body">
          <input
            aria-label="筛选审计日志"
            className="app-select-search-input ai-audit-search"
            placeholder="筛选工具或状态"
            type="search"
            value={auditQuery}
            onChange={(event) => setAuditQuery(event.currentTarget.value)}
          />
          {auditLoading ? <p className="ai-history-empty">加载中…</p> : null}
          {!auditLoading && auditError ? <p className="ai-audit-error" role="alert">{auditError}</p> : null}
          {!auditLoading && !auditError && visibleAuditEvents.length === 0 ? (
            <p className="ai-history-empty">当前会话暂无审计记录。</p>
          ) : null}
          {!auditLoading
            ? visibleAuditEvents.map((entry) => {
                const event = entry.event as Record<string, unknown>;
                const name = typeof event.name === "string" ? event.name : "工具调用";
                const status = typeof event.status === "string" ? event.status : "unknown";
                const statusLabel = formatAuditStatus(status);
                const command = typeof event.command === "string" ? event.command : "";
                return (
                  <div className="ai-audit-item" key={entry.id}>
                    <button
                      className="ai-audit-item-summary"
                      type="button"
                      aria-expanded={auditExpandedId === entry.id}
                      onClick={() => setAuditExpandedId((current) => (current === entry.id ? null : entry.id))}
                    >
                      <span className="ai-audit-item-head">
                        <strong>{formatToolCallTitle(name)}</strong>
                        <small className={`ai-audit-status ai-audit-status-${status}`}>{statusLabel}</small>
                      </span>
                      <small>
                        {new Date(Number(entry.created_at_ms)).toLocaleString()} · #{entry.id.toString()}
                      </small>
                    </button>
                    {command ? <code className="ai-audit-command">{command}</code> : null}
                    {auditExpandedId === entry.id ? (
                      <small className="ai-audit-detail">
                        {[
                          typeof event.workspace === "string" && event.workspace ? `工作区：${event.workspace}` : "",
                          typeof event.risk === "string" && event.risk ? `风险：${event.risk}` : "",
                          typeof event.approval_decision === "string" && event.approval_decision
                            ? `审批：${event.approval_decision}`
                            : "",
                          typeof event.exit_status === "number" ? `退出：${event.exit_status}` : "",
                          typeof event.duration_ms === "number" ? `耗时：${event.duration_ms} ms` : "",
                          typeof event.error === "string" && event.error ? `错误：${event.error}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "无其他详情"}
                      </small>
                    ) : null}
                  </div>
                );
              })
            : null}
          {!auditLoading && !auditError && auditHasMore ? (
            <button className="ai-audit-load-more" type="button" disabled={auditLoadingMore} onClick={() => void loadMoreAuditEvents()}>
              {auditLoadingMore ? "加载中…" : "加载更早记录"}
            </button>
          ) : null}
        </div>
      </AnchoredSurfacePortal>

      {!runtimeAvailable ? (
        <p className="ai-inline-notice">桌面端才能保存配置和调用模型。</p>
      ) : null}
      {providerConfigsLoaded && providerConfigs.length === 0 ? (
        <div className="ai-config-empty">
          <strong>还没有 AI 配置</strong>
          <span>添加配置名称、接入模式、API Key、请求地址和模型后即可开始对话。</span>
          <button className="primary-button" type="button" onClick={onOpenSettings}>
            <Settings className="ui-icon" aria-hidden="true" />
            <span>打开 AI 设置</span>
          </button>
        </div>
      ) : null}

      <div className="ai-message-list-shell">
        <section
          className="ai-message-list"
          aria-label="AI 对话"
          ref={messageListRef}
        >
          <div className="ai-message-list-content" ref={messageListContentRef}>
          {messages.length === 0 ? (
            <div className="ai-welcome">
              <Terminal className="ui-icon" aria-hidden="true" />
              <strong>描述现象，或把终端输出放进上下文。</strong>
              <span>{agentModeDescription}</span>
            </div>
          ) : (
            messages.map((message) => (
              <AiConversationMessage key={message.id} message={message}
                isStreaming={streamState?.assistantMessageId === message.id}
                ticking={active || streamState?.assistantMessageId !== message.id}
                agentModeEnabled={agentModeEnabled} hasStream={Boolean(streamState)}
                renderTool={renderToolCallCard} renderSuggestions={renderCommandSuggestions}
                onCopy={copyMessage} onOpenAttachment={openAttachmentPreview}
                onUndo={undoMessageFileChanges} />
            ))
          )}
          </div>
        </section>
        {messageListHasNewContent ? (
          <button
            className="ai-new-content-button"
            type="button"
            aria-label="回到底部查看新内容"
            onClick={scrollMessageListToBottom}
          >
            <ChevronDown className="ui-icon" aria-hidden="true" />
            <span>新内容</span>
          </button>
        ) : null}
      </div>

      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      {notice ? <p className="ai-notice" role="status">{notice}</p> : null}

      <input
        ref={attachmentInputRef}
        className="ai-image-attachment-input"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,text/*,.txt,.md,.json,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.csv,.tsv,.rs,.js,.jsx,.ts,.tsx,.py,.go,.java,.kt,.sh,.bash,.zsh,.ps1,.sql,.html,.htm,.css,.scss,.xml,.env,.gitignore,Dockerfile"
        multiple
        aria-label="选择图片附件"
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files) {
            void addAttachments(files);
          }
          event.currentTarget.value = "";
        }}
      />
      <form className="ai-compose" onSubmit={(event) => void submit(event)}>
        <div className="ai-compose-box">
          {contextBlocks.length > 0 ? (
            <div className="ai-compose-context-list" aria-label={`已添加 ${contextBlocks.length.toString()} 个上下文片段`}>
              {contextBlocks.map((block) => {
                const sensitive = contextLooksSensitive(block.content);
                return (
                  <article
                    className={`ai-compose-context-chip ${sensitive ? "sensitive" : ""}`}
                    key={block.id}
                    title={block.content}
                  >
                    <button
                      className="ai-compose-context-preview"
                      type="button"
                      aria-label={`预览附件 ${block.title}`}
                      onClick={() => void openAttachmentPreview(block)}
                    >
                      {block.kind === "image" && block.data_url ? (
                        <img className="ai-compose-context-image" src={block.data_url} alt="" />
                      ) : (
                        <FileText className="ui-icon" aria-hidden="true" />
                      )}
                    </button>
                    <span className="ai-compose-context-chip-label">
                      <strong>{block.title}</strong>
                      <small>
                        {block.kind === "image"
                          ? `${block.source} · 图片附件`
                          : block.kind === "file"
                            ? `${block.source} · 文本附件`
                          : `${block.source} · ${block.line_count.toString()} 行 · ${block.char_count.toString()} 字`}
                      </small>
                    </span>
                    {sensitive ? <ShieldAlert className="ui-icon" aria-label="可能包含敏感信息" /> : null}
                    <button
                      type="button"
                      aria-label={`移除上下文 ${block.title}`}
                      onClick={() =>
                        setContextBlocks((blocks) => blocks.filter((item) => item.id !== block.id))
                      }
                    >
                      <X className="ui-icon" aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          <textarea
            aria-label="输入问题"
            value={input}
            placeholder="输入问题，例如：解释这段报错，或生成排查命令"
            spellCheck={false}
            onPaste={handleAttachmentPaste}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (
                event.key === "Enter" &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              ) {
                return;
              }
              if (keyboardEventMatchesShortcut(event.nativeEvent, sendShortcutBinding)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <footer>
            <div className="ai-compose-footer-left">
              <Tooltip label={`添加上下文${contextBlocks.length > 0 ? `（${contextBlocks.length.toString()} 个片段）` : ""}`}>
                <button
                  ref={contextTriggerRef}
                  aria-expanded={contextMenuOpen}
                  aria-haspopup="menu"
                  aria-label="添加上下文"
                  className={`ai-context-add-button ${contextMenuOpen ? "active" : ""}`}
                  type="button"
                  onClick={() => setContextMenuOpen((open) => !open)}
                >
                  <Plus className="ui-icon" aria-hidden="true" />
                  {contextBlocks.length > 0 ? (
                    <span className="ai-context-count-badge">{contextBlocks.length.toString()}</span>
                  ) : null}
                </button>
              </Tooltip>
              <Tooltip label={agentModeDescription}>
                <AppSelect
                  ariaLabel="AI 执行模式"
                  className={`ai-agent-mode-select ai-agent-mode-${effectiveAgentMode}`}
                  disabled={Boolean(streamState)}
                  menuMinWidth={300}
                  menuOptionHeight={48}
                  options={agentModeOptions.map((option) => ({
                    ...option,
                    description:
                      option.value === "full" ? (
                        <span className="ai-agent-mode-full-description">
                          {agentModeOptionDescriptions[option.value]}
                        </span>
                      ) : (
                        agentModeOptionDescriptions[option.value]
                      ),
                    disabled: option.value !== "chat" && !agentModeAvailable,
                  }))}
                  menuClassName="ai-agent-mode-menu"
                  value={effectiveAgentMode}
                  onChange={(value) => {
                    setAgentMode(value);
                    window.localStorage.setItem(selectedAgentModeStorageKey, value);
                  }}
                />
              </Tooltip>
            </div>
          <div className="ai-compose-footer-right">
            <Tooltip label="选择供应商与模型；模型列表来自对应配置的接口">
              <AiModelPicker
                providers={providerConfigs}
                selectedProviderId={selectedProviderId}
                selectedModel={selectedModel}
                disabled={!providerConfigs.length || Boolean(streamState)}
                onSelect={(providerId, model) => {
                  setSelectedModel(model);
                  rememberAiSelection(selectedModelsStorageKey, providerId, model);
                  const provider = providerConfigs.find((config) => config.id === providerId);
                  if (provider && model !== provider.model) {
                    void aiProviderConfigSave({
                      id: provider.id,
                      name: provider.name,
                      provider: provider.provider,
                      api_format: provider.api_format,
                      endpoint: provider.endpoint,
                      model,
                      models: provider.models,
                      api_key_touched: false,
                    })
                      .then((saved) => {
                        aiProviderConfigsCache = providerConfigs.map((config) =>
                          config.id === saved.id ? saved : config,
                        );
                        setProviderConfigs((configs) =>
                          configs.map((config) => (config.id === saved.id ? saved : config)),
                        );
                      })
                      .catch((nextError) => setError(formatAiError(nextError)));
                  }
                  if (providerId !== selectedProviderId) {
                    skipModelResetRef.current = true;
                    setSelectedProviderId(providerId);
                    window.localStorage.setItem(selectedProviderStorageKey, providerId);
                  }
                }}
                onModelCapabilitiesChange={handleModelCapabilitiesChange}
                onManage={onOpenSettings}
              />
            </Tooltip>
            {reasoningOptions.length > 0 ? (
              <Tooltip label="思考等级（由模型目录或接口提供）">
                <AppSelect
                  ariaLabel="思考等级"
                  className="ai-reasoning-select"
                  disabled={Boolean(streamState)}
                  menuMinWidth={112}
                  options={reasoningOptions}
                  placeholder="思考"
                  value={selectedReasoningLevel}
                  onChange={(value) => {
                    setSelectedReasoningLevel(value);
                    if (selectedProviderId && selectedModel) {
                      rememberAiSelection(
                        selectedReasoningLevelsStorageKey,
                        `${selectedProviderId}:${selectedModel}`,
                        value,
                      );
                    }
                  }}
                />
              </Tooltip>
            ) : null}
            {streamState ? (
              <Tooltip label="停止生成">
                <button
                  aria-label="停止"
                  className="ai-stop-button ai-compose-icon-button"
                  type="button"
                  onClick={() => void stopStreaming()}
                >
                  <Square className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip label={loading ? "准备中" : "发送"}>
                <button
                  aria-label={loading ? "准备中" : "发送"}
                  className="ai-compose-send"
                  type="submit"
                  disabled={sendDisabled}
                >
                  <Send className="ui-icon" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>
          </footer>
        </div>
      </form>

      <AnchoredSurfacePortal
        align="start"
        anchorRef={contextTriggerRef}
        ariaLabel="添加上下文"
        className="ai-context-menu popover-content"
        desiredHeight={connection ? 258 : 220}
        minHeight={120}
        open={active && contextMenuOpen}
        role="menu"
        side="top"
        width={204}
        onOpenChange={setContextMenuOpen}
      >
        <div className="ai-context-menu-title">添加上下文</div>
        <button
          className="ai-context-menu-item"
          disabled={imageAttachmentLoading || Boolean(streamState)}
          role="menuitem"
          type="button"
          onClick={() => {
            attachmentInputRef.current?.click();
            setContextMenuOpen(false);
          }}
        >
          <ImageIcon className="ui-icon" aria-hidden="true" />
          <span>{imageAttachmentLoading ? "读取附件中…" : "图片或文本附件"}</span>
        </button>
        <button
          className="ai-context-menu-item"
          disabled={!recentTerminalOutput?.trim()}
          role="menuitem"
          type="button"
          onClick={() => {
            addRecentTerminalOutputContext();
            setContextMenuOpen(false);
          }}
        >
          <Terminal className="ui-icon" aria-hidden="true" />
          <span>最近输出</span>
        </button>
        <button
          className="ai-context-menu-item"
          role="menuitem"
          type="button"
          onClick={() => {
            void selectAiWorkspaceDirectory().then((path) => {
              if (path) { setLocalWorkspace(path); setAgentMode("execute"); setNotice(`已选择本地工作区：${path}`); }
            });
            setContextMenuOpen(false);
          }}
        >
          <FileText className="ui-icon" aria-hidden="true" />
          <span>{localWorkspace ? "更换本地工作区" : "选择本地工作区"}</span>
        </button>
        {connection ? (
          <button
            className="ai-context-menu-item"
            disabled={Boolean(streamState)}
            role="menuitem"
            type="button"
            onClick={openRemoteWorkspaceDialog}
          >
            <FolderOpen className="ui-icon" aria-hidden="true" />
            <span>{remoteWorkspacePath ? "更换 SSH 工作区" : "选择 SSH 工作区"}</span>
          </button>
        ) : null}
        <button
          className="ai-context-menu-item"
          disabled={!connection}
          role="menuitem"
          type="button"
          onClick={() => {
            addConnectionContext();
            setContextMenuOpen(false);
          }}
        >
          <ListPlus className="ui-icon" aria-hidden="true" />
          <span>连接</span>
        </button>
        <button
          className="ai-context-menu-item"
          disabled={!commandDraft.trim()}
          role="menuitem"
          type="button"
          onClick={() => {
            addCommandDraftContext();
            setContextMenuOpen(false);
          }}
        >
          <CornerDownLeft className="ui-icon" aria-hidden="true" />
          <span>草稿</span>
        </button>
        <button
          className="ai-context-menu-item"
          disabled={recentCommands.length === 0}
          role="menuitem"
          type="button"
          onClick={() => {
            addRecentCommandsContext();
            setContextMenuOpen(false);
          }}
        >
          <Clock3 className="ui-icon" aria-hidden="true" />
          <span>最近命令</span>
        </button>
      </AnchoredSurfacePortal>

      <Dialog.Root
        open={active && remoteWorkspaceDialogOpen}
        onOpenChange={(open) => {
          setRemoteWorkspaceDialogOpen(open);
          if (!open) {
            setRemoteWorkspaceError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-backdrop ai-ssh-workspace-backdrop" />
          <Dialog.Content
            className="ai-ssh-workspace-dialog"
            onInteractOutside={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <form onSubmit={submitRemoteWorkspace}>
              <header className="dialog-head">
                <div className="dialog-title-group">
                  <Dialog.Title>更换 SSH 工作区</Dialog.Title>
                  <Dialog.Description className="dialog-subtitle">
                    文件工具会在当前 SSH 主机的这个目录下工作。
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className="icon-button dialog-close-button" type="button" aria-label="关闭">
                    <X className="ui-icon" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </header>
              <label className="ai-ssh-workspace-field">
                <span>工作区路径</span>
                <input
                  autoFocus
                  aria-describedby={remoteWorkspaceError ? "ai-ssh-workspace-error" : undefined}
                  aria-invalid={Boolean(remoteWorkspaceError)}
                  placeholder="例如 /home/user/project"
                  spellCheck={false}
                  value={remoteWorkspaceDraft}
                  onChange={(event) => {
                    setRemoteWorkspaceDraft(event.currentTarget.value);
                    if (remoteWorkspaceError) {
                      setRemoteWorkspaceError(null);
                    }
                  }}
                />
              </label>
              {remoteWorkspaceError ? (
                <p className="ai-ssh-workspace-error" id="ai-ssh-workspace-error" role="alert">
                  {remoteWorkspaceError}
                </p>
              ) : null}
              <footer className="ai-ssh-workspace-actions">
                <button
                  type="button"
                  onClick={() => {
                    setRemoteWorkspacePath(null);
                    if (connection?.id) {
                      rememberAiSelection(selectedRemoteWorkspacesStorageKey, connection.id, "");
                    }
                    setRemoteWorkspaceError(null);
                    setRemoteWorkspaceDialogOpen(false);
                    setNotice("已恢复跟随当前终端目录。");
                  }}
                >
                  跟随当前目录
                </button>
                <Dialog.Close asChild>
                  <button type="button">取消</button>
                </Dialog.Close>
                <button className="primary-button" type="submit">保存</button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={active && Boolean(pendingDeleteSession) }
        title="删除 AI 会话"
        description={`确认删除“${pendingDeleteSession?.title || "该会话"}”吗？此操作不会影响终端。`}
        confirmLabel="删除"
        onConfirm={confirmDeleteSession}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSession(null);
          }
        }}
      />
      <ConfirmDialog
        open={active && clearSessionOpen}
        title="清空当前 AI 会话"
        description="会删除当前会话内的消息记录，但保留会话入口。"
        confirmLabel="清空"
        onConfirm={clearCurrentSession}
        onOpenChange={setClearSessionOpen}
      />
      <ConfirmDialog
        open={active && Boolean(pendingDangerousCommand) }
        title="确认发送危险命令"
        description={
          pendingDangerousCommand
            ? pendingDangerousCommand.reasons.join("；") || "该命令可能影响系统或数据。"
            : "该命令可能影响系统或数据。"
        }
        confirmLabel="发送"
        onConfirm={async () => {
          const command = pendingDangerousCommand?.command;
          setPendingDangerousCommand(null);
          if (command) {
            await runSendCommand(command);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDangerousCommand(null);
          }
        }}
      />
      <AttachmentPreviewDialog
        attachment={previewAttachment}
        open={active && Boolean(previewAttachment) }
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachment(null);
          }
        }}
      />
    </section>
  );




}

function buildContextBlock({
  kind,
  title,
  source,
  content,
}: {
  kind: string;
  title: string;
  source: string;
  content: string;
}): AiContextBlock {
  const normalized = content.trim();
  return {
    id: `${kind}-${Date.now().toString()}`,
    kind,
    title,
    source,
    content: normalized,
    line_count: normalized.split(/\r?\n/).length,
    char_count: Array.from(normalized).length,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (value) {
        resolve(value);
      } else {
        reject(new Error(`读取图片失败：${file.name}`));
      }
    });
    reader.addEventListener("error", () => reject(reader.error || new Error(`读取图片失败：${file.name}`)));
    reader.readAsDataURL(file);
  });
}

function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  if (normalized === "dockerfile" || normalized === ".gitignore") {
    return normalized.replace(/^\./, "");
  }
  return normalized.split(".").pop() || "";
}

function isImageAttachment(file: File): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(file.type) ||
    ["png", "jpg", "jpeg", "gif", "webp"].includes(fileExtension(file.name));
}

function isTextAttachment(file: File): boolean {
  return file.type.startsWith("text/") || textAttachmentExtensions.has(fileExtension(file.name));
}

function readFileAsText(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new Error(`无法按 UTF-8 读取文本附件：${file.name || "未命名文件"}`);
    }
  });
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "unordered_list"; items: string[] }
  | { type: "ordered_list"; items: string[] }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "table"; align: MarkdownTableAlign[]; header: string[]; rows: string[][] };

type MarkdownTableAlign = "left" | "center" | "right" | null;

type ShellFenceLineClassification =
  | { kind: "command"; command: string }
  | { kind: "skip" }
  | { kind: "output" };

const shellFenceLanguages = new Set([
  "sh",
  "shell",
  "bash",
  "zsh",
  "fish",
  "powershell",
  "ps1",
  "cmd",
  "bat",
]);

const knownShellCommands = new Set([
  "apt",
  "apt-cache",
  "apt-get",
  "awk",
  "bash",
  "brew",
  "cargo",
  "cat",
  "cd",
  "chmod",
  "chown",
  "clear",
  "cmake",
  "composer",
  "cp",
  "curl",
  "cut",
  "dd",
  "df",
  "dig",
  "dmesg",
  "docker",
  "du",
  "echo",
  "env",
  "export",
  "fdisk",
  "find",
  "firewall-cmd",
  "free",
  "git",
  "go",
  "grep",
  "halt",
  "head",
  "history",
  "hostname",
  "hostnamectl",
  "htop",
  "ifconfig",
  "ip",
  "iptables",
  "java",
  "journalctl",
  "jq",
  "kill",
  "killall",
  "kubectl",
  "last",
  "less",
  "ln",
  "ls",
  "lsof",
  "make",
  "mkdir",
  "mkfs",
  "mount",
  "mv",
  "mysql",
  "nc",
  "netstat",
  "nmap",
  "node",
  "npm",
  "openssl",
  "parted",
  "passwd",
  "ping",
  "pip",
  "pip3",
  "pnpm",
  "poweroff",
  "ps",
  "psql",
  "python",
  "python3",
  "reboot",
  "rm",
  "route",
  "rsync",
  "scp",
  "sed",
  "sensors",
  "service",
  "sh",
  "shutdown",
  "sort",
  "source",
  "ssh",
  "ssh-keygen",
  "sshpass",
  "ss",
  "sudo",
  "systemctl",
  "tail",
  "tar",
  "tee",
  "top",
  "touch",
  "traceroute",
  "ufw",
  "umount",
  "uname",
  "unzip",
  "uptime",
  "useradd",
  "userdel",
  "vim",
  "w",
  "watch",
  "wc",
  "wget",
  "who",
  "wipefs",
  "xargs",
  "yarn",
  "zsh",
]);

interface AiConversationMessageProps {
  message: AiChatMessage;
  isStreaming: boolean;
  ticking: boolean;
  agentModeEnabled: boolean;
  hasStream: boolean;
  renderTool: (call: AiToolCallRecord, flowing?: boolean) => ReactNode;
  renderSuggestions: (message: AiChatMessage) => ReactNode;
  onCopy: (content: string) => Promise<void>;
  onOpenAttachment: (block: AiContextBlock, sessionId?: string) => Promise<void>;
  onUndo: (message: AiChatMessage, summary: AiFileChangeSummary) => Promise<string | null>;
}

const AiConversationMessage = memo(function AiConversationMessage({
  message, isStreaming, ticking, agentModeEnabled, hasStream, renderTool, renderSuggestions,
  onCopy, onOpenAttachment, onUndo,
}: AiConversationMessageProps) {
  const showStatus =
    Boolean(message.status) &&
    message.status !== "complete" &&
    message.status !== "streaming";
  const contextsNode =
    message.contexts.length > 0 ? (
      <div className="ai-message-contexts">
        {message.contexts.map((block) => (
          <button
            className={`ai-message-context ${block.kind === "image" ? "ai-message-context-image" : ""}`}
            key={block.id}
            title={block.title}
            type="button"
            onClick={() => void onOpenAttachment(block, message.session_id)}
          >
            {block.kind === "image" && block.data_url ? (
              <img src={block.data_url} alt="" />
            ) : (
              <FileText className="ui-icon" aria-hidden="true" />
            )}
            <span>{block.title}</span>
          </button>
        ))}
      </div>
    ) : null;
  return (
    <article className={`ai-message ${message.role}`} key={message.id}>
      {showStatus ? (
        <header>
          <span>{formatMessageStatus(message.status)}</span>
        </header>
      ) : null}
      {message.role === "user" ? (
        <div className="ai-message-bubble">
          {contextsNode}
          <div className="ai-message-content">
            {message.content
              ? renderMarkdownContent(message.content)
              : "..."}
          </div>
        </div>
      ) : (
        <>
          {contextsNode}
          <AiMessageTimeline
            message={message}
            isStreaming={isStreaming}
            ticking={ticking}
            renderText={renderMarkdownContent}
            renderTool={renderTool}
          />
          {!agentModeEnabled ? renderSuggestions(message) : null}
          {message.file_changes?.map((summary) => (
            <AiFileChangesSummary key={summary.checkpoint_id} summary={summary}
              disabled={hasStream}
              onUndo={(change) => onUndo(message, change)} />                      ))}
        </>
      )}
      <div className="ai-message-meta">
        <Tooltip label="复制">
          <button
            type="button"
            aria-label="复制消息"
            className="ai-message-meta-button"
            onClick={() => void onCopy(message.content)}
          >
            <Copy className="ui-icon" aria-hidden="true" />
          </button>
        </Tooltip>
        <time>{formatMessageTime(message.created_at)}</time>
      </div>
    </article>
  );
});

function renderMarkdownContent(content: string) {
  const blocks = parseMarkdownBlocks(content);
  return blocks.map((block, index) => {
    if (block.type === "heading") {
      return (
        <h4 className={`ai-md-heading level-${Math.min(block.level, 3).toString()}`} key={`h-${index.toString()}`}>
          {renderInlineMarkdown(block.text)}
        </h4>
      );
    }
    if (block.type === "unordered_list") {
      return (
        <ul className="ai-md-list" key={`ul-${index.toString()}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`ul-${index.toString()}-${itemIndex.toString()}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    }
    if (block.type === "ordered_list") {
      return (
        <ol className="ai-md-list ordered" key={`ol-${index.toString()}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`ol-${index.toString()}-${itemIndex.toString()}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
    }
    if (block.type === "code") {
      return (
        <pre className="ai-md-codeblock" key={`code-${index.toString()}`}>
          <code>{block.lines.join("\n")}</code>
        </pre>
      );
    }
    if (block.type === "table") {
      return (
        <div className="ai-md-table-wrap" key={`table-${index.toString()}`}>
          <table className="ai-md-table">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={cellIndex.toString()} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex.toString()}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex.toString()} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return (
      <p className="ai-md-paragraph" key={`p-${index.toString()}`}>
        {renderInlineMarkdown(block.lines.join(" "))}
      </p>
    );
  });
}

function renderInlineMarkdown(text: string, keyPrefix = "md"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let keyIndex = 0;
  let plain = "";
  let cursor = 0;

  function flushPlain() {
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
  }

  while (cursor < text.length) {
    if (text[cursor] === "`") {
      const codeEnd = text.indexOf("`", cursor + 1);
      if (codeEnd > cursor + 1) {
        flushPlain();
        nodes.push(
          <code className="ai-md-inline-code" key={`${keyPrefix}-code-${keyIndex.toString()}`}>
            {text.slice(cursor + 1, codeEnd)}
          </code>,
        );
        keyIndex += 1;
        cursor = codeEnd + 1;
        continue;
      }
    }
    if (text.startsWith("**", cursor)) {
      const boldEnd = findClosingBoldMarker(text, cursor + 2);
      if (boldEnd > cursor + 2) {
        flushPlain();
        const strongKey = `${keyPrefix}-strong-${keyIndex.toString()}`;
        nodes.push(
          <strong key={strongKey}>{renderInlineMarkdown(text.slice(cursor + 2, boldEnd), strongKey)}</strong>,
        );
        keyIndex += 1;
        cursor = boldEnd + 2;
        continue;
      }
    }
    plain += text[cursor];
    cursor += 1;
  }
  flushPlain();

  return nodes.length > 0 ? nodes : [text];
}

function findClosingBoldMarker(text: string, from: number) {
  let cursor = from;
  while (cursor < text.length) {
    if (text[cursor] === "`") {
      const codeEnd = text.indexOf("`", cursor + 1);
      if (codeEnd === -1) {
        return text.indexOf("**", cursor);
      }
      cursor = codeEnd + 1;
      continue;
    }
    if (text.startsWith("**", cursor)) {
      return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitMarkdownTableRow(line: string) {
  let row = line.trim();
  if (row.startsWith("|")) {
    row = row.slice(1);
  }
  if (row.endsWith("|") && !row.endsWith("\\|")) {
    row = row.slice(0, -1);
  }
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "`") {
      inCode = !inCode;
    }
    if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function markdownTableAlign(cell: string): MarkdownTableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return left ? "left" : null;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replace(/\r/g, "").split("\n");
  let inFence = false;
  let fenceLang = "";
  let fenceLines: string[] = [];
  let paragraphLines: string[] = [];
  let listType: "unordered_list" | "ordered_list" | null = null;
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({ lines: paragraphLines, type: "paragraph" });
    paragraphLines = [];
  }

  function flushList() {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    blocks.push({ items: listItems, type: listType });
    listType = null;
    listItems = [];
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    if (inFence) {
      if (rawLine.trim().startsWith("```")) {
        blocks.push({ lang: fenceLang, lines: fenceLines, type: "code" });
        inFence = false;
        fenceLang = "";
        fenceLines = [];
        continue;
      }
      fenceLines.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      inFence = true;
      fenceLang = trimmed.slice(3).trim().toLowerCase();
      fenceLines = [];
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const nextLine = lines[lineIndex + 1];
    if (trimmed.includes("|") && nextLine !== undefined && isMarkdownTableSeparator(nextLine)) {
      const header = splitMarkdownTableRow(trimmed);
      const align = splitMarkdownTableRow(nextLine).map(markdownTableAlign);
      const rows: string[][] = [];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].trim().includes("|")) {
        const cells = splitMarkdownTableRow(lines[lineIndex]);
        rows.push(header.map((_, cellIndex) => cells[cellIndex] ?? ""));
        lineIndex += 1;
      }
      lineIndex -= 1;
      flushParagraph();
      flushList();
      blocks.push({ align, header, rows, type: "table" });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        type: "heading",
      });
      continue;
    }

    const unorderedMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "unordered_list") {
        flushList();
      }
      listType = "unordered_list";
      listItems.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ordered_list") {
        flushList();
      }
      listType = "ordered_list";
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    if (listType && /^\s{2,}\S/.test(rawLine) && listItems.length > 0) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${trimmed}`;
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (inFence) {
    blocks.push({ lang: fenceLang, lines: fenceLines, type: "code" });
  }
  return blocks;
}

function extractCommandSuggestions(content: string): AiCommandSuggestion[] {
  const suggestions: AiCommandSuggestion[] = [];
  const seen = new Set<string>();
  for (const block of parseMarkdownBlocks(content)) {
    if (block.type === "code" && isShellFence(block.lang)) {
      for (const command of extractCommandsFromShellFence(block.lines)) {
        pushSuggestion(suggestions, seen, command);
      }
      continue;
    }
    if (block.type !== "code" && block.type !== "table") {
      const sourceLines =
        block.type === "paragraph"
          ? block.lines
          : block.type === "heading"
            ? [block.text]
            : block.items;
      for (const line of sourceLines) {
        const command = extractCommandFromPlainLine(line);
        if (command) {
          pushSuggestion(suggestions, seen, command);
        }
      }
    }
  }
  return suggestions;
}

function pushSuggestion(
  suggestions: AiCommandSuggestion[],
  seen: Set<string>,
  command: string,
) {
  const normalized = command.trim();
  if (!normalized || seen.has(normalized) || normalized.length > 4000) {
    return;
  }
  const assessment = assessCommandLocally(normalized);
  seen.add(normalized);
  suggestions.push({
    command: normalized,
    risk: assessment.risk,
    reasons: assessment.reasons,
  });
}

function shellLikeCommand(line: string) {
  const normalized = normalizePotentialCommandLine(line);
  const first = normalized.split(/\s+/)[0]?.replace(/^[`"']|[`"']$/g, "") || "";
  const firstLower = first.toLowerCase();
  return knownShellCommands.has(firstLower) || firstLower.startsWith("mkfs.")
    ? normalized.replace(/^`|`$/g, "")
    : null;
}

function assessCommandLocally(command: string): AiCommandAssessment {
  const lower = command.toLowerCase();
  const reasons: string[] = [];
  if (/\brm\s+-[^\n\r]*r[^\n\r]*f/i.test(command)) {
    reasons.push("包含递归强制删除。");
  }
  if (/\b(?:mkfs|fdisk|parted|wipefs|shutdown|reboot|halt|poweroff)\b/i.test(command)) {
    reasons.push("可能修改磁盘或重启主机。");
  }
  if (/\bdd\b/i.test(command) && /\bof=/.test(command)) {
    reasons.push("包含 dd 写入目标。");
  }
  if (/\b(?:curl|wget)\b[^\n\r|]*\|\s*(?:sh|bash)\b/i.test(command)) {
    reasons.push("包含下载脚本后直接执行。");
  }
  if (
    lower.includes("iptables") ||
    lower.includes("ufw") ||
    lower.includes("firewall-cmd") ||
    lower.includes("ip route") ||
    lower.includes("route ") ||
    lower.includes("systemctl restart") ||
    lower.includes("systemctl stop") ||
    (lower.includes("service ") && lower.includes(" stop"))
  ) {
    reasons.push("可能影响网络或服务状态。");
  }
  if (
    lower.includes("chmod -r 777") ||
    lower.includes("chown -r") ||
    lower.includes("userdel ") ||
    lower.includes("passwd ") ||
    (lower.includes("/etc/ssh") && (lower.includes(">") || lower.includes("tee ")))
  ) {
    reasons.push("可能改变权限、用户、认证或 SSH 配置。");
  }
  if (containsSensitiveCommandText(lower)) {
    reasons.push("包含凭据、密钥或 token 明文。");
  }
  return {
    command,
    risk: reasons.length ? "dangerous" : "safe",
    reasons,
  };
}

function isShellFence(lang: string) {
  return shellFenceLanguages.has(lang);
}

function extractCommandsFromShellFence(lines: string[]) {
  const commands: string[] = [];
  let sawOutputLikeLine = false;

  for (const rawLine of lines) {
    const classification = classifyShellFenceLine(rawLine);
    if (classification.kind === "command") {
      commands.push(classification.command);
    } else if (classification.kind === "output") {
      sawOutputLikeLine = true;
    }
  }

  if (commands.length === 0) {
    return [];
  }
  return sawOutputLikeLine ? commands : [commands.join("\n")];
}

function classifyShellFenceLine(line: string): ShellFenceLineClassification {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "\\" || trimmed.startsWith("#")) {
    return { kind: "skip" };
  }
  if (isPromptOnlyLine(trimmed)) {
    return { kind: "output" };
  }
  const normalized = normalizePotentialCommandLine(trimmed);
  if (!normalized) {
    return { kind: "skip" };
  }
  if (looksLikeTerminalNoise(trimmed) || looksLikeTerminalNoise(normalized)) {
    return { kind: "output" };
  }
  const command = shellLikeCommand(normalized);
  if (!command) {
    return { kind: "output" };
  }
  return { command, kind: "command" };
}

function extractCommandFromPlainLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const inlineCodeCommand = extractStandaloneInlineCodeCommand(trimmed);
  if (inlineCodeCommand) {
    return inlineCodeCommand;
  }
  const markdownListCommand = extractMarkdownListCommand(trimmed);
  if (markdownListCommand) {
    return markdownListCommand;
  }
  if (isMarkdownStructuralLine(trimmed) || looksLikeTerminalNoise(trimmed)) {
    return null;
  }

  const normalized = normalizePotentialCommandLine(trimmed);
  if (!normalized || isPromptOnlyLine(trimmed) || isPromptOnlyLine(normalized)) {
    return null;
  }
  if (hasCjkCharacters(normalized) && !shellLikeCommand(normalized)) {
    return null;
  }
  if (/[：]/.test(normalized) || /^\S.*:\s*$/.test(normalized)) {
    return null;
  }
  if (looksLikeTerminalNoise(normalized)) {
    return null;
  }
  return shellLikeCommand(normalized);
}

function extractStandaloneInlineCodeCommand(line: string) {
  const match = /^(?:[-*+]\s+|\d+\.\s+)?`([^`]+)`\s*$/.exec(line);
  if (!match) {
    return null;
  }
  return shellLikeCommand(match[1].trim());
}

function extractMarkdownListCommand(line: string) {
  const match = /^(?:[-*+]\s+|\d+\.\s+)(.+)$/.exec(line);
  if (!match) {
    return null;
  }
  return shellLikeCommand(match[1].trim());
}

function normalizePotentialCommandLine(line: string) {
  let normalized = line.trim().replace(/^`|`$/g, "");
  let previous = "";
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^(?:\$|#|>)\s+/, "")
      .replace(/^PS [^>]+>\s*/i, "")
      .replace(/^\[[^\]]+\][#$]\s*/, "")
      .replace(/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+(?::[^\s#$>]+)?[#$>]\s*/, "")
      .trim();
  }
  return normalized;
}

function isMarkdownStructuralLine(line: string) {
  return (
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/.test(line) ||
    /^[-*_]{3,}$/.test(line) ||
    /^\|.*\|$/.test(line)
  );
}

function isPromptOnlyLine(line: string) {
  return (
    /^(?:PS [^>]+>|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+(?::[^\s#$>]+)?[#$>])\s*$/i.test(line) ||
    /^\[[^\]]+\][#$]\s*$/i.test(line) ||
    /^(?:\$|#)\s*$/.test(line)
  );
}

function looksLikeTerminalNoise(line: string) {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }
  const compact = normalized.replace(/\s+/g, "");
  if (/^[\\/_|()[\]{}<>+=*-]{6,}$/.test(compact)) {
    return true;
  }
  return [
    /^welcome to\b/i,
    /^last login:/i,
    /^last check:/i,
    /^system load:/i,
    /^memory usage:/i,
    /^swap usage:/i,
    /^usage of \//i,
    /^ipv4 address for /i,
    /^\[\s*\d+[^\]]*updates?[^\]]*\]$/i,
    /^\[[^\]]*configuration[^\]]*\]$/i,
    /^\[[^\]]*beta[^\]]*\]$/i,
    /^\s*[_/\\|]{3,}/,
  ].some((pattern) => pattern.test(normalized));
}

function hasCjkCharacters(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

function containsSensitiveCommandText(lowerCommand: string) {
  return [
    "authorization: bearer",
    "api_key=",
    "apikey=",
    "access_token=",
    "auth_token=",
    "secret_access_key",
    "client_secret",
    "private_key",
    "--password",
    "password=",
    "passwd=",
    "sshpass -p",
    "-----begin",
  ].some((pattern) => lowerCommand.includes(pattern));
}

function contextLooksSensitive(content: string) {
  const lower = content.toLowerCase();
  return (
    containsSensitiveCommandText(lower) ||
    /\b(?:password|passwd|token|secret|access[_-]?key|api[_-]?key|authorization|x-api-key)\b\s*[:=]\s*\S+/i.test(
      content,
    ) ||
    /-----begin [a-z0-9 ]*private key-----/i.test(content) ||
    /\bsk-[a-z0-9_-]{12,}/i.test(content)
  );
}

function formatMessageTime(value: string) {
  const numeric = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 9_999_999_999 ? numeric : numeric * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatMessageStatus(status: string) {
  if (status === "streaming") {
    return "生成中";
  }
  if (status === "complete") {
    return "完成";
  }
  if (status === "stopped") {
    return "已停止";
  }
  if (status === "error") {
    return "失败";
  }
  return status || "完成";
}

function upsertToolCall(calls: AiToolCallRecord[], record: AiToolCallRecord) {
  return calls.some((call) => call.id === record.id)
    ? calls.map((call) => (call.id === record.id ? record : call))
    : [...calls, record];
}

function ensureAiScopeStreamListener(): Promise<void> {
  if (!aiScopeStreamListener) {
    const generation = ++aiScopeStreamListenerGeneration;
    aiScopeStreamListener = listenAiChatStream(handleAiScopeStreamEvent)
      .then((unlisten) => {
        if (generation !== aiScopeStreamListenerGeneration) {
          unlisten();
          return;
        }
        aiScopeStreamUnlisten = unlisten;
      })
      .catch((error) => {
        aiScopeStreamListener = null;
        throw error;
      });
  }
  return aiScopeStreamListener;
}

// Vite 热更新会重新执行这个模块。如果旧的 Tauri 监听没有解除，
// 同一个流事件会被旧模块和新模块各消费一次，文本就会按监听器数量重复追加。
// 生产环境没有 import.meta.hot，这段只负责开发期清理，不改变正常运行时行为。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    aiScopeStreamListenerGeneration += 1;
    aiScopeStreamUnlisten?.();
    aiScopeStreamUnlisten = null;
    aiScopeStreamListener = null;
  });
}

function handleAiScopeStreamEvent(event: AiChatStreamEvent) {
  const effects: Array<[string, AiAssistantScopeEffect]> = [];
  updateEveryAiScopeState((key, state) => {
    const result = applyAiStreamEventToScope(state, event);
    if (result.effect) {
      effects.push([key, result.effect]);
    }
    return result.state;
  });
  effects.forEach(([key, effect]) => emitAiScopeEffect(key, effect));
}

function mapMessageById(
  messages: AiChatMessage[],
  messageId: string,
  update: (message: AiChatMessage) => AiChatMessage,
) {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    changed = true;
    return update(message);
  });
  return changed ? next : messages;
}

function applyAiStreamEventToScope(
  state: AiAssistantScopeState,
  event: AiChatStreamEvent,
): { state: AiAssistantScopeState; effect: AiAssistantScopeEffect | null } {
  const unchanged = { state, effect: null };
  const withMessages = (
    messages: AiChatMessage[],
    effect: AiAssistantScopeEffect | null = null,
  ) => (messages === state.messages ? unchanged : { state: { ...state, messages }, effect });

  if (event.kind === "file_changes" && event.file_changes && state.activeSessionId === event.session_id) {
    const summaries = event.file_changes;
    return withMessages(applyFileChangeSummaries(state.messages, event.session_id, summaries));
  }
  if (event.kind === "tool_output") {
    const output = event.tool_output;
    if (!output || !output.delta) {
      return unchanged;
    }
    return withMessages(
      mapMessageById(state.messages, event.message_id, (message) => ({
        ...message,
        tool_calls: message.tool_calls.map((call) =>
          call.id === output.tool_call_id
            ? {
                ...call,
                output: tailByChars(
                  `${call.status === "completed" ? "" : call.output}${output.delta}`,
                  12_000,
                ),
                status: call.status === "pending_approval" ? call.status : "running",
              }
            : call,
        ),
      })),
    );
  }
  if (event.kind === "background_task") {
    const update = event.background_task;
    if (!update) {
      return unchanged;
    }
    const status =
      update.status === "succeeded"
        ? "completed"
        : update.status === "cancelled"
          ? "cancelled"
          : update.status === "running"
            ? "running"
            : "failed";
    return withMessages(
      mapMessageById(state.messages, event.message_id, (message) => ({
        ...message,
        tool_calls: message.tool_calls.map((call) =>
          call.id === update.tool_call_id
            ? {
                ...call,
                status,
                output: update.output_preview || call.output,
                output_artifact_id: update.output_artifact_id || call.output_artifact_id,
                exit_status: update.exit_status ?? call.exit_status,
              }
            : call,
        ),
      })),
      update.status !== "running" ? { kind: "background_task", status: update.status } : null,
    );
  }
  if (event.kind === "tool_call") {
    const record = event.tool_call;
    if (!record) {
      return unchanged;
    }
    // 后台任务可能在主流已结束后才完成。只要消息 ID 对得上，仍要
    // 接收最终的完整工具记录，不能再用当前 stream_id 把它丢掉。
    return withMessages(
      mapMessageById(state.messages, event.message_id, (message) => ({
        ...(message.tool_calls.some((item) => item.id === record.id)
          ? message
          : finishThinkingBlock(message)),
        tool_calls: upsertToolCall(message.tool_calls, record),
      })),
    );
  }
  if (!state.streamState || event.stream_id !== state.streamState.streamId) {
    return unchanged;
  }
  if (event.kind === "chunk") {
    const delta = event.delta || "";
    return withMessages(
      mapMessageById(state.messages, event.message_id, (message) => ({
        ...finishThinkingBlock(message),
        content: `${message.content}${delta}`,
        status: "streaming",
      })),
    );
  }
  if (event.kind === "thinking") {
    const delta = event.thinking_delta || "";
    return withMessages(
      mapMessageById(state.messages, event.message_id, (message) => ({
        ...appendThinkingDelta(message, delta, event.thinking_update),
        status: "streaming",
      })),
    );
  }
  if (event.kind === "finished" || event.kind === "stopped" || event.kind === "error") {
    const messages = mapMessageById(state.messages, event.message_id, (message) => ({
      ...finishThinkingBlock(message),
      commands: extractCommandSuggestions(event.content || message.content),
      content: event.content ?? message.content,
      status:
        event.kind === "finished" ? "complete" : event.kind === "stopped" ? "stopped" : "error",
    }));
    return {
      state: { ...state, messages, streamState: null },
      effect: { kind: "stream_ended", status: event.kind, error: event.error ?? null },
    };
  }
  return unchanged;
}

function formatToolCallTitle(name: string) {
  if (name === "run_command") {
    return "执行命令";
  }
  if (name === "server_monitor") {
    return "服务器状态";
  }
  if (name === "read_terminal_output") {
    return "读取终端输出";
  }
  if (name === "read_file") return "读取文件";
  if (name === "glob") return "查找文件";
  if (name === "grep") return "搜索内容";
  if (name === "preview_patch") return "预览文件修改";
  if (name === "apply_patch") return "应用文件修改";
  if (name === "preview_file_change") return "预览文件操作";
  if (name === "apply_file_change") return "应用文件操作";
  if (name === "workspace_changes") return "汇总工作区变更";
  if (name === "create_workspace_checkpoint") return "创建工作区检查点";
  if (name === "rollback_workspace") return "整体回滚工作区";
  if (name === "start_task") return "启动后台任务";
  if (name === "task_status") return "查询任务状态";
  if (name === "task_output") return "读取任务输出";
  if (name === "cancel_task") return "停止后台任务";
  if (name === "update_plan") return "更新计划";
  if (name === "ask_user") return "等待用户选择";
  if (name === "web_search") return "联网搜索";
  if (name === "web_fetch") return "读取网页";
  return name;
}

function formatToolCallSummary(call: AiToolCallRecord) {
  if (call.name === "run_command") {
    return (call.command || "").replace(/\s+/g, " ").trim();
  }
  if (call.name === "server_monitor") {
    return "负载、内存与磁盘概况";
  }
  if (call.name === "read_terminal_output") {
    return "发送时的终端输出快照";
  }
  if (call.name === "workspace_changes") return "汇总待应用、已应用变更和检查点";
  if (call.name === "create_workspace_checkpoint") return "保存当前多文件变更状态";
  if (call.name === "run_command" || call.name === "start_task") return (call.command || "").replace(/\s+/g, " ").trim();
  if (
    call.name === "apply_patch" ||
    call.name === "preview_patch" ||
    call.name === "preview_file_change" ||
    call.name === "apply_file_change" ||
    call.name === "rollback_patch" ||
    call.name === "rollback_workspace"
  ) {
    return call.command || "等待文件变更确认";
  }
  if (call.name === "update_plan") return "已更新编码计划";
  if (call.name === "ask_user") return "等待用户选择";
  if (call.name === "web_search") return (call.command || "").replace(/\s+/g, " ").trim();
  if (call.name === "web_fetch") return (call.command || "").replace(/\s+/g, " ").trim();
  return "";
}

function formatPlanOutput(value: string) {
  try {
    const parsed = JSON.parse(value) as { plan?: unknown };
    if (typeof parsed.plan === "string" && parsed.plan.trim()) {
      return parsed.plan.trim();
    }
  } catch {
    // Older records can contain the raw plan text.
  }
  return value || "计划尚未填写。";
}

function formatToolCallStatus(call: AiToolCallRecord) {
  switch (call.status) {
    case "pending_approval":
      return "待确认";
    case "pending_user_input":
      return "待选择";
    case "running":
      return "执行中";
    case "completed":
      return call.exit_status && call.exit_status !== 0
        ? `退出码 ${call.exit_status.toString()}`
        : "完成";
    case "failed":
      return "失败";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已取消";
    default:
      return call.status;
  }
}

function formatAuditStatus(status: string) {
  switch (status) {
    case "pending_approval":
      return "待确认";
    case "pending_user_input":
      return "待选择";
    case "running":
      return "执行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function toolCallStatusTone(call: AiToolCallRecord) {
  if (call.status === "running") {
    return "running";
  }
  if (call.status === "completed") {
    return call.exit_status && call.exit_status !== 0 ? "warning" : "success";
  }
  if (call.status === "failed" || call.status === "rejected" || call.status === "pending_approval") {
    return "danger";
  }
  if (call.status === "pending_user_input") {
    return "running";
  }
  return "muted";
}

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${durationMs.toString()} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function formatReasoningLevel(level: string) {
  switch (level.trim().toLowerCase().replace(/[\s-]+/g, "_")) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "xhigh":
    case "x_high":
    case "very_high":
    case "highest":
    case "max":
    case "maximum":
    case "ultra":
      return "最高";
    case "enabled":
    case "enable":
    case "on":
    case "true":
      return "开启";
    case "disabled":
    case "disable":
    case "off":
    case "false":
    case "none":
      return "关闭";
    default:
      return level;
  }
}

function reasoningLevelIcon(level: string): ReactNode {
  const normalized = level.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return <ReasoningBrainIcon level={normalized} />;
}

function ReasoningBrainIcon({ level }: { level: string }) {
  const folds =
    level === "low"
      ? 1
      : level === "medium"
        ? 2
        : level === "high"
          ? 3
          : ["xhigh", "x_high", "very_high", "highest", "max", "maximum", "ultra"].includes(level)
            ? 4
            : ["enabled", "enable", "on", "true"].includes(level)
              ? 2
              : 0;
  const disabled = ["disabled", "disable", "off", "false", "none"].includes(level);

  return (
    <svg
      className={`ui-icon ai-reasoning-icon ai-reasoning-icon-${level}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 18V5" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
      {folds >= 2 ? <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" /> : null}
      {folds >= 3 ? <path d="M7.1 9.2c1 .2 1.7.8 2 1.7M16.9 9.2c-1 .2-1.7.8-2 1.7" /> : null}
      {folds >= 4 ? <path d="M7.2 14.7c1.1-.1 1.9.4 2.3 1.4M16.8 14.7c-1.1-.1-1.9.4-2.3 1.4" /> : null}
      {disabled ? <path d="m5 5 14 14" /> : null}
    </svg>
  );
}

function tailByChars(content: string, maxChars: number) {
  const chars = Array.from(content);
  return chars.length <= maxChars ? content : chars.slice(chars.length - maxChars).join("");
}

function formatAiError(error: unknown) {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || "AI 操作失败。");
  }
  return error instanceof Error ? error.message : "AI 操作失败。";
}
