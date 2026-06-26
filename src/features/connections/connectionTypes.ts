export type ConnectionAuthKind = "password" | "private_key";
export type ConnectionCredentialMode = "saved" | "inline" | "prompt";
export type ConnectionJumpKind = "none" | "ssh_jump";
import type {
  CharacterBackspaceMode,
  SerialDataBits,
  SerialFlowControl,
  SerialParity,
  SerialStopBits,
  TelnetEnterMode,
} from "../terminal/characterSessionTypes";

export type ConnectionProtocol = "ssh" | "rdp" | "vnc" | "telnet" | "serial";
export type ConnectionProxyKind = "none" | "http_connect" | "socks5";
export type RdpDisplayMode = "embedded" | "windowed" | "fullscreen" | "all_monitors";
export type RdpAudioMode = "local" | "remote" | "disabled";
export type RdpGatewayMode = "disabled" | "auto" | "explicit";
export type RdpGatewayCredentialSource = "same" | "prompt";
export type RdpPerformancePreset = "auto" | "lan" | "balanced" | "low_bandwidth";
export type RdpSecurityCredentialMode = "prompt" | "saved" | "os_store";
export type RdpNetworkLevelAuthentication = "auto" | "enabled" | "disabled";
export type RdpCertificatePolicy = "trust" | "prompt" | "strict";
export type RdpRenderMode = "embedded" | "external" | "custom";
export type RdpRunnerKind =
  | "mstsc_activex"
  | "mstsc"
  | "freerdp"
  | "macos_app"
  | "custom";
export type RdpPlatform = "windows" | "linux" | "macos" | "unknown";
export type VncScaleMode = "fit" | "stretch" | "actual";
export type VncPerformancePreset = "auto" | "quality" | "balanced" | "low_bandwidth";
export type VncSecurityCredentialMode = "prompt" | "saved";
export type VncRenderMode = "embedded" | "external" | "custom";
export type VncRunnerKind = "novnc" | "vncviewer" | "tigervnc" | "realvnc" | "custom";
export type VncPlatform = "windows" | "linux" | "macos" | "unknown";
export type ConnectionTerminalEncoding =
  | "utf-8"
  | "gbk"
  | "gb18030"
  | "big5"
  | "euc-jp"
  | "iso-2022-jp"
  | "shift-jis"
  | "euc-kr";

export interface ConnectionJumpConfig {
  kind: ConnectionJumpKind;
  jump_connection_id?: string | null;
}

export interface ConnectionProxyConfig {
  kind: ConnectionProxyKind;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
}

export interface ConnectionAdvancedConfig {
  connect_timeout_ms: number;
  auth_timeout_ms: number;
  keepalive_interval_ms: number;
  terminal_encoding: ConnectionTerminalEncoding;
}

export interface RdpDisplayConfig {
  mode: RdpDisplayMode;
  width?: number | null;
  height?: number | null;
  dynamic_resize: boolean;
  use_multimon: boolean;
}

export interface RdpResourceConfig {
  clipboard: boolean;
  audio: RdpAudioMode;
  drives: boolean;
  printers: boolean;
  smart_cards: boolean;
}

export interface RdpGatewayConfig {
  mode: RdpGatewayMode;
  host?: string | null;
  credential_source: RdpGatewayCredentialSource;
}

export interface RdpRemoteAppConfig {
  enabled: boolean;
  program?: string | null;
  working_dir?: string | null;
  args?: string | null;
}

export interface RdpPerformanceConfig {
  preset: RdpPerformancePreset;
  desktop_background: boolean;
  font_smoothing: boolean;
  visual_styles: boolean;
}

export interface RdpSecurityConfig {
  credential_mode: RdpSecurityCredentialMode;
  nla: RdpNetworkLevelAuthentication;
  certificate_policy: RdpCertificatePolicy;
}

export interface RdpRunnerConfig {
  render_mode: RdpRenderMode;
  preferred_runner?: RdpRunnerKind | null;
  custom_executable?: string | null;
  custom_args_template?: string | null;
}

export interface RdpConnectionConfig {
  domain?: string | null;
  display: RdpDisplayConfig;
  resources: RdpResourceConfig;
  gateway?: RdpGatewayConfig | null;
  remote_app: RdpRemoteAppConfig;
  performance: RdpPerformanceConfig;
  security: RdpSecurityConfig;
  runner: RdpRunnerConfig;
  raw_rdp_settings?: string | null;
  raw_runner_args?: string | null;
}

export interface VncDisplayConfig {
  scale_mode: VncScaleMode;
  resize_session: boolean;
  clip_viewport: boolean;
}

export interface VncInputConfig {
  view_only: boolean;
  clipboard: boolean;
  shared: boolean;
}

export interface VncPerformanceConfig {
  preset: VncPerformancePreset;
  quality_level?: number | null;
  compression_level?: number | null;
}

export interface VncSecurityConfig {
  credential_mode: VncSecurityCredentialMode;
}

export interface VncRunnerConfig {
  render_mode: VncRenderMode;
  preferred_runner?: VncRunnerKind | null;
  custom_executable?: string | null;
  custom_args_template?: string | null;
}

export interface VncConnectionConfig {
  display: VncDisplayConfig;
  input: VncInputConfig;
  performance: VncPerformanceConfig;
  security: VncSecurityConfig;
  runner: VncRunnerConfig;
  raw_runner_args?: string | null;
}

export interface TelnetConnectionConfig {
  enter_mode: TelnetEnterMode;
  backspace_mode: CharacterBackspaceMode;
}

export interface SerialConnectionConfig {
  port_name: string;
  baud_rate: number;
  data_bits: SerialDataBits;
  parity: SerialParity;
  stop_bits: SerialStopBits;
  flow_control: SerialFlowControl;
  backspace_mode: CharacterBackspaceMode;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol?: ConnectionProtocol | null;
  group?: string | null;
  host: string;
  port: number;
  username: string;
  credential_mode: ConnectionCredentialMode;
  credential_id?: string | null;
  inline_auth_kind?: ConnectionAuthKind | null;
  inline_password?: string | null;
  inline_private_key_path?: string | null;
  inline_private_key_passphrase?: string | null;
  prompt_auth_kind?: ConnectionAuthKind | null;
  proxy: ConnectionProxyConfig;
  jump: ConnectionJumpConfig;
  advanced: ConnectionAdvancedConfig;
  rdp?: RdpConnectionConfig | null;
  vnc?: VncConnectionConfig | null;
  telnet?: TelnetConnectionConfig | null;
  serial?: SerialConnectionConfig | null;
  notes?: string | null;
  is_favorite: boolean;
  last_connected_at?: string | null;
  remote_os_id?: string | null;
  remote_os_name?: string | null;
  remote_os_version?: string | null;
  created_at: string;
  updated_at: string;
  auth_kind?: ConnectionAuthKind | null;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
}

export interface ConnectionProfileInput {
  id?: string;
  protocol?: ConnectionProtocol;
  name?: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  credential_mode: ConnectionCredentialMode;
  credential_id?: string;
  inline_auth_kind?: ConnectionAuthKind;
  inline_password?: string;
  inline_password_touched?: boolean;
  inline_private_key_path?: string;
  inline_private_key_passphrase?: string;
  inline_private_key_passphrase_touched?: boolean;
  prompt_auth_kind?: ConnectionAuthKind;
  proxy: ConnectionProxyConfig;
  jump: ConnectionJumpConfig;
  advanced: ConnectionAdvancedConfig;
  rdp?: RdpConnectionConfig | null;
  vnc?: VncConnectionConfig | null;
  telnet?: TelnetConnectionConfig | null;
  serial?: SerialConnectionConfig | null;
  notes?: string;
  is_favorite?: boolean;
  last_connected_at?: string;
  remote_os_id?: string;
  remote_os_name?: string;
  remote_os_version?: string;
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}

export interface CredentialProfile {
  id: string;
  name: string;
  username?: string | null;
  kind: ConnectionAuthKind;
  password?: string | null;
  private_key_path?: string | null;
  private_key_passphrase?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialProfileInput {
  id?: string;
  name?: string;
  username?: string;
  kind: ConnectionAuthKind;
  password?: string;
  password_touched?: boolean;
  private_key_path?: string;
  private_key_passphrase?: string;
  private_key_passphrase_touched?: boolean;
  notes?: string;
}

export interface RevealedConnectionSecret {
  auth_kind: ConnectionAuthKind;
  password?: string | null;
  private_key_passphrase?: string | null;
}

export interface RevealedCredentialSecret {
  kind: ConnectionAuthKind;
  password?: string | null;
  private_key_passphrase?: string | null;
}

export interface ConnectionRuntimeCredentialRequest {
  connection_id: string;
  auth_kind?: ConnectionAuthKind;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
}

export interface HostKeyInfo {
  host: string;
  port: number;
  key_algorithm: string;
  fingerprint_sha256: string;
  public_key: string;
}

export interface ConnectionStepResult {
  ok: boolean;
  message: string;
}

export interface RdpRunnerProbeResult {
  platform: RdpPlatform;
  available_runners: RdpRunnerKind[];
  default_runner?: RdpRunnerKind | null;
  default_executable?: string | null;
  supports_embedded: boolean;
  supports_remote_app: boolean;
  supports_dynamic_resize: boolean;
  setup_hint?: string | null;
}

export interface RdpLaunchPreview {
  connection_id: string;
  runner?: RdpRunnerKind | null;
  render_mode: RdpRenderMode;
  executable?: string | null;
  args: string[];
  rdp_file_content?: string | null;
  fallback_reason?: string | null;
  setup_hint?: string | null;
  warnings: string[];
}

export interface RdpLaunchResult {
  session_id: string;
  connection_id: string;
  launched: boolean;
  embedded: boolean;
  runner: RdpRunnerKind;
  executable?: string | null;
  args: string[];
  process_id?: number | null;
  rdp_file_path?: string | null;
  fallback_reason?: string | null;
  setup_hint?: string | null;
}

export interface RdpSessionCloseResult {
  ok: boolean;
  message: string;
}

export interface RdpSessionResizeResult {
  ok: boolean;
  applied: boolean;
  message: string;
}

export interface RdpSessionClosedEvent {
  session_id: string;
}

export interface RdpEmbeddedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VncRunnerProbeResult {
  platform: VncPlatform;
  available_runners: VncRunnerKind[];
  default_runner?: VncRunnerKind | null;
  default_executable?: string | null;
  supports_embedded: boolean;
  supports_clipboard: boolean;
  supports_resize_session: boolean;
  setup_hint?: string | null;
}

export interface VncLaunchPreview {
  connection_id: string;
  runner?: VncRunnerKind | null;
  render_mode: VncRenderMode;
  embedded: boolean;
  executable?: string | null;
  args: string[];
  websocket_url?: string | null;
  fallback_reason?: string | null;
  setup_hint?: string | null;
  warnings: string[];
}

export interface VncLaunchResult {
  session_id: string;
  connection_id: string;
  launched: boolean;
  embedded: boolean;
  runner: VncRunnerKind;
  websocket_url?: string | null;
  password?: string | null;
  executable?: string | null;
  args: string[];
  process_id?: number | null;
  fallback_reason?: string | null;
  setup_hint?: string | null;
  warnings: string[];
}

export interface VncSessionCloseResult {
  ok: boolean;
  message: string;
}

export const defaultProxyConfig: ConnectionProxyConfig = {
  kind: "none",
  host: "",
  password: "",
  port: 8080,
  username: "",
};

export const defaultJumpConfig: ConnectionJumpConfig = {
  kind: "none",
  jump_connection_id: "",
};

export const defaultAdvancedConfig: ConnectionAdvancedConfig = {
  auth_timeout_ms: 45000,
  connect_timeout_ms: 30000,
  keepalive_interval_ms: 20000,
  terminal_encoding: "utf-8",
};

export const defaultRdpConfig: RdpConnectionConfig = {
  domain: "",
  display: {
    mode: "embedded",
    width: 1440,
    height: 900,
    dynamic_resize: true,
    use_multimon: false,
  },
  resources: {
    clipboard: true,
    audio: "local",
    drives: false,
    printers: false,
    smart_cards: false,
  },
  gateway: {
    mode: "disabled",
    host: "",
    credential_source: "prompt",
  },
  remote_app: {
    enabled: false,
    program: "",
    working_dir: "",
    args: "",
  },
  performance: {
    preset: "auto",
    desktop_background: false,
    font_smoothing: true,
    visual_styles: true,
  },
  security: {
    credential_mode: "prompt",
    nla: "auto",
    certificate_policy: "prompt",
  },
  runner: {
    render_mode: "embedded",
    preferred_runner: undefined,
    custom_executable: "",
    custom_args_template: "",
  },
  raw_rdp_settings: "",
  raw_runner_args: "",
};

export const defaultVncConfig: VncConnectionConfig = {
  display: {
    scale_mode: "fit",
    resize_session: true,
    clip_viewport: true,
  },
  input: {
    view_only: false,
    clipboard: true,
    shared: true,
  },
  performance: {
    preset: "auto",
    quality_level: 6,
    compression_level: 2,
  },
  security: {
    credential_mode: "prompt",
  },
  runner: {
    render_mode: "embedded",
    preferred_runner: "novnc",
    custom_executable: "",
    custom_args_template: "",
  },
  raw_runner_args: "",
};

export const defaultTelnetConfig: TelnetConnectionConfig = {
  backspace_mode: "del",
  enter_mode: "crlf",
};

export const defaultSerialConfig: SerialConnectionConfig = {
  backspace_mode: "del",
  baud_rate: 9600,
  data_bits: "eight",
  flow_control: "none",
  parity: "none",
  port_name: "",
  stop_bits: "one",
};

export const terminalEncodingOptions: Array<{
  label: string;
  value: ConnectionTerminalEncoding;
}> = [
  { label: "UTF-8", value: "utf-8" },
  { label: "GBK", value: "gbk" },
  { label: "GB18030", value: "gb18030" },
  { label: "Big5", value: "big5" },
  { label: "EUC-JP", value: "euc-jp" },
  { label: "ISO-2022-JP", value: "iso-2022-jp" },
  { label: "Shift_JIS", value: "shift-jis" },
  { label: "EUC-KR", value: "euc-kr" },
];

export function normalizeTerminalEncoding(
  value?: string | null,
): ConnectionTerminalEncoding {
  const normalized = (value || "").trim().toLowerCase().replace(/_/g, "-");
  const option = terminalEncodingOptions.find((item) => item.value === normalized);
  return option?.value || defaultAdvancedConfig.terminal_encoding;
}

export function formatRdpRunnerKind(runner?: RdpRunnerKind | null) {
  switch (runner) {
    case "mstsc_activex":
      return "Windows embedded RDP";
    case "mstsc":
      return "mstsc.exe";
    case "freerdp":
      return "FreeRDP";
    case "macos_app":
      return "macOS RDP App";
    case "custom":
      return "自定义 RDP 客户端";
    default:
      return "自动选择";
  }
}

export function formatVncRunnerKind(runner?: VncRunnerKind | null) {
  switch (runner) {
    case "novnc":
      return "noVNC 内嵌";
    case "vncviewer":
      return "VNC Viewer";
    case "tigervnc":
      return "TigerVNC";
    case "realvnc":
      return "RealVNC";
    case "custom":
      return "自定义 VNC 客户端";
    default:
      return "自动选择";
  }
}
