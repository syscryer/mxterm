export type CommandHistorySource = "command_sender";

export interface CommandSnippet {
  id: string;
  title: string;
  command: string;
  description?: string | null;
  tags: string[];
  favorite: boolean;
  use_count: number;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommandSnippetInput {
  id?: string;
  title?: string;
  command: string;
  description?: string | null;
  tags?: string[];
  favorite?: boolean;
}

export interface CommandHistoryEntry {
  id: string;
  command: string;
  source: CommandHistorySource;
  target_count: number;
  append_enter: boolean;
  use_count: number;
  last_used_at: string;
  created_at: string;
}

export interface CommandHistoryListRequest {
  limit?: number;
}

export interface CommandHistoryRecordRequest {
  command: string;
  source?: CommandHistorySource;
  target_count?: number;
  append_enter?: boolean;
}
