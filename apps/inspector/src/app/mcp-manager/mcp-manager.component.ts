import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TauriBridgeService, McpServerInfo } from '@claude-inspector/data-access';

@Component({
  selector: 'app-mcp-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mcp-manager.component.html',
  styleUrl: './mcp-manager.component.scss',
})
export class McpManagerComponent implements OnInit {
  private bridge = inject(TauriBridgeService);

  servers = signal<McpServerInfo[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  expandedServer = signal<string | null>(null);
  removing = signal<string | null>(null);

  // Add form
  showAddForm = signal(false);
  addName = signal('');
  addTransport = signal<'stdio' | 'http'>('stdio');
  addCommandOrUrl = signal('');
  addArgs = signal('');
  addEnvPairs = signal<{ key: string; value: string }[]>([]);
  addScope = signal<'user' | 'project'>('user');
  adding = signal(false);

  ngOnInit() {
    this.loadServers();
  }

  async loadServers() {
    this.loading.set(true);
    try {
      const servers = await this.bridge.listMcpServers();
      this.servers.set(servers);
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggleExpand(name: string) {
    this.expandedServer.set(this.expandedServer() === name ? null : name);
  }

  getSourceLabel(source: string): string {
    if (source === 'user') return 'User';
    if (source.startsWith('project:')) return source.replace('project:', '');
    if (source.startsWith('plugin:')) return source.replace('plugin:', '');
    return source;
  }

  getSourceType(source: string): string {
    if (source === 'user') return 'user';
    if (source.startsWith('project:')) return 'project';
    if (source.startsWith('plugin:')) return 'plugin';
    return 'unknown';
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'stdio': return 'Terminal';
      case 'http': return 'HTTP';
      case 'sse': return 'SSE';
      default: return type;
    }
  }

  addEnvPair() {
    this.addEnvPairs.update((pairs) => [...pairs, { key: '', value: '' }]);
  }

  removeEnvPair(index: number) {
    this.addEnvPairs.update((pairs) => pairs.filter((_, i) => i !== index));
  }

  async addServer() {
    const name = this.addName().trim();
    const commandOrUrl = this.addCommandOrUrl().trim();
    if (!name || !commandOrUrl) return;

    this.adding.set(true);
    try {
      const args = this.addArgs()
        .split(/\s+/)
        .filter((a) => a.length > 0);

      const env: Record<string, string> = {};
      for (const pair of this.addEnvPairs()) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value;
        }
      }

      const transport = this.addTransport() === 'http' ? 'http' : undefined;

      const result = await this.bridge.addMcpServer({
        name,
        commandOrUrl,
        args,
        transport,
        env,
        scope: this.addScope(),
      });

      if (result.success) {
        this.showSuccess(`Added MCP server: ${name}`);
        this.resetForm();
        await this.loadServers();
      } else {
        this.error.set(result.stderr || result.stdout || 'Failed to add server');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.adding.set(false);
    }
  }

  async removeServer(server: McpServerInfo) {
    this.removing.set(server.name);
    try {
      const scope = this.getSourceType(server.source) === 'user' ? 'user' : undefined;
      const result = await this.bridge.removeMcpServer(server.name, scope);
      if (result.success) {
        this.showSuccess(`Removed: ${server.name}`);
        await this.loadServers();
      } else {
        this.error.set(result.stderr || 'Failed to remove server');
      }
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.removing.set(null);
    }
  }

  objectKeys(obj: Record<string, string>): string[] {
    return Object.keys(obj);
  }

  private resetForm() {
    this.showAddForm.set(false);
    this.addName.set('');
    this.addCommandOrUrl.set('');
    this.addArgs.set('');
    this.addEnvPairs.set([]);
    this.addTransport.set('stdio');
  }

  private showSuccess(msg: string) {
    this.success.set(msg);
    setTimeout(() => this.success.set(null), 3000);
  }
}
