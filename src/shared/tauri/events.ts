import { emit, emitTo, listen } from "@tauri-apps/api/event";
import type { AiChatStreamEvent } from "../../features/ai/aiTypes";
import type {
  DockerImagePullProgressEvent,
  DockerLogStreamEvent,
} from "../../features/tools/dockerTypes";
import type {
  RdpSessionClosedEvent,
  VncRunnerWindowMessageEvent,
  VncRunnerWindowPayload,
  VncRunnerWindowReadyEvent,
  VncRunnerWindowSessionEvent,
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

export function listenAiChatStream(handler: (event: AiChatStreamEvent) => void) {
  return listen<AiChatStreamEvent>("ai:chat_stream", (event) => handler(event.payload));
}

export const VNC_RUNNER_WINDOW_PAYLOAD_EVENT = "vnc:runner_window_payload";
export const VNC_RUNNER_WINDOW_READY_EVENT = "vnc:runner_window_ready";
export const VNC_RUNNER_WINDOW_CLOSE_REQUEST_EVENT = "vnc:runner_window_close_request";
export const VNC_RUNNER_WINDOW_CLOSED_EVENT = "vnc:runner_window_closed";
export const VNC_RUNNER_WINDOW_MESSAGE_EVENT = "vnc:runner_window_message";
export const VNC_RUNNER_WINDOW_ERROR_EVENT = "vnc:runner_window_error";

export function emitVncRunnerWindowPayload(target: string, payload: VncRunnerWindowPayload) {
  return emitTo<VncRunnerWindowPayload>(target, VNC_RUNNER_WINDOW_PAYLOAD_EVENT, payload);
}

export function emitVncRunnerWindowReady(payload: VncRunnerWindowReadyEvent) {
  return emit<VncRunnerWindowReadyEvent>(VNC_RUNNER_WINDOW_READY_EVENT, payload);
}

export function emitVncRunnerWindowClosed(payload: VncRunnerWindowSessionEvent) {
  return emit<VncRunnerWindowSessionEvent>(VNC_RUNNER_WINDOW_CLOSED_EVENT, payload);
}

export function emitVncRunnerWindowMessage(payload: VncRunnerWindowMessageEvent) {
  return emit<VncRunnerWindowMessageEvent>(VNC_RUNNER_WINDOW_MESSAGE_EVENT, payload);
}

export function emitVncRunnerWindowError(payload: VncRunnerWindowMessageEvent) {
  return emit<VncRunnerWindowMessageEvent>(VNC_RUNNER_WINDOW_ERROR_EVENT, payload);
}

export function emitVncRunnerWindowCloseRequest(
  target: string,
  payload: VncRunnerWindowSessionEvent,
) {
  return emitTo<VncRunnerWindowSessionEvent>(
    target,
    VNC_RUNNER_WINDOW_CLOSE_REQUEST_EVENT,
    payload,
  );
}

export function listenVncRunnerWindowPayload(
  handler: (event: VncRunnerWindowPayload) => void,
) {
  return listen<VncRunnerWindowPayload>(VNC_RUNNER_WINDOW_PAYLOAD_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listenVncRunnerWindowReady(
  handler: (event: VncRunnerWindowReadyEvent) => void,
) {
  return listen<VncRunnerWindowReadyEvent>(VNC_RUNNER_WINDOW_READY_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listenVncRunnerWindowCloseRequest(
  handler: (event: VncRunnerWindowSessionEvent) => void,
) {
  return listen<VncRunnerWindowSessionEvent>(VNC_RUNNER_WINDOW_CLOSE_REQUEST_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listenVncRunnerWindowClosed(
  handler: (event: VncRunnerWindowSessionEvent) => void,
) {
  return listen<VncRunnerWindowSessionEvent>(VNC_RUNNER_WINDOW_CLOSED_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listenVncRunnerWindowMessage(
  handler: (event: VncRunnerWindowMessageEvent) => void,
) {
  return listen<VncRunnerWindowMessageEvent>(VNC_RUNNER_WINDOW_MESSAGE_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listenVncRunnerWindowError(
  handler: (event: VncRunnerWindowMessageEvent) => void,
) {
  return listen<VncRunnerWindowMessageEvent>(VNC_RUNNER_WINDOW_ERROR_EVENT, (event) =>
    handler(event.payload),
  );
}
