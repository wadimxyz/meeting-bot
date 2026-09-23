import path from 'node:path';
function integer(name: string, initial: number, max: number): number {
  const value = Number(process.env[name] ?? initial);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name}: ungültiger Wert`);
  return value;
}
export const settings = {
  port: integer('ASSISTANT_PORT', 4317, 65535),
  dataDir: path.resolve(process.env.ASSISTANT_DATA_DIR ?? 'meeting-data'),
  model: process.env.WHISPER_MODEL ? path.resolve(process.env.WHISPER_MODEL) : undefined,
  whisper: process.env.WHISPER_BIN ?? 'whisper-cli',
  ffmpeg: process.env.FFMPEG_BIN ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN ?? 'ffprobe',
  maxMinutes: integer('ASSISTANT_MAX_MINUTES', 180, 360),
  maxUploadBytes: integer('ASSISTANT_MAX_UPLOAD_MB', 2048, 10240) * 1024 * 1024,
};
export function meetUrl(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Google-Meet-Link fehlt.');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com' || url.port || url.username || url.password || !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname)) {
    throw new Error('Erwartet wird https://meet.google.com/abc-defg-hij.');
  }
  return `https://meet.google.com${url.pathname}`;
}
export function title(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 120) throw new Error('Titel muss 1–120 Zeichen haben.');
  return input.trim();
}
