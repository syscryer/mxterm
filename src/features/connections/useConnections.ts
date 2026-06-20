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
  normalizeTerminalEncoding,
  type ConnectionProfile,
  type ConnectionProfileInput,
  type ConnectionRuntimeCredentialRequest,
} from "./connectionTypes";

const demoConnections: ConnectionProfile[] = [
  {
    id: "demo-dev-core",
    name: "开发环境 / edgs",
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
    notes: "开发 收藏 k8s",
    is_favorite: true,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-test-web",
    name: "测试环境 / web",
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
    notes: "测试 qa",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-bastion",
    name: "生产跳板",
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
    notes: "跳板 tailscale bastion",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-cloud-ubuntu",
    name: "云主机 / ubuntu",
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
    notes: "云 aws",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-dev-k8s",
    name: "dev-k8s-node2",
    host: "203.0.113.16",
    port: 22,
    username: "root",
    group: "开发环境",
    credential_mode: "prompt",
    prompt_auth_kind: "password",
    proxy: defaultProxyConfig,
    jump: defaultJumpConfig,
    advanced: defaultAdvancedConfig,
    notes: "开发 k8s preview",
    is_favorite: false,
    last_connected_at: "demo",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-stage",
    name: "预发环境 / stage",
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
  const credentialMode = input.credential_mode || "inline";
  const inlineAuthKind =
    input.inline_auth_kind || input.auth_kind || (input.private_key_path ? "private_key" : "password");
  const promptAuthKind = input.prompt_auth_kind || input.auth_kind || "password";
  const proxyKind = input.proxy?.kind || "none";
  const trim = (value: string | undefined | null) => value?.trim() || undefined;

  return {
    id: trim(input.id),
    name: trim(input.name),
    group: trim(input.group),
    host: input.host.trim(),
    port: Number(input.port) || 22,
    username: input.username.trim(),
    credential_mode: credentialMode,
    credential_id: credentialMode === "saved" ? trim(input.credential_id) : undefined,
    inline_auth_kind: credentialMode === "inline" ? inlineAuthKind : undefined,
    inline_password:
      credentialMode === "inline" && inlineAuthKind === "password"
        ? trim(input.inline_password || input.password)
        : undefined,
    inline_private_key_path:
      credentialMode === "inline" && inlineAuthKind === "private_key"
        ? trim(input.inline_private_key_path || input.private_key_path)
        : undefined,
    inline_private_key_passphrase:
      credentialMode === "inline" && inlineAuthKind === "private_key"
        ? trim(input.inline_private_key_passphrase || input.private_key_passphrase)
        : undefined,
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
    notes: trim(input.notes),
    is_favorite: input.is_favorite,
    last_connected_at: trim(input.last_connected_at),
    remote_os_id: trim(input.remote_os_id),
    remote_os_name: trim(input.remote_os_name),
    remote_os_version: trim(input.remote_os_version),
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
