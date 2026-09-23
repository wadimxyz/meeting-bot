import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Meeting, activeStatuses } from './types';
export class Store {
  constructor(readonly root: string) { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); }
  dir(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Ungültige Meeting-ID.');
    return path.join(this.root, id);
  }
  get(id: string): Meeting { return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'meeting.json'), 'utf8')); }
  list(): Meeting[] {
    return fs.readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).flatMap(id => {
      try { return [this.get(id)]; } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  save(value: Meeting): Meeting {
    const dir = this.dir(value.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = path.join(dir, 'meeting.json.tmp');
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, path.join(dir, 'meeting.json'));
    return value;
  }
  patch(id: string, patch: Partial<Meeting>): Meeting { return this.save({ ...this.get(id), ...patch, id }); }
  create(values: Pick<Meeting, 'title' | 'source' | 'status'> & { url?: string }): Meeting {
    const now = new Date().toISOString();
    return this.save({ ...values, id: randomUUID(), createdAt: now, consentAt: now, artifacts: [] });
  }
  recover(): void {
    for (const meeting of this.list()) if (activeStatuses.includes(meeting.status)) {
      this.patch(meeting.id, { status: 'failed', error: 'Vorheriger Lauf wurde unterbrochen. Vorhandene Aufnahme bleibt erhalten; Auswertung kann erneut gestartet werden.' });
    }
  }
}
