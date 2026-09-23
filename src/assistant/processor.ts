import fs from 'node:fs/promises';
import path from 'node:path';
import { settings } from './settings';
import { command } from './process';
import { Store } from './store';
import { candidates, parseWhisper, reportMarkdown, screenshotPoints, transcriptMarkdown } from './report';
export async function inspectMedia(file: string): Promise<{ duration: number; video: boolean }> {
  const probe = JSON.parse(await command(settings.ffprobe, ['-protocol_whitelist', 'file,pipe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  if (!probe.streams?.some((s: any) => s.codec_type === 'audio')) throw new Error('Keine Tonspur vorhanden. Ein Transkript kann aus diesem Video nicht erstellt werden.');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > settings.maxMinutes * 60 + 10) throw new Error('Unbekannte oder zu lange Aufnahmedauer.');
  return { duration, video: probe.streams.some((s: any) => s.codec_type === 'video') };
}
export async function processMeeting(store: Store, id: string): Promise<void> {
  const meeting = store.get(id), dir = store.dir(id);
  if (!meeting.media) throw new Error('Aufnahmedatei fehlt.');
  store.patch(id, { status: 'processing', stage: 'Tonspur prüfen', error: undefined, transcript: undefined, candidates: undefined, screenshots: undefined, artifacts: [meeting.media] });
  const file = path.join(dir, meeting.media);
  const info = await inspectMedia(file);
  store.patch(id, { duration: info.duration });
  if (!settings.model) throw new Error('WHISPER_MODEL fehlt. Aufnahme ist gespeichert; nach Modell-Konfiguration erneut auswerten.');
  await fs.access(settings.model);
  const wav = path.join(dir, 'audio.wav');
  await command(settings.ffmpeg, ['-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 600_000);
  const volume = await command(settings.ffmpeg, ['-nostdin', '-v', 'info', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], 600_000, true);
  const maximum = Number(volume.match(/max_volume: ([\w.\-]+) dB/)?.[1]);
  if (!Number.isFinite(maximum) || maximum < -65) throw new Error('Tonspur enthält kein messbares Audiosignal. Bitte Audioaufnahme prüfen.');
  store.patch(id, { stage: 'Deutsch transkribieren (lokales Whisper)' });
  await command(settings.whisper, ['-m', settings.model, '-f', wav, '-l', 'de', '-ng', '-oj', '-osrt', '-of', path.join(dir, 'transcript')], 12 * 60 * 60_000);
  const transcript = parseWhisper(JSON.parse(await fs.readFile(path.join(dir, 'transcript.json'), 'utf8')));
  if (!transcript.length) throw new Error('Keine Sprache erkannt. Aufnahme bleibt erhalten.');
  const tasks = candidates(transcript);
  store.patch(id, { stage: 'Screenshots und Aufgaben aufbereiten' });
  const shots = info.video ? screenshotPoints(transcript, info.duration) : [];
  for (let i = 0; i < shots.length; i++) {
    const filename = `screenshot-${String(i + 1).padStart(2, '0')}.jpg`;
    await command(settings.ffmpeg, ['-nostdin', '-y', '-v', 'error', '-ss', String(shots[i].time), '-protocol_whitelist', 'file,pipe', '-i', file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', path.join(dir, filename)]);
    await fs.access(path.join(dir, filename));
    shots[i].image = filename;
  }
  await fs.writeFile(path.join(dir, 'transcript.md'), transcriptMarkdown(meeting.title, transcript));
  await fs.writeFile(path.join(dir, 'notes.md'), reportMarkdown(meeting.title, tasks, shots));
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify(tasks, null, 2));
  store.patch(id, { status: 'ready', stage: undefined, transcript, candidates: tasks, screenshots: shots,
    artifacts: [meeting.media, 'audio.wav', 'transcript.md', 'transcript.srt', 'transcript.json', 'notes.md', 'tasks.json', ...shots.map(s => s.image!)] });
}
