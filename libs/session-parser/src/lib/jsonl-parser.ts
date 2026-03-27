import { RawSessionEntry } from '@claude-inspector/types';

export function parseSessionEntries(rawEntries: unknown[]): RawSessionEntry[] {
  return rawEntries
    .filter((entry): entry is Record<string, unknown> => {
      const e = entry as Record<string, unknown>;
      return e != null && typeof e === 'object' && 'uuid' in e && 'timestamp' in e;
    })
    .map((e) => {
      // Normalize timestamp: can be ISO string, numeric string, or number
      const raw = e['timestamp'];
      if (typeof raw === 'string') {
        const asNum = Number(raw);
        e['timestamp'] = isNaN(asNum) ? new Date(raw).getTime() : asNum;
      }
      return e as unknown as RawSessionEntry;
    })
    .filter((e) => !isNaN(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export type EntryType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'progress'
  | 'system'
  | 'other';

export function getEntryType(entry: RawSessionEntry): EntryType {
  if (entry.type === 'progress') return 'progress';
  if (entry.type === 'system') return 'system';
  if (entry.type === 'file-history-snapshot') return 'other';

  const message = entry.message;
  if (!message) {
    // Some entries have data but no message (e.g. system events)
    if ((entry as any).data?.type) return 'system';
    return 'other';
  }

  if (message.role === 'assistant') {
    const content = message.content;
    if (Array.isArray(content)) {
      if (content.some((b: any) => b.type === 'tool_use')) return 'tool_use';
      if (content.some((b: any) => b.type === 'thinking')) return 'thinking';
    }
    return 'assistant_message';
  }

  if (message.role === 'user') {
    const content = message.content;
    if (Array.isArray(content) && content.some((b: any) => b.type === 'tool_result')) {
      return 'tool_result';
    }
    return 'user_message';
  }

  return 'other';
}

export function extractTextContent(entry: RawSessionEntry): string {
  // Handle system/progress entries
  if (entry.type === 'system' || (entry as any).data?.type) {
    return formatSystemEntry(entry);
  }

  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    // Check for toolUseResult data (tool_result entries store output here)
    if (entry.toolUseResult) {
      const parts: string[] = [];
      if (entry.toolUseResult.stdout) parts.push(entry.toolUseResult.stdout);
      if (entry.toolUseResult.stderr) parts.push(`[stderr] ${entry.toolUseResult.stderr}`);
      if (parts.length > 0) return parts.join('\n');
    }
    return '';
  }

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      parts.push((block as { text: string }).text);
    } else if (block.type === 'thinking') {
      const thinking = (block as { thinking: string }).thinking;
      parts.push(`[Thinking]\n${thinking}`);
    } else if (block.type === 'tool_use') {
      const toolBlock = block as { name: string; input: Record<string, unknown> };
      const inputSummary = formatToolInput(toolBlock.input);
      parts.push(`[Tool: ${toolBlock.name}]\n${inputSummary}`);
    } else if (block.type === 'tool_result') {
      const resultBlock = block as { tool_use_id: string; content: string; is_error?: boolean };
      const prefix = resultBlock.is_error ? '[Error] ' : '';
      const resultContent = typeof resultBlock.content === 'string'
        ? resultBlock.content
        : JSON.stringify(resultBlock.content, null, 2);
      parts.push(`${prefix}${resultContent}`);
    }
  }

  return parts.join('\n');
}

function formatToolInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      const display = value.length > 500 ? value.slice(0, 500) + '...' : value;
      lines.push(`  ${key}: ${display}`);
    } else {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

function formatSystemEntry(entry: RawSessionEntry): string {
  const data = (entry as any).data;
  if (!data) return `[System: ${entry.type}]`;

  const type = data.type || 'unknown';
  const parts = [`[${type}]`];

  if (type === 'hook_progress') {
    parts.push(`Hook: ${data.hookName || data.hookEvent || 'unknown'}`);
    if (data.command) parts.push(`Command: ${data.command}`);
  } else if (type === 'agent_progress') {
    parts.push(`Agent: ${data.agentId || 'unknown'}`);
    if (data.prompt) {
      const promptPreview = data.prompt.length > 200 ? data.prompt.slice(0, 200) + '...' : data.prompt;
      parts.push(promptPreview);
    }
  } else if (type === 'bash_progress') {
    if (data.output) parts.push(data.output);
  } else if (type === 'turn_duration') {
    if (data.durationMs) parts.push(`Duration: ${data.durationMs}ms`);
  } else {
    // Generic fallback: show the data keys
    parts.push(JSON.stringify(data, null, 2));
  }

  return parts.join('\n');
}
