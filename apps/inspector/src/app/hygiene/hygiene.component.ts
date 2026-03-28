import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, HygieneIssue } from '@claude-inspector/data-access';

@Component({
  selector: 'app-hygiene',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hygiene.component.html',
  styleUrl: './hygiene.component.scss',
})
export class HygieneComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  issues = signal<HygieneIssue[]>([]);
  loading = signal(true);

  warnings = computed(() => this.issues().filter(i => i.severity === 'warning'));
  infos = computed(() => this.issues().filter(i => i.severity === 'info'));

  categories = computed(() => {
    const cats = new Map<string, number>();
    for (const issue of this.issues()) {
      cats.set(issue.category, (cats.get(issue.category) || 0) + 1);
    }
    return cats;
  });

  ngOnInit() {
    this.runChecks();
  }

  async runChecks() {
    this.loading.set(true);
    try {
      const issues = await this.bridge.checkHygiene();
      this.issues.set(issues);
    } catch { /* ignore */ } finally {
      this.loading.set(false);
    }
  }

  getCategoryLabel(cat: string): string {
    const labels: Record<string, string> = {
      claude_md: 'Missing CLAUDE.md',
      large_session: 'Large Sessions',
      worktrees: 'Stale Worktrees',
      debug_logs: 'Debug Logs',
      telemetry: 'Telemetry',
      uncommitted: 'Uncommitted Changes',
    };
    return labels[cat] || cat;
  }

  getCategoryIcon(cat: string): string {
    const icons: Record<string, string> = {
      claude_md: '📄',
      large_session: '📦',
      worktrees: '🌳',
      debug_logs: '🪵',
      telemetry: '📡',
      uncommitted: '📝',
    };
    return icons[cat] || '⚠';
  }
}
