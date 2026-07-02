export type AiProviderKind = "openai" | "claude";
export type AiApiFormat = "openai_compatible" | "anthropic";
export type AiCommandRisk = "safe" | "dangerous";
export type AiChatStreamKind = "chunk" | "finished" | "error" | "stopped";

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderKind;
  api_format: AiApiFormat;
  endpoint: string;
  model: string;
  api_key_saved: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiProviderConfigInput {
  id?: string;
  name: string;
  provider: AiProviderKind;
  api_format: AiApiFormat;
  endpoint: string;
  model: string;
  api_key?: string | null;
  api_key_touched?: boolean;
}

export interface RevealedAiProviderApiKey {
  api_key: string;
}

export interface AiContextBlock {
  id: string;
  kind: string;
  title: string;
  content: string;
  source: string;
  line_count: number;
  char_count: number;
}

export interface AiCommandSuggestion {
  command: string;
  risk: AiCommandRisk;
  reasons: string[];
}

export interface AiCommandAssessment {
  command: string;
  risk: AiCommandRisk;
  reasons: string[];
}

export interface AiChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  content: string;
  contexts: AiContextBlock[];
  commands: AiCommandSuggestion[];
  status: "complete" | "streaming" | "error" | "stopped" | string;
  created_at: string;
  updated_at: string;
}

export interface AiChatSessionSummary {
  id: string;
  title: string;
  provider_config_id?: string | null;
  message_count: number;
  last_message_preview?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiChatSession {
  summary: AiChatSessionSummary;
  messages: AiChatMessage[];
}

export interface AiChatStreamStartRequest {
  provider_config_id: string;
  session_id?: string | null;
  content: string;
  contexts?: AiContextBlock[];
}

export interface AiChatStreamStartResponse {
  stream_id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
}

export interface AiChatStreamEvent {
  kind: AiChatStreamKind;
  stream_id: string;
  session_id: string;
  message_id: string;
  delta?: string | null;
  content?: string | null;
  error?: string | null;
}
