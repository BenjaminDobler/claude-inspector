import { RawSessionEntry } from './session.types';
import { SessionStats, ToolStat, TokenDataPoint } from './stats.types';
import { ConversationTree } from './tree.types';

export interface ProjectInfo {
  pathKey: string;
  displayPath: string;
  sessionCount: number;
}

export interface SessionInfo {
  sessionId: string;
  fileSize: number;
  modifiedAt: string;
  hasSubagents: boolean;
  subagentCount: number;
  firstMessage: string;
  model: string;
  messageCount: number;
}

export interface RawSessionData {
  entries: RawSessionEntry[];
  subagents: Record<string, SubagentData>;
}

export interface SubagentData {
  meta: { agentType?: string; [key: string]: unknown };
  entries: RawSessionEntry[];
}

export interface SubagentSession {
  agentId: string;
  meta: { agentType: string };
  entries: RawSessionEntry[];
  stats: SessionStats;
}

export interface ParsedSession {
  id: string;
  projectPath: string;
  entries: RawSessionEntry[];
  tree: ConversationTree;
  stats: SessionStats;
  tokenTimeline: TokenDataPoint[];
  toolStats: ToolStat[];
  subagents: SubagentSession[];
}
