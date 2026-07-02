export type DockerInitialRefreshView = "containers" | "images" | "engine";
export type DockerInitialRefreshToolboxView = "docker" | "network" | "schedule";
export type DockerAutoRefreshKind = "containers" | "images" | "engine";

export interface DockerInitialRefreshInput {
  active: boolean;
  connectionId: string | null;
  documentVisible: boolean;
  dockerView: DockerInitialRefreshView;
  initialRefreshStarted: boolean;
  lastContainersRefreshAt: number;
  lastImagesRefreshAt: number;
  now: number;
  toolboxView: DockerInitialRefreshToolboxView;
}

export interface DockerInitialRefreshPlan {
  delayMs: number;
  refreshContainers: boolean;
  refreshImages: boolean;
  silent: boolean;
}

export const dockerInitialRefreshDelayMs = 1_200;

export function planDockerInitialRefresh(input: DockerInitialRefreshInput): DockerInitialRefreshPlan | null {
  const {
    active,
    connectionId,
    documentVisible,
    dockerView,
    initialRefreshStarted,
    lastContainersRefreshAt,
    lastImagesRefreshAt,
    toolboxView,
  } = input;
  if (!active || !connectionId || !documentVisible || toolboxView !== "docker" || initialRefreshStarted) {
    return null;
  }

  const refreshContainers = dockerView === "containers" && lastContainersRefreshAt <= 0;
  const refreshImages = dockerView === "images" && lastImagesRefreshAt <= 0;

  if (!refreshContainers && !refreshImages) {
    return null;
  }

  return {
    delayMs: dockerInitialRefreshDelayMs,
    refreshContainers,
    refreshImages,
    silent: false,
  };
}

export function shouldRunDockerAutoRefresh({
  active,
  dockerView,
  refreshKind,
}: {
  active: boolean;
  dockerView: DockerInitialRefreshView;
  refreshKind: DockerAutoRefreshKind;
}) {
  return active && dockerView === refreshKind;
}
