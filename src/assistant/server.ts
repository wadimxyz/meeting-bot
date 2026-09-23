import express, { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fork, ChildProcess } from 'node:child_process';
import { settings, meetUrl, title } from './settings';
import { Store } from './store';
import { activeStatuses, Meeting } from './types';
import { processMeeting } from './processor';
import { command } from './process';
const store = new Store(settings.dataDir);
const lock = path.join(settings.dataDir, 'server.lock');
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
  if (alive) throw new Error('In diesem Datenordner läuft bereits ein Server.');
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
process.on('exit', () => { if (fs.existsSync(lock)) fs.unlinkSync(lock); });
store.recover();
const app = express();
app.disable('x-powered-by');
const origins = [`http://127.0.0.1:${settings.port}`, `http://localhost:${settings.port}`];
app.use((req, res, next) => {
  if (!origins.includes(`http://${req.headers.host}`) || (req.headers.origin && !origins.includes(req.headers.origin))) { res.status(403).json({ error: 'Nur lokaler Zugriff über die eigene Oberfläche ist erlaubt.' }); return; }
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-assistant-request'] !== '1') { res.status(403).json({ error: 'Anfrageheader fehlt.' }); return; }
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; media-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '16kb' }));
let busy: string | undefined, worker: ChildProcess | undefined, stopping = false;
let shutdownRequested = false;
function requireIdle(): void { if (busy || shutdownRequested) throw new Error('Es läuft bereits eine Aufnahme oder Auswertung.'); }
function consent(value: unknown): void { if (value !== true) throw new Error('Bestätige, dass die Beteiligten der Aufnahme zugestimmt haben.'); }
const route = (handler: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => Promise.resolve().then(() => handler(req, res)).catch(next);
async function analyze(id: string): Promise<void> {
  busy = id;
  try { await processMeeting(store, id); }
  catch (error) { store.patch(id, { status: 'failed', stage: undefined, error: error instanceof Error ? error.message : String(error) }); }
  finally { busy = undefined; }
}
let healthCache: object | undefined;
app.get('/api/health', route(async (_req, res) => {
  if (!healthCache) {
    const dependencies = await Promise.all([settings.ffmpeg, settings.ffprobe, settings.whisper].map(async (binary, i) => {
      try { await command(binary, [i === 2 ? '--help' : '-version'], 10_000); return { name: binary, ready: true }; }
      catch { return { name: binary, ready: false }; }
    }));
    healthCache = { dependencies, model: Boolean(settings.model && fs.existsSync(settings.model)), localOnly: true };
  }
  res.json({ ...healthCache, busy, maxMinutes: settings.maxMinutes });
}));
app.get('/api/meetings', (_req, res) => res.json(store.list()));
app.get('/api/meetings/:id', route((req, res) => { res.json(store.get(req.params.id)); }));
app.post('/api/meetings', route((req, res) => {
  requireIdle(); consent(req.body.consent);
  const url = meetUrl(req.body.url), meetingTitle = title(req.body.title);
  if (!settings.model || !fs.existsSync(settings.model)) throw new Error('Zuerst WHISPER_MODEL konfigurieren; siehe README.');
  const meeting = store.create({ title: meetingTitle, source: 'meet', status: 'joining', url });
  busy = meeting.id; stopping = false;
  const child = fork(path.join(__dirname, 'worker.js'), [meeting.id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  worker = child;
  let stopDeadline: NodeJS.Timeout | undefined;
  child.stderr?.on('data', () => { /* Operational details arrive as structured IPC; avoid noisy upstream logs. */ });
  child.on('message', (patch: Partial<Meeting>) => { store.patch(meeting.id, patch); });
  child.on('error', error => { store.patch(meeting.id, { status: 'failed', error: error.message }); });
  child.on('close', code => {
    clearTimeout(stopDeadline); worker = undefined; stopping = false;
    const current = store.get(meeting.id);
    if (code === 0 && current.media && current.status !== 'failed') void analyze(meeting.id);
    else {
      busy = undefined;
      if (activeStatuses.includes(current.status)) store.patch(meeting.id, { status: 'failed', stage: undefined, error: 'Meeting-Bot wurde unterbrochen. Aufnahmefragmente bleiben im Datenordner erhalten.' });
    }
  });
  child.on('assistant-stop', () => {
    stopDeadline = setTimeout(() => { store.patch(meeting.id, { status: 'failed', error: 'Beenden dauerte zu lange. Aufnahmefragmente bleiben erhalten.' }); child.kill('SIGKILL'); }, 30_000);
  });
  res.status(201).json(meeting);
}));
app.post('/api/meetings/:id/stop', route((req, res) => {
  if (busy !== req.params.id || !worker) throw new Error('Keine aktive Aufnahme für dieses Meeting.');
  if (!stopping) { stopping = true; worker.send('stop'); worker.emit('assistant-stop'); }
  res.json({ stopping: true });
}));
app.post('/api/import', route(async (req, res) => {
  requireIdle(); consent(req.headers['x-recording-consent'] === 'true');
  const extension = String(req.query.extension ?? '');
  if (!['webm', 'mp4', 'mov', 'mkv', 'wav', 'mp3', 'm4a', 'flac'].includes(extension)) throw new Error('Dateiformat wird nicht unterstützt.');
  const meeting = store.create({ title: title(req.query.title), source: 'import', status: 'importing' });
  busy = meeting.id;
  const media = `recording.${extension}`, destination = path.join(store.dir(meeting.id), media);
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > settings.maxUploadBytes) callback(new Error('Datei überschreitet das Upload-Limit.'));
    else callback(null, chunk);
  } });
  try {
    await pipeline(req, limit, fs.createWriteStream(`${destination}.part`, { flags: 'wx', mode: 0o600 }));
    if (!bytes) throw new Error('Datei ist leer.');
    fs.renameSync(`${destination}.part`, destination);
    store.patch(meeting.id, { media, bytes, artifacts: [media] });
    void analyze(meeting.id);
    res.status(201).json(store.get(meeting.id));
  } catch (error) {
    busy = undefined;
    fs.rmSync(`${destination}.part`, { force: true });
    store.patch(meeting.id, { status: 'failed', error: String(error) });
    throw error;
  }
}));
app.post('/api/meetings/:id/process', route((req, res) => {
  requireIdle();
  const meeting = store.get(req.params.id);
  if (!meeting.media) throw new Error('Keine vollständige Aufnahme vorhanden.');
  void analyze(meeting.id); res.status(202).json({ processing: true });
}));
app.get('/api/meetings/:id/files/:file', route((req, res) => {
  const meeting = store.get(req.params.id);
  if (!meeting.artifacts.includes(req.params.file) || path.basename(req.params.file) !== req.params.file) { res.sendStatus(404); return; }
  if (req.query.download === '1') res.attachment(req.params.file);
  res.sendFile(path.join(store.dir(meeting.id), req.params.file));
}));
app.delete('/api/meetings/:id', route((req, res) => {
  if (busy === req.params.id) throw new Error('Laufendes Meeting kann nicht gelöscht werden.');
  store.get(req.params.id);
  fs.rmSync(store.dir(req.params.id), { recursive: true }); res.json({ deleted: true });
}));
app.use(express.static(path.resolve('web/assistant'), { index: 'index.html', dotfiles: 'deny' }));
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (!res.headersSent && !res.destroyed) res.status(400).json({ error: error.message });
});
const server = app.listen(settings.port, '127.0.0.1', () => console.log(`Meeting Notes: http://127.0.0.1:${settings.port}`));
async function shutdown(): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  server.close();
  if (worker?.connected) { worker.send('stop'); worker.emit('assistant-stop'); }
  const wait = setInterval(() => { if (!busy) { clearInterval(wait); process.exit(0); } }, 500);
  setTimeout(() => { worker?.kill('SIGKILL'); process.exit(1); }, 35_000).unref();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
