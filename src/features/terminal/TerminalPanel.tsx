import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import type { ConnectionProfile } from "../connections/connectionTypes";
import {
  terminalClose,
  terminalConnect,
  terminalResize,
  terminalWrite,
} from "../../shared/tauri/commands";
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
import {
  createTerminalSemanticHighlighter,
  getTerminalSemanticHighlightPalette,
  type TerminalSemanticHighlighter,
} from "./terminalSemanticHighlight";
import { normalizeStartupOutput } from "./terminalStartupOutput";

const TERMINAL_SCROLLBAR_WIDTH = 6;
const STARTUP_OUTPUT_BUFFER_MS = 250;

interface TerminalPanelProps {
  active: boolean;
  connection: ConnectionProfile | null;
  fontFamily: string;
  fontSize: number;
  initialOutput?: number[];
  initialRequestId?: string;
  initialSessionId: string;
  onWarmupCaptureReady?: (tabId: string) => void;
  tabId: string;
  theme: ITheme;
  title: string;
  onCurrentDirectoryChange?: (tabId: string, path: string) => void;
  onStatusChange: (tabId: string, status: string) => void;
}

export function TerminalPanel({
  active,
  connection,
  fontFamily,
  fontSize,
  initialOutput = [],
  initialRequestId,
  initialSessionId,
  onCurrentDirectoryChange,
  onStatusChange,
  onWarmupCaptureReady,
  tabId,
  theme,
  title,
}: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const semanticHighlighterRef = useRef<TerminalSemanticHighlighter | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const osc7BufferRef = useRef("");
  const inputDirectoryStateRef = useRef(createTerminalInputDirectoryState());
  const initialOutputWrittenLengthRef = useRef(0);
  const startedRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  const onWarmupCaptureReadyRef = useRef(onWarmupCaptureReady);
  const startupOutputBufferRef = useRef("");
  const startupOutputBufferingRef = useRef(false);
  const startupOutputFlushTimerRef = useRef<number | null>(null);
  const terminalOutputWriterRef = useRef<((decoded: string) => void) | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [listenersReady, setListenersReady] = useState(!hasTauriRuntime());
  const [status, setStatus] = useState(connection ? "待连接" : "空闲");

  useEffect(() => {
    onWarmupCaptureReadyRef.current = onWarmupCaptureReady;
  }, [onWarmupCaptureReady]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    onStatusChange(tabId, status);
  }, [onStatusChange, status, tabId]);

  useEffect(() => {
    inputDirectoryStateRef.current = createTerminalInputDirectoryState({
      currentDirectory: null,
      homeDirectory: inferRemoteHomeDirectory(connection?.username),
    });
  }, [connection?.id, connection?.username]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily,
      fontSize,
      overviewRuler: {
        width: TERMINAL_SCROLLBAR_WIDTH,
      },
      scrollback: 8000,
      theme: withTerminalChromeTheme(theme),
    });
    const fitAddon = new FitAddon();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(hostRef.current);
    const semanticHighlighter = createTerminalSemanticHighlighter(terminal, {
      palette: getTerminalSemanticHighlightPalette(theme),
    });
    semanticHighlighterRef.current = semanticHighlighter;
    fitAddon.fit();
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
      startupOutputBufferingRef.current = false;
      if (bufferedOutput) {
        terminal.write(normalizeStartupOutput(bufferedOutput));
      }
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
        return;
      }
      terminal.write(decoded);
    };

    terminalOutputWriterRef.current = writeDecodedOutput;
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
    }

    const dataDisposable = terminal.onData((data) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
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
      void terminalWrite(activeSessionId, data).catch((error) => {
        terminal.writeln(`\r\n输入发送失败: ${formatError(error)}`);
      });
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return;
      }
      void terminalResize(activeSessionId, cols, rows).catch((error) => {
        terminal.writeln(`\r\n尺寸同步失败: ${formatError(error)}`);
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(hostRef.current);

    let stopOutputListener: (() => void) | undefined;
    let stopStateListener: (() => void) | undefined;
    let stopProgressListener: (() => void) | undefined;
    let disposed = false;
    if (hasTauriRuntime()) {
      setListenersReady(false);
      const outputListener = listenTerminalOutput((event) => {
        if (!matchesTerminalEvent(event, tabId, sessionIdRef.current, initialRequestId)) {
          return;
        }
        const decoded = decoderRef.current.decode(Uint8Array.from(event.data), { stream: true });
        writeDecodedOutput(decoded);
      });

      const stateListener = listenTerminalStateChanged((event) => {
        if (!matchesTerminalEvent(event, tabId, sessionIdRef.current, initialRequestId)) {
          return;
        }
        setSessionId(null);
        const suffix =
          event.exit_status === null ? "" : `，退出码 ${event.exit_status.toString()}`;
        setStatus(`已断开${suffix}`);
        terminal.writeln(`\r\n[会话已断开${suffix}]`);
      });

      const progressListener = listenTerminalConnectProgress((event) => {
        if (event.request_id !== tabId) {
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
          onWarmupCaptureReadyRef.current?.(tabId);
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
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        void terminalClose(activeSessionId).catch(() => {});
      }
      stopOutputListener?.();
      stopStateListener?.();
      stopProgressListener?.();
      if (startupOutputFlushTimerRef.current !== null) {
        window.clearTimeout(startupOutputFlushTimerRef.current);
        startupOutputFlushTimerRef.current = null;
      }
      startupOutputBufferRef.current = "";
      startupOutputBufferingRef.current = false;
      terminalOutputWriterRef.current = null;
      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      semanticHighlighter.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      semanticHighlighterRef.current = null;
    };
  }, [initialRequestId, initialSessionId, tabId]);

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
    fitAddonRef.current?.fit();
  }, [fontFamily]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSize) {
      return;
    }

    terminal.options.fontSize = fontSize;
    fitAddonRef.current?.fit();
  }, [fontSize]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (
      !terminal ||
      !fitAddon ||
      !connection ||
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

    fitAddon.fit();
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
      request_id: tabId,
      rows: terminal.rows,
      username: connection.username,
    })
      .then((nextSessionId) => {
        sessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setStatus("已连接");
        terminal.focus();
      })
      .catch((error) => {
        setSessionId(null);
        setStatus("连接失败");
        terminal.writeln(`\r\n连接失败: ${formatError(error)}`);
      });
  }, [connection, listenersReady, tabId]);

  useEffect(() => {
    if (active) {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    }
  }, [active]);

  return (
    <section
      className={`terminal-panel ${active ? "" : "is-hidden"}`}
      aria-label={`${title} 终端`}
    >
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}

function withTerminalChromeTheme(theme: ITheme): ITheme {
  return {
    ...theme,
    overviewRulerBorder: "transparent",
    scrollbarSliderActiveBackground: "rgba(148, 163, 184, 0.36)",
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "rgba(148, 163, 184, 0.28)",
  };
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function matchesTerminalEvent(
  event: { request_id: string | null; session_id: string },
  tabId: string,
  sessionId: string | null,
  initialRequestId?: string,
) {
  return (
    event.session_id === sessionId ||
    event.request_id === tabId ||
    (Boolean(initialRequestId) && event.request_id === initialRequestId)
  );
}
