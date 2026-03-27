import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RawSessionEntry, ContentBlock, ToolUseBlock } from '@claude-inspector/types';
import { getEntryType, extractTextContent } from '@claude-inspector/session-parser';

export interface SearchResult {
  entry: RawSessionEntry;
  type: string;
  text: string;
  toolName?: string;
  matchIndex: number;
}

@Component({
  selector: 'app-session-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="search-container">
      <div class="search-bar">
        <input
          type="text"
          class="search-input"
          placeholder="Search messages, tools..."
          [ngModel]="query()"
          (ngModelChange)="onQueryChange($event)"
        />
        <div class="filter-chips">
          @for (filter of filters; track filter.key) {
            <button
              class="filter-chip"
              [class.active]="activeFilters().has(filter.key)"
              (click)="toggleFilter(filter.key)"
            >
              {{ filter.label }}
            </button>
          }
        </div>
      </div>

      @if (results().length > 0) {
        <div class="results-list">
          <div class="results-count">{{ results().length }} results</div>
          @for (result of results(); track result.matchIndex) {
            <button class="result-item" (click)="resultClick.emit(result)">
              <span class="result-type" [attr.data-type]="result.type">{{ result.type }}</span>
              @if (result.toolName) {
                <span class="result-tool">{{ result.toolName }}</span>
              }
              <span class="result-text">{{ result.text | slice:0:120 }}</span>
            </button>
          }
        </div>
      } @else if (query().length > 0) {
        <div class="no-results">No matches found</div>
      }
    </div>
  `,
  styleUrl: './session-search.component.scss',
})
export class SessionSearchComponent {
  @Input() entries: RawSessionEntry[] = [];
  @Output() resultClick = new EventEmitter<SearchResult>();

  query = signal('');
  activeFilters = signal(new Set<string>());
  results = signal<SearchResult[]>([]);

  filters = [
    { key: 'user_message', label: 'User' },
    { key: 'thinking', label: 'Thinking' },
    { key: 'assistant_message', label: 'Assistant' },
    { key: 'tool_use', label: 'Tools' },
    { key: 'tool_result', label: 'Results' },
  ];

  onQueryChange(value: string) {
    this.query.set(value);
    this.search();
  }

  toggleFilter(key: string) {
    const current = new Set(this.activeFilters());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.activeFilters.set(current);
    this.search();
  }

  private search() {
    const q = this.query().toLowerCase();
    const filters = this.activeFilters();
    const results: SearchResult[] = [];

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const type = getEntryType(entry);

      // Apply type filter
      if (filters.size > 0 && !filters.has(type)) continue;

      const text = extractTextContent(entry);
      let toolName: string | undefined;

      if (entry.message?.content && Array.isArray(entry.message.content)) {
        const toolBlock = (entry.message.content as ContentBlock[]).find(
          (b) => b.type === 'tool_use'
        ) as ToolUseBlock | undefined;
        toolName = toolBlock?.name;
      }

      // Apply text search
      if (q.length > 0) {
        const matchesText = text.toLowerCase().includes(q);
        const matchesTool = toolName?.toLowerCase().includes(q);
        if (!matchesText && !matchesTool) continue;
      }

      results.push({
        entry,
        type,
        text: text || toolName || type,
        toolName,
        matchIndex: i,
      });
    }

    this.results.set(results.slice(0, 200)); // limit to 200 results
  }
}
