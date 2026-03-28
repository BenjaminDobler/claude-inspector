import { Component, HostListener, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionStoreService } from '@claude-inspector/data-access';

interface PaletteItem {
  label: string;
  description: string;
  route: string;
  icon: string;
  category: string;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="palette-overlay" (click)="close()">
        <div class="palette-modal" (click)="$event.stopPropagation()">
          <input
            #searchInput
            type="text"
            class="palette-input"
            placeholder="Type to search..."
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            (keydown.escape)="close()"
            (keydown.arrowdown)="moveSelection(1); $event.preventDefault()"
            (keydown.arrowup)="moveSelection(-1); $event.preventDefault()"
            (keydown.enter)="selectCurrent()"
          />
          <div class="palette-results">
            @for (item of filteredItems(); track item.route; let i = $index) {
              <button
                class="palette-item"
                [class.selected]="selectedIndex() === i"
                (click)="navigate(item)"
                (mouseenter)="selectedIndex.set(i)"
              >
                <span class="palette-icon">{{ item.icon }}</span>
                <div class="palette-text">
                  <span class="palette-label">{{ item.label }}</span>
                  <span class="palette-desc">{{ item.description }}</span>
                </div>
                <span class="palette-category">{{ item.category }}</span>
              </button>
            }
            @if (filteredItems().length === 0) {
              <div class="palette-empty">No results</div>
            }
          </div>
          <div class="palette-footer">
            <span class="palette-hint">arrows to navigate</span>
            <span class="palette-hint">enter to select</span>
            <span class="palette-hint">esc to close</span>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private router = inject(Router);
  private store = inject(SessionStoreService);

  isOpen = signal(false);
  query = signal('');
  selectedIndex = signal(0);

  private items: PaletteItem[] = [
    { label: 'Dashboard', description: 'Overview with activity and costs', route: '/dashboard', icon: '◆', category: 'Overview' },
    { label: 'Sessions', description: 'Browse and select sessions', route: '/', icon: '◉', category: 'Monitor' },
    { label: 'Transcripts', description: 'Search across all sessions', route: '/transcripts', icon: '☰', category: 'Monitor' },
    { label: 'Tools', description: 'Cross-session tool analytics', route: '/tools', icon: '⚡', category: 'Monitor' },
    { label: 'Costs', description: 'Cost tracking and daily breakdown', route: '/costs', icon: '●', category: 'Monitor' },
    { label: 'CLAUDE.md', description: 'View and edit project context files', route: '/claude-md', icon: '✍', category: 'Workspace' },
    { label: 'Plugins', description: 'Manage plugins and marketplace', route: '/config', icon: '★', category: 'Config' },
    { label: 'MCP Servers', description: 'Manage MCP server connections', route: '/mcp', icon: '⚙', category: 'Config' },
    { label: 'Notifications', description: 'Sound and alert settings', route: '/settings', icon: '♮', category: 'Config' },
    { label: 'Hygiene', description: 'Health checks and cleanup suggestions', route: '/hygiene', icon: '⚠', category: 'Health' },
  ];

  filteredItems = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.items;
    return this.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  });

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.toggle();
    }
  }

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.isOpen.set(true);
      this.query.set('');
      this.selectedIndex.set(0);
      setTimeout(() => {
        const input = document.querySelector('.palette-input') as HTMLInputElement;
        input?.focus();
      }, 50);
    }
  }

  close() {
    this.isOpen.set(false);
  }

  moveSelection(delta: number) {
    const items = this.filteredItems();
    let idx = this.selectedIndex() + delta;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    this.selectedIndex.set(idx);
  }

  selectCurrent() {
    const items = this.filteredItems();
    const idx = this.selectedIndex();
    if (items[idx]) {
      this.navigate(items[idx]);
    }
  }

  navigate(item: PaletteItem) {
    this.close();
    this.router.navigate([item.route]);
  }
}
