import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  ProjectInfo,
  SessionInfo,
  RawSessionData,
} from '@claude-inspector/types';

export interface ActiveSessionInfo {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  projectPath: string;
  isRunning: boolean;
}

export interface PollResult {
  newEntries: unknown[];
  totalLines: number;
}

export interface ConfigFiles {
  globalSettings: Record<string, unknown> | null;
  globalSettingsLocal: Record<string, unknown> | null;
  installedPlugins: Record<string, unknown> | null;
  knownMarketplaces: Record<string, unknown> | null;
  installCounts: Record<string, unknown> | null;
  blocklist: Record<string, unknown> | null;
}

export interface ProjectConfig {
  projectPath: string;
  displayPath: string;
  settings: Record<string, unknown> | null;
  settingsLocal: Record<string, unknown> | null;
  claudeMd: string | null;
}

export interface MarketplaceInfo {
  name: string;
  source: unknown;
  catalog: { plugins?: MarketplacePlugin[]; name?: string; description?: string } | null;
}

export interface MarketplacePlugin {
  name: string;
  description: string;
  category?: string;
  author?: { name: string; email?: string };
  source?: unknown;
  homepage?: string;
}

export interface PluginDetail {
  name: string;
  marketplace: string;
  pluginJson: Record<string, unknown> | null;
  hasMcp: boolean;
  mcpJson: Record<string, unknown> | null;
  skills: { name: string; content: string }[];
}

@Injectable({ providedIn: 'root' })
export class TauriBridgeService {
  // Session commands
  async listProjects(): Promise<ProjectInfo[]> {
    return invoke<ProjectInfo[]>('list_projects');
  }

  async listSessions(projectPath: string): Promise<SessionInfo[]> {
    return invoke<SessionInfo[]>('list_sessions', { projectPath });
  }

  async readSession(projectPath: string, sessionId: string): Promise<RawSessionData> {
    return invoke<RawSessionData>('read_session', { projectPath, sessionId });
  }

  // Data commands
  async readCostData(): Promise<CostData> {
    return invoke<CostData>('read_cost_data');
  }

  async readSessionTasks(sessionId: string): Promise<TaskItem[]> {
    return invoke<TaskItem[]>('read_session_tasks', { sessionId });
  }

  async readUsageStats(): Promise<DailyActivity[]> {
    return invoke<DailyActivity[]>('read_usage_stats');
  }

  async readFileHistory(sessionId: string): Promise<FileHistoryEntry[]> {
    return invoke<FileHistoryEntry[]>('read_file_history', { sessionId });
  }

  async readHourlyActivity(): Promise<{ hour: number; count: number }[]> {
    return invoke<{ hour: number; count: number }[]>('read_hourly_activity');
  }

  async readGlobalToolStats(): Promise<[GlobalToolStat[], ToolSequence[]]> {
    return invoke<[GlobalToolStat[], ToolSequence[]]>('read_global_tool_stats');
  }

  async listSessionNotes(): Promise<SessionNote[]> {
    return invoke<SessionNote[]>('list_session_notes');
  }

  async saveSessionNote(params: {
    sessionId: string; projectPath: string; note: string; tags: string[]; bookmarked: boolean;
  }): Promise<void> {
    return invoke('save_session_note', params);
  }

  async deleteSessionNote(sessionId: string): Promise<void> {
    return invoke('delete_session_note', { sessionId });
  }

  async readGlobalHistory(limit?: number): Promise<HistoryEntry[]> {
    return invoke<HistoryEntry[]>('read_global_history', { limit: limit || 500 });
  }

  async readProjectMemory(projectPathKey: string): Promise<MemoryFile[]> {
    return invoke<MemoryFile[]>('read_project_memory', { projectPathKey });
  }

  async readSessionPlans(projectPath: string, sessionId: string): Promise<PlanFile[]> {
    return invoke<PlanFile[]>('read_session_plans', { projectPath, sessionId });
  }

  async getActiveSessions(): Promise<ActiveSessionInfo[]> {
    return invoke<ActiveSessionInfo[]>('get_active_sessions');
  }

  async focusSession(pid: number, cwd?: string): Promise<string> {
    return invoke<string>('focus_session', { pid, cwd: cwd || null });
  }

  async pollSession(projectPath: string, sessionId: string, lastLine: number): Promise<PollResult> {
    return invoke<PollResult>('poll_session', { projectPath, sessionId, lastLine });
  }

  // Config commands
  async readGlobalConfig(): Promise<ConfigFiles> {
    return invoke<ConfigFiles>('read_global_config');
  }

  async writeGlobalSettings(settings: Record<string, unknown>): Promise<void> {
    return invoke('write_global_settings', { settings });
  }

  async readProjectConfig(projectDir: string): Promise<ProjectConfig> {
    return invoke<ProjectConfig>('read_project_config', { projectDir });
  }

  async writeProjectSettings(projectDir: string, settings: Record<string, unknown>): Promise<void> {
    return invoke('write_project_settings', { projectDir, settings });
  }

  async writeProjectSettingsLocal(projectDir: string, settings: Record<string, unknown>): Promise<void> {
    return invoke('write_project_settings_local', { projectDir, settings });
  }

  async listMarketplaces(): Promise<MarketplaceInfo[]> {
    return invoke<MarketplaceInfo[]>('list_marketplaces');
  }

  async readPluginDetail(marketplace: string, pluginName: string): Promise<PluginDetail> {
    return invoke<PluginDetail>('read_plugin_detail', { marketplace, pluginName });
  }

  // MCP commands
  async listMcpServers(): Promise<McpServerInfo[]> {
    return invoke<McpServerInfo[]>('list_mcp_servers');
  }

  async addMcpServer(params: {
    name: string;
    commandOrUrl: string;
    args: string[];
    transport?: string;
    env: Record<string, string>;
    scope?: string;
  }): Promise<CommandResult> {
    return invoke<CommandResult>('add_mcp_server', params);
  }

  async removeMcpServer(name: string, scope?: string): Promise<CommandResult> {
    return invoke<CommandResult>('remove_mcp_server', { name, scope: scope || null });
  }

  // Workspace commands
  async searchTranscripts(query: string, limit?: number): Promise<TranscriptResult[]> {
    return invoke<TranscriptResult[]>('search_transcripts', { query, limit: limit || 100 });
  }

  async listClaudeMdFiles(): Promise<ClaudeMdInfo[]> {
    return invoke<ClaudeMdInfo[]>('list_claude_md_files');
  }

  async writeClaudeMd(projectPath: string, content: string): Promise<void> {
    return invoke('write_claude_md', { projectPath, content });
  }

  async checkHygiene(): Promise<HygieneIssue[]> {
    return invoke<HygieneIssue[]>('check_hygiene');
  }

  async addMarketplace(source: string): Promise<CommandResult> {
    return invoke<CommandResult>('add_marketplace', { source });
  }

  async removeMarketplace(name: string): Promise<CommandResult> {
    return invoke<CommandResult>('remove_marketplace', { name });
  }

  async updateMarketplace(name?: string): Promise<CommandResult> {
    return invoke<CommandResult>('update_marketplace', { name: name || null });
  }

  async installPlugin(pluginId: string): Promise<CommandResult> {
    return invoke<CommandResult>('install_plugin', { pluginId });
  }

  async updatePlugin(pluginId: string): Promise<CommandResult> {
    return invoke<CommandResult>('update_plugin', { pluginId });
  }

  async uninstallPlugin(pluginId: string): Promise<CommandResult> {
    return invoke<CommandResult>('uninstall_plugin', { pluginId });
  }
}

export interface McpServerInfo {
  name: string;
  source: string;
  serverType: string;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface CostData {
  days: Record<string, Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>>;
  pricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
}

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  status: string;
  activeForm: string | null;
  blocks: string[];
  blockedBy: string[];
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface FileHistoryEntry {
  fileHash: string;
  versions: { version: string; size: number; contentPreview: string }[];
}

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

export interface MemoryFile {
  filename: string;
  content: string;
}

export interface TranscriptResult {
  projectPath: string;
  sessionId: string;
  entryType: string;
  text: string;
  timestamp: string;
  model: string;
  toolName: string;
}

export interface ClaudeMdInfo {
  projectPath: string;
  displayPath: string;
  content: string | null;
  exists: boolean;
}

export interface HygieneIssue {
  category: string;
  severity: string;
  title: string;
  description: string;
  action: string;
  project: string;
}

export interface SessionNote {
  sessionId: string;
  projectPath: string;
  note: string;
  tags: string[];
  bookmarked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalToolStat {
  name: string;
  count: number;
}

export interface ToolSequence {
  fromTool: string;
  toTool: string;
  count: number;
}

export interface PlanFile {
  slug: string;
  content: string;
  modifiedAt: string;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}
