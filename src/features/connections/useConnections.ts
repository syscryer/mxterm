import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectionDelete,
  connectionList,
  connectionMarkConnected,
  connectionProbeSystem,
  connectionSetFavorite,
  connectionUpsert,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import {
  defaultAdvancedConfig,
  defaultJumpConfig,
  defaultProxyConfig,
  defaultRdpConfig,
  defaultVncConfig,
  normalizeTerminalEncoding,
  type ConnectionProfile,
  type ConnectionProfileInput,
  type ConnectionRuntimeCredentialRequest,
  type RdpConnectionConfig,
  type VncConnectionConfig,
} from "./connectionTypes";

const demoConnections: ConnectionProfile[] = [
  {
    id: "demo-dev-core",
    name: "开发环境 / edgs",
    protocol: "ssh",
    host: "203.0.113.70",
    port: 22,
    username: "root",
    group: "开发环境",
    credential_mode: "inline",
    inline_auth_kind: "password",
    inline_password: "",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "开发 收藏 k8s",
    is_favorite: true,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-test-web",
    name: "测试环境 / web",
    protocol: "ssh",
    host: "203.0.113.131",
    port: 22,
    username: "root",
    group: "测试环境",
    credential_mode: "inline",
    inline_auth_kind: "password",
    inline_password: "",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "测试 qa",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-bastion",
    name: "生产跳板",
    protocol: "ssh",
    host: "100.93.140.33",
    port: 22,
    username: "root",
    group: "生产环境",
    credential_mode: "inline",
    inline_auth_kind: "private_key",
    inline_private_key_path: "~/.ssh/id_ed25519",
    inline_private_key_passphrase: "",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "跳板 tailscale bastion",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-cloud-ubuntu",
    name: "云主机 / ubuntu",
    protocol: "ssh",
    host: "198.51.100.24",
    port: 22,
    username: "ubuntu",
    group: "云主机",
    credential_mode: "inline",
    inline_auth_kind: "private_key",
    inline_private_key_path: "~/.ssh/cloud.pem",
    inline_private_key_passphrase: "",
    proxy: defaultProxyConfig,
    jump: {
      kind: "ssh_jump",
      jump_connection_id: "demo-bastion",
    },
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "云 aws",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-dev-k8s",
    name: "dev-k8s-node2",
    protocol: "ssh",
    host: "203.0.113.16",
    port: 22,
    username: "root",
    group: "开发环境",
    credential_mode: "prompt",
    prompt_auth_kind: "password",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "开发 k8s preview",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-rdp-win",
    name: "办公 Windows",
    protocol: "rdp",
    host: "198.51.100.45",
    port: 3389,
    username: "administrator",
    group: "生产环境",
    credential_mode: "prompt",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: defaultRdpConfig,
    vnc: null,
    notes: "rdp windows desktop",
    is_favorite: true,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-vnc-linux",
    name: "Linux 图形桌面",
    protocol: "vnc",
    host: "198.51.100.88",
    port: 5900,
    username: "vncuser",
    group: "生产环境",
    credential_mode: "prompt",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    vnc: defaultVncConfig,
    notes: "vnc desktop",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-stage",
    name: "预发环境 / stage",
    protocol: "ssh",
    host: "198.51.100.78",
    port: 22,
    username: "deploy",
    group: "预发环境",
    credential_mode: "inline",
    inline_auth_kind: "password",
    inline_password: "",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    rdp: null,
    notes: "stage 测试",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
];

export function useConnections(options: { enabled?: boolean } = {}) {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isTauri = hasTauriRuntime();
  const enabled = options.enabled ?? true;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!enabled) {
      setConnections([]);
      setLoading(false);
      return;
    }

    if (!isTauri) {
      setConnections(demoConnections);
      setLoading(false);
      return;
    }

    try {
      setConnections(await connectionList());
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setLoading(false);
    }
  }, [enabled, isTauri]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback(
    async (input: ConnectionProfileInput) => {
      const normalized = normalizeConnectionInput(input);
      if (!isTauri) {
        const now = "preview";
        const profile: ConnectionProfile = {
          ...normalized,
          id: normalized.id || `preview-${Date.now().toString()}`,
          is_favorite: Boolean(normalized.is_favorite),
          last_connected_at: normalized.last_connected_at || null,
          name:
            normalized.name ||
            `${normalized.username.trim()}@${normalized.host.trim()}`,
          created_at: now,
          updated_at: now,
        };

        setConnections((items) => {
          const index = items.findIndex((item) => item.id === profile.id);
          if (index === -1) {
            return [...items, profile];
          }

          return items.map((item) => (item.id === profile.id ? profile : item));
        });

        return profile;
      }

      const profile = await connectionUpsert(normalized);
      setConnections((items) => {
        const index = items.findIndex((item) => item.id === profile.id);
        if (index === -1) {
          return [...items, profile];
        }

        return items.map((item) => (item.id === profile.id ? profile : item));
      });

      return profile;
    },
    [isTauri],
  );

  const setFavorite = useCallback(
    async (connectionId: string, isFavorite: boolean) => {
      if (isTauri) {
        const profile = await connectionSetFavorite(connectionId, isFavorite);
        setConnections((items) =>
          items.map((item) => (item.id === profile.id ? profile : item)),
        );
        return profile;
      }

      const now = new Date().toISOString();
      let nextProfile: ConnectionProfile | null = null;
      setConnections((items) =>
        items.map((item) => {
          if (item.id !== connectionId) {
            return item;
          }
          nextProfile = {
            ...item,
            is_favorite: isFavorite,
            updated_at: now,
          };
          return nextProfile;
        }),
      );
      return nextProfile;
    },
    [isTauri],
  );

  const markConnected = useCallback(
    async (connectionId: string) => {
      if (isTauri) {
        const profile = await connectionMarkConnected(connectionId);
        setConnections((items) =>
          items.map((item) => (item.id === profile.id ? profile : item)),
        );
        return profile;
      }

      const now = new Date().toISOString();
      let nextProfile: ConnectionProfile | null = null;
      setConnections((items) =>
        items.map((item) => {
          if (item.id !== connectionId) {
            return item;
          }
          nextProfile = {
            ...item,
            last_connected_at: now,
          };
          return nextProfile;
        }),
      );
      return nextProfile;
    },
    [isTauri],
  );

  const probeSystem = useCallback(
    async (request: ConnectionRuntimeCredentialRequest) => {
      if (!isTauri) {
        return null;
      }

      const profile = await connectionProbeSystem(request);
      setConnections((items) =>
        items.map((item) => (item.id === profile.id ? profile : item)),
      );
      return profile;
    },
    [isTauri],
  );

  const remove = useCallback(
    async (id: string) => {
      if (isTauri) {
        await connectionDelete(id);
      }

      setConnections((items) => items.filter((item) => item.id !== id));
    },
    [isTauri],
  );

  return useMemo(
    () => ({
      connections,
      error,
      loading,
      markConnected,
      probeSystem,
      reload,
      remove,
      setFavorite,
      upsert,
    }),
    [
      connections,
      error,
      loading,
      markConnected,
      probeSystem,
      reload,
      remove,
      setFavorite,
      upsert,
    ],
  );
}
export function normalizeConnectionInput(input: ConnectionProfileInput): ConnectionProfileInput {
  const protocol = input.protocol || "ssh";
  if (protocol === "rdp") {
    const trim = (value: string | undefined | null) => value?.trim() || undefined;
    const credentialMode = input.credential_mode || "prompt";
    const inlinePassword = trim(input.inline_password || input.password);
    const inlinePasswordTouched =
      typeof input.inline_password_touched === "boolean"
        ? input.inline_password_touched
        : Boolean(inlinePassword);

    return {
      id: trim(input.id),
      protocol: "rdp",
      name: trim(input.name),
      group: trim(input.group),
      host: input.host.trim(),
      port: Number(input.port) || 3389,
      username: input.username.trim(),
      credential_mode: credentialMode,
      credential_id: credentialMode === "saved" ? trim(input.credential_id) : undefined,
      inline_auth_kind: credentialMode === "inline" ? "password" : undefined,
      inline_password:
        credentialMode === "inline" && inlinePasswordTouched ? inlinePassword : undefined,
      inline_password_touched: credentialMode === "inline" ? inlinePasswordTouched : false,
      inline_private_key_path: undefined,
      inline_private_key_passphrase: undefined,
      inline_private_key_passphrase_touched: false,
      prompt_auth_kind: undefined,
      proxy: { kind: "none" },
      jump: { kind: "none" },
      advanced: defaultAdvancedConfig,
      rdp: normalizeRdpConfig(input.rdp),
      vnc: undefined,
      notes: trim(input.notes),
      is_favorite: input.is_favorite,
      last_connected_at: trim(input.last_connected_at),
      remote_os_id: trim(input.remote_os_id),
      remote_os_name: trim(input.remote_os_name),
      remote_os_version: trim(input.remote_os_version),
    };
  }

  if (protocol === "vnc") {
    const trim = (value: string | undefined | null) => value?.trim() || undefined;
    const credentialMode = input.credential_mode || "prompt";
    const inlinePassword = trim(input.inline_password || input.password);
    const inlinePasswordTouched =
      typeof input.inline_password_touched === "boolean"
        ? input.inline_password_touched
        : Boolean(inlinePassword);

    return {
      id: trim(input.id),
      protocol: "vnc",
      name: trim(input.name),
      group: trim(input.group),
      host: input.host.trim(),
      port: Number(input.port) || 5900,
      username: input.username.trim(),
      credential_mode: credentialMode,
      credential_id: credentialMode === "saved" ? trim(input.credential_id) : undefined,
      inline_auth_kind: credentialMode === "inline" ? "password" : undefined,
      inline_password:
        credentialMode === "inline" && inlinePasswordTouched ? inlinePassword : undefined,
      inline_password_touched: credentialMode === "inline" ? inlinePasswordTouched : false,
      inline_private_key_path: undefined,
      inline_private_key_passphrase: undefined,
      inline_private_key_passphrase_touched: false,
      prompt_auth_kind: undefined,
      proxy: { kind: "none" },
      jump: { kind: "none" },
      advanced: defaultAdvancedConfig,
      rdp: undefined,
      vnc: normalizeVncConfig(input.vnc),
      notes: trim(input.notes),
      is_favorite: input.is_favorite,
      last_connected_at: trim(input.last_connected_at),
      remote_os_id: trim(input.remote_os_id),
      remote_os_name: trim(input.remote_os_name),
      remote_os_version: trim(input.remote_os_version),
    };
  }

  const credentialMode = input.credential_mode || "inline";
  const inlineAuthKind =
    input.inline_auth_kind || input.auth_kind || (input.private_key_path ? "private_key" : "password");
  const promptAuthKind = input.prompt_auth_kind || input.auth_kind || "password";
  const proxyKind = input.proxy?.kind || "none";
  const trim = (value: string | undefined | null) => value?.trim() || undefined;
  const inlinePassword = trim(input.inline_password || input.password);
  const inlinePrivateKeyPassphrase = trim(
    input.inline_private_key_passphrase || input.private_key_passphrase,
  );
  const inlinePasswordTouched =
    typeof input.inline_password_touched === "boolean"
      ? input.inline_password_touched
      : Boolean(inlinePassword);
  const inlinePrivateKeyPassphraseTouched =
    typeof input.inline_private_key_passphrase_touched === "boolean"
      ? input.inline_private_key_passphrase_touched
      : Boolean(inlinePrivateKeyPassphrase);

  return {
    id: trim(input.id),
    protocol: "ssh",
    name: trim(input.name),
    group: trim(input.group),
    host: input.host.trim(),
    port: Number(input.port) || 22,
    username: input.username.trim(),
    credential_mode: credentialMode,
    credential_id: credentialMode === "saved" ? trim(input.credential_id) : undefined,
    inline_auth_kind: credentialMode === "inline" ? inlineAuthKind : undefined,
    inline_password:
      credentialMode === "inline" && inlineAuthKind === "password" && inlinePasswordTouched
        ? inlinePassword
        : undefined,
    inline_password_touched:
      credentialMode === "inline" && inlineAuthKind === "password"
        ? inlinePasswordTouched
        : false,
    inline_private_key_path:
      credentialMode === "inline" && inlineAuthKind === "private_key"
        ? trim(input.inline_private_key_path || input.private_key_path)
        : undefined,
    inline_private_key_passphrase:
      credentialMode === "inline" &&
      inlineAuthKind === "private_key" &&
      inlinePrivateKeyPassphraseTouched
        ? inlinePrivateKeyPassphrase
        : undefined,
    inline_private_key_passphrase_touched:
      credentialMode === "inline" && inlineAuthKind === "private_key"
        ? inlinePrivateKeyPassphraseTouched
        : false,
    prompt_auth_kind: credentialMode === "prompt" ? promptAuthKind : undefined,
    proxy:
      proxyKind === "none"
        ? { kind: "none" }
        : {
            kind: proxyKind,
            host: trim(input.proxy?.host),
            port: Number(input.proxy?.port) || undefined,
            username: trim(input.proxy?.username),
            password: trim(input.proxy?.password),
          },
    jump: normalizeJumpConfig(input.jump),
    advanced: {
      auth_timeout_ms:
        Number(input.advanced?.auth_timeout_ms) || defaultAdvancedConfig.auth_timeout_ms,
      connect_timeout_ms:
        Number(input.advanced?.connect_timeout_ms) || defaultAdvancedConfig.connect_timeout_ms,
      keepalive_interval_ms:
        Number(input.advanced?.keepalive_interval_ms) ||
        defaultAdvancedConfig.keepalive_interval_ms,
      terminal_encoding: normalizeTerminalEncoding(input.advanced?.terminal_encoding),
    },
    rdp: undefined,
    vnc: undefined,
    notes: trim(input.notes),
    is_favorite: input.is_favorite,
    last_connected_at: trim(input.last_connected_at),
    remote_os_id: trim(input.remote_os_id),
    remote_os_name: trim(input.remote_os_name),
    remote_os_version: trim(input.remote_os_version),
  };
}

function normalizeVncConfig(input?: VncConnectionConfig | null): VncConnectionConfig {
  const vnc = input || defaultVncConfig;
  const trim = (value: string | undefined | null) => value?.trim() || undefined;
  const renderMode = vnc.runner?.render_mode || defaultVncConfig.runner.render_mode;

  return {
    display: {
      scale_mode: vnc.display?.scale_mode || defaultVncConfig.display.scale_mode,
      resize_session: vnc.display?.resize_session ?? defaultVncConfig.display.resize_session,
      clip_viewport: vnc.display?.clip_viewport ?? defaultVncConfig.display.clip_viewport,
    },
    input: {
      view_only: Boolean(vnc.input?.view_only),
      clipboard: vnc.input?.clipboard ?? defaultVncConfig.input.clipboard,
      shared: vnc.input?.shared ?? defaultVncConfig.input.shared,
    },
    performance: {
      preset: vnc.performance?.preset || defaultVncConfig.performance.preset,
      quality_level:
        typeof vnc.performance?.quality_level === "number"
          ? Math.min(9, Math.max(0, vnc.performance.quality_level))
          : defaultVncConfig.performance.quality_level,
      compression_level:
        typeof vnc.performance?.compression_level === "number"
          ? Math.min(9, Math.max(0, vnc.performance.compression_level))
          : defaultVncConfig.performance.compression_level,
    },
    security: {
      credential_mode: vnc.security?.credential_mode || defaultVncConfig.security.credential_mode,
    },
    runner: {
      render_mode: renderMode,
      preferred_runner:
        renderMode === "embedded"
          ? "novnc"
          : vnc.runner?.preferred_runner || defaultVncConfig.runner.preferred_runner,
      custom_executable: renderMode === "custom" ? trim(vnc.runner?.custom_executable) : undefined,
      custom_args_template:
        renderMode === "custom" ? trim(vnc.runner?.custom_args_template) : undefined,
    },
    raw_runner_args: trim(vnc.raw_runner_args),
  };
}

function normalizeRdpConfig(input?: RdpConnectionConfig | null): RdpConnectionConfig {
  const rdp = input || defaultRdpConfig;
  const trim = (value: string | undefined | null) => value?.trim() || undefined;
  const gatewayMode = rdp.gateway?.mode || "disabled";
  const remoteAppEnabled = Boolean(rdp.remote_app?.enabled);
  const renderMode = rdp.runner?.render_mode === "external" ? "external" : "embedded";
  const displayMode =
    rdp.display?.mode === "windowed" ? defaultRdpConfig.display.mode : rdp.display?.mode;

  return {
    domain: trim(rdp.domain),
    display: {
      mode: displayMode || defaultRdpConfig.display.mode,
      width: Number(rdp.display?.width) || defaultRdpConfig.display.width,
      height: Number(rdp.display?.height) || defaultRdpConfig.display.height,
      dynamic_resize: rdp.display?.dynamic_resize ?? defaultRdpConfig.display.dynamic_resize,
      use_multimon:
        rdp.display?.mode === "all_monitors" ||
        Boolean(rdp.display?.use_multimon),
    },
    resources: {
      clipboard: rdp.resources?.clipboard ?? defaultRdpConfig.resources.clipboard,
      audio: rdp.resources?.audio || defaultRdpConfig.resources.audio,
      drives: Boolean(rdp.resources?.drives),
      printers: Boolean(rdp.resources?.printers),
      smart_cards: Boolean(rdp.resources?.smart_cards),
    },
    gateway:
      gatewayMode === "disabled"
        ? null
        : {
            mode: gatewayMode,
            host: trim(rdp.gateway?.host),
            credential_source:
              rdp.gateway?.credential_source ||
              defaultRdpConfig.gateway?.credential_source ||
              "prompt",
          },
    remote_app: remoteAppEnabled
      ? {
          enabled: true,
          program: trim(rdp.remote_app?.program),
          working_dir: trim(rdp.remote_app?.working_dir),
          args: trim(rdp.remote_app?.args),
        }
      : { enabled: false },
    performance: {
      preset: rdp.performance?.preset || defaultRdpConfig.performance.preset,
      desktop_background: Boolean(rdp.performance?.desktop_background),
      font_smoothing:
        rdp.performance?.font_smoothing ?? defaultRdpConfig.performance.font_smoothing,
      visual_styles:
        rdp.performance?.visual_styles ?? defaultRdpConfig.performance.visual_styles,
    },
    security: {
      credential_mode:
        rdp.security?.credential_mode || defaultRdpConfig.security.credential_mode,
      nla: rdp.security?.nla || defaultRdpConfig.security.nla,
      certificate_policy:
        rdp.security?.certificate_policy || defaultRdpConfig.security.certificate_policy,
    },
    runner: {
      render_mode: renderMode,
      preferred_runner: renderMode === "external" ? "mstsc" : undefined,
      custom_executable: undefined,
      custom_args_template: undefined,
    },
    raw_rdp_settings: trim(rdp.raw_rdp_settings),
    raw_runner_args: undefined,
  };
}

function normalizeJumpConfig(input: ConnectionProfileInput["jump"]) {
  if (input?.kind !== "ssh_jump") {
    return { kind: "none" as const };
  }

  return {
    kind: "ssh_jump" as const,
    jump_connection_id: input.jump_connection_id?.trim() || "",
  };
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}
