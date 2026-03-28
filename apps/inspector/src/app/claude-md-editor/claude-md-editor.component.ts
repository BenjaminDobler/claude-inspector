import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TauriBridgeService, ClaudeMdInfo } from '@claude-inspector/data-access';

@Component({
  selector: 'app-claude-md-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './claude-md-editor.component.html',
  styleUrl: './claude-md-editor.component.scss',
})
export class ClaudeMdEditorComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  projects = signal<ClaudeMdInfo[]>([]);
  selectedProject = signal<ClaudeMdInfo | null>(null);
  editContent = signal('');
  loading = signal(true);
  saving = signal(false);
  success = signal<string | null>(null);
  dirty = signal(false);

  ngOnInit() {
    this.loadProjects();
  }

  async loadProjects() {
    try {
      const projects = await this.bridge.listClaudeMdFiles();
      this.projects.set(projects);
    } catch { /* ignore */ } finally {
      this.loading.set(false);
    }
  }

  selectProject(project: ClaudeMdInfo) {
    this.selectedProject.set(project);
    this.editContent.set(project.content || '');
    this.dirty.set(false);
  }

  onEdit(value: string) {
    this.editContent.set(value);
    this.dirty.set(true);
  }

  async save() {
    const project = this.selectedProject();
    if (!project) return;

    this.saving.set(true);
    try {
      await this.bridge.writeClaudeMd(project.projectPath, this.editContent());
      this.dirty.set(false);
      this.success.set('Saved!');
      setTimeout(() => this.success.set(null), 2000);

      // Update local state
      const updated = { ...project, content: this.editContent(), exists: true };
      this.selectedProject.set(updated);
      this.projects.update(ps => ps.map(p => p.projectPath === project.projectPath ? updated : p));
    } catch { /* ignore */ } finally {
      this.saving.set(false);
    }
  }

  getProjectName(path: string): string {
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  get existingCount(): number {
    return this.projects().filter(p => p.exists).length;
  }

  get missingCount(): number {
    return this.projects().filter(p => !p.exists).length;
  }
}
