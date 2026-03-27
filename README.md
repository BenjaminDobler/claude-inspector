# Claude Inspector

A desktop app for analyzing, replaying, and managing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions.

Built with **Tauri v2** (Rust backend) + **Angular 21** (frontend) in an **Nx** monorepo.

## Features

### Session Analysis

- **Session Browser** — Browse all projects and sessions from `~/.claude/`, with active session detection and live badges
- **Overview** — Stats grid showing duration, message counts, token usage (input/output/cache), estimated cost, model, version, git branch, subagent count
- **Timeline** — D3 horizontal timeline with color-coded events (user, assistant, tool, thinking, progress)
- **Token Chart** — D3 multi-line chart showing cumulative input/output/cache tokens with hover tooltips
- **Tool Stats** — Bar chart with success/error breakdown and detail table (frequency, error rate, avg duration)
- **Conversation Tree** — D3 tree layout showing the main conversation thread with subagent sidechain branches
- **Search** — Full-text search across all session entries with type filters
- **Insights** — Decision flow timeline showing skills, agents, thinking blocks, plan mode transitions, errors, and user questions
- **Tasks** — Task lists with status badges (pending/in_progress/completed) and dependency tracking
- **File History** — Versioned file snapshots showing what was changed during a session
- **Memory** — Auto-saved memories (user preferences, feedback, project context, references) with parsed frontmatter
- **Plans** — Associated plan files linked via session slug

### Replay

- **Auto-play** with configurable speed (0.5x–10x), play/pause, scrubber bar
- **Step-through** with forward/back buttons and keyboard shortcuts (Space, Arrow keys, Home/End)
- **Context panel** — Running stats (elapsed time, tokens, tools used), conversation history, and current message detail side-by-side

### Live Monitoring

- Polls active Claude Code sessions for real-time updates (2s interval)
- All visualizations update reactively via Angular signals
- Configurable **notification rules** with sounds and system notifications:
  - User input needed (AskUserQuestion)
  - Tool errors
  - Agent spawns
  - Skill invocations
  - Plan mode changes
  - Session idle (30s+ no activity)

### Configuration Management

- **Plugin Manager** — Browse marketplace, search/filter plugins, install/update/uninstall via Claude CLI
- **Marketplace Sources** — Add/remove third-party marketplaces (GitHub repos, URLs)
- **MCP Server Manager** — List servers from user/project/plugin sources, add new servers (stdio or HTTP), remove servers
- **Permissions Editor** — Add/remove permission patterns per project
- **Raw Editor** — Direct JSON editing of `settings.json` and `settings.local.json` (global and per-project)

### Cost & Usage

- **Cost Dashboard** — Daily token cost breakdown per model with 7-day/30-day/all-time summaries
- **Usage Dashboard** — Total messages, sessions, tool calls across all time, 14-day activity bar chart, recent prompt history

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.77+
- [Tauri CLI](https://tauri.app/) v2

### Install

```bash
git clone https://github.com/BenjaminDobler/claude-inspector.git
cd claude-inspector
npm install
```

### Development

Run the Tauri dev window (starts both the Angular dev server and the Rust backend):

```bash
npm run tauri:dev
```

Or run only the Angular frontend in a browser (no Rust commands will work):

```bash
npx nx serve inspector
```

### Build

```bash
npm run tauri:build
```

This produces a native `.dmg` (macOS), `.msi` (Windows), or `.deb`/`.AppImage` (Linux).

## Architecture

```
claude-inspector/
├── apps/inspector/          # Angular 21 frontend
├── src-tauri/               # Tauri v2 Rust backend
│   └── src/commands/
│       ├── sessions.rs      # List/read sessions, plans
│       ├── watcher.rs       # Active sessions, polling
│       ├── config.rs        # Settings, plugins, marketplaces
│       ├── data.rs          # Costs, tasks, stats, file history, memory
│       └── mcp.rs           # MCP server management
├── libs/
│   ├── types/               # Shared TypeScript interfaces
│   ├── session-parser/      # JSONL parsing, tree building, stats
│   └── data-access/         # Angular services (Tauri bridge, store, watcher, notifications)
└── plans/                   # Implementation plans
```

### Data Flow

```
~/.claude/ session files
  → Tauri Rust commands (read, parse, watch)
  → TauriBridgeService (invoke / event listener)
  → SessionStoreService (Angular signals)
  → session-parser lib (computed signals)
  → D3 visualizations / Angular templates
```

### Key Technologies

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust, native webview) |
| Frontend | Angular 21 (standalone components, signals) |
| Monorepo | Nx |
| Visualizations | D3.js |
| Styling | SCSS with CSS custom properties |
| Typography | DM Sans + JetBrains Mono |

## Session Data

Claude Inspector reads session data from `~/.claude/`:

| Data | Source |
|------|--------|
| Session conversations | `projects/{path}/{sessionId}.jsonl` |
| Subagent sessions | `projects/{path}/{sessionId}/subagents/` |
| Plans | `plans/{slug}.md` |
| Tasks | `tasks/{sessionId}/*.json` |
| File history | `file-history/{sessionId}/` |
| Memory | `projects/{path}/memory/` |
| Cost data | `readout-cost-cache.json` + `readout-pricing.json` |
| Usage stats | `stats-cache.json` |
| Global history | `history.jsonl` |
| Active sessions | `sessions/{pid}.json` |
| Settings | `settings.json`, `settings.local.json` |
| Plugins | `plugins/` |

## License

MIT
