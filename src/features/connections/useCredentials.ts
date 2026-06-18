import { useCallback, useEffect, useMemo, useState } from "react";

import {
  credentialDelete,
  credentialList,
  credentialUpsert,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";
import type { CredentialProfile, CredentialProfileInput } from "./connectionTypes";

const demoCredentials: CredentialProfile[] = [
  {
    id: "demo-credential-root-password",
    name: "root 密码账号",
    username: "root",
    kind: "password",
    password: "",
    notes: "预览账号",
    created_at: "demo",
    updated_at: "demo",
  },
  {
    id: "demo-credential-cloud-key",
    name: "云主机私钥账号",
    username: "deploy",
    kind: "private_key",
    private_key_path: "~/.ssh/cloud.pem",
    private_key_passphrase: "",
    notes: "预览账号",
    created_at: "demo",
    updated_at: "demo",
  },
];

export function useCredentials() {
  const [credentials, setCredentials] = useState<CredentialProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isTauri = hasTauriRuntime();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!isTauri) {
      setCredentials(demoCredentials);
      setLoading(false);
      return;
    }

    try {
      setCredentials(await credentialList());
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
    async (input: CredentialProfileInput) => {
      const normalized = normalizeCredentialInput(input);
      if (!isTauri) {
        const now = "preview";
        const profile: CredentialProfile = {
          ...normalized,
          id: normalized.id || `preview-credential-${Date.now().toString()}`,
          name: normalized.name || defaultCredentialName(normalized),
          created_at: now,
          updated_at: now,
        };
        setCredentials((items) => upsertLocal(items, profile));
        return profile;
      }

      const profile = await credentialUpsert(normalized);
      setCredentials((items) => upsertLocal(items, profile));
      return profile;
    },
    [isTauri],
  );

  const remove = useCallback(
    async (id: string) => {
      if (isTauri) {
        await credentialDelete(id);
      }
      setCredentials((items) => items.filter((item) => item.id !== id));
    },
    [isTauri],
  );

  return useMemo(
    () => ({
      credentials,
      error,
      loading,
      reload,
      remove,
      upsert,
    }),
    [credentials, error, loading, reload, remove, upsert],
  );
}

function normalizeCredentialInput(input: CredentialProfileInput): CredentialProfileInput {
  const trim = (value: string | undefined | null) => value?.trim() || undefined;
  return {
    id: trim(input.id),
    kind: input.kind,
    name: trim(input.name),
    username: trim(input.username),
    notes: trim(input.notes),
    password: input.kind === "password" ? trim(input.password) : undefined,
    private_key_path:
      input.kind === "private_key" ? trim(input.private_key_path) : undefined,
    private_key_passphrase:
      input.kind === "private_key" ? trim(input.private_key_passphrase) : undefined,
  };
}

function defaultCredentialName(input: CredentialProfileInput) {
  return input.kind === "private_key" ? "SSH 私钥账号" : "SSH 密码账号";
}

function upsertLocal(items: CredentialProfile[], profile: CredentialProfile) {
  const index = items.findIndex((item) => item.id === profile.id);
  if (index === -1) {
    return [...items, profile];
  }
  return items.map((item) => (item.id === profile.id ? profile : item));
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}
