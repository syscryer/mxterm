import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  secretVaultDisableMasterPassword,
  secretVaultEnableMasterPassword,
  secretVaultStatus,
  secretVaultUnlock,
  secretVaultUnlockLocal,
  type SecretVaultStatus,
} from "../../shared/tauri/commands";
import { hasTauriRuntime } from "../../shared/tauri/runtime";

const previewStatus: SecretVaultStatus = {
  initialized: true,
  unlocked: true,
};

export function useSecretVault({ masterPasswordEnabled }: { masterPasswordEnabled: boolean }) {
  const isTauri = hasTauriRuntime();
  const [status, setStatus] = useState<SecretVaultStatus>(
    isTauri ? { initialized: false, unlocked: false } : previewStatus,
  );
  const [loading, setLoading] = useState(isTauri);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localAutoUnlockAttemptedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setStatus(previewStatus);
      setLoading(false);
      setError(null);
      return previewStatus;
    }

    setLoading(true);
    setError(null);
    try {
      const nextStatus = await secretVaultStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch (nextError) {
      setError(formatError(nextError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    localAutoUnlockAttemptedRef.current = false;
  }, [isTauri, masterPasswordEnabled]);

  const unlock = useCallback(
    async (masterPassword: string) => {
      if (!isTauri) {
        setStatus(previewStatus);
        return previewStatus;
      }

      setUnlocking(true);
      setError(null);
      try {
        const nextStatus = await secretVaultUnlock(masterPassword);
        setStatus(nextStatus);
        return nextStatus;
      } catch (nextError) {
        setError(formatError(nextError));
        return null;
      } finally {
        setUnlocking(false);
      }
    },
    [isTauri],
  );

  const unlockLocal = useCallback(async () => {
    if (!isTauri) {
      setStatus(previewStatus);
      return previewStatus;
    }

    setUnlocking(true);
    setError(null);
    try {
      const nextStatus = await secretVaultUnlockLocal();
      setStatus(nextStatus);
      return nextStatus;
    } catch (nextError) {
      setError(formatError(nextError));
      return null;
    } finally {
      setUnlocking(false);
    }
  }, [isTauri]);

  useEffect(() => {
    if (
      !isTauri ||
      masterPasswordEnabled ||
      loading ||
      unlocking ||
      status.unlocked ||
      localAutoUnlockAttemptedRef.current
    ) {
      return;
    }
    localAutoUnlockAttemptedRef.current = true;
    void unlockLocal();
  }, [isTauri, loading, masterPasswordEnabled, status.unlocked, unlockLocal, unlocking]);

  const enableMasterPassword = useCallback(
    async (masterPassword: string) => {
      if (!isTauri) {
        setStatus(previewStatus);
        return previewStatus;
      }

      setUnlocking(true);
      setError(null);
      try {
        const nextStatus = await secretVaultEnableMasterPassword(masterPassword);
        setStatus(nextStatus);
        return nextStatus;
      } catch (nextError) {
        setError(formatError(nextError));
        return null;
      } finally {
        setUnlocking(false);
      }
    },
    [isTauri],
  );

  const disableMasterPassword = useCallback(async () => {
    if (!isTauri) {
      setStatus(previewStatus);
      return previewStatus;
    }

    setUnlocking(true);
    setError(null);
    try {
      const nextStatus = await secretVaultDisableMasterPassword();
      setStatus(nextStatus);
      return nextStatus;
    } catch (nextError) {
      setError(formatError(nextError));
      return null;
    } finally {
      setUnlocking(false);
    }
  }, [isTauri]);

  return useMemo(
    () => ({
      disableMasterPassword,
      enableMasterPassword,
      error,
      loading,
      ready: !isTauri || status.unlocked,
      requiresUnlock: isTauri && !status.unlocked && (masterPasswordEnabled || Boolean(error)),
      refresh,
      status,
      unlock,
      unlocking,
    }),
    [
      disableMasterPassword,
      enableMasterPassword,
      error,
      isTauri,
      loading,
      masterPasswordEnabled,
      refresh,
      status,
      unlock,
      unlocking,
    ],
  );
}

function formatError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}