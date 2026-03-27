import { Injectable, signal, computed } from '@angular/core';
import {
  ProjectInfo,
  SessionInfo,
  RawSessionEntry,
  SessionStats,
  ToolStat,
  TokenDataPoint,
} from '@claude-inspector/types';
import {
  parseSessionEntries,
  computeSessionStats,
  computeToolStats,
  computeTokenTimeline,
} from '@claude-inspector/session-parser';
import { TauriBridgeService, PlanFile } from './tauri-bridge.service';

@Injectable({ providedIn: 'root' })
export class SessionStoreService {
  // State signals
  readonly projects = signal<ProjectInfo[]>([]);
  readonly selectedProject = signal<string | null>(null);
  readonly sessions = signal<SessionInfo[]>([]);
  readonly selectedSessionId = signal<string | null>(null);
  readonly rawEntries = signal<RawSessionEntry[]>([]);
  readonly plans = signal<PlanFile[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Computed derived data
  readonly sessionStats = computed<SessionStats | null>(() => {
    const entries = this.rawEntries();
    if (entries.length === 0) return null;
    return computeSessionStats(entries);
  });

  readonly toolStats = computed<ToolStat[]>(() => {
    const entries = this.rawEntries();
    if (entries.length === 0) return [];
    return computeToolStats(entries);
  });

  readonly tokenTimeline = computed<TokenDataPoint[]>(() => {
    const entries = this.rawEntries();
    if (entries.length === 0) return [];
    return computeTokenTimeline(entries);
  });

  constructor(private tauriBridge: TauriBridgeService) {}

  async loadProjects(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const projects = await this.tauriBridge.listProjects();
      this.projects.set(projects);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async selectProject(projectPath: string): Promise<void> {
    this.selectedProject.set(projectPath);
    this.selectedSessionId.set(null);
    this.rawEntries.set([]);
    this.plans.set([]);
    this.loading.set(true);
    this.error.set(null);
    try {
      const sessions = await this.tauriBridge.listSessions(projectPath);
      this.sessions.set(sessions);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async selectSession(sessionId: string): Promise<void> {
    const projectPath = this.selectedProject();
    if (!projectPath) return;

    this.selectedSessionId.set(sessionId);
    this.loading.set(true);
    this.error.set(null);
    try {
      const [data, plans] = await Promise.all([
        this.tauriBridge.readSession(projectPath, sessionId),
        this.tauriBridge.readSessionPlans(projectPath, sessionId).catch(() => [] as PlanFile[]),
      ]);
      const entries = parseSessionEntries(data.entries);
      this.rawEntries.set(entries);
      this.plans.set(plans);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
