import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TauriBridgeService, DailyActivity, HistoryEntry } from '@claude-inspector/data-access';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  stats = signal<DailyActivity[]>([]);
  history = signal<HistoryEntry[]>([]);
  loading = signal(true);

  totalMessages = signal(0);
  totalSessions = signal(0);
  totalToolCalls = signal(0);
  activeDays = signal(0);

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    try {
      const [stats, history] = await Promise.all([
        this.bridge.readUsageStats().catch(() => []),
        this.bridge.readGlobalHistory(100).catch(() => []),
      ]);

      this.stats.set(stats);
      this.history.set(history);

      this.totalMessages.set(stats.reduce((s, d) => s + d.messageCount, 0));
      this.totalSessions.set(stats.reduce((s, d) => s + d.sessionCount, 0));
      this.totalToolCalls.set(stats.reduce((s, d) => s + d.toolCallCount, 0));
      this.activeDays.set(stats.length);
    } catch {} finally {
      this.loading.set(false);
    }
  }

  formatNumber(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  getProjectName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  recentStats(): DailyActivity[] {
    return this.stats().slice(-14).reverse();
  }

  maxMessages(): number {
    return Math.max(1, ...this.stats().slice(-14).map(s => s.messageCount));
  }
}
