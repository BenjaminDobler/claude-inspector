import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { TauriBridgeService, ActiveSessionInfo } from './tauri-bridge.service';
import { SessionStoreService } from './session-store.service';
import { NotificationService } from './notification.service';
import { parseSessionEntries } from '@claude-inspector/session-parser';
import { RawSessionEntry } from '@claude-inspector/types';

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
        for (const entry of newParsed) {
          this.notifications.checkEntry(entry);
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
