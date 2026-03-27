# Claude Inspector — Implementation Plan

## Context

Claude Code stores rich session data as JSONL files in `~/.claude/projects/`. Each entry contains messages, tool calls, token usage, subagent activity, and metadata. There's no tool to analyze this data visually. Claude Inspector will be a Tauri + Angular desktop app that provides live monitoring, replay, and deep analysis of Claude Code sessions.

## Tech Stack

- **Tauri v2** — Rust backend, native webview, small bundle
- **Angular 21** — standalone components, signals for state
- **Nx workspace** — monorepo with shared libs
- **D3.js** — timeline, token chart, conversation tree visualizations

## Workspace Structure

```
claude-inspector/
  apps/
    inspector/                    # Angular 21 frontend
  src-tauri/                      # Tauri v2 Rust backend (workspace root)
    src/
      lib.rs
      commands/
        sessions.rs               # list_projects, list_sessions, read_session
        watcher.rs                # watch_session, stop_watching, poll_session
  libs/
    types/                        # Shared TS interfaces (framework-agnostic)
    session-parser/               # Pure TS: JSONL parsing, tree building, stats
      src/lib/
        jsonl-parser.ts
        tree-builder.ts
        stats-calculator.ts
        subagent-resolver.ts
    data-access/                  # Angular services: Tauri bridge + signal store
      src/lib/
        tauri-bridge.service.ts
        session-store.service.ts
        watcher.service.ts
```

## Rust Commands (src-tauri)

| Command | Purpose |
|---------|---------|
| `list_projects()` | Read `~/.claude/projects/`, return decoded paths + session counts |
| `list_sessions(project)` | List `.jsonl` files with size, date, subagent info |
| `read_session(project, id)` | Read JSONL + subagent files, return as JSON |
| `get_active_sessions()` | Return sessions with still-running PIDs |
| `watch_session(project, id)` | fs_watch on JSONL file, emit `session-update` events |
| `stop_watching()` | Drop watcher handle |
| `poll_session(project, id, last_line)` | Polling fallback: return new lines since offset |

## Angular App Structure

**Routes:**
- `/` — Session browser (project list + session list)
- `/session/:projectPath/:sessionId` — Session detail with tabbed views
- `/session/:projectPath/:sessionId/replay` — Replay mode

**Key Components:**
- `SessionBrowserComponent` — project list, session cards, active session badges
- `SessionDetailComponent` — container with tabs for all analysis views
- `TimelineComponent` — D3 horizontal timeline (user/assistant/tool events)
- `TokenChartComponent` — D3 stacked area chart (input/output/cache tokens)
- `ToolStatsComponent` — bar charts + table (frequency, success rate, duration)
- `ConversationTreeComponent` — D3 tree layout (main thread + subagent branches)
- `ReplayComponent` — auto-play with speed/scrubber + step-through with arrow keys
- `MessageRendererComponent` — shared renderer for text, tool_use, tool_result blocks

**Services (libs/data-access):**
- `TauriBridgeService` — invoke() wrappers + Tauri event listener → Observable
- `SessionStoreService` — signal-based state, computed signals for parsed data/stats/tree
- `WatcherService` — live monitoring with fs_watch or polling fallback toggle

## Data Flow

```
~/.claude/ JSONL files
  → Tauri Rust commands (read, parse, watch)
  → TauriBridgeService (invoke / event listener)
  → SessionStoreService (raw entries signal)
  → session-parser lib (pure functions in computed signals)
  → Derived signals: parsedSession, tree, tokenTimeline, toolStats
  → D3 visualizations / Angular templates
```

Live monitoring: Tauri emits `session-update` events → new entries appended to store → all computed signals refire → UI updates reactively.

## Implementation Phases

### Phase 1: Foundation
- Scaffold Nx workspace, Angular app, Tauri shell, shared libs
- Implement types library (all interfaces)
- Rust commands: `list_projects`, `list_sessions`, `read_session`
- `TauriBridgeService`, `jsonl-parser.ts`
- `SessionBrowserComponent` — list projects/sessions, click to load

### Phase 2: Core Analysis
- `stats-calculator.ts`, `tree-builder.ts`
- `SessionStoreService` with computed signals
- `SessionDetailComponent` with overview panel
- `TimelineComponent` (D3 horizontal timeline)
- `TokenChartComponent` (D3 stacked area chart)
- `ToolStatsComponent` (bar charts + detail table)

### Phase 3: Conversation Tree + Subagents
- `subagent-resolver.ts`
- Extend Rust to read subagent data
- `ConversationTreeComponent` (D3 tree layout with sidechain branches)
- `MessageRendererComponent` (markdown text, JSON viewer for tool I/O)

### Phase 4: Live Monitoring
- Rust `watch_session`, `stop_watching`, `poll_session`, `get_active_sessions`
- `WatcherService` with polling fallback toggle
- Active sessions section with live badges
- Incremental signal updates

### Phase 5: Replay Mode
- `ReplayComponent` + `ReplayControlsComponent`
- Auto-play: play/pause, speed slider, scrubber bar
- Step-through: forward/back buttons, arrow key shortcuts
- Timeline + token chart highlight current replay position

### Phase 6: Polish
- Virtual scrolling for large sessions
- Web Worker for parsing large files
- Search/filter within sessions
- Dark/light theme, keyboard shortcuts
- Cost estimation display
- Export analysis as JSON/markdown

## Verification

1. `nx serve inspector` → Tauri dev window opens
2. App lists projects from `~/.claude/projects/`
3. Click project → shows sessions with metadata
4. Click session → timeline, token chart, tool stats, conversation tree render
5. Active sessions show green badge, "Watch" button streams updates
6. Replay: play/pause/step through messages at configurable speed
7. Unit tests: `nx test session-parser` covers JSONL parsing, tree building, stats
