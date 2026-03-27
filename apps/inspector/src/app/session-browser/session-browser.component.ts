import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SessionStoreService, WatcherService, ActiveSessionInfo } from '@claude-inspector/data-access';
import { ProjectInfo, SessionInfo } from '@claude-inspector/types';

@Component({
  selector: 'app-session-browser',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './session-browser.component.html',
  styleUrl: './session-browser.component.scss',
})
export class SessionBrowserComponent implements OnInit {
  private store = inject(SessionStoreService);
  private watcher = inject(WatcherService);
  private router = inject(Router);

  projects = this.store.projects;
  sessions = this.store.sessions;
  selectedProject = this.store.selectedProject;
  selectedSessionId = this.store.selectedSessionId;
  loading = this.store.loading;
  error = this.store.error;
  activeSessions = this.watcher.activeSessions;

  ngOnInit() {
    this.store.loadProjects();
    this.watcher.refreshActiveSessions();
  }

  selectProject(project: ProjectInfo) {
    this.store.selectProject(project.pathKey);
  }

  selectSession(session: SessionInfo) {
    const projectPath = this.selectedProject();
    if (projectPath) {
      this.router.navigate(['/session', projectPath, session.sessionId]);
    }
  }

  watchActiveSession(session: ActiveSessionInfo) {
    if (session.projectPath && session.sessionId) {
      this.router.navigate(['/session', session.projectPath, session.sessionId]);
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDate(timestampMs: string): string {
    const date = new Date(parseInt(timestampMs, 10));
    return date.toLocaleString();
  }

  getProjectName(displayPath: string): string {
    const parts = displayPath.split('/').filter(Boolean);
    return parts[parts.length - 1] || displayPath;
  }
}
