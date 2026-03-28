import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { SessionStoreService, WatcherService, TauriBridgeService } from '@claude-inspector/data-access';
import { TimelineComponent } from '../timeline/timeline.component';
import { TokenChartComponent } from '../token-chart/token-chart.component';
import { ToolStatsComponent } from '../tool-stats/tool-stats.component';
import { ConversationTreeComponent } from '../conversation-tree/conversation-tree.component';
import { ReplayComponent } from '../replay/replay.component';
import { SessionSearchComponent } from '../session-search/session-search.component';
import { InsightsComponent } from '../insights/insights.component';
import { TasksViewComponent } from '../tasks-view/tasks-view.component';
import { FileHistoryComponent } from '../file-history/file-history.component';
import { MemoryViewerComponent } from '../memory-viewer/memory-viewer.component';

type Tab = 'overview' | 'timeline' | 'tokens' | 'tools' | 'tree' | 'replay' | 'search' | 'insights' | 'plans' | 'tasks' | 'files' | 'memory';

@Component({
  selector: 'app-session-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TimelineComponent,
    TokenChartComponent,
    ToolStatsComponent,
    ConversationTreeComponent,
    ReplayComponent,
    SessionSearchComponent,
    InsightsComponent,
    TasksViewComponent,
    FileHistoryComponent,
    MemoryViewerComponent,
  ],
  templateUrl: './session-detail.component.html',
  styleUrl: './session-detail.component.scss',
})
export class SessionDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private bridge = inject(TauriBridgeService);
  store = inject(SessionStoreService);
  watcher = inject(WatcherService);
  activeTab = signal<Tab>('overview');

  ngOnInit() {
    const projectPath = this.route.snapshot.paramMap.get('projectPath');
    const sessionId = this.route.snapshot.paramMap.get('sessionId');

    if (projectPath && sessionId) {
      if (this.store.selectedProject() !== projectPath) {
        this.store.selectProject(projectPath).then(() => {
          this.store.selectSession(sessionId);
        });
      } else {
        this.store.selectSession(sessionId);
      }
    }
  }

  exportSession() {
    const stats = this.store.sessionStats();
    const toolStats = this.store.toolStats();
    const tokenTimeline = this.store.tokenTimeline();

    const report = {
      sessionId: this.store.selectedSessionId(),
      projectPath: this.store.selectedProject(),
      stats,
      toolStats,
      tokenTimeline,
      entryCount: this.store.rawEntries().length,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${this.store.selectedSessionId()?.slice(0, 8)}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async focusTerminal() {
    const sessionId = this.store.selectedSessionId();
    const activeSessions = this.watcher.activeSessions();
    const active = activeSessions.find(s => s.sessionId === sessionId);
    if (active) {
      try {
        await this.bridge.focusSession(active.pid);
      } catch { /* ignore on non-macOS */ }
    }
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
    return `${(count / 1000000).toFixed(2)}M`;
  }

  formatCost(usd: number): string {
    return `$${usd.toFixed(4)}`;
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
}
