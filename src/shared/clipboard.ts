import { hasTauriRuntime } from "./tauri/runtime";

async function writeTextViaTauri(text: string): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }
  try {
    const plugin = await import("@tauri-apps/plugin-clipboard-manager");
    await plugin.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function readTextViaTauri(): Promise<string | null> {
  if (!hasTauriRuntime()) {
    return null;
  }
  try {
    const plugin = await import("@tauri-apps/plugin-clipboard-manager");
    return await plugin.readText();
  } catch {
    return null;
  }
}

export async function copyTextToClipboard(text: string) {
  if (await writeTextViaTauri(text)) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand below when the browser denies async clipboard writes.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}

/**
 * 读取系统剪贴板文本。Tauri 环境走原生插件（无浏览器权限提示），
 * 其余环境回退到 Web Clipboard API（可能触发权限提示或被拒绝）。
 * 读取失败时返回空字符串。
 */
export async function readTextFromClipboard(): Promise<string> {
  const tauriText = await readTextViaTauri();
  if (tauriText !== null) {
    return tauriText;
  }

  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }

  return "";
}
