export type AiProviderKind = "openai" | "claude";
export type AiApiFormat = "openai_compatible" | "anthropic" | "responses";
export type AiCommandRisk = "safe" | "dangerous";
export type AiAgentMode = "execute" | "full";
export type AiExecutionMode = "chat" | AiAgentMode;
export type AiChatStreamKind = "chunk" | "thinking" | "tool_call" | "finished" | "error" | "stopped";
export type AiToolCallStatus =
  | "pending_approval"
  | "pending_user_input"
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
  /** 模型生效配置的可用思考档位；缺失时使用内置模型目录或 disabled/enabled 默认。 */
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
  created_at_ms?: number;
  started_at_ms?: number | null;
  finished_at_ms?: number | null;
  approval_required?: boolean;
  approval_decision?: "approved" | "rejected" | string | null;
  connection_id?: string | null;
  workspace?: string | null;
  question?: string | null;
  options?: AiUserOption[];
  allow_free_text?: boolean;
  answer?: AiUserAnswer | null;
}

export interface AiUserOption {
  id: string;
  label: string;
  description?: string | null;
}

export interface AiUserAnswer {
  option_id?: string | null;
  text?: string | null;
  cancelled?: boolean;
}

export interface AiAuditEvent {
  id: number;
  created_at_ms: string;
  event: AiToolCallRecord & Record<string, unknown>;
}

export interface AiChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  content: string;
  thinking: string;
  thinking_blocks?: AiThinkingBlock[];
  contexts: AiContextBlock[];
  commands: AiCommandSuggestion[];
  tool_calls: AiToolCallRecord[];
  status: "complete" | "streaming" | "error" | "stopped" | string;
  created_at: string;
  updated_at: string;
}

export interface AiThinkingUpdate {
  id: string;
  text_offset: number;
  tool_offset: number;
  started_at_ms: number;
  finished_at_ms: number | null;
}

export interface AiThinkingBlock extends AiThinkingUpdate {
  content: string;
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
  connection_id?: string | null;
  workspace_type?: "remote" | "local";
  workspace_path?: string | null;
  local_workspace_path?: string | null;
  mode?: AiAgentMode;
  working_directory?: string | null;
  terminal_output?: string | null;
  terminal_session_id?: string | null;
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
  thinking_delta?: string | null;
  thinking_update?: AiThinkingUpdate | null;
  content?: string | null;
  error?: string | null;
  tool_call?: AiToolCallRecord | null;
}
