import type { WindowMaterialMode } from "../../features/settings/settingsTypes";

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

export interface PlatformCapabilities {
  platform: DesktopPlatform;
  supportsExternalRdp: boolean;
  supportsEmbeddedRdp: boolean;
  supportsMacosGlass: boolean;
  supportsWindowMaterials: boolean;
  supportsWindowsPty: boolean;
  windowMaterials: WindowMaterialMode[];
}

export function resolveDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platformText = [
    navigatorWithUserAgentData.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");

  if (/mac/i.test(platformText)) return "macos";
  if (/win/i.test(platformText)) return "windows";
  if (/linux|x11/i.test(platformText)) return "linux";
  return "unknown";
}

export function getPlatformCapabilities(
  platform: DesktopPlatform = resolveDesktopPlatform(),
): PlatformCapabilities {
  const windowMaterials = getPlatformWindowMaterials(platform);
  return {
    platform,
    supportsEmbeddedRdp: platform === "windows",
    supportsExternalRdp: platform === "windows" || platform === "macos" || platform === "linux",
    supportsMacosGlass: platform === "macos",
    supportsWindowMaterials: windowMaterials.length > 1,
    supportsWindowsPty: platform === "windows",
    windowMaterials,
  };
}

export function getPlatformWindowMaterials(platform: DesktopPlatform): WindowMaterialMode[] {
  if (platform === "windows") {
    return ["auto", "mica", "acrylic", "micaAlt"];
  }
  if (platform === "macos") {
    return ["auto", "macosGlass"];
  }

  return ["auto"];
}
