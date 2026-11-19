// Run against the local Pages server after preparing the optional voice assets.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const origin = 'http://127.0.0.1:8794';
const browser = await (
  process.argv.includes('--webkit') ? webkit : chromium
).launch();
try {
  const context = await browser.newContext();
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  const page = await context.newPage();
  await page.goto(origin);
  assert.ok(!requests.some((url) => url.includes('/voice-assets/model-')));
  const result = await page.evaluate(async () => {
    const { synthesizeKokoro, releaseKokoro } = await import('/kokoro.js');
    const controller = new AbortController();
    const cancelled = synthesizeKokoro('Stop reading.', {
      signal: controller.signal,
    });
    controller.abort();
    const next = synthesizeKokoro('Ask about the council records.');
    try {
      const reason = await cancelled.catch((error) => error.name);
      const audio = await next;
      const wav = new DataView(await audio.arrayBuffer());
      let peak = 0;
      for (let i = 44; i + 1 < wav.byteLength; i += 2) {
        peak = Math.max(peak, Math.abs(wav.getInt16(i, true)));
      }
      return {
        reason,
        type: audio.type,
        header: wav.getUint32(0),
        rate: wav.getUint32(24, true),
        peak,
      };
    } finally {
      releaseKokoro();
    }
  });
  assert.equal(result.reason, 'AbortError');
  assert.equal(result.type, 'audio/wav');
  assert.equal(result.header, 0x52494646); // RIFF
  assert.equal(result.rate, 24000);
  assert.ok(result.peak > 0);
  assert.deepEqual(
    requests.filter(
      (url) => /^https?:/.test(url) && new URL(url).origin !== origin,
    ),
    [],
  );
  console.log(
    'Kokoro cancelled playback preparation and generated a non-silent 24 kHz WAV on this device.',
  );
} finally {
  await browser.close();
}
