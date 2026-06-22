export function commandLibraryTimestampMs(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{1,10}$/u.test(normalized)) {
    return Number(normalized) * 1000;
  }

  if (/^\d{11,}$/u.test(normalized)) {
    return Number(normalized);
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareCommandLibraryTimestampsDesc(left?: string | null, right?: string | null) {
  return (commandLibraryTimestampMs(right) || 0) - (commandLibraryTimestampMs(left) || 0);
}

export function formatCommandLibraryTime(value?: string | null) {
  if (!value) {
    return "未使用";
  }

  const timestamp = commandLibraryTimestampMs(value);
  if (timestamp === null) {
    return value;
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  });
}
