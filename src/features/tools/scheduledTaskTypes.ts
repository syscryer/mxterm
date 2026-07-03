export type ScheduledTaskRunStatus = "success" | "failed" | "running" | "unknown";

export interface ScheduledTaskLogEntry {
  started_at?: string | null;
  exit_code?: number | null;
  status: ScheduledTaskRunStatus | string;
  output_preview: string;
}

export interface ScheduledTaskSummary {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  updated_at: string;
  last_run?: ScheduledTaskLogEntry | null;
}

export interface ScheduledTaskInput {
  id?: string | null;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
}

export interface ScheduledTaskActionResult {
  ok: boolean;
  message: string;
  output?: string | null;
}
