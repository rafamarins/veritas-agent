// Two optional model bundles are required. Route Kokoro's synthetic audio into
// the real audio capture worklet, never the machine's physical microphone or speakers.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

import { appURL } from './local-app.mjs';
const browser = process.argv.includes('--webkit')
  ? await webkit.launch()
  : await chromium.launch({
      args: [
        '--autoplay-policy=document-user-activation-required',
        '--mute-audio',
      ],
    });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  context.on('request', (request) => requests.push(request.url()));
  // Supply a synthetic input track only when the application requests the mic.
  // Its source context is separate from the app's recording context.
  await page.addInitScript(() => {
    Object.defineProperty(
      Object.getPrototypeOf(navigator.mediaDevices),
      'getUserMedia',
      {
        configurable: true,
        value() {
          if (window.denyPermission)
            return Promise.reject(
              new DOMException('Permission denied', 'NotAllowedError'),
            );
          window.audio = new AudioContext();
          window.unlocked = audio.resume();
          window.mic = audio.createMediaStreamDestination();
          if (!window.waitForPermission) return Promise.resolve(mic.stream);
          return new Promise((resolve) => {
            window.grant = () => resolve(mic.stream);
          });
        },
      },
    );
  });
  await page.goto(appURL.href);
  const dictate = page.getByRole('button', {
    name: 'Dictate message',
    exact: true,
  });
  assert.ok(!requests.some((url) => url.includes('decoder-0.bin')));
  await page.evaluate(() => {
    window.denyPermission = true;
  });
  await dictate.click();
  await page
    .getByText(
      'Allow microphone access for this site, then tap the microphone again.',
    )
    .waitFor();
  assert.equal(await dictate.isEnabled(), true);
  await page.evaluate(() => {
    window.denyPermission = false;
    window.waitForPermission = true;
  });
  await dictate.click();
  await page.waitForFunction(() => !!window.grant, null, { polling: 100 });
  await page
    .getByRole('button', { name: 'Cancel dictation', exact: true })
    .click();
  await page.evaluate(() => grant());
  await page.waitForFunction(
    () => mic.stream.getTracks().every((track) => track.readyState === 'ended'),
    null,
    { polling: 100 },
  );
  assert.equal(await page.locator('#question').inputValue(), '');
  await page.evaluate(() => audio.close());

  await page.reload();
  await page.evaluate(async () => {
    const { synthesizeKokoro, releaseKokoro } = await import('./kokoro.js');
    try {
      const wav = await synthesizeKokoro(
        'Ask the council for the house plans.',
      );
      window.wav = await wav.arrayBuffer();
    } finally {
      releaseKokoro();
    }
  });
  await dictate.click();
  await page.getByText('Listening…', { exact: true }).waitFor();
  await page.evaluate(async () => {
    await unlocked;
    const sample = await audio.decodeAudioData(wav);
    return new Promise((resolve) => {
      const source = audio.createBufferSource();
      source.buffer = sample;
      source.connect(mic);
      source.onended = () => resolve();
      source.start(audio.currentTime + 0.2);
    });
  });
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
    requests.filter((url) => url === new URL('api/chat', appURL).href).length,
    0,
  );
  assert.deepEqual(
    requests.filter(
      (url) => /^https?:/.test(url) && new URL(url).origin !== appURL.origin,
    ),
    [],
  );
  await page.evaluate(() => audio.close());
  console.log(
    'One microphone click recorded an editable draft on-device:',
    draft,
  );
} finally {
  await browser.close();
}
