export type AiProviderKind = "openai" | "claude";
export type AiApiFormat = "openai_compatible" | "anthropic" | "responses";
export type AiCommandRisk = "safe" | "dangerous";
export type AiAgentMode = "assist" | "execute" | "full";
export type AiExecutionMode = "chat" | AiAgentMode;
export type AiChatStreamKind = "chunk" | "tool_call" | "finished" | "error" | "stopped";
export type AiToolCallStatus =
  | "pending_approval"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderKind;
  api_format: AiApiFormat;
  endpoint: string;
  model: string;
  models: AiModelConfig[];
  api_key_saved: boolean;
  thinking_mode?: string | null;
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
  models?: AiModelConfigInput[];
  api_key?: string | null;
  api_key_touched?: boolean;
}

export interface AiModelConfig {
  id: string;
  context_window: number;
  max_output_tokens?: number | null;
  enabled: boolean;
}

export interface AiModelConfigInput {
  id: string;
  context_window?: number;
  max_output_tokens?: number | null;
  enabled?: boolean;
}

export interface RevealedAiProviderApiKey {
  api_key: string;
}

export interface AiProviderConfigTestResult {
  message: string;
}

export interface AiProviderModelOption {
  id: string;
  display_name?: string | null;
  subtitle?: string | null;
  /** 模型生效配置的可用思考档位；缺失时使用内置默认的 disabled/enabled。 */
  reasoning_levels?: string[] | null;
  reasoning_default_level?: string | null;
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

export interface AiToolCallRecord {
  id: string;
  name: "run_command" | "server_monitor" | "read_terminal_output" | string;
  command?: string | null;
  status: AiToolCallStatus | string;
  risk?: AiCommandRisk | null;
  reasons: string[];
  exit_status?: number | null;
  output: string;
  output_truncated: boolean;
  duration_ms?: number | null;
  error?: string | null;
  text_offset: number;
}

export interface AiChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  content: string;
  contexts: AiContextBlock[];
  commands: AiCommandSuggestion[];
  tool_calls: AiToolCallRecord[];
  status: "complete" | "streaming" | "error" | "stopped" | string;
  created_at: string;
  updated_at: string;
}

export interface AiChatSessionSummary {
  id: string;
  title: string;
  provider_config_id?: string | null;
  host_scope?: string | null;
  connection_id?: string | null;
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
  agent?: AiAgentRequest | null;
  reasoning_level?: string | null;
  model?: string | null;
  host_scope?: string | null;
  connection_id?: string | null;
}

export interface AiAgentRequest {
  connection_id: string;
  mode?: AiAgentMode;
  working_directory?: string | null;
  terminal_output?: string | null;
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
  tool_call?: AiToolCallRecord | null;
}
