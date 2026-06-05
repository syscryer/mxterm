import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectionDelete,
  connectionList,
  connectionUpsert,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type { ConnectionProfile, ConnectionProfileInput } from "./connectionTypes";

const demoConnections: ConnectionProfile[] = [
  {
    id: "demo-dev-core",
    name: "开发环境 / edgs",
    host: "203.0.113.70",
    port: 22,
    username: "root",
    auth_kind: "password",
    password: "",
    notes: "开发 收藏 k8s",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-test-web",
    name: "测试环境 / web",
    host: "203.0.113.131",
    port: 22,
    username: "root",
    auth_kind: "password",
    password: "",
    notes: "测试 qa",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-bastion",
    name: "生产跳板",
    host: "100.93.140.33",
    port: 22,
    username: "root",
    auth_kind: "private_key",
    private_key_path: "~/.ssh/id_ed25519",
    private_key_passphrase: "",
    notes: "跳板 tailscale bastion",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-cloud-ubuntu",
    name: "云主机 / ubuntu",
    host: "198.51.100.24",
    port: 22,
    username: "ubuntu",
    auth_kind: "private_key",
    private_key_path: "~/.ssh/cloud.pem",
    private_key_passphrase: "",
    notes: "云 aws",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-dev-k8s",
    name: "dev-k8s-node2",
    host: "203.0.113.16",
    port: 22,
    username: "root",
    auth_kind: "password",
    password: "",
    notes: "开发 k8s preview",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-stage",
    name: "预发环境 / stage",
    host: "198.51.100.78",
    port: 22,
    username: "deploy",
    auth_kind: "password",
    password: "",
    notes: "stage 测试",
    created_at: "demo",
    updated_at: "demo",
  },
];

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isTauri = hasTauriRuntime();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

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
  }, [isTauri]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback(
    async (input: ConnectionProfileInput) => {
      if (!isTauri) {
        const now = "preview";
        const profile: ConnectionProfile = {
          id: input.id || `preview-${Date.now().toString()}`,
          name: input.name?.trim() || `${input.username.trim()}@${input.host.trim()}`,
          host: input.host.trim(),
          port: input.port,
          username: input.username.trim(),
          auth_kind: input.auth_kind,
          password: input.password?.trim() || undefined,
          private_key_path: input.private_key_path?.trim() || undefined,
          private_key_passphrase: input.private_key_passphrase?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
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

      const profile = await connectionUpsert(input);
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
      reload,
      remove,
      upsert,
    }),
    [connections, error, loading, reload, remove, upsert],
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}
