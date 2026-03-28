import { Component, AfterViewInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TauriBridgeService, HistoryEntry, HygieneIssue, FullDayStats } from '@claude-inspector/data-access';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements AfterViewInit {
  private bridge = inject(TauriBridgeService);

  fullStats = signal<FullDayStats[]>([]);
  history = signal<HistoryEntry[]>([]);
  hourly = signal<{ hour: number; count: number }[]>([]);
  loading = signal(true);

  totalMessages = signal(0);
  totalSessions = signal(0);
  totalToolCalls = signal(0);
  activeDays = signal(0);
  totalCost = signal(0);
  projectCount = signal(0);

  // Cost by model
  modelCosts = signal<{ model: string; cost: number }[]>([]);

  // Dashboard enhancements
  thisMonthCost = signal(0);
  projectedMonthCost = signal(0);
  lastMonthCost = signal(0);
  monthTrend = signal(0);
  optimizationSavings = signal(0);
  topModel = signal('');
  topModelPct = signal(0);
  hygieneIssues = signal<HygieneIssue[]>([]);
  recentlyActive = signal<{ name: string; count: number }[]>([]);

  ngAfterViewInit() {
    // Wait for two animation frames to ensure the skeleton is painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.loadData();
      });
    });
  }

  async loadData() {
    try {
      const [fullStats, allHistory, hourly, projects, hygieneIssues] = await Promise.all([
        this.bridge.computeFullStats().catch(() => []),
        this.bridge.readGlobalHistory(500).catch(() => []),
        this.bridge.readHourlyActivity().catch(() => []),
        this.bridge.listProjects().catch(() => []),
        this.bridge.checkHygiene().catch(() => []),
      ]);

      const history = allHistory.slice(0, 20); // Recent 20 for display

      // Merge history.jsonl dates into fullStats for older activity data
      const statsMap = new Map(fullStats.map(s => [s.date, s]));
      for (const h of allHistory) {
        if (!h.timestamp) continue;
        const d = new Date(h.timestamp);
        const date = d.toISOString().slice(0, 10);
        if (!statsMap.has(date)) {
          statsMap.set(date, {
            date,
            messageCount: 1,
            toolCallCount: 0,
            inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0,
            models: {},
          });
        }
      }

      const merged = Array.from(statsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      this.fullStats.set(merged);
      this.history.set(history);
      this.hourly.set(hourly);
      this.projectCount.set(projects.length);

      this.totalMessages.set(fullStats.reduce((s, d) => s + d.messageCount, 0));
      this.totalToolCalls.set(fullStats.reduce((s, d) => s + d.toolCallCount, 0));
      this.activeDays.set(fullStats.length);
      // Session count from projects
      this.totalSessions.set(projects.reduce((s, p) => s + p.sessionCount, 0));

      // Pricing table (per million tokens)
      const pricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
        'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
        'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
        'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'claude-sonnet-4-5-20251022': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
      };
      const defaultPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

      // Calculate cost per day and per model from full stats
      const modelCostMap = new Map<string, number>();
      const now = new Date();
      const thisMonthStr = now.toISOString().slice(0, 7);
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);
      let thisMonth = 0;
      let lastMonth = 0;

      for (const day of fullStats) {
        // Find dominant model for this day to price tokens
        let bestModel = '';
        let bestCount = 0;
        for (const [model, count] of Object.entries(day.models)) {
          if (count > bestCount) { bestModel = model; bestCount = count; }
        }

        const prices = pricing[bestModel] || defaultPricing;
        const dayCost =
          (day.inputTokens / 1e6) * prices.input +
          (day.outputTokens / 1e6) * prices.output +
          (day.cacheReadTokens / 1e6) * prices.cacheRead +
          (day.cacheWriteTokens / 1e6) * prices.cacheWrite;

        // Track model costs
        for (const [model, count] of Object.entries(day.models)) {
          const mp = pricing[model] || defaultPricing;
          // Approximate: distribute day's tokens proportionally by model message count
          const totalMsgs = Object.values(day.models).reduce((a, b) => a + b, 0);
          const ratio = totalMsgs > 0 ? count / totalMsgs : 0;
          const modelDayCost = dayCost * ratio;
          modelCostMap.set(model, (modelCostMap.get(model) || 0) + modelDayCost);
        }

        if (day.date.startsWith(thisMonthStr)) thisMonth += dayCost;
        if (day.date.startsWith(lastMonthStr)) lastMonth += dayCost;
      }

      const total = Array.from(modelCostMap.values()).reduce((a, b) => a + b, 0);
      this.totalCost.set(total);

      const sorted = Array.from(modelCostMap.entries())
        .map(([model, cost]) => ({ model: this.shortModel(model), cost }))
        .sort((a, b) => b.cost - a.cost);
      this.modelCosts.set(sorted);

      // Cost projections
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      this.thisMonthCost.set(thisMonth);
      this.projectedMonthCost.set(dayOfMonth > 0 ? (thisMonth / dayOfMonth) * daysInMonth : 0);
      this.lastMonthCost.set(lastMonth);
      this.monthTrend.set(lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0);

      // Optimization ideas
      if (sorted.length > 0) {
        this.topModel.set(sorted[0].model);
        this.topModelPct.set(total > 0 ? (sorted[0].cost / total) * 100 : 0);
        if (sorted[0].model.includes('opus') && this.topModelPct() > 70) {
          this.optimizationSavings.set(sorted[0].cost * 0.8);
        }
      }

      // Hygiene
      this.hygieneIssues.set(hygieneIssues.slice(0, 3));

      // Recently active projects (from history)
      const projectCounts = new Map<string, number>();
      for (const h of history) {
        const name = this.getProjectName(h.project);
        if (name) projectCounts.set(name, (projectCounts.get(name) || 0) + 1);
      }
      this.recentlyActive.set(
        Array.from(projectCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
      );
    } catch { /* ignore */ } finally {
      this.loading.set(false);
    }
  }

  formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  }

  formatCost(usd: number): string {
    return `$${usd.toFixed(2)}`;
  }

  formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString();
  }

  getProjectName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  recentStats(): FullDayStats[] {
    return this.fullStats().slice(-30).reverse();
  }

  maxMessages(): number {
    return Math.max(1, ...this.fullStats().slice(-30).map(s => s.messageCount));
  }

  maxHourly(): number {
    return Math.max(1, ...this.hourly().map(h => h.count));
  }

  maxModelCost(): number {
    return Math.max(1, ...this.modelCosts().map(m => m.cost));
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    if (hour < 12) return `Good morning`;
    if (hour < 17) return `${day} afternoon`;
    return `${day} evening`;
  }

  getHourLabel(hour: number): string {
    if (hour === 0) return '12a';
    if (hour < 12) return `${hour}a`;
    if (hour === 12) return '12p';
    return `${hour - 12}p`;
  }

  hourColor(count: number): string {
    const max = this.maxHourly();
    if (count === 0) return 'transparent';
    const ratio = count / max;
    if (ratio > 0.7) return 'var(--accent-blue)';
    if (ratio > 0.4) return 'var(--accent-green)';
    if (ratio > 0.15) return 'var(--accent-yellow)';
    return 'rgba(88, 166, 255, 0.3)';
  }

  private shortModel(model: string): string {
    return model.replace('claude-', '').replace(/-\d{8}$/, '').replace(/-\d{8}/, '');
  }
}
