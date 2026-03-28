import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TauriBridgeService, TranscriptResult } from '@claude-inspector/data-access';

@Component({
  selector: 'app-transcripts',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transcripts.component.html',
  styleUrl: './transcripts.component.scss',
})
export class TranscriptsComponent {
  private bridge = inject(TauriBridgeService);
  private router = inject(Router);

  query = signal('');
  results = signal<TranscriptResult[]>([]);
  loading = signal(false);
  searched = signal(false);

  async search() {
    const q = this.query().trim();
    if (!q) return;

    this.loading.set(true);
    this.searched.set(true);
    try {
      const results = await this.bridge.searchTranscripts(q, 100);
      this.results.set(results);
    } catch { /* ignore */ } finally {
      this.loading.set(false);
    }
  }

  openSession(result: TranscriptResult) {
    this.router.navigate(['/session', result.projectPath.split('/').join('-'), result.sessionId]);
  }

  getProjectName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  formatTimestamp(ts: string): string {
    const num = Number(ts);
    if (!isNaN(num) && num > 1000000000000) {
      return new Date(num).toLocaleString();
    }
    if (ts.includes('T')) {
      return new Date(ts).toLocaleString();
    }
    return ts;
  }

  getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      user_message: 'var(--accent-blue)',
      assistant_message: 'var(--accent-green)',
      tool_use: 'var(--accent-yellow)',
      tool_result: 'var(--text-secondary)',
      thinking: 'var(--accent-orange)',
    };
    return colors[type] || 'var(--text-muted)';
  }
}
