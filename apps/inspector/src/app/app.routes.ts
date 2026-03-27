import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./session-browser/session-browser.component').then(
        (m) => m.SessionBrowserComponent
      ),
  },
  {
    path: 'session/:projectPath/:sessionId',
    loadComponent: () =>
      import('./session-detail/session-detail.component').then(
        (m) => m.SessionDetailComponent
      ),
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
  },
  {
    path: 'costs',
    loadComponent: () =>
      import('./cost-dashboard/cost-dashboard.component').then(
        (m) => m.CostDashboardComponent
      ),
  },
  {
    path: 'mcp',
    loadComponent: () =>
      import('./mcp-manager/mcp-manager.component').then(
        (m) => m.McpManagerComponent
      ),
  },
  {
    path: 'config',
    loadComponent: () =>
      import('./config/config.component').then(
        (m) => m.ConfigComponent
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./settings/settings.component').then(
        (m) => m.SettingsComponent
      ),
  },
];
