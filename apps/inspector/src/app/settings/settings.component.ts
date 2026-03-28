import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, NotificationRule } from '@claude-inspector/data-access';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  notificationService = inject(NotificationService);
  rules = this.notificationService.rules;
  permission = this.notificationService.notificationPermission;

  soundOptions = [
    { value: 'notification', label: 'Chime (two-tone)' },
    { value: 'error', label: 'Alert (low buzz)' },
    { value: 'complete', label: 'Complete (soft)' },
  ];

  toggleEnabled(rule: NotificationRule): void {
    this.notificationService.updateRule(rule.id, { enabled: !rule.enabled });
  }

  toggleSound(rule: NotificationRule): void {
    this.notificationService.updateRule(rule.id, { sound: !rule.sound });
  }

  toggleSystemNotification(rule: NotificationRule): void {
    this.notificationService.updateRule(rule.id, { systemNotification: !rule.systemNotification });
  }

  toggleFocusTerminal(rule: NotificationRule): void {
    this.notificationService.updateRule(rule.id, { focusTerminal: !rule.focusTerminal });
  }

  setSoundFile(rule: NotificationRule, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.notificationService.updateRule(rule.id, { soundFile: value });
  }

  requestPermission(): void {
    this.notificationService.requestPermission();
  }

  testSound(soundFile: string): void {
    this.notificationService.testSound(soundFile);
  }
}
