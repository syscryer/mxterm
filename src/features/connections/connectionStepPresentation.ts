interface X11StepContext {
  index: number;
  label: string;
  description: string;
  suggestion: string;
}

function x11ErrorContext(code: string): X11StepContext | null {
  if (!code.startsWith("x11_")) return null;
  if (code.startsWith("x11_request_")) {
    return {
      index: 4,
      label: "SSH X11 转发请求",
      description: "等待 SSH 服务端确认 X11 转发",
      suggestion: "检查 SSH 服务端的 X11Forwarding、xauth 和转发策略，并查看 sshd 日志。",
    };
  }
  if (["x11_auth_expired", "x11_channel_limit", "x11_auth_rejected", "x11_setup_invalid", "x11_stream_failed", "x11_not_active"].includes(code)) {
    return {
      index: 4,
      label: "X11 数据转发",
      description: "处理图形程序的 X11 连接",
      suggestion: "检查当前 SSH 会话的 DISPLAY 和 X11 授权；授权到期时重新连接 SSH。",
    };
  }
  return {
    index: 0,
    label: "本地 X11 准备",
    description: "检查本机 X Server、Display 和认证文件",
    suggestion: code.startsWith("x11_authority_") || code === "x11_cookie_missing"
      ? "核对错误详情中的认证文件路径和权限；修改 XAUTHORITY 后完全退出并重启 mXterm。不要删除正在使用的认证文件或锁文件。"
      : "检查本机 X Server、Display、xauth 和认证设置；本地检查通过后才会建立 SSH 网络连接。",
  };
}

export function connectionX11Step(stage?: string | null, errorCode?: string): X11StepContext | null {
  if (errorCode) return x11ErrorContext(errorCode);
  if (stage === "x11_preparing") return x11ErrorContext("x11_xauth_failed");
  if (stage === "x11_requesting" || stage === "x11_ready") return x11ErrorContext("x11_request_denied");
  return null;
}

export function connectionProgressIndex(stage: string): number | null {
  switch (stage) {
    case "x11_preparing": return 0;
    case "tcp_connecting": return 1;
    case "tcp_connected": return 2;
    case "authenticating":
    case "authenticated": return 3;
    case "channel_opening":
    case "x11_requesting":
    case "x11_ready":
    case "pty_requesting":
    case "pty_ready":
    case "shell_starting":
    case "shell_ready": return 4;
    default: return null;
  }
}

export function connectionStepErrorIndex(code: string) {
  const x11 = x11ErrorContext(code);
  if (x11) return x11.index;
  if (
    code === "terminal_tcp_connect_failed" ||
    code === "terminal_connect_failed" ||
    code === "terminal_connect_timeout" ||
    code.startsWith("proxy_")
  ) {
    return 1;
  }
  if (code === "host_key_unknown" || code === "host_key_changed") {
    return 2;
  }
  if (
    code === "terminal_auth_failed" ||
    code === "terminal_auth_rejected" ||
    code === "terminal_auth_timeout" ||
    code === "terminal_auth_missing" ||
    code === "terminal_private_key_invalid" ||
    code.startsWith("credential_") ||
    code.startsWith("connection_credential_")
  ) {
    return 3;
  }
  if (
    code === "terminal_channel_open_failed" ||
    code === "terminal_pty_failed" ||
    code === "terminal_shell_failed"
  ) {
    return 4;
  }
  return 1;
}

export function connectionErrorStage(code: string, rawMessage: string) {
  const x11 = x11ErrorContext(code);
  if (x11) return x11.label;
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "网络连接超时";
  }
  if (
    code === "terminal_connect_failed" ||
    code === "terminal_tcp_connect_failed" ||
    code === "remote_exec_connect_failed" ||
    code.startsWith("proxy_") ||
    raw.includes("connection refused") ||
    raw.includes("actively refused") ||
    raw.includes("no route") ||
    raw.includes("unreachable") ||
    raw.includes("reset")
  ) {
    return "网络连接阶段";
  }
  if (code === "host_key_unknown" || code === "host_key_changed") {
    return "主机密钥阶段";
  }
  if (
    code === "terminal_auth_failed" ||
    code === "terminal_auth_rejected" ||
    code === "terminal_auth_timeout" ||
    code === "terminal_private_key_invalid" ||
    code.startsWith("credential_")
  ) {
    return "用户认证阶段";
  }
  if (
    code === "terminal_channel_open_failed" ||
    code === "terminal_pty_failed" ||
    code === "terminal_shell_failed"
  ) {
    return "远程终端初始化阶段";
  }
  return "连接阶段";
}

export function connectionErrorSuggestion(code: string, rawMessage: string) {
  const x11 = x11ErrorContext(code);
  if (x11) return x11.suggestion;
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "检查主机 IP、端口、防火墙和网络连通性；确认目标 SSH 服务可以从本机访问。";
  }
  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return "目标主机可达但端口拒绝连接，确认 SSH 服务已启动、端口填写正确，或安全组允许访问。";
  }
  if (raw.includes("no route") || raw.includes("unreachable")) {
    return "本机到目标主机没有可用路由，检查 VPN、网段、网关或代理配置。";
  }
  if (raw.includes("reset")) {
    return "连接被对端重置，检查 SSH 服务策略、代理链路或中间防火墙。";
  }
  if (code.startsWith("proxy_")) {
    return "检查代理类型、代理地址端口以及代理用户名密码。";
  }
  if (code === "terminal_auth_rejected") {
    return "主机已响应但认证被拒绝，检查用户名、密码或私钥是否匹配。";
  }
  if (code === "terminal_private_key_invalid") {
    return "检查私钥路径、文件格式和私钥口令。";
  }
  if (code === "terminal_auth_failed" || code === "terminal_auth_timeout") {
    return "检查认证方式、用户名、密码或私钥；如果服务器禁用该方式，需要换用允许的认证方式。";
  }
  if (code === "host_key_changed") {
    return "确认目标主机是否重装或变更过；只有确认安全后再更新信任。";
  }
  if (code === "host_key_unknown") {
    return "核对主机指纹，确认无误后信任并继续连接。";
  }
  if (code === "terminal_pty_failed" || code === "terminal_shell_failed") {
    return "SSH 已登录但远程终端初始化失败，检查服务器是否允许分配 PTY 和启动默认 Shell。";
  }
  return "查看底层原因后重试；如果配置有误，点击编辑连接调整主机、端口、代理或认证信息。";
}

export function connectionErrorSummary(code: string, rawMessage: string, fallback: string) {
  const x11 = x11ErrorContext(code);
  if (x11) return fallback;
  const raw = rawMessage.toLowerCase();
  if (isConnectionTimeoutError(code, raw)) {
    return "连接超时";
  }
  if (raw.includes("connection refused") || raw.includes("actively refused")) {
    return "端口无法连接";
  }
  if (raw.includes("no route") || raw.includes("unreachable")) {
    return "主机不可达";
  }
  return fallback;
}

function isConnectionTimeoutError(code: string, raw: string) {
  return (
    code.includes("connect_timeout") ||
    code === "terminal_tcp_connect_timeout" ||
    raw.includes("timeout") ||
    raw.includes("timed out") ||
    raw.includes("operation timed out")
  );
}
