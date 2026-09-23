import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchAssistantPage } from '../../src/assistant/browser';
import { recordTab } from '../../src/assistant/recorder';
import { command } from '../../src/assistant/process';

test('Real Chrome tab capture records audio and video while physical devices stay denied', { skip: process.env.ASSISTANT_BROWSER_TEST !== '1', timeout: 45_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-recorder-'));
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Local test meeting</title><body style="background:#18201e;color:white;font:32px sans-serif;padding:70px"><h1>Lokale Testbesprechung</h1><p>Tab-Aufnahme mit Audiosignal</p><button id="play">Testsignal starten</button></body>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const page = await launchAssistantPage(`http://127.0.0.1:${address.port}`).catch(error => { server.close(); throw error; });
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    const permission = await page.evaluate(async () => Promise.all(['microphone', 'camera'].map(name => navigator.permissions.query({ name: name as PermissionName }).then(result => result.state))));
    assert.deepEqual(permission, ['denied', 'denied']);
    await page.evaluate(() => {
      document.querySelector('#play')!.addEventListener('click', () => {
        const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
        gain.gain.value = 0.04; oscillator.connect(gain).connect(audio.destination); oscillator.start();
      });
    });
    await page.locator('#play').click();
    let bytes = 0, peak = 0, started = false;
    const raw = path.join(root, 'raw.webm');
    await recordTab(page, 5000, {
      chunk: async data => { bytes += data.length; await fs.appendFile(raw, data); },
      started: () => { started = true; }, meter: value => { peak = Math.max(peak, value); },
    });
    await fs.mkdir('.assistant-test', { recursive: true });
    await fs.copyFile(raw, '.assistant-test/browser-capture.webm');
    assert.ok(started); assert.ok(bytes > 1000, `Empty recording: ${bytes}`); assert.ok(peak > 0.001, `No audio level: ${peak}`);
    const info = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', raw]));
    assert.ok(info.streams.some((stream: any) => stream.codec_type === 'audio'));
    assert.ok(info.streams.some((stream: any) => stream.codec_type === 'video'));
  } finally {
    await page.context().browser()?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true });
  }
});
