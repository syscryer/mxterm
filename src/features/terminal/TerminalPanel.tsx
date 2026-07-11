import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme, type IWindowsPty } from "@xterm/xterm";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Bot,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  RefreshCw,
  ScanText,
  Search,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import type { ConnectionProfile } from "../connections/connectionTypes";
import {
  terminalClose,
  terminalConnect,
  terminalResize,
  terminalWrite,
} from "../../shared/tauri/commands";
import { copyTextToClipboard, readTextFromClipboard } from "../../shared/clipboard";
import {
  listenTerminalConnectProgress,
  listenTerminalOutput,
  listenTerminalStateChanged,
} from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import { extractOsc7Directories } from "./osc7";
import {
  applyTerminalInputDirectoryData,
  createTerminalInputDirectoryState,
  inferRemoteHomeDirectory,
} from "./terminalInputDirectory";
import { promptSnapshotLinesToDirectory } from "./terminalPromptDirectory";
import {
  createTerminalSemanticHighlighter,
  getTerminalSemanticHighlightPalette,
  type TerminalSemanticHighlighter,
} from "./terminalSemanticHighlight";
import { normalizeStartupOutput } from "./terminalStartupOutput";
import { Tooltip } from "../../shared/ui/Tooltip";
import type { TerminalCursorStyle } from "../settings/settingsTypes";

const TERMINAL_SCROLLBAR_WIDTH = 6;
const STARTUP_OUTPUT_BUFFER_MS = 250;
const TERMINAL_OUTPUT_BATCH_MAX_WAIT_MS = 16;
const PROMPT_DIRECTORY_FAST_SNAPSHOT_LOOKBACK_ROWS = 1000;
const PROMPT_DIRECTORY_ANCHOR_SNAPSHOT_LOOKBACK_ROWS = 2000;
// Debounce window for fit() + backend PTY sync during drag. Both must share one
// beat: fitting xterm immediately while deferring the PTY resize leaves a window
// where xterm and the shell disagree on cols/rows and output reflows wrongly.
const TERMINAL_RESIZE_SYNC_DEBOUNCE_MS = 120;

export interface TerminalSearchNavigationRequest {
  direction: "next" | "previous";
  id: number;
  tabId: string;
}

export type TerminalPromptDirectorySnapshotReader = () => string | null;

interface TerminalPanelProps {
  active: boolean;
  className?: string;
  clearRequestId?: number;
  connection: ConnectionProfile | null;
  autoConnect?: boolean;
  ctrlVPaste?: boolean;
  cursorBlink?: boolean;
  cursorStyle?: TerminalCursorStyle;
  fontFamily: string;
  fontSize: number;
  initialOutput?: number[];
  initialRequestId?: string;
  initialSessionId: string;
  layoutRevision?: number;
  onPaneFocus?: () => void;
  searchCaseSensitive?: boolean;
  searchNavigationRequest?: TerminalSearchNavigationRequest | null;
  searchOpen?: boolean;
  searchQuery?: string;
  style?: CSSProperties;
  onWarmupCaptureReady?: (tabId: string) => void;
  tabId: string;
  theme: ITheme;
  title: string;
  visible?: boolean;
  windowsPty?: IWindowsPty;
  onCurrentDirectoryChange?: (tabId: string, path: string) => void;
  onPromptDirectorySnapshotChange?: (
    tabId: string,
    reader: TerminalPromptDirectorySnapshotReader | null,
  ) => void;
  onSearchCaseSensitiveToggle?: (tabId: string) => void;
  onSearchClose?: (tabId: string) => void;
  onSearchQueryChange?: (tabId: string, query: string) => void;
  onRecentOutput?: (tabId: string, output: string) => void;
  onSendSelectionToAi?: (tabId: string, selectedText: string) => void;
  onSessionIdChange?: (tabId: string, sessionId: string, requestId?: string) => void;
  onStatusChange: (tabId: string, status: string) => void;
  onTerminalInputCommand?: (tabId: string, command: string) => void;
  onUserInput?: (tabId: string, data: string) => void;
}

export function TerminalPanel({
  active,
  className,
  clearRequestId = 0,
  connection,
  autoConnect = true,
  ctrlVPaste = true,
  cursorBlink = true,
  cursorStyle = "block",
  fontFamily,
  fontSize,
  initialOutput = [],
  initialRequestId,
  initialSessionId,
  layoutRevision = 0,
  onCurrentDirectoryChange,
  onPromptDirectorySnapshotChange,
  onPaneFocus,
  onRecentOutput,
  onSearchClose,
  onSearchCaseSensitiveToggle,
  onSearchQueryChange,
  onSendSelectionToAi,
  onSessionIdChange,
  onStatusChange,
  onTerminalInputCommand,
  onUserInput,
  onWarmupCaptureReady,
  searchCaseSensitive = false,
  searchNavigationRequest = null,
  searchOpen = false,
  searchQuery = "",
  style,
  tabId,
  theme,
  title,
  visible = active,
  windowsPty,
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const semanticHighlighterRef = useRef<TerminalSemanticHighlighter | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(initialRequestId || tabId);
  const osc7BufferRef = useRef("");
  const inputDirectoryStateRef = useRef(createTerminalInputDirectoryState());
  const inputHistoryStateRef = useRef(createTerminalInputHistoryState());
  const homeDirectoryRef = useRef<string | null>(null);
  const initialOutputWrittenLengthRef = useRef(0);
  const startedRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  const onWarmupCaptureReadyRef = useRef(onWarmupCaptureReady);
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  const onTerminalInputCommandRef = useRef(onTerminalInputCommand);
  const onUserInputRef = useRef(onUserInput);
  const reconnectingPreviousSessionIdRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const startupOutputBufferRef = useRef("");
  const startupOutputBufferingRef = useRef(false);
  const startupOutputFlushTimerRef = useRef<number | null>(null);
  const terminalOutputListenerReadyRef = useRef(false);
  const listenersReadyRef = useRef(!hasTauriRuntime());
  const terminalOutputWriterRef = useRef<((decoded: string) => void) | null>(null);
  const pendingOutputBufferRef = useRef("");
  const pendingOutputFrameRef = useRef<number | null>(null);
  const pendingOutputTimerRef = useRef<number | null>(null);
  const lastSyncedSizeRef = useRef<string | null>(null);
  const pendingResizeTimerRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const initialWindowsPtyRef = useRef(windowsPty);
  const ctrlVPasteRef = useRef(ctrlVPaste);
  const suppressNextNativePasteRef = useRef(false);
  const lastSearchNavigationRequestIdRef = useRef<number | null>(null);
  const lastClearRequestIdRef = useRef(0);
  const previousSearchOpenRef = useRef(searchOpen);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [listenersReady, setListenersReady] = useState(!hasTauriRuntime());
  const [contextMenuSelection, setContextMenuSelection] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [searchResultLabel, setSearchResultLabel] = useState("");
  const [status, setStatus] = useState(connection ? "待连接" : "空闲");

  useEffect(() => {
    onWarmupCaptureReadyRef.current = onWarmupCaptureReady;
  }, [onWarmupCaptureReady]);

  useEffect(() => {
    onSessionIdChangeRef.current = onSessionIdChange;
  }, [onSessionIdChange]);

  useEffect(() => {
    onTerminalInputCommandRef.current = onTerminalInputCommand;
  }, [onTerminalInputCommand]);

  useEffect(() => {
    onUserInputRef.current = onUserInput;
  }, [onUserInput]);

  useEffect(() => {
    ctrlVPasteRef.current = ctrlVPaste;
  }, [ctrlVPaste]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    listenersReadyRef.current = listenersReady;
  }, [listenersReady]);

  useEffect(() => {
    onStatusChange(tabId, status);
  }, [onStatusChange, status, tabId]);

  useEffect(() => {
    const homeDirectory = inferRemoteHomeDirectory(connection?.username);
    homeDirectoryRef.current = homeDirectory;
    inputDirectoryStateRef.current = createTerminalInputDirectoryState({
      currentDirectory: null,
      homeDirectory,
    });
  }, [connection?.id, connection?.username]);

  useEffect(() => {
    if (!onPromptDirectorySnapshotChange) {
      return;
    }

    onPromptDirectorySnapshotChange(tabId, () =>
      readPromptDirectorySnapshot(
        terminalRef.current,
        homeDirectoryRef.current,
        inputDirectoryStateRef.current.directory,
      ),
    );
    return () => onPromptDirectorySnapshotChange(tabId, null);
  }, [onPromptDirectorySnapshotChange, tabId]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    activeRequestIdRef.current = initialRequestId || tabId;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink,
      cursorStyle,
      fontFamily,
      fontSize,
      overviewRuler: {
        width: TERMINAL_SCROLLBAR_WIDTH,
      },
      scrollback: 8000,
      theme: withTerminalChromeTheme(theme),
      windowsPty: resolveWindowsPtyOption(initialWindowsPtyRef.current),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());
    // Activate Unicode 11 width rules so xterm's CJK/fullwidth/emoji width
    // calculation matches modern ConPTY (Windows 10+). Without this, xterm
    // falls back to the legacy Unicode 6 table, which disagrees with ConPTY on
    // wide-glyph widths and pushes the IME composition cursor / TUI input to
    // the wrong column. Requires allowProposedApi (already enabled above).
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";
    terminal.open(hostRef.current);
    const blockSuppressedNativePaste = (event: ClipboardEvent) => {
      if (!suppressNextNativePasteRef.current) {
        return;
      }
      suppressNextNativePasteRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    hostRef.current.addEventListener("paste", blockSuppressedNativePaste, true);
    // 开启模式下 xterm 会在 keydown 阶段把 Ctrl+V 解析成控制字符 \x16 并吞掉原生 paste，
    // 因此必须在 capture 阶段抢先拦截：阻止 xterm 处理，主动读剪贴板并写入终端。
    // 关闭模式仍由下方 attachCustomKeyEventHandler 处理（发送 \x16 交给 shell/Vim）。
    const interceptCtrlVPaste = (event: KeyboardEvent) => {
      if (!ctrlVPasteRef.current || !isTerminalPasteShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      // 浏览器可能仍会对这次 Ctrl+V 触发原生 paste，复用抑制机制避免双重输入。
      suppressNextNativePasteRef.current = true;
      window.setTimeout(() => {
        suppressNextNativePasteRef.current = false;
      }, 0);
      void readTextFromClipboard()
        .then((text) => {
          if (text) {
            terminal.paste(text);
          }
        })
        .catch(() => {});
    };
    hostRef.current.addEventListener("keydown", interceptCtrlVPaste, true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (isTerminalPasteShortcut(event) && !ctrlVPasteRef.current) {
        event.preventDefault();
        suppressNextNativePasteRef.current = true;
        window.setTimeout(() => {
          suppressNextNativePasteRef.current = false;
        }, 0);
        const activeSessionId = sessionIdRef.current;
        if (activeSessionId) {
          void terminalWrite(activeSessionId, "\x16").catch(() => {});
        }
        return false;
      }

      if (!isTerminalCopyShortcut(event) || !terminal.hasSelection()) {
        return true;
      }

      const selectedText = terminal.getSelection();
      if (!selectedText) {
        return true;
      }

      void copyTextToClipboard(selectedText).catch(() => {});
      return false;
    });
    const semanticHighlighter = createTerminalSemanticHighlighter(terminal, {
      palette: getTerminalSemanticHighlightPalette(theme),
    });
    semanticHighlighterRef.current = semanticHighlighter;
    fitAndSyncTerminalSize(terminal, fitAddon, sessionIdRef.current, lastSyncedSizeRef);
    startedRef.current = false;
    initialOutputWrittenLengthRef.current = 0;
    startupOutputBufferRef.current = "";
    startupOutputBufferingRef.current = Boolean(initialRequestId);

    const flushStartupOutput = () => {
      if (startupOutputFlushTimerRef.current !== null) {
        window.clearTimeout(startupOutputFlushTimerRef.current);
        startupOutputFlushTimerRef.current = null;
      }
      const bufferedOutput = startupOutputBufferRef.current;
      startupOutputBufferRef.current = "";
      if (terminalOutputListenerReadyRef.current) {
        onWarmupCaptureReadyRef.current?.(tabId);
      }
      startupOutputBufferingRef.current = false;
      if (bufferedOutput) {
        terminal.write(normalizeStartupOutput(bufferedOutput));
      }
    };

    const clearPendingOutputSchedule = () => {
      if (pendingOutputFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingOutputFrameRef.current);
        pendingOutputFrameRef.current = null;
      }
      if (pendingOutputTimerRef.current !== null) {
        window.clearTimeout(pendingOutputTimerRef.current);
        pendingOutputTimerRef.current = null;
      }
    };

    const flushPendingOutput = () => {
      clearPendingOutputSchedule();
      const bufferedOutput = pendingOutputBufferRef.current;
      pendingOutputBufferRef.current = "";
      if (bufferedOutput) {
        terminal.write(bufferedOutput);
      }
    };

    const scheduleTerminalWrite = (decoded: string) => {
      pendingOutputBufferRef.current += decoded;
      if (pendingOutputFrameRef.current !== null) {
        return;
      }
      pendingOutputFrameRef.current = window.requestAnimationFrame(flushPendingOutput);
      pendingOutputTimerRef.current = window.setTimeout(
        flushPendingOutput,
        TERMINAL_OUTPUT_BATCH_MAX_WAIT_MS,
      );
    };

    const writeDecodedOutput = (decoded: string) => {
      const currentDirectory = extractOsc7Directories(`${osc7BufferRef.current}${decoded}`);
      osc7BufferRef.current = currentDirectory.buffer;
      currentDirectory.paths.forEach((path) => {
        inputDirectoryStateRef.current = {
          ...inputDirectoryStateRef.current,
          directory: path,
        };
        onCurrentDirectoryChange?.(tabId, path);
      });
      if (startupOutputBufferingRef.current) {
        startupOutputBufferRef.current += decoded;
        onRecentOutput?.(tabId, decoded);
        return;
      }
      onRecentOutput?.(tabId, decoded);
      scheduleTerminalWrite(decoded);
    };

    terminalOutputWriterRef.current = writeDecodedOutput;
    const searchResultsDisposable = searchAddon.onDidChangeResults((event) => {
      setSearchResultLabel(formatSearchResultLabel(event.resultIndex, event.resultCount));
    });
    if (startupOutputBufferingRef.current) {
      startupOutputFlushTimerRef.current = window.setTimeout(
        flushStartupOutput,
        STARTUP_OUTPUT_BUFFER_MS,
      );
    }

    if (initialSessionId) {
      sessionIdRef.current = initialSessionId;
      setSessionId(initialSessionId);
      setStatus(hasTauriRuntime() ? "已连接" : "预览");
      if (initialOutput.length > 0) {
        writeDecodedOutput(decoderRef.current.decode(Uint8Array.from(initialOutput), { stream: true }));
        initialOutputWrittenLengthRef.current = initialOutput.length;
      }
      fitAndSyncTerminalSize(terminal, fitAddon, sessionIdRef.current, lastSyncedSizeRef);
    }

    const dataDisposable = terminal.onData((data) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        if (
          connection &&
          listenersReadyRef.current &&
          isTerminalEnterInput(data) &&
          !reconnectingRef.current
        ) {
          void reconnectCurrentTerminal();
        }
        return;
      }
      const inputDirectory = applyTerminalInputDirectoryData(
        inputDirectoryStateRef.current,
        data,
      );
      inputDirectoryStateRef.current = inputDirectory.state;
      if (inputDirectory.directory) {
        onCurrentDirectoryChange?.(tabId, inputDirectory.directory);
      }
      const inputHistory = applyTerminalInputHistoryData(inputHistoryStateRef.current, data);
      inputHistoryStateRef.current = inputHistory.state;
      onUserInputRef.current?.(tabId, data);
      void terminalWrite(activeSessionId, data)
        .then(() => {
          inputHistory.commands.forEach((command) => {
            onTerminalInputCommandRef.current?.(tabId, command);
          });
        })
        .catch((error) => {
          terminal.writeln(`\r\n输入发送失败: ${formatError(error)}`);
        });
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!activeRef.current) {
        return;
      }
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return;
      }
      // onResize is fired by fit(). fit() itself is debounced on the
      // ResizeObserver path, so any onResize reaching here is either from a
      // debounced fit (backend sync is handled by the same timer) or from a
      // synchronous imperative fit (font/active/init), which must sync to the
      // backend immediately to keep xterm and the PTY on the same size.
      syncTerminalSize(terminal, activeSessionId, cols, rows, lastSyncedSizeRef);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) {
        return;
      }
      // Window/pane dragging fires ResizeObserver every frame. We must NOT call
      // fitAddon.fit() on every frame: high-frequency fit() calls desync xterm's
      // canvas (cell width) from its logical buffer, producing the ghosting /
      // duplicated-glyph artifacts seen during drag. Debounce fit() together
      // with the backend sync so xterm and the PTY stay on the same size and
      // only update once after dragging settles.
      scheduleFitAndSyncTerminalSize(
        terminal,
        fitAddon,
        sessionIdRef.current,
        lastSyncedSizeRef,
        pendingResizeTimerRef,
      );
    });
    resizeObserver.observe(hostRef.current);

    let stopOutputListener: (() => void) | undefined;
    let stopStateListener: (() => void) | undefined;
    let stopProgressListener: (() => void) | undefined;
    let disposed = false;
    if (hasTauriRuntime()) {
      setListenersReady(false);
      terminalOutputListenerReadyRef.current = false;
      const outputListener = listenTerminalOutput((event) => {
        if (startupOutputBufferingRef.current && event.request_id === initialRequestId) {
          return;
        }
        if (!matchesTerminalEvent(event, sessionIdRef.current, activeRequestIdRef.current)) {
          return;
        }
        const decoded = decoderRef.current.decode(Uint8Array.from(event.data), { stream: true });
        writeDecodedOutput(decoded);
      });

      const stateListener = listenTerminalStateChanged((event) => {
        if (!matchesTerminalEvent(event, sessionIdRef.current, activeRequestIdRef.current)) {
          return;
        }
        sessionIdRef.current = null;
        setSessionId(null);
        const suffix =
          event.exit_status === null ? "" : `，退出码 ${event.exit_status.toString()}`;
        setStatus(`已断开${suffix}`);
        terminal.writeln(
          `\r\n[会话已断开${suffix}${connection ? "，按 Enter 重新连接" : ""}]`,
        );
      });

      const progressListener = listenTerminalConnectProgress((event) => {
        if (event.request_id !== activeRequestIdRef.current) {
          return;
        }
        terminal.writeln(`\r\n${event.message}`);
      });

      void Promise.all([outputListener, stateListener, progressListener]).then(
        ([unlistenOutput, unlistenState, unlistenProgress]) => {
          if (disposed) {
            unlistenOutput();
            unlistenState();
            unlistenProgress();
            return;
          }
          stopOutputListener = unlistenOutput;
          stopStateListener = unlistenState;
          stopProgressListener = unlistenProgress;
          terminalOutputListenerReadyRef.current = true;
          if (!startupOutputBufferingRef.current) {
            onWarmupCaptureReadyRef.current?.(tabId);
          }
          setListenersReady(true);
        },
      ).catch((error: unknown) => {
        if (disposed) {
          return;
        }
        setStatus("事件监听失败");
        terminal.writeln(`\r\n事件监听初始化失败: ${formatError(error)}`);
      });
    }

    return () => {
      disposed = true;
      // 终端会话由标签关闭流程统一回收，分屏移动不能中断 PTY。
      reconnectingPreviousSessionIdRef.current = null;
      stopOutputListener?.();
      stopStateListener?.();
      stopProgressListener?.();
      suppressNextNativePasteRef.current = false;
      if (startupOutputFlushTimerRef.current !== null) {
        window.clearTimeout(startupOutputFlushTimerRef.current);
        startupOutputFlushTimerRef.current = null;
      }
      startupOutputBufferRef.current = "";
      startupOutputBufferingRef.current = false;
      terminalOutputListenerReadyRef.current = false;
      pendingOutputBufferRef.current = "";
      clearPendingOutputSchedule();
      terminalOutputWriterRef.current = null;
      clearPendingTerminalResizeSync(pendingResizeTimerRef);
      hostRef.current?.removeEventListener("paste", blockSuppressedNativePaste, true);
      hostRef.current?.removeEventListener("keydown", interceptCtrlVPaste, true);
      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      searchResultsDisposable.dispose();
      semanticHighlighter.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      semanticHighlighterRef.current = null;
    };
  }, [tabId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const searchAddon = searchAddonRef.current;
    if (!terminal || !searchAddon) {
      return;
    }

    const trimmedQuery = searchQuery.trim();
    if (!searchOpen) {
      searchAddon.clearDecorations();
      setSearchResultLabel("");
      if (active) {
        terminal.focus();
      }
      return;
    }

    if (!trimmedQuery) {
      searchAddon.clearDecorations();
      setSearchResultLabel("");
      return;
    }

    const found = searchAddon.findNext(searchQuery, getTerminalSearchOptions(searchCaseSensitive, true));
    if (!found) {
      setSearchResultLabel("无匹配");
    }
  }, [active, searchCaseSensitive, searchOpen, searchQuery]);

  useEffect(() => {
    if (searchOpen && !previousSearchOpenRef.current) {
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
    previousSearchOpenRef.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    if (!clearRequestId || lastClearRequestIdRef.current === clearRequestId) {
      return;
    }
    lastClearRequestIdRef.current = clearRequestId;
    terminalRef.current?.clear();
    terminalRef.current?.scrollToBottom();
  }, [clearRequestId]);

  useEffect(() => {
    if (
      !searchNavigationRequest ||
      searchNavigationRequest.tabId !== tabId ||
      lastSearchNavigationRequestIdRef.current === searchNavigationRequest.id ||
      !searchOpen
    ) {
      return;
    }

    lastSearchNavigationRequestIdRef.current = searchNavigationRequest.id;
    if (searchNavigationRequest.direction === "previous") {
      findPreviousTerminalSearch(
        searchAddonRef.current,
        searchQuery,
        searchCaseSensitive,
        setSearchResultLabel,
      );
      return;
    }

    findNextTerminalSearch(
      searchAddonRef.current,
      searchQuery,
      searchCaseSensitive,
      setSearchResultLabel,
    );
  }, [searchCaseSensitive, searchNavigationRequest, searchOpen, searchQuery, tabId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !initialSessionId) {
      return;
    }

    const writtenLength = initialOutputWrittenLengthRef.current;
    if (initialOutput.length <= writtenLength) {
      return;
    }

    const nextBytes = initialOutput.slice(writtenLength);
    const decoded = decoderRef.current.decode(Uint8Array.from(nextBytes), { stream: true });
    const writeOutput = terminalOutputWriterRef.current;
    if (writeOutput) {
      writeOutput(decoded);
    } else {
      terminal.write(decoded);
    }
    initialOutputWrittenLengthRef.current = initialOutput.length;
  }, [initialOutput, initialSessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = withTerminalChromeTheme(theme);
    semanticHighlighterRef.current?.setPalette(getTerminalSemanticHighlightPalette(theme));
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontFamily === fontFamily) {
      return;
    }

    terminal.options.fontFamily = fontFamily;
    fitAndSyncTerminalSize(terminal, fitAddonRef.current, sessionIdRef.current, lastSyncedSizeRef);
  }, [fontFamily]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSize) {
      return;
    }

    terminal.options.fontSize = fontSize;
    fitAndSyncTerminalSize(terminal, fitAddonRef.current, sessionIdRef.current, lastSyncedSizeRef);
  }, [fontSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.cursorStyle === cursorStyle) {
      return;
    }

    terminal.options.cursorStyle = cursorStyle;
  }, [cursorStyle]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.cursorBlink === cursorBlink) {
      return;
    }

    terminal.options.cursorBlink = cursorBlink;
  }, [cursorBlink]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (
      !terminal ||
      !fitAddon ||
      !connection ||
      !autoConnect ||
      !listenersReady ||
      startedRef.current ||
      initialSessionId
    ) {
      return;
    }

    startedRef.current = true;
    if (!hasTauriRuntime()) {
      setStatus("预览");
      terminal.writeln("\r\n普通浏览器预览中不会发起真实 SSH 连接。");
      return;
    }

    const connectRequestId = tabId;
    activeRequestIdRef.current = connectRequestId;
    fitAndSyncTerminalSize(terminal, fitAddon, sessionIdRef.current, lastSyncedSizeRef);
    terminal.clear();
    terminal.writeln(`连接 ${connection.username}@${connection.host}:${connection.port} ...`);
    setStatus("连接中");

    void terminalConnect({
      cols: terminal.cols,
      connection_id: connection.id,
      host: connection.host,
      password: connection.password || undefined,
      port: connection.port,
      private_key_path: connection.private_key_path || undefined,
      private_key_passphrase: connection.private_key_passphrase || undefined,
      request_id: connectRequestId,
      rows: terminal.rows,
      username: connection.username,
    })
      .then((nextSessionId) => {
        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        onSessionIdChangeRef.current?.(tabId, nextSessionId, connectRequestId);
        setStatus("已连接");
        terminal.focus();
      })
      .catch((error) => {
        setSessionId(null);
        setStatus("连接失败");
        terminal.writeln(`\r\n连接失败: ${formatError(error)}`);
      });
  }, [autoConnect, connection, listenersReady, tabId]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      const terminal = terminalRef.current;
      if (terminal) {
        fitAndSyncTerminalSize(terminal, fitAddonRef.current, sessionIdRef.current, lastSyncedSizeRef);
        terminal.focus();
      }
    } else {
      clearPendingTerminalResizeSync(pendingResizeTimerRef);
    }
  }, [active]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const terminal = terminalRef.current;
    if (terminal) {
      fitAndSyncTerminalSize(terminal, fitAddonRef.current, sessionIdRef.current, lastSyncedSizeRef);
    }
  }, [layoutRevision, visible]);

  const hasContextMenuSelection = contextMenuSelection.trim().length > 0;
  const canPasteFromMenu = Boolean(sessionId);
  const canReconnectFromMenu = Boolean(connection) && hasTauriRuntime() && listenersReady && !reconnecting;

  function copyContextMenuSelection() {
    if (!contextMenuSelection) {
      return;
    }
    void copyTextToClipboard(contextMenuSelection).catch(() => {});
  }

  function pasteFromContextMenu() {
    if (!sessionId) {
      return;
    }
    void readTextFromClipboard()
      .then((text) => {
        if (text) {
          terminalRef.current?.paste(text);
        }
      })
      .catch(() => {});
  }

  function selectAllFromContextMenu() {
    terminalRef.current?.selectAll();
  }

  function sendContextMenuSelectionToAi() {
    const selectedText = contextMenuSelection.trim();
    if (selectedText) {
      onSendSelectionToAi?.(tabId, selectedText);
    }
  }

  async function reconnectCurrentTerminal() {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !connection || !hasTauriRuntime() || reconnectingRef.current) {
      return;
    }

    reconnectingRef.current = true;
    setReconnecting(true);

    const previousSessionId = sessionIdRef.current;
    const previousRequestId = activeRequestIdRef.current;
    const reconnectRequestId = `${tabId}-reconnect-${Date.now().toString()}`;
    const homeDirectory = inferRemoteHomeDirectory(connection.username);

    reconnectingPreviousSessionIdRef.current = previousSessionId;
    activeRequestIdRef.current = reconnectRequestId;
    sessionIdRef.current = null;
    setSessionId(null);
    setStatus("重新连接中");
    clearPendingTerminalOutputSchedule(pendingOutputFrameRef, pendingOutputTimerRef);
    clearPendingTerminalResizeSync(pendingResizeTimerRef);
    pendingOutputBufferRef.current = "";
    startupOutputBufferRef.current = "";
    startupOutputBufferingRef.current = false;
    osc7BufferRef.current = "";
    inputDirectoryStateRef.current = createTerminalInputDirectoryState({
      currentDirectory: null,
      homeDirectory,
    });
    inputHistoryStateRef.current = createTerminalInputHistoryState();
    homeDirectoryRef.current = homeDirectory;
    lastSyncedSizeRef.current = null;

    fitAndSyncTerminalSize(terminal, fitAddon, null, lastSyncedSizeRef);
    terminal.writeln(`\r\n[重新连接 ${connection.username}@${connection.host}:${connection.port} ...]`);

    try {
      const nextSessionId = await terminalConnect({
        cols: terminal.cols,
        connection_id: connection.id,
        host: connection.host,
        password: connection.password || undefined,
        port: connection.port,
        private_key_path: connection.private_key_path || undefined,
        private_key_passphrase: connection.private_key_passphrase || undefined,
        request_id: reconnectRequestId,
        rows: terminal.rows,
        username: connection.username,
      });

      if (terminalRef.current !== terminal) {
        await terminalClose(nextSessionId).catch(() => {});
        return;
      }

      reconnectingPreviousSessionIdRef.current = null;
      sessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
      onSessionIdChangeRef.current?.(tabId, nextSessionId, reconnectRequestId);
      setStatus("已连接");
      fitAndSyncTerminalSize(terminal, fitAddon, nextSessionId, lastSyncedSizeRef);
      terminal.focus();

      if (previousSessionId && previousSessionId !== nextSessionId) {
        void terminalClose(previousSessionId).catch(() => {});
      }
    } catch (error) {
      if (terminalRef.current !== terminal) {
        return;
      }
      reconnectingPreviousSessionIdRef.current = null;
      activeRequestIdRef.current = previousRequestId;
      sessionIdRef.current = previousSessionId;
      setSessionId(previousSessionId);
      setStatus("重新连接失败");
      terminal.writeln(`\r\n[重新连接失败: ${formatError(error)}]`);
    } finally {
      reconnectingRef.current = false;
      if (terminalRef.current === terminal) {
        setReconnecting(false);
      }
    }
  }

  return (
    <section
      className={`terminal-panel ${visible ? "" : "is-hidden"} ${searchOpen ? "terminal-search-open" : ""} ${
        className || ""
      }`}
      aria-label={`${title} 终端`}
      aria-hidden={!visible}
      style={style}
      onPointerDown={onPaneFocus}
    >
      {searchOpen ? (
        <div className="terminal-search-bar" role="search">
          <label className="terminal-search-input-wrap">
            <Search className="ui-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              aria-label="搜索终端输出"
              value={searchQuery}
              placeholder="搜索终端输出"
              spellCheck={false}
              onChange={(event) => onSearchQueryChange?.(tabId, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onSearchClose?.(tabId);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    findPreviousTerminalSearch(
                      searchAddonRef.current,
                      searchQuery,
                      searchCaseSensitive,
                      setSearchResultLabel,
                    );
                  } else {
                    findNextTerminalSearch(
                      searchAddonRef.current,
                      searchQuery,
                      searchCaseSensitive,
                      setSearchResultLabel,
                    );
                  }
                }
              }}
            />
          </label>
          {searchResultLabel ? (
            <span className="terminal-search-result" aria-live="polite">
              {searchResultLabel}
            </span>
          ) : null}
          <div className="terminal-search-actions">
            <Tooltip label={searchCaseSensitive ? "区分大小写" : "不区分大小写"}>
              <button
                className={searchCaseSensitive ? "active" : ""}
                type="button"
                aria-label="切换大小写匹配"
                aria-pressed={searchCaseSensitive}
                onClick={() => onSearchCaseSensitiveToggle?.(tabId)}
              >
                <CaseSensitive className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="上一个">
              <button
                type="button"
                aria-label="查找上一个"
                disabled={searchQuery.trim().length === 0}
                onClick={() =>
                  findPreviousTerminalSearch(
                    searchAddonRef.current,
                    searchQuery,
                    searchCaseSensitive,
                    setSearchResultLabel,
                  )
                }
              >
                <ChevronUp className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="下一个">
              <button
                type="button"
                aria-label="查找下一个"
                disabled={searchQuery.trim().length === 0}
                onClick={() =>
                  findNextTerminalSearch(
                    searchAddonRef.current,
                    searchQuery,
                    searchCaseSensitive,
                    setSearchResultLabel,
                  )
                }
              >
                <ChevronDown className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="关闭搜索">
              <button type="button" aria-label="关闭终端搜索" onClick={() => onSearchClose?.(tabId)}>
                <X className="ui-icon" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : null}
      <ContextMenu.Root
        onOpenChange={(open) => {
          if (open) {
            setContextMenuSelection(terminalRef.current?.getSelection() || "");
          }
        }}
      >
        <ContextMenu.Trigger asChild>
          <div className="terminal-host" ref={hostRef} />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="context-menu-content">
            <ContextMenu.Item
              className="context-menu-item"
              disabled={!hasContextMenuSelection}
              onSelect={copyContextMenuSelection}
            >
              <Copy className="ui-icon" aria-hidden="true" />
              <span>复制</span>
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              disabled={!canPasteFromMenu}
              onSelect={pasteFromContextMenu}
            >
              <ClipboardPaste className="ui-icon" aria-hidden="true" />
              <span>粘贴</span>
            </ContextMenu.Item>
            <ContextMenu.Item
              className="context-menu-item"
              onSelect={selectAllFromContextMenu}
            >
              <ScanText className="ui-icon" aria-hidden="true" />
              <span>全选</span>
            </ContextMenu.Item>
            {connection ? (
              <>
                <ContextMenu.Separator className="context-menu-separator" />
                <ContextMenu.Item
                  className="context-menu-item"
                  disabled={!canReconnectFromMenu}
                  onSelect={() => void reconnectCurrentTerminal()}
                >
                  <RefreshCw className={`ui-icon ${reconnecting ? "spin" : ""}`} aria-hidden="true" />
                  <span>重新连接</span>
                </ContextMenu.Item>
              </>
            ) : null}
            <ContextMenu.Separator className="context-menu-separator" />
            <ContextMenu.Item
              className="context-menu-item"
              disabled={!hasContextMenuSelection || !onSendSelectionToAi}
              onSelect={sendContextMenuSelectionToAi}
            >
              <Bot className="ui-icon" aria-hidden="true" />
              <span>发送到 AI 对话</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </section>
  );
}

function getTerminalSearchOptions(caseSensitive: boolean, incremental = false) {
  const primary = readHexToken("--mx-primary", "#2374c6");
  const panel = readHexToken("--mx-panel", "#ffffff");
  const text = readHexToken("--mx-text", "#20242a");

  return {
    decorations: {
      activeMatchBackground: mixHexColors(primary, panel, 0.18),
      activeMatchBorder: mixHexColors(primary, text, 0.58),
      activeMatchColorOverviewRuler: primary,
      matchBackground: mixHexColors(primary, panel, 0.1),
      matchBorder: mixHexColors(primary, text, 0.42),
      matchOverviewRuler: primary,
    },
    caseSensitive,
    incremental,
  };
}

function readHexToken(tokenName: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const styles = window.getComputedStyle(document.documentElement);
  return resolveHexToken(styles, tokenName, fallback, new Set());
}

function resolveHexToken(styles: CSSStyleDeclaration, tokenName: string, fallback: string, visited: Set<string>) {
  if (visited.has(tokenName)) {
    return fallback;
  }
  visited.add(tokenName);

  const rawValue = styles.getPropertyValue(tokenName).trim();
  const normalized = normalizeHexColor(rawValue);
  if (normalized) {
    return normalized;
  }

  const variable = rawValue.match(/^var\(\s*(--[\w-]+)(?:\s*,\s*([^)]*))?\)$/);
  if (!variable) {
    return fallback;
  }
  const variableFallback = normalizeHexColor(variable[2]?.trim() || "") || fallback;
  return resolveHexToken(styles, variable[1], variableFallback, visited);
}

function normalizeHexColor(value: string) {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 6) {
      return `#${digits.toLowerCase()}`;
    }
    return `#${digits
      .split("")
      .map((digit) => digit + digit)
      .join("")
      .toLowerCase()}`;
  }

  const rgb = value.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (!rgb) {
    return null;
  }
  return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
}

function mixHexColors(foreground: string, background: string, foregroundWeight: number) {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  return rgbToHex(
    Math.round(fg.r * weight + bg.r * (1 - weight)),
    Math.round(fg.g * weight + bg.g * (1 - weight)),
    Math.round(fg.b * weight + bg.b * (1 - weight)),
  );
}

function hexToRgb(value: string) {
  const hex = value.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function findNextTerminalSearch(
  searchAddon: SearchAddon | null,
  query: string,
  caseSensitive: boolean,
  setSearchResultLabel: (label: string) => void,
) {
  if (!searchAddon || !query.trim()) {
    return;
  }
  const found = searchAddon.findNext(query, getTerminalSearchOptions(caseSensitive));
  if (!found) {
    setSearchResultLabel("无匹配");
  }
}

function findPreviousTerminalSearch(
  searchAddon: SearchAddon | null,
  query: string,
  caseSensitive: boolean,
  setSearchResultLabel: (label: string) => void,
) {
  if (!searchAddon || !query.trim()) {
    return;
  }
  const found = searchAddon.findPrevious(query, getTerminalSearchOptions(caseSensitive));
  if (!found) {
    setSearchResultLabel("无匹配");
  }
}

function formatSearchResultLabel(resultIndex: number, resultCount: number) {
  if (resultCount === 0) {
    return "无匹配";
  }
  if (resultIndex < 0) {
    return `${resultCount.toString()} 项`;
  }
  return `${(resultIndex + 1).toString()} / ${resultCount.toString()}`;
}

function readPromptDirectorySnapshot(
  terminal: Terminal | null,
  homeDirectory: string | null,
  currentDirectory: string | null,
) {
  if (!terminal) {
    return null;
  }

  const fastSnapshotLines = readPromptDirectorySnapshotLines(
    terminal,
    PROMPT_DIRECTORY_FAST_SNAPSHOT_LOOKBACK_ROWS,
  );
  const fastPath = promptSnapshotLinesToDirectory(
    fastSnapshotLines,
    homeDirectory,
    currentDirectory,
  );
  if (fastPath) {
    return fastPath;
  }

  const anchorSnapshotLines = readPromptDirectorySnapshotLines(
    terminal,
    PROMPT_DIRECTORY_ANCHOR_SNAPSHOT_LOOKBACK_ROWS,
  );
  return promptSnapshotLinesToDirectory(anchorSnapshotLines, homeDirectory, currentDirectory);
}

function readPromptDirectorySnapshotLines(terminal: Terminal, lookbackRows: number) {
  const buffer = terminal.buffer.active;
  const cursorRow = buffer.baseY + buffer.cursorY;
  const firstRow = Math.max(0, cursorRow - lookbackRows);
  const snapshotLines: string[] = [];
  for (let row = cursorRow; row >= firstRow; row -= 1) {
    snapshotLines.push(buffer.getLine(row)?.translateToString(true) || "");
  }
  return snapshotLines;
}

function withTerminalChromeTheme(theme: ITheme): ITheme {
  const background = normalizeHexColor(theme.background || "") || "#111827";
  const foreground = normalizeHexColor(theme.foreground || "") || "#e5e7eb";

  return {
    ...theme,
    overviewRulerBorder: "transparent",
    scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.36)",
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.28)",
    selectionBackground: mixHexColors(foreground, background, 0.22),
    selectionForeground: foreground,
  };
}

function resolveWindowsPtyOption(windowsPty: IWindowsPty | undefined): IWindowsPty | undefined {
  return windowsPty ? { ...windowsPty } : undefined;
}

function fitAndSyncTerminalSize(
  terminal: Terminal,
  fitAddon: FitAddon | null,
  sessionId: string | null,
  lastSyncedSizeRef: { current: string | null },
) {
  fitAddon?.fit();
  const activeSessionId = sessionId;
  if (!activeSessionId) {
    return;
  }
  syncTerminalSize(terminal, activeSessionId, terminal.cols, terminal.rows, lastSyncedSizeRef);
}

// Debounced fit() + backend sync used by the ResizeObserver (drag) path. fit()
// and the PTY resize run in the same timer tick so xterm and the shell never
// disagree on cols/rows. Coalescing fit() calls also stops per-frame canvas
// resizes that desync xterm's glyph grid (ghosting / duplicated glyphs).
function scheduleFitAndSyncTerminalSize(
  terminal: Terminal,
  fitAddon: FitAddon | null,
  sessionId: string | null,
  lastSyncedSizeRef: { current: string | null },
  pendingResizeTimerRef: { current: number | null },
) {
  if (pendingResizeTimerRef.current !== null) {
    window.clearTimeout(pendingResizeTimerRef.current);
  }
  pendingResizeTimerRef.current = window.setTimeout(() => {
    pendingResizeTimerRef.current = null;
    if (!fitAddon) {
      return;
    }
    fitAddon.fit();
    const activeSessionId = sessionId;
    if (!activeSessionId) {
      return;
    }
    syncTerminalSize(terminal, activeSessionId, terminal.cols, terminal.rows, lastSyncedSizeRef);
  }, TERMINAL_RESIZE_SYNC_DEBOUNCE_MS);
}

function clearPendingTerminalOutputSchedule(
  pendingOutputFrameRef: { current: number | null },
  pendingOutputTimerRef: { current: number | null },
) {
  if (pendingOutputFrameRef.current !== null) {
    window.cancelAnimationFrame(pendingOutputFrameRef.current);
    pendingOutputFrameRef.current = null;
  }
  if (pendingOutputTimerRef.current !== null) {
    window.clearTimeout(pendingOutputTimerRef.current);
    pendingOutputTimerRef.current = null;
  }
}

function syncTerminalSize(
  terminal: Terminal,
  activeSessionId: string,
  cols: number,
  rows: number,
  lastSyncedSizeRef: { current: string | null },
) {
  const sizeKey = `${activeSessionId}:${cols.toString()}x${rows.toString()}`;
  if (lastSyncedSizeRef.current === sizeKey) {
    return;
  }
  lastSyncedSizeRef.current = sizeKey;
  void terminalResize(activeSessionId, cols, rows).catch((error) => {
    terminal.writeln(`\r\n尺寸同步失败: ${formatError(error)}`);
  });
}

function clearPendingTerminalResizeSync(
  pendingResizeTimerRef: { current: number | null },
) {
  if (pendingResizeTimerRef.current !== null) {
    window.clearTimeout(pendingResizeTimerRef.current);
    pendingResizeTimerRef.current = null;
  }
}

interface TerminalInputHistoryState {
  buffer: string;
  dirty: boolean;
}

function createTerminalInputHistoryState(): TerminalInputHistoryState {
  return { buffer: "", dirty: false };
}

function applyTerminalInputHistoryData(
  state: TerminalInputHistoryState,
  data: string,
): { commands: string[]; state: TerminalInputHistoryState } {
  let nextState = state;
  const commands: string[] = [];

  for (const char of data) {
    const code = char.charCodeAt(0);
    if (char === "\r" || char === "\n") {
      const command = nextState.dirty ? "" : nextState.buffer.trim();
      if (command && !isSensitiveTerminalInputCommand(command)) {
        commands.push(command);
      }
      nextState = createTerminalInputHistoryState();
      continue;
    }

    if (char === "\b" || char === "\x7f") {
      nextState = {
        ...nextState,
        buffer: nextState.buffer.slice(0, -1),
      };
      continue;
    }

    if (code < 32 || code === 127) {
      nextState = { ...nextState, dirty: true };
      continue;
    }

    nextState = {
      ...nextState,
      buffer: `${nextState.buffer}${char}`,
    };
  }

  return { commands, state: nextState };
}

function isSensitiveTerminalInputCommand(command: string) {
  return (
    /\b(?:passwd|sshpass)\b/i.test(command) ||
    /\bsudo\s+-S\b/i.test(command) ||
    /\b(?:mysql|mariadb|psql|redis-cli)\b[^\n\r]*\s-p(?:\S+)?/i.test(command) ||
    /\b(?:password|passwd|token|secret|access[_-]?key)\s*=/i.test(command)
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function isTerminalEnterInput(data: string) {
  return data === "\r" || data === "\n" || data === "\r\n";
}

function isTerminalCopyShortcut(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "c" &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey)
  );
}

function isTerminalPasteShortcut(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "v" &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey)
  );
}

function matchesTerminalEvent(
  event: { request_id: string | null; session_id: string },
  sessionId: string | null,
  activeRequestId: string | null,
) {
  return (
    (Boolean(sessionId) && event.session_id === sessionId) ||
    (Boolean(activeRequestId) && event.request_id === activeRequestId)
  );
}
