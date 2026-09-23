import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';

test('UI imports speech, renders transcript/tasks/screenshots and offers downloads', { skip: !process.env.ASSISTANT_FIXTURE || !process.env.WHISPER_MODEL, timeout: 150_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-ui-'));
  const server = spawn(process.execPath, ['dist/assistant/server.js'], { env: { ...process.env, ASSISTANT_PORT: '4329', ASSISTANT_DATA_DIR: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    await once(server.stdout!, 'data');
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto('http://127.0.0.1:4329');
    await page.locator('#title').fill('Produktreview – Testaufnahme');
    await page.locator('#consent').check();
    await page.locator('#upload').setInputFiles(process.env.ASSISTANT_FIXTURE!);
    await page.getByRole('button', { name: 'Aufgaben (3)', exact: true }).waitFor({ timeout: 120_000 });
    assert.match(await page.locator('#detail').innerText(), /Wir müssen das falsche Logo ändern/);
    await page.getByRole('button', { name: 'Aufgaben (3)', exact: true }).click();
    assert.equal(await page.locator('.tasks li').count(), 3);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Transkript ↓', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'transcript.md');
    await page.getByRole('button', { name: 'Screenshots (1)', exact: true }).click();
    await page.locator('.gallery img').waitFor();
    await page.evaluate(async () => { await Promise.all([...document.querySelectorAll<HTMLImageElement>('.gallery img')].map(image => image.decode())); });
    fs.mkdirSync('.assistant-test', { recursive: true });
    await page.screenshot({ path: '.assistant-test/ui-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '.assistant-test/ui-mobile.png', fullPage: true });
    assert.deepEqual(failures, []);
    page.on('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await page.getByText('Besprechung gelöscht.', { exact: true }).waitFor();
    assert.equal(fs.readdirSync(root).filter(name => name !== 'server.lock').length, 0);
  } finally {
    await browser.close(); server.kill('SIGTERM'); await once(server, 'exit'); fs.rmSync(root, { force: true, recursive: true });
  }
});
