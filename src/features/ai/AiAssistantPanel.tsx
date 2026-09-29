import {
  Activity,
  Ban,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  CornerDownLeft,
  FileText,
  History,
  ListPlus,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Send,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { copyTextToClipboard } from "../../shared/clipboard";
import {
  aiChatSessionClear,
  aiChatSessionDelete,
  aiChatSessionGet,
  aiChatSessionList,
  aiChatStreamStart,
  aiChatStreamStop,
  aiChatToolDecision,
  aiCommandAssess,
  aiProviderConfigList,
} from "../../shared/tauri/commands";
import { listenAiChatStream } from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { AppSelect, type AppSelectOption } from "../../shared/ui/AppSelect";
import { AnchoredSurfacePortal } from "../../shared/ui/AnchoredSurfacePortal";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../shared/ui/Tooltip";
import type { CommandHistoryEntry } from "../commands/commandLibraryTypes";
import type { ConnectionProfile } from "../connections/connectionTypes";
import { keyboardEventMatchesShortcut } from "../shortcuts/shortcutKeys";
import { AiModelPicker } from "./AiModelPicker";
import type {
  AiChatMessage,
  AiChatSessionSummary,
  AiCommandAssessment,
  AiCommandSuggestion,
  AiContextBlock,
  AiExecutionMode,
  AiProviderConfig,
  AiProviderModelOption,
  AiToolCallRecord,
} from "./aiTypes";

interface AiAssistantPanelProps {
  active: boolean;
  commandDraft: string;
  connection: ConnectionProfile | null;
  connections: ConnectionProfile[];
  contextRequestKey?: number;
  initialContexts?: AiContextBlock[];
  recentCommands: CommandHistoryEntry[];
  recentTerminalOutput?: string | null;
  sendShortcutBinding?: string | null;
  terminalDirectory?: string | null;
  terminalTitle?: string | null;
  onInsertCommand: (command: string) => void;
  onOpenSettings: () => void;
  onSaveCommand: (command: string) => void;
  onSendCommand: (command: string) => Promise<void>;
}

interface StreamState {
  assistantMessageId: string;
  sessionId: string;
  streamId: string;
}

const selectedProviderStorageKey = "mxterm.ai.selectedProviderConfigId";
const agentTerminalOutputLimit = 20000;
const HISTORY_SCOPE_CURRENT = "__current__";
const HISTORY_SCOPE_ALL = "__all__";
const HISTORY_SCOPE_NONE = "__none__";

export function AiAssistantPanel({
  active,
  commandDraft,
  connection,
  connections,
  contextRequestKey = 0,
  initialContexts = [],
  recentCommands,
  recentTerminalOutput,
  sendShortcutBinding,
  terminalDirectory,
  terminalTitle,
  onInsertCommand,
  onOpenSettings,
  onSaveCommand,
  onSendCommand,
}: AiAssistantPanelProps) {
  const runtimeAvailable = hasTauriRuntime();
  const [providerConfigs, setProviderConfigs] = useState<AiProviderConfig[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(() =>
    window.localStorage.getItem(selectedProviderStorageKey) || "",
  );
  const [sessions, setSessions] = useState<AiChatSessionSummary[]>([]);
  const [historyScopeChoice, setHistoryScopeChoice] = useState(HISTORY_SCOPE_CURRENT);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [contextBlocks, setContextBlocks] = useState<AiContextBlock[]>([]);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyScopeOpen, setHistoryScopeOpen] = useState(false);
  const [historyScopeQuery, setHistoryScopeQuery] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const loadingRef = useRef(false);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const contextTriggerRef = useRef<HTMLButtonElement | null>(null);
  const messageListRef = useRef<HTMLElement | null>(null);
  const streamStateRef = useRef<StreamState | null>(null);
  const lastContextRequestKeyRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeleteSession, setPendingDeleteSession] =
    useState<AiChatSessionSummary | null>(null);
  const [clearSessionOpen, setClearSessionOpen] = useState(false);
  const [pendingDangerousCommand, setPendingDangerousCommand] =
    useState<AiCommandAssessment | null>(null);
  const [agentMode, setAgentMode] = useState<AiExecutionMode>("execute");
  const [decidingToolCallIds, setDecidingToolCallIds] = useState<string[]>([]);
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Record<string, boolean>>({});
  const [selectedModel, setSelectedModel] = useState("");
  const [reasoningLevels, setReasoningLevels] = useState<string[]>([]);
  const [selectedReasoningLevel, setSelectedReasoningLevel] = useState("");
  const skipModelResetRef = useRef(false);

  const agentModeAvailable = Boolean(connection);
  const effectiveAgentMode: AiExecutionMode = agentModeAvailable ? agentMode : "chat";
  const agentModeEnabled = effectiveAgentMode !== "chat" && agentModeAvailable;
  const agentModeOptions: Array<AppSelectOption<AiExecutionMode>> = [
    {
      value: "chat",
      label: "对话",
      icon: <Bot className="ui-icon ai-agent-mode-icon ai-agent-mode-chat" aria-hidden="true" />,
    },
    {
      value: "assist",
      label: "辅助排查",
      icon: <Terminal className="ui-icon ai-agent-mode-icon ai-agent-mode-assist" aria-hidden="true" />,
    },
    {
      value: "execute",
      label: "执行",
      icon: <Zap className="ui-icon ai-agent-mode-icon ai-agent-mode-execute" aria-hidden="true" />,
    },
    {
      value: "full",
      label: "完全访问",
      icon: (
        <span className="ai-agent-mode-full-icons" aria-hidden="true">
          <Plus className="ui-icon" />
          <ShieldAlert className="ui-icon" />
        </span>
      ),
    },
  ];
  const agentModeDescription = !agentModeAvailable
    ? "仅 SSH 会话可用：连接后可选择命令执行模式"
    : effectiveAgentMode === "chat"
      ? "仅对话和建议，不执行命令"
      : effectiveAgentMode === "assist"
        ? "仅执行低风险排查命令，高风险命令会拒绝"
        : effectiveAgentMode === "full"
          ? "完全访问：AI 可执行高风险命令，请确认当前连接"
          : "执行排查命令，高风险命令会先请你确认";
  const currentHostScope = connection
    ? `${connection.username}@${connection.host}:${connection.port}`
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
    Boolean(streamState) || loading || !selectedProvider || input.trim().length === 0;
  useEffect(() => {
    streamStateRef.current = streamState;
  }, [streamState]);
  useEffect(() => {
    if (!historyOpen) {
      setHistoryScopeOpen(false);
      setHistoryScopeQuery("");
    }
  }, [historyOpen]);

  function setCurrentStreamState(next: StreamState | null) {
    streamStateRef.current = next;
    setStreamState(next);
  }

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [messages, streamState]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void reloadProviderConfigs();
    void reloadSessions();
  }, [active]);

  useEffect(() => {
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
  }, [providerConfigs, selectedProviderId]);

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
    setSelectedModel(provider?.model ?? "");
  }, [providerConfigs, selectedProviderId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenAiChatStream((event) => {
      if (disposed) {
        return;
      }
      const current = streamStateRef.current;
      if (!current || event.stream_id !== current.streamId) {
        return;
      }
      if (event.kind === "tool_call") {
        const record = event.tool_call;
        if (!record) {
          return;
        }
        setMessages((items) =>
          items.map((message) =>
            message.id === event.message_id
              ? { ...message, tool_calls: upsertToolCall(message.tool_calls, record) }
              : message,
          ),
        );
        return;
      }
      if (event.kind === "chunk") {
        const delta = event.delta || "";
        setMessages((items) =>
          items.map((message) =>
            message.id === event.message_id
              ? { ...message, content: `${message.content}${delta}`, status: "streaming" }
              : message,
          ),
        );
        return;
      }
      if (event.kind === "finished" || event.kind === "stopped" || event.kind === "error") {
        setMessages((items) =>
          items.map((message) =>
            message.id === event.message_id
              ? {
                  ...message,
                  commands: extractCommandSuggestions(event.content || message.content),
                  content: event.content ?? message.content,
                  status:
                    event.kind === "finished"
                      ? "complete"
                      : event.kind === "stopped"
                        ? "stopped"
                        : "error",
                }
              : message,
          ),
        );
        setCurrentStreamState(null);
        if (event.kind === "error") {
          setError(event.error || "AI 回复失败。");
        } else if (event.kind === "stopped") {
          setNotice("已停止生成，当前内容已保留。");
        }
        void reloadSessions();
      }
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(formatAiError(nextError));
        }
      });
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!contextRequestKey || contextRequestKey === lastContextRequestKeyRef.current) {
      return;
    }
    lastContextRequestKeyRef.current = contextRequestKey;
    appendContextBlocks(initialContexts);
  }, [contextRequestKey, initialContexts]);

  async function reloadProviderConfigs() {
    if (!runtimeAvailable) {
      setProviderConfigs([]);
      return;
    }
    try {
      const configs = await aiProviderConfigList();
      setProviderConfigs(configs);
      setError(null);
    } catch (nextError) {
      setError(formatAiError(nextError));
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
    if (streamStateRef.current || loadingRef.current) {
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
    if (!normalizedContent) {
      setError("请输入问题。");
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setNotice(null);
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
        agent:
          agentModeEnabled && connection
            ? {
                connection_id: connection.id,
                mode: effectiveAgentMode,
                working_directory: terminalDirectory || null,
                terminal_output: terminalOutput
                  ? tailByChars(terminalOutput, agentTerminalOutputLimit)
                  : null,
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

  async function decideToolCall(call: AiToolCallRecord, approved: boolean) {
    const current = streamStateRef.current;
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
  }

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
      const currentStream = streamStateRef.current;
      if (currentStream?.sessionId === pendingDeleteSession.id) {
        await aiChatStreamStop(currentStream.streamId).catch(() => undefined);
        setCurrentStreamState(null);
      }
      await aiChatSessionDelete(pendingDeleteSession.id);
      if (activeSessionId === pendingDeleteSession.id) {
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
    if (streamStateRef.current) {
      setError("请先停止生成，再清空当前会话。");
      setClearSessionOpen(false);
      return;
    }
    try {
      const cleared = await aiChatSessionClear(activeSessionId);
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

  async function copyMessage(content: string) {
    try {
      await copyTextToClipboard(content);
      setNotice("消息已复制。");
    } catch {
      setError("复制消息失败。");
    }
  }

  async function copyCommand(command: string) {
    try {
      await copyTextToClipboard(command);
      setNotice("命令已复制。");
    } catch {
      setError("复制命令失败。");
    }
  }

  async function requestSendCommand(command: string) {
    setError(null);
    const assessment = runtimeAvailable
      ? await aiCommandAssess(command).catch(() => assessCommandLocally(command))
      : assessCommandLocally(command);
    if (assessment.risk === "dangerous") {
      setPendingDangerousCommand(assessment);
      return;
    }
    await runSendCommand(command);
  }

  async function runSendCommand(command: string) {
    try {
      await onSendCommand(command);
      setNotice("命令已发送到终端。");
    } catch (nextError) {
      setError(formatAiError(nextError));
    }
  }

  function appendContextBlocks(blocks: AiContextBlock[]) {
    if (blocks.length === 0) {
      return;
    }
    setContextBlocks((current) => {
      const next = [...current];
      blocks.forEach((block) => {
        if (
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

  return (
    <section className="ai-assistant-tool" aria-label="AI">
      <header className="ai-assistant-head">
        <div className="ai-assistant-title">
          <Bot className="ui-icon" aria-hidden="true" />
          <span>
            <strong>AI</strong>
            <small>终端排障与命令生成</small>
          </span>
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
        open={historyOpen}
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

      {!runtimeAvailable ? (
        <p className="ai-inline-notice">桌面端才能保存配置和调用模型。</p>
      ) : null}
      {providerConfigs.length === 0 ? (
        <div className="ai-config-empty">
          <strong>还没有 AI 配置</strong>
          <span>添加配置名称、接入模式、API Key、请求地址和模型后即可开始对话。</span>
          <button className="primary-button" type="button" onClick={onOpenSettings}>
            <Settings className="ui-icon" aria-hidden="true" />
            <span>打开 AI 设置</span>
          </button>
        </div>
      ) : null}

      <section className="ai-message-list" aria-label="AI 对话" ref={messageListRef}>
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <Terminal className="ui-icon" aria-hidden="true" />
            <strong>描述现象，或把终端输出放进上下文。</strong>
            <span>{agentModeDescription}</span>
          </div>
        ) : (
          messages.map((message) => {
            const showStatus =
              Boolean(message.status) && message.status !== "complete";
            const contextsNode =
              message.contexts.length > 0 ? (
                <div className="ai-message-contexts">
                  {message.contexts.map((block) => (
                    <span key={block.id}>{block.title}</span>
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
                    {message.tool_calls.length > 0 ? (
                      renderAssistantWithToolCalls(message)
                    ) : (
                      <div className="ai-message-content">
                        {message.content
                          ? renderMarkdownContent(message.content)
                          : "..."}
                      </div>
                    )}
                    {renderCommandSuggestions(message)}
                  </>
                )}
                <div className="ai-message-meta">
                  <Tooltip label="复制">
                    <button
                      type="button"
                      aria-label="复制消息"
                      className="ai-message-meta-button"
                      onClick={() => void copyMessage(message.content)}
                    >
                      <Copy className="ui-icon" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <time>{formatMessageTime(message.created_at)}</time>
                </div>
              </article>
            );
          })
        )}
      </section>

      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      {notice ? <p className="ai-notice" role="status">{notice}</p> : null}

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
                    <span className="ai-compose-context-chip-label">
                      <strong>{block.title}</strong>
                      <small>{block.source} · {block.line_count.toString()} 行 · {block.char_count.toString()} 字</small>
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
                  menuMinWidth={172}
                  options={agentModeOptions.map((option) => ({
                    ...option,
                    disabled: option.value !== "chat" && !agentModeAvailable,
                  }))}
                  value={effectiveAgentMode}
                  onChange={(value) => setAgentMode(value)}
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
              <Tooltip label="思考等级（由模型接口提供）">
                <AppSelect
                  ariaLabel="思考等级"
                  className="ai-reasoning-select"
                  disabled={Boolean(streamState)}
                  menuMinWidth={112}
                  options={reasoningOptions}
                  placeholder="思考"
                  value={selectedReasoningLevel}
                  onChange={setSelectedReasoningLevel}
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
        desiredHeight={220}
        minHeight={120}
        open={contextMenuOpen}
        role="menu"
        side="top"
        width={204}
        onOpenChange={setContextMenuOpen}
      >
        <div className="ai-context-menu-title">添加上下文</div>
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

      <ConfirmDialog
        open={Boolean(pendingDeleteSession)}
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
        open={clearSessionOpen}
        title="清空当前 AI 会话"
        description="会删除当前会话内的消息记录，但保留会话入口。"
        confirmLabel="清空"
        onConfirm={clearCurrentSession}
        onOpenChange={setClearSessionOpen}
      />
      <ConfirmDialog
        open={Boolean(pendingDangerousCommand)}
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
    </section>
  );

  function renderAssistantWithToolCalls(message: AiChatMessage) {
    const chars = Array.from(message.content);
    const calls = [...message.tool_calls].sort((left, right) => left.text_offset - right.text_offset);
    const nodes: ReactNode[] = [];
    let cursor = 0;
    calls.forEach((call) => {
      const offset = Math.min(Math.max(call.text_offset, cursor), chars.length);
      const text = chars.slice(cursor, offset).join("");
      if (text.trim()) {
        nodes.push(
          <div className="ai-message-content" key={`text-${call.id}`}>
            {renderMarkdownContent(text)}
          </div>,
        );
      }
      nodes.push(renderToolCallCard(call));
      cursor = offset;
    });
    const rest = chars.slice(cursor).join("");
    if (rest.trim()) {
      nodes.push(
        <div className="ai-message-content" key="text-rest">
          {renderMarkdownContent(rest)}
        </div>,
      );
    } else if (message.status === "streaming" && !calls.some(isToolCallActive)) {
      nodes.push(
        <div className="ai-message-content" key="text-pending">
          ...
        </div>,
      );
    }
    return <div className="ai-message-flow">{nodes}</div>;
  }

  function renderToolCallCard(call: AiToolCallRecord) {
    const pending = call.status === "pending_approval";
    const deciding = decidingToolCallIds.includes(call.id);
    const danger = pending || call.risk === "dangerous";
    const ToolIcon =
      call.name === "server_monitor" ? Activity : call.name === "read_terminal_output" ? FileText : Terminal;
    const expanded = expandedToolCallIds[call.id] ?? pending;
    const detailId = `ai-tool-detail-${call.id}`;
    const outputMeta = [
      call.exit_status !== null && call.exit_status !== undefined
        ? `退出码 ${call.exit_status.toString()}`
        : null,
      call.duration_ms !== null && call.duration_ms !== undefined ? formatDuration(call.duration_ms) : null,
      call.output_truncated ? "仅显示末尾" : null,
    ].filter(Boolean);
    return (
      <article
        className={`ai-tool-card ${expanded ? "expanded" : ""} ${danger ? "danger" : ""}`}
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
          <span className="ai-tool-label">{formatToolCallTitle(call.name)}</span>
          <span className="ai-tool-summary-text">{formatToolCallSummary(call)}</span>
          <span className={`ai-tool-status ${toolCallStatusTone(call)}`}>
            {call.status === "running" ? (
              <LoaderCircle className="ui-icon ai-tool-spinner" aria-hidden="true" />
            ) : pending ? (
              <ShieldAlert className="ui-icon" aria-hidden="true" />
            ) : null}
            {formatToolCallStatus(call)}
          </span>
        </button>
        {expanded ? (
          <div className="ai-tool-detail" id={detailId}>
            {call.name === "run_command" && call.command ? <code>{call.command}</code> : null}
            {pending && call.reasons.length > 0 ? <p>{call.reasons.join("；")}</p> : null}
            {call.error ? <p>{call.error}</p> : null}
            {call.output ? (
              <div className="ai-tool-output">
                <small className="ai-tool-meta">{["输出", ...outputMeta].join(" · ")}</small>
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
  }

  function renderCommandSuggestions(message: AiChatMessage) {
    const suggestions = extractCommandSuggestions(message.content);
    if (suggestions.length === 0) {
      return null;
    }
    return (
      <div className="ai-command-suggestions">
        {suggestions.map((suggestion, index) => (
          <article
            className={`ai-command-card ${suggestion.risk === "dangerous" ? "danger" : ""}`}
            key={`${message.id}-${index.toString()}`}
          >
            <header>
              <strong>命令建议</strong>
              {suggestion.risk === "dangerous" ? (
                <span>
                  <ShieldAlert className="ui-icon" aria-hidden="true" />
                  高风险
                </span>
              ) : null}
            </header>
            <code>{suggestion.command}</code>
            {suggestion.reasons.length > 0 ? (
              <p>{suggestion.reasons.join("；")}</p>
            ) : null}
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
  }
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

function isToolCallActive(call: AiToolCallRecord) {
  return call.status === "running" || call.status === "pending_approval";
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
  return "";
}

function formatToolCallStatus(call: AiToolCallRecord) {
  switch (call.status) {
    case "pending_approval":
      return "待确认";
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
