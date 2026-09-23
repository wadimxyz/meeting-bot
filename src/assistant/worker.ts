// Keep upstream integrations disabled before their modules are loaded.
process.env.MEETING_ASSISTANT_MODE = 'true';
process.env.GOOGLE_ANONYMOUS_JOIN_REQUEST_ATTEMPTS = '1';
process.env.JOIN_WAIT_TIME_MINUTES = '5';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleMeetBot } from '../bots/GoogleMeetBot';
import winston from 'winston';
import { IUploader } from '../middleware/disk-uploader';
import { Store } from './store';
import { settings } from './settings';
import { recordTab, stopTab } from './recorder';
import { command } from './process';
const store = new Store(settings.dataDir);
const id = process.argv[2];
let bytes = 0, began = 0;
const notify = (patch: Parameters<Store['patch']>[1]): Promise<void> => new Promise(resolve => {
  if (!process.connected || !process.send) { resolve(); return; }
  process.send(patch, () => resolve());
});
class LocalSink implements IUploader {
  async uploadRecordingToRemoteStorage(): Promise<boolean> { return bytes > 0; }
  async saveDataToTempFile(data: Buffer): Promise<boolean> {
    await fs.appendFile(path.join(store.dir(id), 'capture.webm'), data, { mode: 0o600 });
    bytes += data.length; notify({ bytes }); return true;
  }
  setRecordingDuration(): void { /* Duration is verified from the remuxed recording. */ }
}
class AssistantBot extends GoogleMeetBot {
  recording = false;
  private cancelRequested = false;
  protected async onPageCreated(): Promise<void> { if (this.cancelRequested) await this.stop(); }
  async stop(): Promise<void> {
    if (this.page && this.recording) { await stopTab(this.page); }
    else {
      this.cancelRequested = true;
      if (!this.page) return;
      await this.page.context().browser()?.close();
      await notify({ status: 'cancelled', stage: undefined });
      process.exit(0);
    }
  }
  protected async recordMeetingPage({ uploader }: { teamId: string; userId: string; eventId?: string; botId?: string; uploader: IUploader }): Promise<void> {
    began = Date.now();
    await recordTab(this.page, settings.maxMinutes * 60_000, {
      chunk: async data => { await uploader.saveDataToTempFile(data); },
      started: () => { this.recording = true; clearTimeout(admissionDeadline); notify({ status: 'recording', stage: 'Aufnahme läuft · Mikrofon und Kamera gesperrt' }); },
      meter: level => notify({ audioLevel: level, ...(level > 0.002 ? { lastAudioAt: new Date().toISOString() } : {}) }),
    });
    this.recording = false;
  }
}
const logger = winston.createLogger({ silent: true, transports: [new winston.transports.Console()] });
const bot = new AssistantBot(logger, id);
const admissionDeadline = setTimeout(() => { void bot.stop().finally(() => process.exit(1)); }, 7 * 60_000);
process.on('message', message => { if (message === 'stop') void bot.stop().catch(async error => { await notify({ status: 'failed', error: String(error) }); process.exit(1); }); });
process.on('SIGTERM', () => { void bot.stop(); });
process.on('disconnect', () => { void bot.stop().finally(() => process.exit(1)); });
async function run(): Promise<void> {
  const meeting = store.get(id);
  await bot.join({ url: meeting.url!, name: 'Meeting Notes · Aufnahme', bearerToken: '', teamId: 'local', timezone: 'Europe/Berlin', userId: 'local', botId: id, uploader: new LocalSink() });
  if (!bytes) throw new Error('Keine Aufnahme empfangen.');
  // MediaRecorder WebM has no duration index; remux without re-encoding for seeking.
  await command(settings.ffmpeg, ['-nostdin', '-y', '-v', 'error', '-i', path.join(store.dir(id), 'capture.webm'), '-c', 'copy', path.join(store.dir(id), 'recording.webm')], 600_000);
  await notify({ media: 'recording.webm', artifacts: ['recording.webm', 'capture.webm'], duration: (Date.now() - began) / 1000 });
}
void run().then(() => process.exit(0)).catch(async error => {
  await notify({ status: 'failed', error: error instanceof Error ? error.message : String(error) }); process.exit(1);
}).finally(() => clearTimeout(admissionDeadline));
