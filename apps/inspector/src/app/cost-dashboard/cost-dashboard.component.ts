import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, CostData } from '@claude-inspector/data-access';

interface DayCost {
  date: string;
  models: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  totalCost: number;
}

@Component({
  selector: 'app-cost-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cost-dashboard.component.html',
  styleUrl: './cost-dashboard.component.scss',
})
export class CostDashboardComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  costData = signal<CostData | null>(null);
  loading = signal(true);

  dayCosts = computed<DayCost[]>(() => {
    const data = this.costData();
    if (!data) return [];

    const pricing = data.pricing;
    const result: DayCost[] = [];

    for (const [date, models] of Object.entries(data.days)) {
      let totalCost = 0;
      for (const [model, usage] of Object.entries(models)) {
        const prices = pricing[model] || { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
        totalCost +=
          (usage.input / 1_000_000) * prices.input +
          (usage.output / 1_000_000) * prices.output +
          (usage.cacheRead / 1_000_000) * prices.cacheRead +
          (usage.cacheWrite / 1_000_000) * prices.cacheWrite;
      }
      result.push({ date, models, totalCost });
    }

    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  });

  totalSpend = computed(() => this.dayCosts().reduce((sum, d) => sum + d.totalCost, 0));
  last7DaysSpend = computed(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return this.dayCosts().filter(d => d.date >= cutoffStr).reduce((sum, d) => sum + d.totalCost, 0);
  });
  last30DaysSpend = computed(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return this.dayCosts().filter(d => d.date >= cutoffStr).reduce((sum, d) => sum + d.totalCost, 0);
  });

  modelNames = computed(() => {
    const data = this.costData();
    if (!data) return [];
    const names = new Set<string>();
    for (const models of Object.values(data.days)) {
      for (const model of Object.keys(models)) names.add(model);
    }
    return Array.from(names).sort();
  });

  ngOnInit() {
    this.loadCosts();
  }

  async loadCosts() {
    try {
      const data = await this.bridge.readCostData();
      this.costData.set(data);
    } catch {} finally {
      this.loading.set(false);
    }
  }

  formatCost(usd: number): string {
    return `$${usd.toFixed(2)}`;
  }

  formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  getModelShortName(model: string): string {
    return model.replace('claude-', '').replace(/-\d{8}$/, '');
  }

  getDayTotal(day: DayCost, type: string): number {
    return Object.values(day.models).reduce((sum, u) => sum + ((u as any)[type] || 0), 0);
  }
}
