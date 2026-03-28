import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { TauriBridgeService, ActiveSessionInfo } from './tauri-bridge.service';
import { SessionStoreService } from './session-store.service';
import { NotificationService } from './notification.service';
import { parseSessionEntries } from '@claude-inspector/session-parser';

@Injectable({ providedIn: 'root' })
export class WatcherService implements OnDestroy {
  private tauriBridge = inject(TauriBridgeService);
  private sessionStore = inject(SessionStoreService);
  private notifications = inject(NotificationService);

  readonly isWatching = signal(false);
  readonly activeSessions = signal<ActiveSessionInfo[]>([]);
  readonly backgroundMonitoring = signal(true); // enabled by default
  readonly usePolling = signal(true);
  readonly pollIntervalMs = signal(2000);

  // Foreground watch (specific session, updates UI)
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastLine = 0;
  private watchingProject = '';
  private watchingSession = '';
  private watchingPid: number | null = null;

  // Background monitor (all active sessions, notifications only)
  private activeCheckTimer: ReturnType<typeof setInterval> | null = null;
  private bgPollTimer: ReturnType<typeof setInterval> | null = null;
  private bgLastLines = new Map<string, number>(); // sessionId -> lastLine

  constructor() {
    // Check for active sessions every 10 seconds
    this.activeCheckTimer = setInterval(() => {
      this.refreshActiveSessions();
    }, 10000);
    this.refreshActiveSessions();

    // Start background monitoring for notifications
    this.startBackgroundMonitor();
  }

  ngOnDestroy() {
    this.stopWatching();
    this.stopBackgroundMonitor();
    if (this.activeCheckTimer) {
      clearInterval(this.activeCheckTimer);
    }
  }

  async refreshActiveSessions(): Promise<void> {
    try {
      const sessions = await this.tauriBridge.getActiveSessions();
      this.activeSessions.set(sessions);
    } catch {
      // silently fail
    }
  }

  // ─── Foreground watch (updates session detail UI) ───

  startWatching(projectPath: string, sessionId: string): void {
    this.stopWatching();
    this.watchingProject = projectPath;
    this.watchingSession = sessionId;
    this.lastLine = this.sessionStore.rawEntries().length;
    this.isWatching.set(true);
    this.notifications.startIdleWatch();

    const active = this.activeSessions().find(s => s.sessionId === sessionId);
    this.watchingPid = active?.pid ?? null;

    this.pollTimer = setInterval(async () => {
      await this.pollForeground();
    }, this.pollIntervalMs());
  }

  stopWatching(): void {
    this.isWatching.set(false);
    this.notifications.stopIdleWatch();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollForeground(): Promise<void> {
    try {
      const result = await this.tauriBridge.pollSession(
        this.watchingProject,
        this.watchingSession,
        this.lastLine
      );

      if (result.newEntries.length > 0) {
        const newParsed = parseSessionEntries(result.newEntries);

        let needsFocus = false;
        for (const entry of newParsed) {
          const r = this.notifications.checkEntry(entry);
          if (r.shouldFocusTerminal) needsFocus = true;
        }

        if (needsFocus) {
          let pid = this.watchingPid;
          if (!pid) {
            const active = this.activeSessions().find(s => s.sessionId === this.watchingSession);
            pid = active?.pid ?? null;
            if (pid) this.watchingPid = pid;
          }
          if (pid) {
            this.tauriBridge.focusSession(pid).catch(() => { /* ignore */ });
          }
        }

        const existing = this.sessionStore.rawEntries();
        this.sessionStore.rawEntries.set([...existing, ...newParsed]);
        this.lastLine = result.totalLines;
      }
    } catch {
      // polling failed
    }
  }

  // ─── Background monitor (all active sessions, notifications only) ───

  private startBackgroundMonitor(): void {
    this.bgPollTimer = setInterval(async () => {
      if (!this.backgroundMonitoring()) return;
      await this.pollBackground();
    }, 3000);
  }

  private stopBackgroundMonitor(): void {
    if (this.bgPollTimer) {
      clearInterval(this.bgPollTimer);
      this.bgPollTimer = null;
    }
  }

  private async pollBackground(): Promise<void> {
    const activeSessions = this.activeSessions();
    if (activeSessions.length === 0) return;

    for (const session of activeSessions) {
      // Skip the session being watched in foreground (already handled)
      if (this.isWatching() && session.sessionId === this.watchingSession) continue;

      if (!session.projectPath || !session.sessionId) continue;

      const lastLine = this.bgLastLines.get(session.sessionId) ?? 0;

      try {
        const result = await this.tauriBridge.pollSession(
          session.projectPath,
          session.sessionId,
          lastLine
        );

        if (result.newEntries.length > 0) {
          const newParsed = parseSessionEntries(result.newEntries);

          let needsFocus = false;
          for (const entry of newParsed) {
            const r = this.notifications.checkEntry(entry);
            if (r.shouldFocusTerminal) needsFocus = true;
          }

          if (needsFocus && session.pid) {
            this.tauriBridge.focusSession(session.pid).catch(() => { /* ignore */ });
          }

          this.bgLastLines.set(session.sessionId, result.totalLines);
        }
      } catch {
        // skip this session
      }
    }

    // Clean up entries for sessions that are no longer active
    const activeIds = new Set(activeSessions.map(s => s.sessionId));
    for (const id of this.bgLastLines.keys()) {
      if (!activeIds.has(id)) {
        this.bgLastLines.delete(id);
      }
    }
  }
}
