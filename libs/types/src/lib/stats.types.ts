export interface SessionStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalToolCalls: number;
  totalToolErrors: number;
  toolBreakdown: ToolStat[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  startTime: number;
  endTime: number;
  subagentCount: number;
  model: string;
  version: string;
  gitBranch: string;
}

export interface ToolStat {
  name: string;
  callCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export interface TokenDataPoint {
  index: number;
  timestamp: number;
  uuid: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  cumulativeInput: number;
  cumulativeOutput: number;
  cumulativeCacheRead: number;
  cumulativeCacheCreation: number;
  cumulativeTotal: number;
}
