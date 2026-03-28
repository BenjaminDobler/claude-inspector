# Claude Inspector — Improvement Plan

Based on reference app analysis and current state assessment.

## 1. Layout: Switch to Persistent Sidebar Navigation

**Current:** Top header nav with flat links (Sessions, Dashboard, Costs, MCP, Plugins, Notifications)
**Target:** Left sidebar with grouped sections, similar to reference app

```
Overview
  Dashboard (Readout-style home)
  Assistant

Monitor
  Live
  Sessions
  Transcripts
  Tools

Workspace
  Repos
  Work Graph
  Timeline
  Diffs
  Snapshots

Config
  Skills
  Agents
  Memory
  Hooks
  MCP Servers
  Plugins

Health
  Hygiene
  Deps
  Env

Settings
```

Key changes:
- Permanent left sidebar (~200px) with grouped nav items and section headers
- Sidebar stays visible across all pages (not just session browser)
- Active state with subtle background highlight
- Section headers in muted uppercase

## 2. Dashboard: Rich Readout Homepage

**Current:** Basic summary cards + bar chart + recent prompts
**Target:** Information-dense dashboard like the reference "Readout" page

Add these sections:
- **Greeting banner** with personalized message ("Saturday vibes, Benjamin") + quick stats in prose
- **Summary cards row**: Repos, Commits Today, Sessions, Est. Cost
- **Activity chart** (30d) + **"When You Work"** hourly heatmap side by side
- **Cost by Model** horizontal bar chart (Opus, Sonnet, Haiku with colors)
- **Recent Sessions** list with last prompt, project name, relative time
- **Health alerts** ("11 hygiene issues", "Desktop has 145 uncommitted files")
- **Recently Active** projects as pill badges with session count
- **Quick cards** row: Skills, Agents, Memory, Repos — each showing a preview of what's configured

## 3. Tools Page: Cross-Session Tool Analytics

**Current:** Tool stats are per-session only (in session detail tab)
**Target:** Dedicated global "Tools" page aggregating across ALL sessions

Add:
- **Summary cards**: Total Calls, Files Touched, Avg/Session, vs Last Week %
- **Usage Over Time** bar chart (7d/14d/30d toggle)
- **Tool Distribution** horizontal bar chart (Read, Edit, Bash, Grep, Write, etc.)
- **Common Sequences** — analyze tool call patterns (Bash→Bash, Read→Edit, Grep→Read, etc.)
- **Most Edited Files** — aggregate file edits across sessions with project context

## 4. Costs Page: Projections & Optimization

**Current:** Daily table with token counts + cost
**Target:** Richer cost analysis

Add:
- **Today / This Week / This Month / All Time** summary cards
- **Cost by Model** horizontal bars with colors
- **Monthly Projection** ("Projected: $X" vs "So Far: $Y")
- **Trends** with week-over-week and month-over-month % change (green/red arrows)
- **Daily Cost** bar chart (like current but better styled)
- **Optimization Ideas** — smart suggestions ("Mix in Sonnet for simple tasks — Opus accounts for 94% of spend, -$496")

## 5. Session List: Better Cards

**Current:** Simple cards with ID, size, date
**Target:** Richer session cards

Add:
- First user message as preview text
- Model badge
- Duration
- Token count summary
- Tool count
- Status indicator (completed vs in-progress)

## 6. New Pages from Reference

### Transcripts
- Searchable full conversation view across sessions
- Filter by project, date range, model

### Work Graph
- Visual dependency graph of sessions and their relationships

### Repo Pulse
- Per-project activity summary
- Recent commits, branches, uncommitted changes

### Diffs
- Show git diffs created during sessions

### Snapshots
- Visual file-history browser with before/after comparison

### Hygiene
- Check for stale worktrees, large sessions, missing CLAUDE.md files
- Actionable recommendations

### Hooks Editor
- Visual editor for hooks.json instead of raw JSON
- Event type selector, command builder

### Agents Page
- List all subagents across sessions
- Agent type distribution
- Average agent duration and token usage

## 7. Design Polish

### From reference app:
- Horizontal bar charts with colored segments (blue=Read, green=Edit/Bash, yellow=token types)
- Section headers with emoji icons + count badges + info tooltips
- "When You Work" hourly activity heatmap
- Cleaner card layouts with more whitespace
- Subtle section dividers
- Prose-style summaries at top of each page
- Pill badges for project tags with session counts
- Arrow indicators for trends (↑52%, ↓355%)
- Click-through navigation (cards link to detail pages)

### General improvements:
- Consistent icon system (use emoji or an icon set like Lucide)
- Better loading skeletons instead of spinners
- Transition animations between pages
- Breadcrumb navigation in detail views
- Keyboard navigation (Cmd+K palette)

## Implementation Priority

### Phase 1: Layout & Navigation
1. Sidebar navigation with grouped sections
2. Move current pages into sidebar structure

### Phase 2: Dashboard Overhaul
3. Rich readout homepage with all widgets
4. "When You Work" heatmap

### Phase 3: Global Analytics
5. Tools page (cross-session)
6. Cost projections & optimization ideas

### Phase 4: New Pages
7. Transcripts (cross-session search)
8. Agents page
9. Hooks editor
10. Hygiene checks

### Phase 5: Design Refinement
11. Horizontal bar charts throughout
12. Section headers with icons
13. Loading skeletons
14. Keyboard navigation
