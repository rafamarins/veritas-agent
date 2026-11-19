import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

export async function checkChatHistory(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  try {
    const requests = [];
    await context.route('**/api/chat', (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body:
          JSON.stringify({
            type: 'done',
            reply: {
              answer: 'Ask for the council records.',
              mode: 'assistant',
              citations: [],
              receipt: crypto.randomUUID(),
            },
          }) + '\n',
      });
    });
    await page.goto(origin);
    await page.evaluate(() => {
      localStorage.setItem(
        'veritas-agent.chat.v1',
        JSON.stringify({
          epoch: '',
          messages: [
            {
              id: crypto.randomUUID(),
              question: 'A first viewing',
              answer: 'Ask for the plans.',
              citations: [],
              receipt: crypto.randomUUID(),
              vote: 0,
            },
          ],
        }),
      );
    });
    await page.reload();
    await page.getByRole('link', { name: 'A first viewing' }).click();
    await page.locator('#thread .answer').waitFor();
    const original = page.url();
    await page.getByRole('link', { name: 'New chat', exact: true }).click();
    await page.locator('#thread').waitFor({ state: 'hidden' });
    await page.locator('#question').fill('A second viewing');
    await page.locator('#send').click();
    await page.waitForURL(/#chat\/[a-f0-9-]+$/);
    await page.locator('.answer-feedback').waitFor();
    const second = page.url();
    assert.deepEqual(requests[0].history, []);
    await page.reload();
    assert.equal(await page.locator('.turn').count(), 1);
    await page.getByRole('link', { name: 'Chat home', exact: true }).click();
    await page.locator('#chat-list a').first().waitFor();
    assert.deepEqual(await page.locator('#chat-list a').allTextContents(), [
      'A second viewing',
      'A first viewing',
    ]);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.goBack();
    assert.equal(page.url(), second);
    await page.goto(original);
    await page.locator('#question').fill('Which plans?');
    await page.locator('#send').click();
    await page.locator('.turn:nth-child(2) .answer-feedback').waitFor();
    assert.deepEqual(
      requests[1].history.map((m) => m.question),
      ['A first viewing'],
    );
    // A delete in a second tab must cancel the in-flight reply without reviving its chat.
    const writing = await context.newPage();
    await writing.goto(original);
    const requestSeen = Promise.withResolvers();
    const release = Promise.withResolvers();
    await writing.route('**/api/chat', async (route) => {
      requestSeen.resolve();
      await release.promise;
      await route.abort().catch(() => {});
    });
    await writing.locator('#question').fill('And which council?');
    await writing.locator('#send').click();
    await requestSeen.promise;
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Clear chat' }).click();
    await page.getByRole('link', { name: 'A second viewing' }).waitFor();
    await writing.getByRole('link', { name: 'A second viewing' }).waitFor();
    release.resolve();
    assert.equal(await page.locator('#chat-list li').count(), 1);
    assert.equal(await writing.locator('#question').inputValue(), '');
    await writing.close();
    await page.evaluate(() => {
      const key = 'veritas-agent.chats.v2';
      const [chat] = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify(
          Array.from({ length: 30 }, () => ({
            ...chat,
            id: crypto.randomUUID(),
          })),
        ),
      );
    });
    await page.reload();
    await page.locator('#question').fill('One more viewing');
    await page.locator('#send').click();
    await page
      .getByText('Clear a saved chat to make room for a new one.')
      .waitFor();
    assert.equal(await page.locator('#chat-list li').count(), 30);
  } finally {
    await context.close();
  }
}

if (import.meta.main) {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      await checkChatHistory(browser, 'http://127.0.0.1:8794');
      console.log(
        'Verified chat migration, navigation and separate histories in ' +
          engine.name() +
          '.',
      );
    } finally {
      await browser.close();
    }
  }
}
