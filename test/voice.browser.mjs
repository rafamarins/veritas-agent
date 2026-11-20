// Browser speech services depend on the OS. Exercise their event contract with fictional text.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

import { appURL } from './local-app.mjs';

const useWebKit = process.argv.includes('--webkit');
const withKokoro = process.argv.includes('--kokoro');
const browser = useWebKit
  ? await webkit.launch()
  : await chromium.launch({
      args: [
        '--autoplay-policy=document-user-activation-required',
        '--mute-audio',
      ],
    });
try {
  const page = await browser.newPage({
    viewport: { width: 375, height: 820 },
    locale: 'en-NZ',
  });
  await page.addInitScript(() => {
    const synth = new EventTarget();
    synth.voices = [];
    synth.getVoices = () => synth.voices;
    synth.speak = (u) => {
      (window.spoken ??= []).push(u.text);
      window.currentUtterance = u;
    };
    synth.cancel = () => {};
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, 'SpeechRecognition', {
      value: class {
        constructor() {
          window.testMic = this;
        }
        start() {
          this.onstart();
        }
        stop() {
          if (window.nextTranscript)
            this.onresult({
              resultIndex: 0,
              results: [
                { isFinal: true, 0: { transcript: window.nextTranscript } },
              ],
            });
          this.onend();
        }
        abort() {
          window.aborted = (window.aborted || 0) + 1;
          this.onend();
        }
      },
    });
    // Observe real decoded buffers reaching a real Web Audio source with gesture-required playback.
    const start = AudioBufferSourceNode.prototype.start;
    window.buffers = [];
    AudioBufferSourceNode.prototype.start = function (...args) {
      const signal = this.buffer?.getChannelData(0);
      if (signal)
        window.buffers.push({
          state: this.context.state,
          audible: signal.some((n) => Math.abs(n) > 0.001),
        });
      return start.apply(this, args);
    };
  });
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  // Exercise the browser-native fallback even when optional Whisper weights are installed.
  await page.route('**/whisper-assets/ready.json', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  let chats = 0;
  await page.route('**/api/chat', async (route) => {
    chats++;
    const reply = {
      answer: 'Check the property file. Ask the council.',
      mode: 'assistant',
      citations: [],
      receipt: '5bfcbe46-e2ff-4ed4-93f6-55761ab5b097',
    };
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'done', reply }) + '\n',
    });
  });
  await page.goto(appURL.href);
  const mic = page.getByRole('button', {
    name: 'Dictate message',
    exact: true,
  });
  const finish = page.getByRole('button', {
    name: 'Finish dictation',
    exact: true,
  });
  const draft = page.locator('#question');
  const send = page.getByRole('button', { name: 'Send', exact: true });

  await mic.waitFor();
  assert.equal(await page.locator('#composer select').count(), 0);
  const size = await mic.boundingBox();
  assert.ok(size.width >= 44 && size.height >= 44);
  assert.ok(!requests.some((url) => /(?:decoder|model)-0\.bin/.test(url)));

  await draft.fill('I saw a garage.');
  await mic.click();
  await finish.waitFor();
  assert.equal(await send.isDisabled(), true);
  await draft.press('Enter');
  assert.equal(chats, 0);
  await finish.waitFor();
  await page.evaluate(() => {
    window.cancelledMic = window.testMic;
  });
  await page.keyboard.press('Escape');
  await mic.waitFor();
  assert.equal(await page.evaluate(() => window.aborted), 1);
  await page.evaluate(() =>
    window.cancelledMic.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'An abandoned draft.' } }],
    }),
  );
  assert.equal(await draft.inputValue(), 'I saw a garage.');

  await mic.click();
  await finish.waitFor();
  await page.evaluate(() => {
    window.nextTranscript = 'Which plans should I ask for?';
  });
  await finish.click();
  await mic.waitFor();
  assert.equal(
    await draft.inputValue(),
    'I saw a garage. Which plans should I ask for?',
  );
  assert.equal(chats, 0);
  await draft.fill('An edited garage question');
  await send.click();
  await page.locator('.answer-feedback').waitFor();
  assert.equal(chats, 1);
  assert.equal(await page.evaluate(() => window.spoken?.length ?? 0), 0);

  const read = page.getByRole('button', { name: 'Read aloud', exact: true });
  await read.click();
  await page.evaluate(() => {
    window.speechSynthesis.voices = [{ lang: 'en-NZ', localService: true }];
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  await page.waitForFunction(() => window.spoken?.length > 0);
  assert.match(await page.evaluate(() => window.spoken[0]), /property file/);
  await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
  if (withKokoro) {
    await page.evaluate(() => {
      window.speechSynthesis.voices = [];
    });
    await read.click();
    await page.waitForFunction(() => window.buffers.length >= 2, null, {
      timeout: 120000,
    });
    assert.ok(
      await page.evaluate(() =>
        window.buffers.every((b) => b.audible && b.state === 'running'),
      ),
    );
  }
  await mic.click();
  await finish.waitFor();
  await page.getByRole('link', { name: 'Chat home', exact: true }).click();
  await page.locator('#library').waitFor();
  assert.equal(await page.evaluate(() => window.aborted), 2);
  assert.equal(await draft.inputValue(), '');
  assert.equal(chats, 1);
  assert.equal(
    await page.getByRole('button', { name: 'Stop reading' }).count(),
    0,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(
    requests.filter(
      (url) => /^https?:/.test(url) && new URL(url).origin !== appURL.origin,
    ),
    [],
  );
  console.log(
    'Passed single-click dictation, editable drafts, cancellation, manual playback and mobile layout' +
      (withKokoro ? ', including two non-silent Kokoro segments.' : '.'),
  );
} finally {
  await browser.close();
}
