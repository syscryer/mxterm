import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { FormEvent, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { terminalConnect, terminalResize, terminalWrite } from "../../shared/tauri/commands";
import { listenTerminalOutput, listenTerminalStateChanged } from "../../shared/tauri/events";
import { hasTauriRuntime } from "../../shared/tauri/runtime";

const textDecoder = new TextDecoder();

export function TerminalPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState("未连接");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#111827",
        foreground: "#d1d5db",
        cursor: "#f9fafb",
        selectionBackground: "#374151",
      },
    });
    const fitAddon = new FitAddon();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(hostRef.current);
    fitAddon.fit();
    terminal.writeln("mXterm SSH spike ready");
    terminal.writeln("填写连接信息后开始真实 SSH 会话。");

    const dataDisposable = terminal.onData((data) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return;
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
    if (hasTauriRuntime()) {
      void listenTerminalOutput((event) => {
        if (event.session_id !== sessionIdRef.current) {
          return;
        }
        terminal.write(textDecoder.decode(Uint8Array.from(event.data), { stream: true }));
      }).then((unlisten) => {
        stopOutputListener = unlisten;
      });

      void listenTerminalStateChanged((event) => {
        if (event.session_id !== sessionIdRef.current) {
          return;
        }
        setSessionId(null);
        const suffix =
          event.exit_status === null ? "" : `，退出码 ${event.exit_status.toString()}`;
        setStatus(`已断开${suffix}`);
        terminal.writeln(`\r\n[会话已断开${suffix}]`);
      }).then((unlisten) => {
        stopStateListener = unlisten;
      });
    }

    return () => {
      stopOutputListener?.();
      stopStateListener?.();
      resizeObserver.disconnect();
      resizeDisposable.dispose();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    if (!hasTauriRuntime()) {
      terminal.writeln("\r\n请在 Tauri 应用窗口中测试真实 SSH 连接。");
      return;
    }

    fitAddon.fit();
    terminal.clear();
    terminal.writeln(`连接 ${username}@${host}:${port} ...`);
    setStatus("连接中");

    try {
      const nextSessionId = await terminalConnect({
        cols: terminal.cols,
        host,
        password: password || undefined,
        port: Number(port),
        rows: terminal.rows,
        username,
      });
      setSessionId(nextSessionId);
      setStatus("已连接");
      terminal.focus();
    } catch (error) {
      setSessionId(null);
      setStatus("连接失败");
      terminal.writeln(`\r\n连接失败: ${formatError(error)}`);
    }
  }

  return (
    <section className="terminal-panel" aria-label="终端">
      <div className="terminal-tabs">
        <button className="active" type="button">
          terminal
        </button>
        <form className="terminal-connect-form" onSubmit={connect}>
          <input
            aria-label="SSH 主机"
            placeholder="host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
          <input
            aria-label="SSH 端口"
            className="port-input"
            inputMode="numeric"
            placeholder="22"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
          <input
            aria-label="SSH 用户名"
            placeholder="user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            aria-label="SSH 密码"
            placeholder="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button disabled={status === "连接中"} type="submit">
            连接
          </button>
        </form>
        <span className="terminal-status">{status}</span>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
