import { Evidence, Segment } from './types';
export function timestamp(seconds: number): string {
  return new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 19);
}
export function parseWhisper(value: unknown): Segment[] {
  const segments = (value as { transcription?: unknown })?.transcription;
  if (!Array.isArray(segments)) throw new Error('Whisper lieferte kein gültiges Transkript.');
  return segments.map((segment: any) => {
    const start = segment?.offsets?.from / 1000, end = segment?.offsets?.to / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || typeof segment.text !== 'string') throw new Error('Ungültige Transkript-Zeitstempel.');
    return { start, end, text: segment.text.trim() };
  }).filter(segment => segment.text.length > 0);
}
export function candidates(segments: Segment[]): Evidence[] {
  const matches = /\b(müssen|muss|sollte[n]?|fehlt|fehler|falsch(?:e[snr]?)?|korrigieren|ändern|ergänzen|prüfen|testen|todo|bug|need to|should|fix)\b/i;
  return segments.filter(segment => matches.test(segment.text)).map(segment => ({ time: segment.start, text: segment.text }));
}
export function screenshotPoints(segments: Segment[], duration: number): Evidence[] {
  const explicit = /screenshot|bildschirm|hier|logo|dark.?mode|hell|dunkel|farbe|button|fehler/i;
  const selected: Evidence[] = [];
  for (const segment of segments.filter(s => explicit.test(s.text))) {
    const time = Math.max(0, Math.min(duration - 0.1, segment.start));
    if (!selected.some(s => Math.abs(s.time - time) < 8)) selected.push({ time, text: segment.text });
    if (selected.length === 24) break;
  }
  return selected;
}
function markdown(value: string): string { return value.replace(/[\\`*_{}\[\]<>#|!]/g, '\\$&'); }
export function transcriptMarkdown(title: string, segments: Segment[]): string {
  return `# ${markdown(title)}\n\nAutomatisches Transkript · Deutsch · keine verlässliche Sprecherzuordnung. Bitte anhand der Aufnahme prüfen.\n\n` + segments.map(s => `**${timestamp(s.start)}** ${markdown(s.text)}`).join('\n\n') + '\n';
}
export function reportMarkdown(title: string, tasks: Evidence[], shots: Evidence[]): string {
  return `# ${markdown(title)} – Besprechungsnotizen\n\n## Aufgaben zur Prüfung\n\nAutomatisch anhand von Formulierungen ausgewählte Originalaussagen. Keine bestätigten Beschlüsse; Verantwortliche und Fristen werden nicht erfunden.\n\n` +
    (tasks.map(t => `- [ ] **${timestamp(t.time)}** ${markdown(t.text)}`).join('\n') || 'Keine Aufgabenformulierungen erkannt.') +
    '\n\n## Visuelle Belege\n\n' + (shots.map(s => `### ${timestamp(s.time)}\n\n${markdown(s.text)}\n\n![Meeting zum Zeitpunkt ${timestamp(s.time)}](${s.image})`).join('\n\n') || 'Keine visuellen Hinweise erkannt.') + '\n';
}
