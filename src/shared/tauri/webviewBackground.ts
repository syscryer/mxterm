import { resolveDesktopPlatform } from "./platformCapabilities";
import { hasTauriRuntime } from "./runtime";

const DEFAULT_BACKGROUND_TOKEN = "--mx-bg";

/**
 * Windows WebView2 在透明窗口 + Mica 材质下，输入法激活时会触发底层重绘导致内容区露底。
 * 通过显式设置 WebView 背景色来避免这个问题。
 */
export async function syncCurrentWebviewBackground(
  cssVariableName = DEFAULT_BACKGROUND_TOKEN,
) {
  if (typeof document === "undefined") {
    return false;
  }

  if (!hasTauriRuntime() || resolveDesktopPlatform() !== "windows") {
    return false;
  }

  // 等待 CSS 变量注入完成
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const bodyStyle = getComputedStyle(document.body);
  const documentStyle = getComputedStyle(document.documentElement);
  const backgroundColor =
    bodyStyle.getPropertyValue(cssVariableName).trim() ||
    documentStyle.getPropertyValue(cssVariableName).trim();

  if (!backgroundColor) {
    return false;
  }

  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setBackgroundColor(backgroundColor);
    return true;
  } catch {
    return false;
  }
}
