import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, FileHistoryEntry } from '@claude-inspector/data-access';

@Component({
  selector: 'app-file-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-history.component.html',
  styleUrl: './file-history.component.scss',
})
export class FileHistoryComponent implements OnChanges {
  private bridge = inject(TauriBridgeService);

  @Input() sessionId: string = '';

  files = signal<FileHistoryEntry[]>([]);
  expandedHash = signal<string | null>(null);
  selectedVersion = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['sessionId'] && this.sessionId) {
      this.loadHistory();
    }
  }

  async loadHistory() {
    try {
      const files = await this.bridge.readFileHistory(this.sessionId);
      this.files.set(files);
    } catch {}
  }

  toggleExpand(hash: string) {
    this.expandedHash.set(this.expandedHash() === hash ? null : hash);
    this.selectedVersion.set(null);
  }

  selectVersion(hash: string, version: string) {
    this.selectedVersion.set(`${hash}@${version}`);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
