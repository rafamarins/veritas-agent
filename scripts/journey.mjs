import assert from 'node:assert/strict';
import { checkChatHistory } from '../test/history.browser.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const origin = 'http://127.0.0.1:8794';
const screenshot = process.argv.includes('--screenshots');
const browser = await (
  process.argv.includes('--webkit') ? webkit : chromium
).launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 760 },
});
const page = await context.newPage();
const external = [],
  errors = [],
  votes = [];
const index = JSON.parse(
  await readFile(new URL('../src/guide/reference-index.json', import.meta.url)),
);
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (r.url().startsWith('http') && new URL(r.url()).origin !== origin)
    external.push(r.url());
  if (new URL(r.url()).pathname === '/api/feedback')
    votes.push(r.postDataJSON());
});
const read = (tab = page) =>
  tab.evaluate(() => {
    const chats = JSON.parse(
      localStorage.getItem('veritas-agent.chats.v2') || '[]',
    );
    return (
      chats.find((chat) => '#chat/' + chat.id === location.hash)?.messages || []
    );
  });
async function submit(question, reducedMotion = false) {
  await page.emulateMedia({
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const prior = (await read()).length;
  await page.evaluate((prior) => {
    const thread = document.querySelector('#thread');
    const trace = {
      loading: null,
      first: '',
      last: '',
      updates: 0,
      savedEarly: false,
      overflow: false,
    };
    window.streamTrace = trace;
    const observer = new MutationObserver(() => {
      const answer = thread.querySelector('.turn:last-child .answer');
      if (!document.querySelector('#send').disabled) {
        if (trace.loading) observer.disconnect();
        return;
      }
      if (!answer) return;
      if (answer.classList.contains('is-reading')) {
        trace.loading = {
          text: answer.textContent,
          opacity:
            answer
              .getAnimations()[0]
              ?.effect.getKeyframes()
              .map((f) => Number(f.opacity)) || [],
        };
      } else if (answer.textContent !== trace.last) {
        trace.first ||= answer.textContent;
        trace.last = answer.textContent;
        trace.updates++;
        const chats = JSON.parse(
          localStorage.getItem('veritas-agent.chats.v2') || '[]',
        );
        const saved = chats.find(
          (chat) => '#chat/' + chat.id === location.hash,
        );
        trace.savedEarly ||=
          (saved?.messages.length || 0) !== prior ||
          Boolean(answer.parentElement.querySelector('.answer-feedback'));
        trace.overflow ||= document.documentElement.scrollWidth > innerWidth;
      }
    });
    observer.observe(thread, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, prior);
  await page.getByRole('textbox', { name: 'Your question' }).fill(question);
  await page.locator('#send').click();
  await page.waitForFunction(
    () =>
      !document.querySelector('#send').disabled &&
      document.querySelector('#status').textContent !== 'Finding sources…',
    null,
    { timeout: 150000 },
  );
  assert.equal(
    await page.locator('#status').textContent(),
    'Reply saved on this device.',
  );
  const turn = (await read()).at(-1);
  assert.equal(
    turn.mode,
    'assistant',
    'Expected a cited model reply for the fictional visit.',
  );
  assert.doesNotMatch(turn.answer, /local information memorandum/i);
  const trace = await page.evaluate(() => window.streamTrace);
  assert.equal(trace.loading?.text, 'Reading the guide and references…');
  assert.deepEqual(trace.loading.opacity, reducedMotion ? [] : [0.5, 1]);
  assert.ok(trace.updates > 1 && trace.first.length < turn.answer.length);
  assert.ok(turn.answer.startsWith(trace.first));
  assert.equal(trace.savedEarly, false);
  assert.equal(trace.overflow, false);
  assert.equal(await page.locator('.is-reading').count(), 0);
  return turn;
}
try {
  await checkChatHistory(browser, origin);
  await page.goto(origin + '/#/ask');
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(
    await page.getByRole('heading', { level: 1 }).textContent(),
    'Ask Veritas.',
  );
  await page.evaluate(() => document.fonts.ready);
  if (screenshot) {
    await mkdir('docs', { recursive: true });
    await page.screenshot({ path: 'docs/ask-veritas.png' });
  }
  const first = await submit(
    'I saw a garage converted into a bedroom at an open home. Which council records should I ask for?',
  );
  const source = first.citations.find((c) => c.kind === 'reference');
  assert.ok(source);
  assert.ok(
    index.records
      .find((r) => r.id === source.sourceId)
      .passages.some((p) => p.text.includes(source.quote)),
  );
  await page
    .getByText(source.quote + (source.shortened ? '…' : ''), { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole('link', { name: source.title, exact: true })
      .getAttribute('href'),
    source.url,
  );
  await page.reload();
  assert.equal((await read())[0].id, first.id);
  if (!screenshot) await page.setViewportSize({ width: 390, height: 844 });
  const second = await submit(
    'The council paperwork only mentions a carport. Does that answer my earlier question?',
    true,
  );
  assert.match(second.answer, /garage|bedroom/i);
  assert.match(second.answer, /carport/i);
  assert.doesNotMatch(
    second.answer,
    /(?:requires?|needs?|obtain|apply for) (?:a )?retrospective (?:building )?consent/i,
  );
  assert.ok(second.citations.some((c) => c.kind === 'reference'));
  const last = page.locator('article.turn').last();
  if (screenshot) {
    const height = Math.ceil((await last.boundingBox()).height) + 320;
    await page.setViewportSize({ width: 1200, height: Math.max(760, height) });
    await page.mouse.move(0, 0);
    await last.scrollIntoViewIfNeeded();
    await last.screenshot({ path: 'docs/cited-reply.png' });
  }
  async function vote(label, value) {
    await last.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(
      (v) =>
        JSON.parse(localStorage.getItem('veritas-agent.chats.v2'))
          .find((chat) => '#chat/' + chat.id === location.hash)
          .messages.at(-1).vote === v,
      value,
    );
    assert.equal(
      await last
        .getByRole('button', { name: label, exact: true })
        .getAttribute('aria-pressed'),
      String(value !== 0),
    );
  }
  await vote('Helpful', 1);
  await page.reload();
  assert.equal(
    await last
      .getByRole('button', { name: 'Helpful', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await vote('Not helpful', -1);
  await vote('Not helpful', 0);
  assert.deepEqual(
    votes.map((v) => v.vote),
    [1, -1, 0],
  );
  assert.ok(
    votes.every(
      (v) =>
        Object.keys(v).sort().join(',') === 'receipt,vote' &&
        v.receipt === second.receipt,
    ),
  );
  const anotherTab = await context.newPage();
  await anotherTab.goto(origin);
  await anotherTab.locator('#chat-list a').first().click();
  await anotherTab.locator('article.turn').first().waitFor();
  assert.equal((await read(anotherTab)).length, 2);
  const other = await browser.newContext();
  const separate = await other.newPage();
  await separate.goto(origin);
  assert.deepEqual(await read(separate), []);
  await other.close();
  assert.equal((await context.request.get(origin + '/api/chat')).status(), 405);
  assert.deepEqual(
    (await context.cookies()).filter((c) => c.name === 'veritas'),
    [],
  );
  assert.equal(
    (
      await context.request.post(origin + '/api/feedback', {
        headers: { origin: 'https://example.org' },
        data: {},
      })
    ).status(),
    403,
  );
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 840 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(
      (await page.locator('#send .block-arrow').boundingBox()).width,
      width <= 740 ? 27 : 36,
    );
    assert.equal(
      (
        await last
          .getByRole('button', { name: 'Helpful', exact: true })
          .boundingBox()
      ).width,
      44,
    );
  }
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear chat' }).click();
  await anotherTab.locator('.starters:visible').waitFor();
  await page.reload();
  assert.deepEqual(await read(), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    'Passed streamed replies, loading pulse and reduced motion, source quote, two-turn recall, device storage, isolated browser, update/remove vote, clear across tabs and responsive controls.',
  );
} finally {
  await browser.close();
}
