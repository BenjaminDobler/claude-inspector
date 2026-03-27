import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TauriBridgeService,
  ConfigFiles,
  ProjectConfig,
  MarketplaceInfo,
  MarketplacePlugin,
  PluginDetail,
} from '@claude-inspector/data-access';

type Section = 'plugins' | 'marketplace' | 'permissions' | 'project' | 'raw';

interface PluginEntry extends MarketplacePlugin {
  marketplace: string;
  installed: boolean;
  installCount?: number;
  installedVersion?: string;
  lastUpdated?: string;
  daysSinceUpdate?: number;
}

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './config.component.html',
  styleUrl: './config.component.scss',
})
export class ConfigComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  activeSection = signal<Section>('plugins');
  loading = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  // Global config
  globalConfig = signal<ConfigFiles | null>(null);
  enabledPlugins = signal<Record<string, boolean>>({});

  // Marketplace
  marketplaces = signal<MarketplaceInfo[]>([]);
  allPlugins = signal<PluginEntry[]>([]);
  selectedPlugin = signal<PluginEntry | null>(null);
  selectedPluginDetail = signal<PluginDetail | null>(null);
  marketplaceSearch = signal('');
  marketplaceCategory = signal('');
  marketplaceShowInstalled = signal<'all' | 'installed' | 'not-installed'>('all');
  installing = signal<string | null>(null);
  updating = signal<string | null>(null);
  newMarketplaceSource = signal('');
  marketplaceLoading = signal(false);

  get filteredPlugins() {
    const search = this.marketplaceSearch().toLowerCase();
    const category = this.marketplaceCategory();
    const showInstalled = this.marketplaceShowInstalled();

    return this.allPlugins().filter((p) => {
      if (search && !p.name.toLowerCase().includes(search) && !p.description?.toLowerCase().includes(search)) return false;
      if (category && p.category !== category) return false;
      if (showInstalled === 'installed' && !p.installed) return false;
      if (showInstalled === 'not-installed' && p.installed) return false;
      return true;
    });
  }

  get categories(): string[] {
    const cats = new Set<string>();
    for (const p of this.allPlugins()) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats).sort();
  }

  // Project config
  projectDirs = signal<string[]>([]);
  selectedProjectDir = signal<string>('');
  projectConfig = signal<ProjectConfig | null>(null);
  projectPermissions = signal<string[]>([]);
  newPermission = signal('');

  // Raw editor
  rawEditTarget = signal<'global' | 'project' | 'project-local'>('global');
  rawEditContent = signal('');

  ngOnInit() {
    this.loadGlobalConfig();
    this.loadMarketplaces();
    this.loadProjectDirs();
  }

  async loadGlobalConfig(): Promise<void> {
    this.loading.set(true);
    try {
      const config = await this.bridge.readGlobalConfig();
      this.globalConfig.set(config);

      const enabled = (config.globalSettings as any)?.enabledPlugins || {};
      this.enabledPlugins.set(enabled);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async loadMarketplaces(): Promise<void> {
    try {
      const marketplaces = await this.bridge.listMarketplaces();
      this.marketplaces.set(marketplaces);

      const config = this.globalConfig();
      const installed = config?.installedPlugins as any;
      const installedKeys = installed?.plugins ? Object.keys(installed.plugins) : [];
      const counts = (config?.installCounts as any)?.counts || [];

      const installedData = installed?.plugins || {};
      const allPlugins: PluginEntry[] = [];

      for (const mkt of marketplaces) {
        const plugins = mkt.catalog?.plugins || [];
        for (const p of plugins) {
          const fullId = `${p.name}@${mkt.name}`;
          const countEntry = counts.find((c: any) => c.plugin === fullId);
          const installInfo = (installedData as any)[fullId];
          const installEntry = Array.isArray(installInfo) ? installInfo[0] : null;

          let daysSinceUpdate: number | undefined;
          if (installEntry?.lastUpdated) {
            const updated = new Date(installEntry.lastUpdated).getTime();
            daysSinceUpdate = Math.floor((Date.now() - updated) / (1000 * 60 * 60 * 24));
          }

          allPlugins.push({
            ...p,
            marketplace: mkt.name,
            installed: installedKeys.includes(fullId),
            installCount: countEntry?.unique_installs,
            installedVersion: installEntry?.version,
            lastUpdated: installEntry?.lastUpdated,
            daysSinceUpdate,
          });
        }
      }

      allPlugins.sort((a, b) => (b.installCount || 0) - (a.installCount || 0));
      this.allPlugins.set(allPlugins);
    } catch (e) {
      // silently fail — config may not exist
    }
  }

  async togglePlugin(pluginId: string, enable: boolean): Promise<void> {
    const current = { ...this.enabledPlugins() };
    if (enable) {
      current[pluginId] = true;
    } else {
      delete current[pluginId];
    }

    const settings = {
      ...(this.globalConfig()?.globalSettings || {}),
      enabledPlugins: current,
    };

    try {
      await this.bridge.writeGlobalSettings(settings);
      this.enabledPlugins.set(current);
      this.showSuccess(`Plugin ${enable ? 'enabled' : 'disabled'}`);
      await this.loadGlobalConfig();
    } catch (e) {
      this.error.set(String(e));
    }
  }

  async installPlugin(plugin: MarketplacePlugin & { marketplace: string }): Promise<void> {
    const pluginId = `${plugin.name}@${plugin.marketplace}`;
    this.installing.set(pluginId);
    try {
      const result = await this.bridge.installPlugin(pluginId);
      if (result.success) {
        this.showSuccess(`Installed ${plugin.name}`);
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        this.error.set(result.stderr || 'Installation failed');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.installing.set(null);
    }
  }

  async updatePlugin(plugin: PluginEntry): Promise<void> {
    const pluginId = `${plugin.name}@${plugin.marketplace}`;
    this.updating.set(pluginId);
    try {
      const result = await this.bridge.updatePlugin(pluginId);
      if (result.success) {
        this.showSuccess(`Updated ${plugin.name}`);
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        // "already up to date" is in stdout, not an error
        if (result.stdout?.toLowerCase().includes('up to date') || result.stdout?.toLowerCase().includes('already')) {
          this.showSuccess(`${plugin.name} is already up to date`);
        } else {
          this.error.set(result.stderr || result.stdout || 'Update failed');
        }
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.updating.set(null);
    }
  }

  async addMarketplace(): Promise<void> {
    const source = this.newMarketplaceSource().trim();
    if (!source) return;

    this.marketplaceLoading.set(true);
    try {
      const result = await this.bridge.addMarketplace(source);
      if (result.success) {
        this.showSuccess('Marketplace added');
        this.newMarketplaceSource.set('');
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        this.error.set(result.stderr || result.stdout || 'Failed to add marketplace');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.marketplaceLoading.set(false);
    }
  }

  async removeMarketplace(name: string): Promise<void> {
    this.marketplaceLoading.set(true);
    try {
      const result = await this.bridge.removeMarketplace(name);
      if (result.success) {
        this.showSuccess(`Removed marketplace: ${name}`);
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        this.error.set(result.stderr || 'Failed to remove marketplace');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.marketplaceLoading.set(false);
    }
  }

  async refreshMarketplaces(): Promise<void> {
    this.marketplaceLoading.set(true);
    try {
      const result = await this.bridge.updateMarketplace();
      if (result.success) {
        this.showSuccess('Marketplaces updated');
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        this.error.set(result.stderr || result.stdout || 'Failed to update marketplaces');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.marketplaceLoading.set(false);
    }
  }

  async updateAllPlugins(): Promise<void> {
    const installed = this.allPlugins().filter((p) => p.installed);
    for (const plugin of installed) {
      await this.updatePlugin(plugin);
    }
  }

  async uninstallPlugin(plugin: MarketplacePlugin & { marketplace: string }): Promise<void> {
    const pluginId = `${plugin.name}@${plugin.marketplace}`;
    this.installing.set(pluginId);
    try {
      const result = await this.bridge.uninstallPlugin(pluginId);
      if (result.success) {
        this.showSuccess(`Uninstalled ${plugin.name}`);
        await this.loadGlobalConfig();
        await this.loadMarketplaces();
      } else {
        this.error.set(result.stderr || 'Uninstallation failed');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.installing.set(null);
    }
  }

  async viewPlugin(plugin: PluginEntry): Promise<void> {
    this.selectedPlugin.set(plugin);
    this.selectedPluginDetail.set(null);

    // Try to load cached details (skills, mcp) for installed plugins
    if (plugin.installed) {
      try {
        const detail = await this.bridge.readPluginDetail(plugin.marketplace, plugin.name);
        this.selectedPluginDetail.set(detail);
      } catch {
        // fine — just show catalog info
      }
    }
  }

  closePluginDetail(): void {
    this.selectedPlugin.set(null);
    this.selectedPluginDetail.set(null);
  }

  // Project config
  async loadProjectDirs(): Promise<void> {
    try {
      const projects = await this.bridge.listProjects();
      const dirs = projects.map((p) => '/' + p.displayPath);
      this.projectDirs.set(dirs);
    } catch { /* ignore */ }
  }

  async loadProjectConfig(): Promise<void> {
    const dir = this.selectedProjectDir();
    if (!dir) return;

    this.loading.set(true);
    try {
      const config = await this.bridge.readProjectConfig(dir);
      this.projectConfig.set(config);

      const perms = (config.settingsLocal as any)?.permissions?.allow || [];
      this.projectPermissions.set(perms);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  async addPermission(): Promise<void> {
    const perm = this.newPermission().trim();
    if (!perm) return;

    const perms = [...this.projectPermissions(), perm];
    await this.savePermissions(perms);
    this.newPermission.set('');
  }

  async removePermission(index: number): Promise<void> {
    const perms = this.projectPermissions().filter((_, i) => i !== index);
    await this.savePermissions(perms);
  }

  private async savePermissions(perms: string[]): Promise<void> {
    const dir = this.selectedProjectDir();
    if (!dir) return;

    const config = this.projectConfig();
    const settingsLocal = {
      ...(config?.settingsLocal || {}),
      permissions: { allow: perms },
    };

    try {
      await this.bridge.writeProjectSettingsLocal(dir, settingsLocal);
      this.projectPermissions.set(perms);
      this.showSuccess('Permissions saved');
    } catch (e) {
      this.error.set(String(e));
    }
  }

  // Raw editor
  async loadRawContent(): Promise<void> {
    const target = this.rawEditTarget();
    const config = this.globalConfig();
    const projectConfig = this.projectConfig();

    let content: unknown;
    if (target === 'global') {
      content = config?.globalSettings || {};
    } else if (target === 'project') {
      content = projectConfig?.settings || {};
    } else {
      content = projectConfig?.settingsLocal || {};
    }
    this.rawEditContent.set(JSON.stringify(content, null, 2));
  }

  async saveRawContent(): Promise<void> {
    try {
      const parsed = JSON.parse(this.rawEditContent());
      const target = this.rawEditTarget();

      if (target === 'global') {
        await this.bridge.writeGlobalSettings(parsed);
      } else if (target === 'project') {
        await this.bridge.writeProjectSettings(this.selectedProjectDir(), parsed);
      } else {
        await this.bridge.writeProjectSettingsLocal(this.selectedProjectDir(), parsed);
      }
      this.showSuccess('Settings saved');
      await this.loadGlobalConfig();
    } catch (e) {
      this.error.set(String(e));
    }
  }

  formatCount(n: number | undefined): string {
    if (!n) return '';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }

  private showSuccess(msg: string): void {
    this.success.set(msg);
    setTimeout(() => this.success.set(null), 3000);
  }
}
