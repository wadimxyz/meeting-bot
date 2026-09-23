import { Page } from 'playwright';
import { randomUUID } from 'node:crypto';
export interface RecordingHooks {
  chunk(data: Buffer): Promise<void>;
  started(): void;
  meter(level: number): void;
}
export async function recordTab(page: Page, maxMilliseconds: number, hooks: RecordingHooks): Promise<void> {
  const secret = randomUUID();
  let settle: (() => void) | undefined, fail: ((error: Error) => void) | undefined;
  const finished = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
  // Attach rejection handling before setup to avoid unhandled page-close races.
  void finished.catch(() => undefined);
  const closed = () => fail?.(new Error('Meeting-Browser wurde unerwartet geschlossen. Aufnahme möglicherweise unvollständig.'));
  page.on('close', closed);
  const deadline = setTimeout(() => fail?.(new Error('Aufnahme konnte nicht rechtzeitig beendet werden.')), maxMilliseconds + 30_000);
  try {
    await page.exposeFunction('assistantChunk', async (key: string, base64: string) => {
      if (key !== secret) throw new Error('Ungültiger Aufnahmeschlüssel.');
      if (base64.length > 16_000_000) throw new Error('Aufnahmeblock zu groß.');
      await hooks.chunk(Buffer.from(base64, 'base64'));
    });
    await page.exposeFunction('assistantMeter', (key: string, level: number) => { if (key === secret) hooks.meter(level); });
    await page.exposeFunction('assistantFinished', (key: string, error?: string) => {
      if (key === secret) error ? fail?.(new Error(error)) : settle?.();
    });
    await page.evaluate(async ({ key, maximum }) => {
      const runtime = window as unknown as {
        assistantChunk(key: string, data: string): Promise<void>;
        assistantMeter(key: string, level: number): Promise<void>;
        assistantFinished(key: string, error?: string): Promise<void>;
        assistantStop?: () => void;
      };
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: { suppressLocalAudioPlayback: true } as MediaTrackConstraints, preferCurrentTab: true } as DisplayMediaStreamOptions);
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Chrome liefert keine Tonspur. Aufnahme wurde nicht gestartet.');
      }
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { stream.getTracks().forEach(track => track.stop()); await audio.close(); throw new Error('WebM-Aufzeichnung wird nicht unterstützt.'); }
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 96_000 });
      let writes = Promise.resolve(), fault: string | undefined;
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      runtime.assistantStop = stop;
      const timer = setTimeout(stop, maximum);
      const meter = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        void runtime.assistantMeter(key, rms).catch(() => stop());
        if (/You left the meeting|You've been removed|Sie haben die Besprechung verlassen|Sie wurden.*entfernt|The meeting has ended|Die Besprechung wurde beendet/i.test(document.body.innerText)) stop();
      }, 1000);
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        writes = writes.then(async () => {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result);
              // Codec lists can contain commas before the base64 payload.
              resolve(url.slice(url.lastIndexOf(',') + 1));
            };
            reader.onerror = () => reject(new Error('Aufnahmeblock konnte nicht gelesen werden.'));
            reader.readAsDataURL(event.data);
          });
          await runtime.assistantChunk(key, data);
        }).catch(error => { fault = String(error); stop(); });
      };
      recorder.onerror = () => { fault = 'MediaRecorder meldet einen Aufnahmefehler.'; stop(); };
      recorder.onstop = async () => {
        clearTimeout(timer); clearInterval(meter);
        stream.getTracks().forEach(track => track.stop());
        await audio.close();
        await writes;
        await runtime.assistantFinished(key, fault);
      };
      stream.getTracks().forEach(track => track.addEventListener('ended', stop));
      recorder.start(2000);
    }, { key: secret, maximum: maxMilliseconds });
    hooks.started();
    await finished;
  } finally { clearTimeout(deadline); page.off('close', closed); }
}
export async function stopTab(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const stop = (window as unknown as { assistantStop?: () => void }).assistantStop;
    stop?.(); return Boolean(stop);
  });
}
