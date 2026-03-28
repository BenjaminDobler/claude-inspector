import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TauriBridgeService, SessionNote } from '@claude-inspector/data-access';

@Component({
  selector: 'app-session-notes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './session-notes.component.html',
  styleUrl: './session-notes.component.scss',
})
export class SessionNotesComponent implements OnChanges {
  private bridge = inject(TauriBridgeService);

  @Input() sessionId = '';
  @Input() projectPath = '';

  note = signal<SessionNote | null>(null);
  editNote = signal('');
  editTags = signal('');
  bookmarked = signal(false);
  saving = signal(false);
  success = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['sessionId'] || changes['projectPath']) && this.sessionId) {
      this.loadNote();
    }
  }

  async loadNote() {
    try {
      const notes = await this.bridge.listSessionNotes();
      const existing = notes.find(n => n.sessionId === this.sessionId);
      if (existing) {
        this.note.set(existing);
        this.editNote.set(existing.note);
        this.editTags.set(existing.tags.join(', '));
        this.bookmarked.set(existing.bookmarked);
      } else {
        this.note.set(null);
        this.editNote.set('');
        this.editTags.set('');
        this.bookmarked.set(false);
      }
    } catch { /* ignore */ }
  }

  toggleBookmark() {
    this.bookmarked.update(b => !b);
    this.save();
  }

  async save() {
    if (!this.sessionId) return;
    this.saving.set(true);
    try {
      const tags = this.editTags()
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await this.bridge.saveSessionNote({
        sessionId: this.sessionId,
        projectPath: this.projectPath,
        note: this.editNote(),
        tags,
        bookmarked: this.bookmarked(),
      });

      this.success.set('Saved');
      setTimeout(() => this.success.set(null), 2000);
    } catch { /* ignore */ } finally {
      this.saving.set(false);
    }
  }

  async deleteNote() {
    try {
      await this.bridge.deleteSessionNote(this.sessionId);
      this.note.set(null);
      this.editNote.set('');
      this.editTags.set('');
      this.bookmarked.set(false);
    } catch { /* ignore */ }
  }

  predefinedTags = ['good', 'failed', 'reference', 'bug-fix', 'feature', 'refactor', 'learning'];

  addTag(tag: string) {
    const current = this.editTags();
    const tags = current.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (!tags.includes(tag)) {
      tags.push(tag);
      this.editTags.set(tags.join(', '));
    }
  }
}
