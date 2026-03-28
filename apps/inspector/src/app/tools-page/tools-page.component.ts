import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, GlobalToolStat, ToolSequence } from '@claude-inspector/data-access';

@Component({
  selector: 'app-tools-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tools-page.component.html',
  styleUrl: './tools-page.component.scss',
})
export class ToolsPageComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  tools = signal<GlobalToolStat[]>([]);
  sequences = signal<ToolSequence[]>([]);
  loading = signal(true);

  totalCalls = computed(() => this.tools().reduce((s, t) => s + t.count, 0));
  toolCount = computed(() => this.tools().length);
  maxToolCount = computed(() => Math.max(1, ...this.tools().map(t => t.count)));
  maxSeqCount = computed(() => Math.max(1, ...this.sequences().map(s => s.count)));

  // Color mapping for tool bars
  toolColors: Record<string, string> = {
    Read: 'var(--accent-blue)',
    Edit: 'var(--accent-green)',
    Bash: '#3fb950',
    Grep: 'var(--accent-yellow)',
    Write: '#8b949e',
    Glob: '#bc8cff',
    Agent: 'var(--accent-purple)',
    TaskCreate: '#d29922',
    TaskUpdate: '#d29922',
    Skill: '#f0883e',
  };

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    try {
      const [tools, sequences] = await this.bridge.readGlobalToolStats();
      this.tools.set(tools);
      this.sequences.set(sequences);
    } catch { /* ignore */ } finally {
      this.loading.set(false);
    }
  }

  getToolColor(name: string): string {
    return this.toolColors[name] || 'var(--accent-blue)';
  }

  formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  }
}
