import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TauriBridgeService, DailyActivity, HistoryEntry, CostData, HygieneIssue } from '@claude-inspector/data-access';

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
  hourly = signal<{ hour: number; count: number }[]>([]);
  costData = signal<CostData | null>(null);
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

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    try {
      const [stats, history, hourly, costData, projects, hygieneIssues] = await Promise.all([
        this.bridge.readUsageStats().catch(() => []),
        this.bridge.readGlobalHistory(20).catch(() => []),
        this.bridge.readHourlyActivity().catch(() => []),
        this.bridge.readCostData().catch(() => null),
        this.bridge.listProjects().catch(() => []),
        this.bridge.checkHygiene().catch(() => []),
      ]);

      this.stats.set(stats);
      this.history.set(history);
      this.hourly.set(hourly);
      this.costData.set(costData);
      this.projectCount.set(projects.length);

      this.totalMessages.set(stats.reduce((s, d) => s + d.messageCount, 0));
      this.totalSessions.set(stats.reduce((s, d) => s + d.sessionCount, 0));
      this.totalToolCalls.set(stats.reduce((s, d) => s + d.toolCallCount, 0));
      this.activeDays.set(stats.length);

      // Calculate total cost and per-model costs
      if (costData) {
        const modelMap = new Map<string, number>();
        for (const [, models] of Object.entries(costData.days)) {
          for (const [model, usage] of Object.entries(models)) {
            const prices = costData.pricing[model] || { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
            const cost =
              (usage.input / 1_000_000) * prices.input +
              (usage.output / 1_000_000) * prices.output +
              (usage.cacheRead / 1_000_000) * prices.cacheRead +
              (usage.cacheWrite / 1_000_000) * prices.cacheWrite;
            modelMap.set(model, (modelMap.get(model) || 0) + cost);
          }
        }
        const total = Array.from(modelMap.values()).reduce((a, b) => a + b, 0);
        this.totalCost.set(total);

        const sorted = Array.from(modelMap.entries())
          .map(([model, cost]) => ({ model: this.shortModel(model), cost }))
          .sort((a, b) => b.cost - a.cost);
        this.modelCosts.set(sorted);

        // Cost projections
        const now = new Date();
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const thisMonthStr = now.toISOString().slice(0, 7); // "2026-03"
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);

        let thisMonth = 0;
        let lastMonth = 0;
        for (const [date, models] of Object.entries(costData.days)) {
          let dayCost = 0;
          for (const [model, usage] of Object.entries(models)) {
            const prices = costData.pricing[model] || { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
            dayCost += (usage.input / 1e6) * prices.input + (usage.output / 1e6) * prices.output +
              (usage.cacheRead / 1e6) * prices.cacheRead + (usage.cacheWrite / 1e6) * prices.cacheWrite;
          }
          if (date.startsWith(thisMonthStr)) thisMonth += dayCost;
          if (date.startsWith(lastMonthStr)) lastMonth += dayCost;
        }

        this.thisMonthCost.set(thisMonth);
        this.projectedMonthCost.set(dayOfMonth > 0 ? (thisMonth / dayOfMonth) * daysInMonth : 0);
        this.lastMonthCost.set(lastMonth);
        this.monthTrend.set(lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0);

        // Optimization ideas
        if (sorted.length > 0) {
          const topCost = sorted[0].cost;
          this.topModel.set(sorted[0].model);
          this.topModelPct.set(total > 0 ? (topCost / total) * 100 : 0);
          // If top model is Opus and accounts for >70%, suggest Sonnet
          if (sorted[0].model.includes('opus') && this.topModelPct() > 70) {
            this.optimizationSavings.set(topCost * 0.8); // Sonnet is ~80% cheaper
          }
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

  recentStats(): DailyActivity[] {
    return this.stats().slice(-30).reverse();
  }

  maxMessages(): number {
    return Math.max(1, ...this.stats().slice(-30).map(s => s.messageCount));
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
