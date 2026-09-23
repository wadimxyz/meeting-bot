import { chromium, Page } from 'playwright';
export async function launchAssistantPage(origin = 'https://meet.google.com'): Promise<Page> {
  const executablePath = process.env.CHROME_PATH ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
  const browser = await chromium.launch({
    executablePath, headless: false,
    args: ['--no-first-run', '--no-default-browser-check', '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900'],
    ignoreDefaultArgs: ['--mute-audio'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    // Deny the bot access to real devices. Incoming tab audio remains recordable.
    for (const name of ['microphone', 'camera']) {
      await cdp.send('Browser.setPermission', { permission: { name }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId });
    }
    // Keep this session attached: Chrome removes permission overrides on detach.
    return page;
  } catch (error) { await browser.close(); throw error; }
}
