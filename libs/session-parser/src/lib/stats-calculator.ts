import {
  RawSessionEntry,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TokenUsage,
  SessionStats,
  ToolStat,
  TokenDataPoint,
} from '@claude-inspector/types';
import { getEntryType } from './jsonl-parser';

export function computeSessionStats(entries: RawSessionEntry[]): SessionStats {
  let userMessages = 0;
  let assistantMessages = 0;
  let totalToolCalls = 0;
  let totalToolErrors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let model = '';
  let version = '';
  let gitBranch = '';
  let subagentIds = new Set<string>();

  for (const entry of entries) {
    if (!version && entry.version) version = entry.version;
    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch;

    const entryType = getEntryType(entry);

    if (entryType === 'user_message') userMessages++;
    if (entryType === 'assistant_message' || entryType === 'tool_use') {
      assistantMessages++;
    }

    if (entry.message?.model && !model) {
      model = entry.message.model;
    }

    // Count tool calls and errors
    if (entry.message?.content && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content as ContentBlock[]) {
        if (block.type === 'tool_use') totalToolCalls++;
        if (block.type === 'tool_result' && (block as ToolResultBlock).is_error) {
          totalToolErrors++;
        }
      }
    }

    // Sum token usage
    const usage = entry.message?.usage;
    if (usage) {
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      totalCacheReadTokens += usage.cache_read_input_tokens || 0;
      totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
    }

    // Track subagent IDs from progress events
    if (entry.type === 'progress' && entry.data?.agentId) {
      subagentIds.add(entry.data.agentId);
    }
    if (entry.isSidechain && entry.toolUseID) {
      subagentIds.add(entry.toolUseID);
    }
  }

  const startTime = entries.length > 0 ? entries[0].timestamp : 0;
  const endTime = entries.length > 0 ? entries[entries.length - 1].timestamp : 0;

  const toolBreakdown = computeToolStats(entries);
  const estimatedCostUsd = estimateCost(
    model,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens
  );

  return {
    totalMessages: userMessages + assistantMessages,
    userMessages,
    assistantMessages,
    totalToolCalls,
    totalToolErrors,
    toolBreakdown,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    estimatedCostUsd,
    durationMs: endTime - startTime,
    startTime,
    endTime,
    subagentCount: subagentIds.size,
    model,
    version,
    gitBranch,
  };
}

export function computeToolStats(entries: RawSessionEntry[]): ToolStat[] {
  const toolMap = new Map<
    string,
    { calls: number; errors: number; durations: number[] }
  >();

  // Build a map of tool_use_id -> timestamp for duration calculation
  const toolUseTimestamps = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.message?.content || !Array.isArray(entry.message.content)) continue;

    for (const block of entry.message.content as ContentBlock[]) {
      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseBlock;
        const existing = toolMap.get(toolUse.name) || {
          calls: 0,
          errors: 0,
          durations: [],
        };
        existing.calls++;
        toolMap.set(toolUse.name, existing);
        toolUseTimestamps.set(toolUse.id, entry.timestamp);
      }

      if (block.type === 'tool_result') {
        const toolResult = block as ToolResultBlock;
        const useTimestamp = toolUseTimestamps.get(toolResult.tool_use_id);

        if (useTimestamp) {
          const duration = entry.timestamp - useTimestamp;
          // Find which tool this result belongs to by looking up the tool_use entry
          // We need to search entries to find the corresponding tool_use
          for (const [name, data] of toolMap.entries()) {
            // Duration is associated during result processing
            // We'll handle this via sourceToolAssistantUUID correlation
          }
        }

        if (toolResult.is_error) {
          // Find the tool name from the corresponding tool_use
          for (const prevEntry of entries) {
            if (!prevEntry.message?.content || !Array.isArray(prevEntry.message.content))
              continue;
            for (const prevBlock of prevEntry.message.content as ContentBlock[]) {
              if (
                prevBlock.type === 'tool_use' &&
                (prevBlock as ToolUseBlock).id === toolResult.tool_use_id
              ) {
                const name = (prevBlock as ToolUseBlock).name;
                const existing = toolMap.get(name);
                if (existing) existing.errors++;
                break;
              }
            }
          }
        }
      }
    }
  }

  // Calculate durations by correlating tool_use and tool_result timestamps
  for (const entry of entries) {
    if (entry.sourceToolAssistantUUID && entry.message?.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content as ContentBlock[]) {
          if (block.type === 'tool_result') {
            const toolResult = block as ToolResultBlock;
            const useTimestamp = toolUseTimestamps.get(toolResult.tool_use_id);
            if (useTimestamp) {
              const duration = entry.timestamp - useTimestamp;
              // Find tool name from the tool_use_id
              for (const prevEntry of entries) {
                if (!prevEntry.message?.content || !Array.isArray(prevEntry.message.content))
                  continue;
                for (const prevBlock of prevEntry.message.content as ContentBlock[]) {
                  if (
                    prevBlock.type === 'tool_use' &&
                    (prevBlock as ToolUseBlock).id === toolResult.tool_use_id
                  ) {
                    const name = (prevBlock as ToolUseBlock).name;
                    const existing = toolMap.get(name);
                    if (existing) existing.durations.push(duration);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return Array.from(toolMap.entries())
    .map(([name, data]) => {
      const stat: ToolStat = {
        name,
        callCount: data.calls,
        errorCount: data.errors,
        successRate: data.calls > 0 ? (data.calls - data.errors) / data.calls : 1,
      };

      if (data.durations.length > 0) {
        stat.avgDurationMs =
          data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
        stat.minDurationMs = Math.min(...data.durations);
        stat.maxDurationMs = Math.max(...data.durations);
      }

      return stat;
    })
    .sort((a, b) => b.callCount - a.callCount);
}

export function computeTokenTimeline(entries: RawSessionEntry[]): TokenDataPoint[] {
  const dataPoints: TokenDataPoint[] = [];
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  let cumulativeCacheRead = 0;
  let cumulativeCacheCreation = 0;
  let index = 0;

  for (const entry of entries) {
    const usage = entry.message?.usage;
    if (!usage) continue;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;

    cumulativeInput += inputTokens;
    cumulativeOutput += outputTokens;
    cumulativeCacheRead += cacheRead;
    cumulativeCacheCreation += cacheCreation;

    dataPoints.push({
      index,
      timestamp: entry.timestamp,
      uuid: entry.uuid,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheCreation,
      cumulativeInput,
      cumulativeOutput,
      cumulativeCacheRead,
      cumulativeCacheCreation,
      cumulativeTotal:
        cumulativeInput + cumulativeOutput + cumulativeCacheRead + cumulativeCacheCreation,
    });

    index++;
  }

  return dataPoints;
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number
): number {
  // Pricing per million tokens (USD)
  const pricing: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
    'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
    'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
  };

  // Find matching pricing (partial match)
  let rates = pricing['claude-sonnet-4-6']; // default
  for (const [key, value] of Object.entries(pricing)) {
    if (model.includes(key) || model.startsWith(key.split('-').slice(0, -1).join('-'))) {
      rates = value;
      break;
    }
  }

  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output +
    (cacheReadTokens / 1_000_000) * rates.cacheRead +
    (cacheCreationTokens / 1_000_000) * rates.cacheCreation
  );
}
