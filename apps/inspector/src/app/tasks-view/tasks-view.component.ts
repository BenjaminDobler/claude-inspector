import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TauriBridgeService, TaskItem } from '@claude-inspector/data-access';

@Component({
  selector: 'app-tasks-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tasks-view.component.html',
  styleUrl: './tasks-view.component.scss',
})
export class TasksViewComponent implements OnChanges {
  private bridge = inject(TauriBridgeService);

  @Input() sessionId: string = '';

  tasks = signal<TaskItem[]>([]);
  expandedId = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['sessionId'] && this.sessionId) {
      this.loadTasks();
    }
  }

  async loadTasks() {
    try {
      const tasks = await this.bridge.readSessionTasks(this.sessionId);
      this.tasks.set(tasks);
    } catch {}
  }

  toggleExpand(id: string) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'completed': return 'var(--accent-green)';
      case 'in_progress': return 'var(--accent-blue)';
      case 'pending': return 'var(--text-muted)';
      default: return 'var(--text-faint)';
    }
  }

  getBlockerNames(ids: string[]): string {
    return ids.map(id => {
      const task = this.tasks().find(t => t.id === id);
      return task ? `#${id} ${task.subject}` : `#${id}`;
    }).join(', ');
  }
}
