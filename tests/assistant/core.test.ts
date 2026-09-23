import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { meetUrl, title } from '../../src/assistant/settings';
import { Store } from '../../src/assistant/store';
import { candidates, parseWhisper, reportMarkdown, screenshotPoints } from '../../src/assistant/report';
import { inspectMedia } from '../../src/assistant/processor';
import { command } from '../../src/assistant/process';

test('Only canonical Google Meet links are accepted', () => {
  assert.equal(meetUrl('https://meet.google.com/abc-defg-hij?authuser=1'), 'https://meet.google.com/abc-defg-hij');
  for (const value of ['http://meet.google.com/abc-defg-hij', 'https://meet.google.com.evil.test/abc-defg-hij', 'https://localhost/abc-defg-hij', 'https://user@meet.google.com/abc-defg-hij', 'https://meet.google.com:444/abc-defg-hij', 'https://meet.google.com/lookup/foo', null]) assert.throws(() => meetUrl(value));
  assert.throws(() => title(' ')); assert.throws(() => title('x'.repeat(121)));
});
test('Interrupted work is recovered without losing the source artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-store-'));
  try {
    const store = new Store(dir), meeting = store.create({ title: 'Review', source: 'import', status: 'processing' });
    store.patch(meeting.id, { media: 'recording.webm', artifacts: ['recording.webm'] });
    new Store(dir).recover();
    const recovered = store.get(meeting.id);
    assert.equal(recovered.status, 'failed'); assert.equal(recovered.media, 'recording.webm');
    assert.throws(() => store.dir('../../etc'));
    assert.equal(fs.existsSync(path.join(store.dir(meeting.id), 'meeting.json.tmp')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Whisper timestamps remain linked to task quotes and bounded screenshots', () => {
  const segments = parseWhisper({ transcription: [
    { offsets: { from: 0, to: 4000 }, text: ' Das Logo ist falsch, wir müssen das ändern. ' },
    { offsets: { from: 4500, to: 6000 }, text: 'Hier ist es auch falsch.' },
    { offsets: { from: 12000, to: 16000 }, text: 'Den Dark Mode sollten wir prüfen.' },
    { offsets: { from: 18000, to: 19000 }, text: 'Danke für das Gespräch.' },
  ] });
  assert.equal(candidates(segments).length, 3);
  const shots = screenshotPoints(segments, 20); assert.deepEqual(shots.map(s => s.time), [0, 12]);
  assert.match(reportMarkdown('<img src=x>', candidates(segments), []), /\\<img/);
  assert.throws(() => parseWhisper({ transcription: [{ offsets: { from: -1, to: 3 }, text: 'bad' }] }));
});
test('A video without an audio track is rejected explicitly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-silent-'));
  try {
    const file = path.join(dir, 'silent.mp4');
    await command('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1', '-c:v', 'libx264', file]);
    await assert.rejects(() => inspectMedia(file), /Keine Tonspur/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
