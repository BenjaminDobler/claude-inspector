export interface RawSessionEntry {
  uuid: string;
  parentUuid: string | null;
  timestamp: number;
  sessionId: string;
  type: 'user' | 'assistant' | 'system' | 'progress' | 'file-history-snapshot';
  isSidechain: boolean;
  userType: string;
  cwd: string;
  version: string;
  gitBranch?: string;
  promptId?: string;
  requestId?: string;
  message?: MessageContent;
  data?: ProgressData;
  toolUseResult?: ToolUseResultData;
  sourceToolAssistantUUID?: string;
  toolUseID?: string;
  parentToolUseID?: string;
}

export interface MessageContent {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  model?: string;
  id?: string;
  type?: string;
  usage?: TokenUsage;
  stop_reason?: string | null;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolUseResultData {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  noOutputExpected?: boolean;
}

export interface ProgressData {
  message?: unknown;
  type?: string;
  prompt?: string;
  agentId?: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  service_tier?: string;
  inference_geo?: string;
}
