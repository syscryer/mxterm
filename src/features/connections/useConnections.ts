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
    id: "demo-dev",
    name: "开发环境",
    host: "203.0.113.70",
    port: 22,
    username: "root",
    auth_kind: "password",
    password: "",
    notes: "普通浏览器预览示例",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-test",
    name: "测试环境",
    host: "203.0.113.131",
    port: 22,
    username: "root",
    auth_kind: "password",
    password: "",
    notes: "普通浏览器预览示例",
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
