import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/features/connections/connectionStepPresentation.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  connectionErrorStage, connectionErrorSuggestion, connectionErrorSummary,
  connectionStepErrorIndex, connectionProgressIndex, connectionX11Step,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("local X11 failures retain backend meaning even when detail resembles a network failure", () => {
  for (const code of ["x11_authority_lock_failed", "x11_authority_path_invalid", "x11_xauth_failed", "x11_local_connect_timeout", "x11_xauth_timeout", "x11_security_unavailable"]) {
    assert.equal(connectionStepErrorIndex(code), 0);
    assert.equal(connectionErrorStage(code, "connection refused; timed out"), "本地 X11 准备");
    assert.equal(connectionErrorSummary(code, "connection refused; timed out", "真实 X11 错误"), "真实 X11 错误");
    assert.doesNotMatch(connectionErrorSuggestion(code, "timed out"), /主机 IP|VPN|SSH 服务已启动/);
    assert.equal(connectionX11Step(null, code).index, 0);
  }
});

test("SSH X11 acknowledgement failure is after authentication, with server-specific guidance", () => {
  assert.equal(connectionStepErrorIndex("x11_request_timeout"), 4);
  assert.equal(connectionErrorStage("x11_request_timeout", "timed out"), "SSH X11 转发请求");
  assert.match(connectionErrorSuggestion("x11_request_denied", ""), /X11Forwarding/);
  assert.equal(connectionX11Step("x11_ready", "terminal_shell_failed"), null);
});

test("actual backend stages select local prep then network, authentication and X11 request", () => {
  const stages = ["x11_preparing", "tcp_connecting", "tcp_connected", "authenticating", "authenticated", "channel_opening", "x11_requesting", "x11_ready", "pty_requesting", "shell_ready"];
  assert.deepEqual(stages.map(connectionProgressIndex), [0, 1, 2, 3, 3, 4, 4, 4, 4, 4]);
  assert.equal(connectionX11Step("x11_preparing").label, "本地 X11 准备");
  assert.equal(connectionX11Step("x11_requesting").label, "SSH X11 转发请求");
  assert.equal(connectionX11Step("tcp_connecting"), null);
  assert.equal(connectionProgressIndex("future-stage"), null);
});

test("existing SSH and proxy errors keep their original mapping", () => {
  for (const [code, index] of [["terminal_connect_failed", 1], ["proxy_connect_failed", 1], ["host_key_changed", 2], ["terminal_auth_rejected", 3], ["terminal_shell_failed", 4]]) {
    assert.equal(connectionStepErrorIndex(code), index);
  }
  assert.equal(connectionErrorSummary("terminal_connect_failed", "connection refused", "error"), "端口无法连接");
  assert.equal(connectionErrorStage("terminal_connect_timeout", ""), "网络连接超时");
});
