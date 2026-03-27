import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, MemoryFile } from '@claude-inspector/data-access';

@Component({
  selector: 'app-memory-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './memory-viewer.component.html',
  styleUrl: './memory-viewer.component.scss',
})
export class MemoryViewerComponent implements OnChanges {
  private bridge = inject(TauriBridgeService);

  @Input() projectPathKey: string = '';

  memories = signal<MemoryFile[]>([]);
  expandedFile = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectPathKey'] && this.projectPathKey) {
      this.loadMemories();
    }
  }

  async loadMemories() {
    try {
      const files = await this.bridge.readProjectMemory(this.projectPathKey);
      this.memories.set(files);
    } catch {}
  }

  toggleExpand(filename: string) {
    this.expandedFile.set(this.expandedFile() === filename ? null : filename);
  }

  getMemoryType(content: string): string {
    const match = content.match(/type:\s*(\w+)/);
    return match ? match[1] : 'unknown';
  }

  getMemoryName(content: string): string {
    const match = content.match(/name:\s*(.+)/);
    return match ? match[1].trim() : '';
  }

  getMemoryDescription(content: string): string {
    const match = content.match(/description:\s*(.+)/);
    return match ? match[1].trim() : '';
  }

  getTypeColor(type: string): string {
    switch (type) {
      case 'user': return 'var(--accent-blue)';
      case 'feedback': return 'var(--accent-yellow)';
      case 'project': return 'var(--accent-green)';
      case 'reference': return 'var(--accent-purple)';
      default: return 'var(--text-muted)';
    }
  }
}
