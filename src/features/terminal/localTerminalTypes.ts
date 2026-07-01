export type LocalTerminalProfileKind =
  | "powershell"
  | "powershell_core"
  | "cmd"
  | "wsl"
  | "git_bash"
  | "bash"
  | "zsh"
  | "fish"
  | "pwsh"
  | "custom";

export interface LocalTerminalProfile {
  id: string;
  name: string;
  kind: LocalTerminalProfileKind | string;
  platform: string;
  source: string;
  command: string;
  args: string[];
  cwd?: string | null;
  env: Record<string, string>;
  icon: string;
  hidden: boolean;
  detected: boolean;
}

export interface LocalTerminalProfileInput {
  id?: string;
  name: string;
  kind: LocalTerminalProfileKind | string;
  platform: string;
  source: string;
  command: string;
  args: string[];
  cwd?: string | null;
  env: Record<string, string>;
  icon: string;
  hidden: boolean;
  detected: boolean;
}

export interface LocalTerminalOpenRequest {
  request_id?: string;
  profile?: LocalTerminalProfileInput;
  cols: number;
  rows: number;
  cwd?: string;
}

export interface WindowsPtyInfo {
  backend: "conpty" | "winpty";
  build_number?: number | null;
}

export interface LocalTerminalSettings {
  ctrlVPaste: boolean;
  defaultProfileId: string | null;
  hiddenProfileIds: string[];
  customProfiles: LocalTerminalProfileInput[];
  reopenLastLocalWorkspace: boolean;
}

export interface LocalTerminalTab {
  id: string;
  source?: "local" | "telnet" | "serial";
  profileId: string;
  profileKind: string;
  title: string;
  requestId?: string;
  sessionId?: string;
  status: string;
  error?: string | null;
  warmupOutput: number[];
}
