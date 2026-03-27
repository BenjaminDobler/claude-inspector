import { Component, Input, OnChanges, SimpleChanges, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RawSessionEntry,
  ContentBlock,
  ToolUseBlock,
  ThinkingBlock,
} from '@claude-inspector/types';
import { getEntryType, extractTextContent } from '@claude-inspector/session-parser';

interface SkillEvent {
  timestamp: number;
  skillName: string;
  args?: string;
  uuid: string;
}

interface AgentEvent {
  timestamp: number;
  agentType?: string;
  description?: string;
  prompt?: string;
  uuid: string;
}

interface ThinkingEvent {
  timestamp: number;
  thinking: string;
  uuid: string;
  precedingContext: string;
}

interface DecisionEvent {
  timestamp: number;
  uuid: string;
  type: 'thinking' | 'skill' | 'agent' | 'plan' | 'ask_user' | 'tool_search' | 'error';
  label: string;
  detail: string;
}

@Component({
  selector: 'app-insights',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './insights.component.html',
  styleUrl: './insights.component.scss',
})
export class InsightsComponent implements OnChanges {
  @Input() entries: RawSessionEntry[] = [];

  activeSection = signal<'decisions' | 'skills' | 'agents' | 'thinking' | 'errors'>('decisions');

  skills = signal<SkillEvent[]>([]);
  agents = signal<AgentEvent[]>([]);
  thinkingBlocks = signal<ThinkingEvent[]>([]);
  decisions = signal<DecisionEvent[]>([]);
  errors = signal<{ timestamp: number; uuid: string; toolName: string; error: string }[]>([]);

  expandedUuid = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entries']) {
      this.analyze();
    }
  }

  toggleExpand(uuid: string) {
    this.expandedUuid.set(this.expandedUuid() === uuid ? null : uuid);
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  private analyze() {
    const skills: SkillEvent[] = [];
    const agents: AgentEvent[] = [];
    const thinkingBlocks: ThinkingEvent[] = [];
    const decisions: DecisionEvent[] = [];
    const errors: { timestamp: number; uuid: string; toolName: string; error: string }[] = [];

    let lastUserMessage = '';

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const entryType = getEntryType(entry);

      // Track user messages for context
      if (entryType === 'user_message') {
        lastUserMessage = extractTextContent(entry).slice(0, 200);
      }

      // Extract thinking blocks
      if (entryType === 'thinking' && entry.message?.content && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as ContentBlock[]) {
          if (block.type === 'thinking') {
            const tb = block as ThinkingBlock;
            thinkingBlocks.push({
              timestamp: entry.timestamp,
              thinking: tb.thinking,
              uuid: entry.uuid,
              precedingContext: lastUserMessage,
            });
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'thinking',
              label: 'Thinking',
              detail: tb.thinking.slice(0, 300),
            });
          }
        }
      }

      // Extract tool_use blocks for skills, agents, plan mode, etc.
      if (entry.message?.content && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as ContentBlock[]) {
          if (block.type !== 'tool_use') continue;
          const tb = block as ToolUseBlock;
          const input = tb.input as Record<string, any>;

          if (tb.name === 'Skill') {
            const skillName = String(input['skill'] || 'unknown');
            const args = String(input['args'] || '');
            skills.push({ timestamp: entry.timestamp, skillName, args, uuid: entry.uuid });
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'skill',
              label: `Skill: ${skillName}`,
              detail: args ? `Args: ${args}` : 'No arguments',
            });
          }

          if (tb.name === 'Agent') {
            const agentType = String(input['subagent_type'] || '');
            const agentDesc = String(input['description'] || '');
            const agentPrompt = String(input['prompt'] || '');
            agents.push({
              timestamp: entry.timestamp,
              agentType,
              description: agentDesc,
              prompt: agentPrompt,
              uuid: entry.uuid,
            });
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'agent',
              label: `Agent: ${agentType || 'general'} — ${agentDesc}`,
              detail: agentPrompt.slice(0, 300),
            });
          }

          if (tb.name === 'EnterPlanMode') {
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'plan',
              label: 'Entered Plan Mode',
              detail: 'Switched to planning phase for architecture/design',
            });
          }

          if (tb.name === 'ExitPlanMode') {
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'plan',
              label: 'Exited Plan Mode',
              detail: 'Plan complete, ready for implementation',
            });
          }

          if (tb.name === 'AskUserQuestion') {
            const questions = (input['questions'] as any[]) || [];
            const qTexts = questions.map((q: any) => q.question || '').join('; ');
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'ask_user',
              label: 'Asked User',
              detail: qTexts.slice(0, 300),
            });
          }

          if (tb.name === 'ToolSearch') {
            const query = String(input['query'] || '');
            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'tool_search',
              label: `ToolSearch: ${query}`,
              detail: `Searching for deferred tool: ${query}`,
            });
          }
        }

        // Track errors in tool results
        for (const block of entry.message.content as ContentBlock[]) {
          if (block.type === 'tool_result' && (block as any).is_error) {
            const resultBlock = block as any;
            const errorText = typeof resultBlock.content === 'string'
              ? resultBlock.content : JSON.stringify(resultBlock.content);

            // Find the tool name from the tool_use_id
            let toolName = 'unknown';
            for (const prev of this.entries) {
              if (prev.message?.content && Array.isArray(prev.message.content)) {
                for (const pb of prev.message.content as ContentBlock[]) {
                  if (pb.type === 'tool_use' && (pb as ToolUseBlock).id === resultBlock.tool_use_id) {
                    toolName = (pb as ToolUseBlock).name;
                  }
                }
              }
            }

            errors.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              toolName,
              error: errorText.slice(0, 500),
            });

            decisions.push({
              timestamp: entry.timestamp,
              uuid: entry.uuid,
              type: 'error',
              label: `Error: ${toolName}`,
              detail: errorText.slice(0, 300),
            });
          }
        }
      }
    }

    // Sort all by timestamp
    decisions.sort((a, b) => a.timestamp - b.timestamp);

    this.skills.set(skills);
    this.agents.set(agents);
    this.thinkingBlocks.set(thinkingBlocks);
    this.decisions.set(decisions);
    this.errors.set(errors);
  }
}
