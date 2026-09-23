import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Local HTTP API rejects cross-origin writes and requires recording consent', { timeout: 15_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-http-'));
  const server = spawn(process.execPath, ['dist/assistant/server.js'], { env: { ...process.env, ASSISTANT_PORT: '4328', ASSISTANT_DATA_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(server.stdout!, 'data');
    const base = 'http://127.0.0.1:4328';
    assert.equal((await fetch(`${base}/api/meetings`)).status, 200);
    const missingHeader = await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(missingHeader.status, 403);
    const badOrigin = await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'X-Assistant-Request': '1', Origin: 'https://other.example' } });
    assert.equal(badOrigin.status, 403);
    const missingConsent = await fetch(`${base}/api/meetings`, { method: 'POST', headers: { 'X-Assistant-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Review', url: 'https://meet.google.com/abc-defg-hij', consent: false }) });
    assert.equal(missingConsent.status, 400); assert.match((await missingConsent.json()).error, /zugestimmt/);
    const invalidImport = await fetch(`${base}/api/import?title=Review&extension=html`, { method: 'POST', headers: { 'X-Assistant-Request': '1', 'X-Recording-Consent': 'true' } });
    assert.equal(invalidImport.status, 400);
    assert.deepEqual(await (await fetch(`${base}/api/meetings`)).json(), []);
  } finally {
    server.kill('SIGTERM'); await once(server, 'exit'); fs.rmSync(root, { force: true, recursive: true });
  }
});
