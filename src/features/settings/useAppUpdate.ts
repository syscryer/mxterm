import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

import {
  checkForAppUpdate,
  formatAppDistributionMode,
  getAppRuntimeInfo,
  getUnsupportedUpdateMessage,
  installAppUpdate,
  type AppUpdateCheckResult,
} from "../../shared/tauri/appUpdate";
import type { AppRuntimeInfo } from "../../shared/tauri/commands";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "installing"
  | "failed"
  | "unsupported";

export interface UseAppUpdateResult {
  canInstall: boolean;
  checkNow: () => Promise<void>;
  checking: boolean;
  currentVersion: string;
  dismissWorkspaceNotice: () => void;
  distributionLabel: string;
  installNow: () => Promise<void>;
  installProgress: string | null;
  installing: boolean;
  message: string | null;
  repositoryUrl: string;
  runtimeInfo: AppRuntimeInfo | null;
  status: AppUpdateStatus;
  statusLabel: string;
  updateVersion: string | null;
  workspaceNoticeLabel: string | null;
  workspaceNoticeVisible: boolean;
}

export function useAppUpdate({
  autoCheckEnabled,
}: {
  autoCheckEnabled: boolean;
}): UseAppUpdateResult {
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const lastAutoCheckVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function loadRuntimeInfo() {
      try {
        const nextRuntimeInfo = await getAppRuntimeInfo();
        if (disposed) {
          return;
        }
        setRuntimeInfo(nextRuntimeInfo);
        const unsupportedMessage = getUnsupportedUpdateMessage(nextRuntimeInfo);
        if (unsupportedMessage) {
          setStatus("unsupported");
          setMessage(unsupportedMessage);
        } else {
          setStatus("idle");
          setMessage(null);
        }
      } catch (error) {
        if (!disposed) {
          setStatus("failed");
          setMessage(formatError(error, "运行时信息读取失败。"));
        }
      }
    }

    void loadRuntimeInfo();
    return () => {
      disposed = true;
    };
  }, []);

  const applyCheckResult = useCallback((result: AppUpdateCheckResult) => {
    setRuntimeInfo(result.runtimeInfo);
    setMessage(result.message);
    setInstallProgress(null);

    if (result.status === "available") {
      setStatus("available");
      setUpdate(result.update ?? null);
      setUpdateVersion(result.version ?? null);
      return;
    }

    setStatus(result.status);
    setUpdate(null);
    setUpdateVersion(null);
  }, []);

  const runCheck = useCallback(
    async (silent: boolean) => {
      setStatus("checking");
      setMessage(silent ? null : "正在检查 GitHub Release...");
      setInstallProgress(null);

      const result = await checkForAppUpdate({ silent });
      if (result) {
        applyCheckResult(result);
        return;
      }

      if (!silent) {
        setStatus("failed");
        setMessage("检查更新失败，请稍后重试。");
      } else if (runtimeInfo) {
        const unsupportedMessage = getUnsupportedUpdateMessage(runtimeInfo);
        setStatus(unsupportedMessage ? "unsupported" : "idle");
        setMessage(unsupportedMessage);
      }
    },
    [applyCheckResult, runtimeInfo],
  );

  useEffect(() => {
    if (!autoCheckEnabled || !runtimeInfo) {
      return;
    }
    if (getUnsupportedUpdateMessage(runtimeInfo)) {
      return;
    }
    if (lastAutoCheckVersionRef.current === runtimeInfo.version) {
      return;
    }

    lastAutoCheckVersionRef.current = runtimeInfo.version;
    void runCheck(true);
  }, [autoCheckEnabled, runtimeInfo, runCheck]);

  const checkNow = useCallback(async () => {
    await runCheck(false);
  }, [runCheck]);

  const installNow = useCallback(async () => {
    if (!update) {
      setStatus("failed");
      setMessage("没有可安装的更新，请先检查更新。");
      return;
    }

    setStatus("installing");
    setInstallProgress("正在准备更新...");
    setMessage(null);
    try {
      await installAppUpdate(update, setInstallProgress);
    } catch (error) {
      setStatus("failed");
      setMessage(formatError(error, "安装更新失败，请到 GitHub Release 手动下载。"));
    }
  }, [update]);

  const dismissWorkspaceNotice = useCallback(() => {
    if (updateVersion) {
      setDismissedVersion(updateVersion);
    }
  }, [updateVersion]);

  const workspaceNoticeVisible =
    status === "available" && Boolean(updateVersion) && dismissedVersion !== updateVersion;

  const statusLabel = useMemo(() => {
    if (status === "checking") return "检查中";
    if (status === "latest") return "已是最新";
    if (status === "available") return updateVersion ? `发现 ${updateVersion}` : "发现新版本";
    if (status === "installing") return "安装中";
    if (status === "failed") return "检查失败";
    if (status === "unsupported") return "不支持自动更新";
    return autoCheckEnabled ? "自动检查已开启" : "自动检查已关闭";
  }, [autoCheckEnabled, status, updateVersion]);

  return {
    canInstall: status === "available" && Boolean(update),
    checkNow,
    checking: status === "checking",
    currentVersion: runtimeInfo?.version || "--",
    dismissWorkspaceNotice,
    distributionLabel: runtimeInfo
      ? formatAppDistributionMode(runtimeInfo.distributionMode)
      : "读取中",
    installNow,
    installProgress,
    installing: status === "installing",
    message: status === "installing" ? installProgress : message,
    repositoryUrl: runtimeInfo?.repositoryUrl || "https://github.com/syscryer/mxterm",
    runtimeInfo,
    status,
    statusLabel,
    updateVersion,
    workspaceNoticeLabel:
      status === "available" ? (updateVersion ? `发现新版本 ${updateVersion}` : "有可用更新") : null,
    workspaceNoticeVisible,
  };
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
