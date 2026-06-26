import { listen } from "@tauri-apps/api/event";
import type {
  DockerImagePullProgressEvent,
  DockerLogStreamEvent,
} from "../../features/tools/dockerTypes";
import type {
  RdpSessionClosedEvent,
} from "../../features/connections/connectionTypes";
import type {
  RemoteFileTransferProgressEvent,
} from "../../features/files/remoteFileTypes";
import type {
  TerminalConnectProgressEvent,
  TerminalOutputEvent,
  TerminalStateChangedEvent,
} from "../../features/terminal/terminalTypes";

export function listenTerminalOutput(handler: (event: TerminalOutputEvent) => void) {
  return listen<TerminalOutputEvent>("terminal:output", (event) => handler(event.payload));
}

export function listenTerminalStateChanged(handler: (event: TerminalStateChangedEvent) => void) {
  return listen<TerminalStateChangedEvent>("terminal:state_changed", (event) =>
    handler(event.payload),
  );
}

export function listenTerminalConnectProgress(
  handler: (event: TerminalConnectProgressEvent) => void,
) {
  return listen<TerminalConnectProgressEvent>("terminal:connect_progress", (event) =>
    handler(event.payload),
  );
}

export function listenRemoteFileTransferProgress(
  handler: (event: RemoteFileTransferProgressEvent) => void,
) {
  return listen<RemoteFileTransferProgressEvent>("remote_file:transfer_progress", (event) =>
    handler(event.payload),
  );
}

export function listenDockerImagePullProgress(
  handler: (event: DockerImagePullProgressEvent) => void,
) {
  return listen<DockerImagePullProgressEvent>("docker:image_pull_progress", (event) =>
    handler(event.payload),
  );
}

export function listenDockerLogStream(handler: (event: DockerLogStreamEvent) => void) {
  return listen<DockerLogStreamEvent>("docker:log_stream", (event) => handler(event.payload));
}

export function listenRdpSessionClosed(handler: (event: RdpSessionClosedEvent) => void) {
  return listen<RdpSessionClosedEvent>("rdp:session_closed", (event) => handler(event.payload));
}
