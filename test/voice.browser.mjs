// Browser speech services depend on the OS. Exercise their event contract with fictional text.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

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
  const page = await browser.newPage({ viewport: { width: 375, height: 820 } });
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
          this.onend();
        }
        abort() {
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
  await page.goto('http://127.0.0.1:8794/');
  assert.ok(!requests.some((url) => url.includes('/voice-assets/')));
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.getByText('Listening…', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testMic.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'A garage question' } }],
    });
    window.testMic.stop();
  });
  assert.equal(
    await page.locator('#question').inputValue(),
    'A garage question',
  );
  assert.equal(chats, 0);
  await page.locator('#question').fill('An edited garage question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('.answer-feedback').waitFor();
  await page.evaluate(() => {
    window.speechSynthesis.voices = [{ lang: 'en-NZ', localService: true }];
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  await page.waitForFunction(() => window.spoken?.length > 0);
  assert.match(await page.evaluate(() => window.spoken[0]), /property file/);
  await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
  assert.equal(chats, 1);
  if (withKokoro) {
    await page.waitForFunction(
      () =>
        !document.querySelector('#voice-engine option[value=kokoro]').disabled,
    );
    await page.locator('#voice-engine').selectOption('kokoro');
    await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
    await page.waitForFunction(() => window.buffers.length >= 2, null, {
      timeout: 120000,
    });
    assert.ok(
      await page.evaluate(() =>
        window.buffers.every((b) => b.audible && b.state === 'running'),
      ),
    );
  }
  await page.getByRole('link', { name: 'Chat home', exact: true }).click();
  await page.locator('#library').waitFor();
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
      (url) => /^https?:/.test(url) && new URL(url).hostname !== '127.0.0.1',
    ),
    [],
  );
  console.log(
    'Passed editable dictation, delayed voice availability, reading controls, navigation and mobile layout' +
      (withKokoro ? ', including two non-silent Kokoro segments.' : '.'),
  );
} finally {
  await browser.close();
}
