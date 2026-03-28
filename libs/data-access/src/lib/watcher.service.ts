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
  readonly usePolling = signal(true);
  readonly pollIntervalMs = signal(2000);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastLine = 0;
  private watchingProject = '';
  private watchingSession = '';
  private watchingPid: number | null = null;

  constructor() {
    this.activeCheckTimer = setInterval(() => {
      this.refreshActiveSessions();
    }, 10000);
    this.refreshActiveSessions();
  }

  ngOnDestroy() {
    this.stopWatching();
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

  startWatching(projectPath: string, sessionId: string): void {
    this.stopWatching();
    this.watchingProject = projectPath;
    this.watchingSession = sessionId;
    this.lastLine = this.sessionStore.rawEntries().length;
    this.isWatching.set(true);
    this.notifications.startIdleWatch();

    // Find and cache the PID for this session
    const active = this.activeSessions().find(s => s.sessionId === sessionId);
    this.watchingPid = active?.pid ?? null;

    this.pollTimer = setInterval(async () => {
      await this.poll();
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

  private async poll(): Promise<void> {
    try {
      const result = await this.tauriBridge.pollSession(
        this.watchingProject,
        this.watchingSession,
        this.lastLine
      );

      if (result.newEntries.length > 0) {
        const newParsed = parseSessionEntries(result.newEntries);

        // Check each new entry against notification rules
        let needsFocus = false;
        for (const entry of newParsed) {
          const result2 = this.notifications.checkEntry(entry);
          if (result2.shouldFocusTerminal) needsFocus = true;
        }

        // Auto-focus terminal if triggered
        if (needsFocus) {
          // Try cached PID first, then look up from active sessions
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
      // polling failed, will retry on next interval
    }
  }
}
