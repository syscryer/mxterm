export interface TerminalConnectRequest {
  request_id?: string;
  connection_id?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  private_key_path?: string;
  private_key_passphrase?: string;
  cols: number;
  rows: number;
}

export interface TerminalOutputEvent {
  session_id: string;
  data: number[];
}

export interface TerminalStateChangedEvent {
  session_id: string;
  state: "closed";
  exit_status: number | null;
}

export interface TerminalConnectProgressEvent {
  request_id: string;
  stage: string;
  message: string;
}
