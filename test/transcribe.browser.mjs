// Two optional model bundles are required. Route Kokoro's synthetic audio into
// the real audio capture worklet, never the machine's physical microphone or speakers.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const origin = 'http://127.0.0.1:8794';
const browser = await (
  process.argv.includes('--webkit') ? webkit : chromium
).launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  await page.goto(origin);
  assert.ok(!requests.some((url) => url.includes('decoder-0.bin')));
  await page.evaluate(() => {
    document.querySelector('#voice-toggle').addEventListener(
      'click',
      () => {
        window.audio = new AudioContext();
        window.unlocked = audio.resume();
      },
      { once: true },
    );
    Object.defineProperty(
      Object.getPrototypeOf(navigator.mediaDevices),
      'getUserMedia',
      {
        configurable: true,
        value: () =>
          new Promise((resolve) => {
            window.grant = resolve;
          }),
      },
    );
  });
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByText('Whisper downloads', { exact: false }).waitFor();
  const dictate = page.locator('#dictate');
  await dictate.click();
  await page.waitForFunction(() => !!window.grant, null, { polling: 100 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    window.cancelled = audio.createMediaStreamDestination().stream;
    grant(cancelled);
  });
  await page.waitForFunction(
    () => cancelled.getTracks().every((track) => track.readyState === 'ended'),
    null,
    { polling: 100 },
  );
  assert.equal(await page.locator('#question').inputValue(), '');

  await page.evaluate(async () => {
    await unlocked;
    const { synthesizeKokoro, releaseKokoro } = await import('/kokoro.js');
    let wav;
    try {
      wav = await synthesizeKokoro('Ask the council for the house plans.');
    } finally {
      releaseKokoro();
    }
    window.sample = await audio.decodeAudioData(await wav.arrayBuffer());
    window.mic = audio.createMediaStreamDestination();
    Object.defineProperty(
      Object.getPrototypeOf(navigator.mediaDevices),
      'getUserMedia',
      {
        configurable: true,
        value: async () => mic.stream,
      },
    );
  });
  await dictate.click();
  await page.getByText('Listening…', { exact: true }).waitFor();
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const source = audio.createBufferSource();
        source.buffer = sample;
        source.connect(mic);
        source.onended = () => resolve();
        source.start(audio.currentTime + 0.2);
      }),
  );
  await page.getByRole('button', { name: 'Finish dictation' }).click();
  assert.ok(
    await page.evaluate(() =>
      mic.stream.getTracks().every((track) => track.readyState === 'ended'),
    ),
  );
  await page.waitForFunction(
    () => /council/i.test(document.querySelector('#question').value),
    null,
    { polling: 100, timeout: 90000 },
  );
  const draft = await page.locator('#question').inputValue();
  assert.match(draft, /plan/i);
  await page.locator('#question').fill('An edited question.');
  assert.equal(
    requests.filter((url) => new URL(url).pathname === '/api/chat').length,
    0,
  );
  assert.deepEqual(
    requests.filter(
      (url) => /^https?:/.test(url) && new URL(url).origin !== origin,
    ),
    [],
  );
  await page.evaluate(() => audio.close());
  console.log(
    'Dictation controls produced an editable draft on-device:',
    draft,
  );
} finally {
  await browser.close();
}
