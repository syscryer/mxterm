import type { HostKeyInfo } from "./connectionTypes";

export type HostKeyDecision = "unknown" | "changed";

export interface ParsedHostKeyError {
  decision: HostKeyDecision;
  hostKey: HostKeyInfo;
  oldFingerprint: string | null;
}

export function parseHostKeyError(error: unknown): ParsedHostKeyError | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code: unknown }).code;
  if (code !== "host_key_unknown" && code !== "host_key_changed") {
    return null;
  }
  const raw = String((error as { raw_message?: unknown }).raw_message || "");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isHostKeyInfo(parsed)) {
      return {
        decision: "unknown",
        hostKey: parsed,
        oldFingerprint: null,
      };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "host_key" in parsed &&
      isHostKeyInfo((parsed as { host_key: unknown }).host_key)
    ) {
      const changedPayload = parsed as {
        host_key: HostKeyInfo;
        old_fingerprint_sha256?: unknown;
      };
      return {
        decision: code === "host_key_changed" ? "changed" : "unknown",
        hostKey: changedPayload.host_key,
        oldFingerprint:
          typeof changedPayload.old_fingerprint_sha256 === "string"
            ? changedPayload.old_fingerprint_sha256
            : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function isHostKeyInfo(value: unknown): value is HostKeyInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const info = value as Partial<HostKeyInfo>;
  return (
    typeof info.host === "string" &&
    typeof info.port === "number" &&
    typeof info.key_algorithm === "string" &&
    typeof info.fingerprint_sha256 === "string" &&
    typeof info.public_key === "string"
  );
}
