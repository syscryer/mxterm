import type { WindowMaterialMode } from "../../features/settings/settingsTypes";
import {
  getPlatformCapabilities,
  getPlatformWindowMaterials,
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "./platformCapabilities";
import {
  getSupportedWindowMaterialsCommand,
  setWindowMaterialCommand,
  type NativeWindowMaterial,
} from "./commands";
import { hasTauriRuntime } from "./runtime";

export { getPlatformWindowMaterials, resolveDesktopPlatform, type DesktopPlatform };

const windowMaterialIds: Record<WindowMaterialMode, number> = {
  auto: 0,
  mica: 2,
  acrylic: 3,
  micaAlt: 4,
  macosGlass: 10,
};

const windowMaterialById: Record<number, WindowMaterialMode | undefined> = {
  0: "auto",
  2: "mica",
  3: "acrylic",
  4: "micaAlt",
  10: "macosGlass",
};

const windowMaterialLabels: Record<WindowMaterialMode, string> = {
  auto: "默认",
  mica: "Mica",
  acrylic: "Acrylic",
  micaAlt: "Mica Alt",
  macosGlass: "macOS Glass",
};

export function normalizeWindowMaterial(
  material: WindowMaterialMode,
  supportedMaterials: readonly WindowMaterialMode[],
): WindowMaterialMode {
  if (supportedMaterials.includes(material)) {
    return material;
  }

  return supportedMaterials[0] ?? "auto";
}

export function getWindowMaterialLabel(material: WindowMaterialMode) {
  return windowMaterialLabels[material];
}

export async function getSupportedWindowMaterials(): Promise<WindowMaterialMode[]> {
  const fallback = getPlatformCapabilities().windowMaterials;

  if (!hasTauriRuntime()) {
    return fallback;
  }

  try {
    const materials = await getSupportedWindowMaterialsCommand();
    const allowed = new Set(fallback);
    const normalized = normalizeNativeWindowMaterials(materials).filter((material) =>
      allowed.has(material),
    );
    return normalized.length > 0 ? normalized : fallback;
  } catch {
    return fallback;
  }
}

export async function setWindowMaterial(material: WindowMaterialMode) {
  if (!hasTauriRuntime()) {
    return false;
  }

  try {
    await setWindowMaterialCommand(windowMaterialIds[material]);
    return true;
  } catch {
    return false;
  }
}

function normalizeNativeWindowMaterials(materials: NativeWindowMaterial[]) {
  return materials
    .map((material) => windowMaterialById[material.id])
    .filter((material): material is WindowMaterialMode => Boolean(material));
}
