import {
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RawSessionEntry, ContentBlock, ToolUseBlock } from '@claude-inspector/types';
import {
  getEntryType,
  extractTextContent,
  computeSessionStats,
  computeToolStats,
  computeTokenTimeline,
  type EntryType,
} from '@claude-inspector/session-parser';

interface ReplayMessage {
  entry: RawSessionEntry;
  type: EntryType;
  text: string;
  toolName?: string;
}

interface ReplaySnapshot {
  messages: ReplayMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalToolCalls: number;
  totalToolErrors: number;
  toolsUsed: Map<string, number>;
  elapsedMs: number;
}

@Component({
  selector: 'app-replay',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './replay.component.html',
  styleUrl: './replay.component.scss',
})
export class ReplayComponent implements OnChanges, OnDestroy, AfterViewChecked {
  @ViewChild('conversationScroll') conversationScrollRef!: ElementRef<HTMLDivElement>;
  @Input() entries: RawSessionEntry[] = [];

  currentIndex = signal(0);
  isPlaying = signal(false);
  playbackSpeed = signal(1);
  showContext = signal(true);

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private shouldScrollToBottom = false;

  filteredEntries: RawSessionEntry[] = [];

  currentEntry = computed(() => {
    const idx = this.currentIndex();
    return this.filteredEntries[idx] ?? null;
  });

  currentType = computed(() => {
    const entry = this.currentEntry();
    return entry ? getEntryType(entry) : '';
  });

  currentText = computed(() => {
    const entry = this.currentEntry();
    return entry ? extractTextContent(entry) : '';
  });

  currentToolName = computed(() => {
    const entry = this.currentEntry();
    if (!entry?.message?.content || !Array.isArray(entry.message.content)) return '';
    const toolBlock = (entry.message.content as ContentBlock[]).find(
      (b) => b.type === 'tool_use'
    ) as ToolUseBlock | undefined;
    return toolBlock?.name || '';
  });

  progress = computed(() => {
    if (this.filteredEntries.length === 0) return 0;
    return (this.currentIndex() / (this.filteredEntries.length - 1)) * 100;
  });

  // Accumulated state at current position
  snapshot = computed<ReplaySnapshot>(() => {
    const idx = this.currentIndex();
    const entriesUpToNow = this.filteredEntries.slice(0, idx + 1);
    const startTime = this.filteredEntries.length > 0 ? this.filteredEntries[0].timestamp : 0;
    const currentTime = entriesUpToNow.length > 0 ? entriesUpToNow[entriesUpToNow.length - 1].timestamp : 0;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheTokens = 0;
    let totalToolCalls = 0;
    let totalToolErrors = 0;
    const toolsUsed = new Map<string, number>();
    const messages: ReplayMessage[] = [];

    for (const entry of entriesUpToNow) {
      const type = getEntryType(entry);
      const text = extractTextContent(entry);
      let toolName: string | undefined;

      if (entry.message?.content && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content as ContentBlock[]) {
          if (block.type === 'tool_use') {
            const tb = block as ToolUseBlock;
            toolName = tb.name;
            totalToolCalls++;
            toolsUsed.set(tb.name, (toolsUsed.get(tb.name) || 0) + 1);
          }
          if (block.type === 'tool_result' && (block as any).is_error) {
            totalToolErrors++;
          }
        }
      }

      const usage = entry.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
        totalCacheTokens += (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      }

      messages.push({ entry, type, text, toolName });
    }

    return {
      messages,
      totalInputTokens,
      totalOutputTokens,
      totalCacheTokens,
      totalToolCalls,
      totalToolErrors,
      toolsUsed,
      elapsedMs: currentTime - startTime,
    };
  });

  sortedToolsUsed = computed(() => {
    const snap = this.snapshot();
    return Array.from(snap.toolsUsed.entries())
      .sort((a, b) => b[1] - a[1]);
  });

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom && this.conversationScrollRef) {
      const el = this.conversationScrollRef.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollToBottom = false;
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.togglePlayPause();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.stepForward();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.stepBack();
        break;
      case 'Home':
        event.preventDefault();
        this.currentIndex.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.currentIndex.set(Math.max(0, this.filteredEntries.length - 1));
        break;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entries']) {
      this.filteredEntries = this.entries.filter(
        (e) => e.type !== 'file-history-snapshot' && e.type !== 'progress'
      );
      this.currentIndex.set(0);
      this.stop();
    }
  }

  ngOnDestroy() {
    this.stop();
  }

  play() {
    if (this.isPlaying()) return;
    this.isPlaying.set(true);
    this.startInterval();
  }

  pause() {
    this.isPlaying.set(false);
    this.clearInterval();
  }

  stop() {
    this.isPlaying.set(false);
    this.clearInterval();
    this.currentIndex.set(0);
  }

  togglePlayPause() {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  }

  stepForward() {
    if (this.currentIndex() < this.filteredEntries.length - 1) {
      this.currentIndex.update((i) => i + 1);
      this.shouldScrollToBottom = true;
    }
  }

  stepBack() {
    if (this.currentIndex() > 0) {
      this.currentIndex.update((i) => i - 1);
    }
  }

  onScrub(event: Event) {
    const value = +(event.target as HTMLInputElement).value;
    this.currentIndex.set(value);
    this.shouldScrollToBottom = true;
  }

  setSpeed(speed: number) {
    this.playbackSpeed.set(speed);
    if (this.isPlaying()) {
      this.clearInterval();
      this.startInterval();
    }
  }

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  formatTokens(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(2)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
  }

  truncate(text: string, len: number): string {
    return text.length > len ? text.slice(0, len) + '...' : text;
  }

  private startInterval() {
    const intervalMs = 1000 / this.playbackSpeed();
    this.intervalId = setInterval(() => {
      if (this.currentIndex() >= this.filteredEntries.length - 1) {
        this.pause();
        return;
      }
      this.currentIndex.update((i) => i + 1);
      this.shouldScrollToBottom = true;
    }, intervalMs);
  }

  private clearInterval() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
