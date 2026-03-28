import { Injectable, signal } from '@angular/core';
import { RawSessionEntry, ContentBlock, ToolUseBlock } from '@claude-inspector/types';

export interface NotificationRule {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  sound: boolean;
  systemNotification: boolean;
  focusTerminal: boolean;
  soundFile: string;
}

const DEFAULT_RULES: NotificationRule[] = [
  {
    id: 'user_input_needed',
    label: 'User Input Needed',
    description: 'When the AI asks a question or needs user input (AskUserQuestion)',
    enabled: true,
    focusTerminal: true,
    sound: true,
    systemNotification: true,
    soundFile: 'notification',
  },
  {
    id: 'tool_error',
    label: 'Tool Error',
    description: 'When a tool call fails with an error',
    enabled: true,
    sound: true,
    systemNotification: false,
    focusTerminal: false,
    soundFile: 'error',
  },
  {
    id: 'agent_spawned',
    label: 'Agent Spawned',
    description: 'When a subagent is spawned',
    enabled: false,
    sound: false,
    systemNotification: false,
    focusTerminal: false,
    soundFile: 'notification',
  },
  {
    id: 'skill_used',
    label: 'Skill Used',
    description: 'When a skill is invoked (e.g. /commit, /review-pr)',
    enabled: false,
    sound: false,
    systemNotification: false,
    focusTerminal: false,
    soundFile: 'notification',
  },
  {
    id: 'plan_mode',
    label: 'Plan Mode Change',
    description: 'When entering or exiting plan mode',
    enabled: false,
    sound: false,
    systemNotification: false,
    focusTerminal: false,
    soundFile: 'notification',
  },
  {
    id: 'session_idle',
    label: 'Session Idle',
    description: 'When no new activity for 30+ seconds during live watch',
    enabled: false,
    sound: true,
    systemNotification: true,
    focusTerminal: false,
    soundFile: 'complete',
  },
];

const STORAGE_KEY = 'claude-inspector-notification-rules';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly rules = signal<NotificationRule[]>(this.loadRules());
  readonly notificationPermission = signal<NotificationPermission>('default');

  private audioCache = new Map<string, HTMLAudioElement>();
  private lastActivityTimestamp = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Check notification permission
    if ('Notification' in window) {
      this.notificationPermission.set(Notification.permission);
    }
  }

  requestPermission(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        this.notificationPermission.set(perm);
      });
    }
  }

  updateRule(ruleId: string, updates: Partial<NotificationRule>): void {
    const current = this.rules();
    const updated = current.map((r) =>
      r.id === ruleId ? { ...r, ...updates } : r
    );
    this.rules.set(updated);
    this.saveRules(updated);
  }

  /**
   * Check a new session entry against notification rules.
   * Called by WatcherService when new entries arrive during live monitoring.
   */
  checkEntry(entry: RawSessionEntry): { shouldFocusTerminal: boolean } {
    this.lastActivityTimestamp = Date.now();
    const rules = this.rules();
    let shouldFocusTerminal = false;

    // Check for AskUserQuestion
    const askRule = rules.find((r) => r.id === 'user_input_needed');
    if (askRule?.enabled && this.isAskUserQuestion(entry)) {
      this.fire(askRule, 'User Input Needed', 'The AI is waiting for your input');
      if (askRule.focusTerminal) shouldFocusTerminal = true;
    }

    // Check for tool errors
    const errorRule = rules.find((r) => r.id === 'tool_error');
    if (errorRule?.enabled && this.isToolError(entry)) {
      const toolName = this.getErrorToolName(entry);
      this.fire(errorRule, 'Tool Error', `${toolName} failed`);
    }

    // Check for agent spawn
    const agentRule = rules.find((r) => r.id === 'agent_spawned');
    if (agentRule?.enabled && this.isAgentSpawn(entry)) {
      this.fire(agentRule, 'Agent Spawned', 'A subagent was started');
    }

    // Check for skill use
    const skillRule = rules.find((r) => r.id === 'skill_used');
    if (skillRule?.enabled && this.isSkillUse(entry)) {
      const skillName = this.getSkillName(entry);
      this.fire(skillRule, 'Skill Used', `Skill: ${skillName}`);
    }

    // Check for plan mode
    const planRule = rules.find((r) => r.id === 'plan_mode');
    if (planRule?.enabled && this.isPlanModeChange(entry)) {
      this.fire(planRule, 'Plan Mode', 'Plan mode state changed');
    }

    return { shouldFocusTerminal };
  }

  startIdleWatch(): void {
    this.lastActivityTimestamp = Date.now();
    this.stopIdleWatch();

    this.idleTimer = setInterval(() => {
      const idleRule = this.rules().find((r) => r.id === 'session_idle');
      if (!idleRule?.enabled) return;

      const elapsed = Date.now() - this.lastActivityTimestamp;
      if (elapsed >= 30000) {
        this.fire(idleRule, 'Session Idle', 'No activity for 30+ seconds');
        this.lastActivityTimestamp = Date.now(); // reset to avoid spamming
      }
    }, 5000);
  }

  stopIdleWatch(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Play a test sound for the given sound file name */
  testSound(soundFile: string): void {
    this.playSound(soundFile);
  }

  private fire(rule: NotificationRule, title: string, body: string): void {
    if (rule.sound) {
      this.playSound(rule.soundFile);
    }

    if (rule.systemNotification && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }

  private playSound(name: string): void {
    // Use Web Audio API with generated tones (no external sound files needed)
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const sounds: Record<string, { freq: number; duration: number; type: OscillatorType }> = {
        notification: { freq: 880, duration: 0.15, type: 'sine' },
        error: { freq: 330, duration: 0.3, type: 'square' },
        complete: { freq: 660, duration: 0.2, type: 'triangle' },
      };

      const config = sounds[name] || sounds['notification'];
      osc.frequency.value = config.freq;
      osc.type = config.type;
      gain.gain.value = 0.3;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + config.duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + config.duration);

      // Play a second tone for notification (two-tone chime)
      if (name === 'notification') {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1100;
        osc2.type = 'sine';
        gain2.gain.value = 0.3;
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc2.start(ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // Audio not available
    }
  }

  private isAskUserQuestion(entry: RawSessionEntry): boolean {
    return this.hasToolUse(entry, 'AskUserQuestion');
  }

  private isToolError(entry: RawSessionEntry): boolean {
    if (!entry.message?.content || !Array.isArray(entry.message.content)) return false;
    return (entry.message.content as ContentBlock[]).some(
      (b) => b.type === 'tool_result' && (b as ContentBlock & { is_error?: boolean }).is_error
    );
  }

  private isAgentSpawn(entry: RawSessionEntry): boolean {
    return this.hasToolUse(entry, 'Agent');
  }

  private isSkillUse(entry: RawSessionEntry): boolean {
    return this.hasToolUse(entry, 'Skill');
  }

  private isPlanModeChange(entry: RawSessionEntry): boolean {
    return this.hasToolUse(entry, 'EnterPlanMode') || this.hasToolUse(entry, 'ExitPlanMode');
  }

  private hasToolUse(entry: RawSessionEntry, toolName: string): boolean {
    if (!entry.message?.content || !Array.isArray(entry.message.content)) return false;
    return (entry.message.content as ContentBlock[]).some(
      (b) => b.type === 'tool_use' && (b as ToolUseBlock).name === toolName
    );
  }

  private getErrorToolName(_entry: RawSessionEntry): string {
    return 'tool';
  }

  private getSkillName(entry: RawSessionEntry): string {
    if (!entry.message?.content || !Array.isArray(entry.message.content)) return 'unknown';
    for (const block of entry.message.content as ContentBlock[]) {
      if (block.type === 'tool_use' && (block as ToolUseBlock).name === 'Skill') {
        return String((block as ToolUseBlock).input['skill'] || 'unknown');
      }
    }
    return 'unknown';
  }

  private loadRules(): NotificationRule[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as NotificationRule[];
        // Merge with defaults to pick up new rules
        return DEFAULT_RULES.map((def) => {
          const existing = parsed.find((p) => p.id === def.id);
          return existing ? { ...def, ...existing } : def;
        });
      }
    } catch { /* ignore storage errors */ }
    return [...DEFAULT_RULES];
  }

  private saveRules(rules: NotificationRule[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch { /* ignore storage errors */ }
  }
}
