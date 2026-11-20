import assert from 'node:assert/strict';
import test from 'node:test';
import { ask, readAnswer } from '../src/assistant.js';
import { contextFor } from '../src/retrieval.js';
import refs from '../sources/references.json' with { type: 'json' };
import answers from '../src/guide/answers.json' with { type: 'json' };
import cards from '../src/guide/cards.json' with { type: 'json' };
import index from '../src/guide/reference-index.json' with { type: 'json' };

test('every source linked from either guide collection has a registry entry', () => {
  const urls = new Set(refs.map((r) => r.url));
  for (const a of answers) {
    assert.ok(urls.has(a.url), a.url);
    for (const lang of ['pt-BR', 'es', 'zh-Hans'])
      assert.ok(a.translations[lang].question);
  }
  for (const card of cards)
    for (const url of card.links) assert.ok(urls.has(url), url);
  for (const ref of refs) {
    assert.match(ref.url, /^https:\/\//);
    if (ref.kind === 'lookup') {
      assert.ok(!ref.excerpt);
      continue;
    }
    const page = index.records.find((r) => r.id === ref.id);
    assert.match(page.checkedOn, /^\d{4}-\d\d-\d\d$/);
    assert.ok(
      page.passages.some((p) => p.text.includes(ref.excerpt)),
      ref.title,
    );
  }
});

test('retrieves official LIM text and keeps each quote traceable', () => {
  const context = contextFor([], 'What does a LIM tell me?');
  assert.ok(
    context.sources.some((s) => s.kind === 'reference' && /LIM/.test(s.text)),
  );
  for (const s of context.sources) assert.ok(s.text.includes(s.quote));
  for (const s of context.sources.filter((s) => s.kind === 'guide'))
    assert.equal(new URL(s.url).hostname, 'rafael.co.nz');
});

test('an exact translated guide question retrieves its original topic', () => {
  const a = answers.find((a) => a.id === 'inspect-1');
  for (const lang of ['pt-BR', 'es', 'zh-Hans'])
    assert.ok(
      contextFor([], a.translations[lang].question).sources.some(
        (s) => s.sourceId === a.id,
      ),
      lang,
    );
});

test('a translated guide question keeps its known language beside English evidence', async () => {
  const question = answers[0].translations['pt-BR'].question;
  let messages;
  const env = {
    AI: {
      async run(_, request) {
        messages = request.messages;
        return { response: '{"answer":"Sem dados.","sources":[]}' };
      },
    },
  };
  await ask(env, contextFor([], question));
  assert.match(
    messages[0].content,
    /Write the entire answer in Brazilian Portuguese/,
  );
  assert.equal(JSON.parse(messages[1].content).question, question);
});

test('a follow-up uses the prior conversation and retrieves relevant sources again', () => {
  const first = 'What does a LIM say about council records?';
  const primary = contextFor([], first).sources.find(
    (s) => s.kind === 'reference',
  );
  const previous = [
    {
      id: 'first',
      question: first,
      answer: 'It summarises council records.',
      citations: [primary],
    },
  ];
  const follow = contextFor(previous, 'What does it leave out?');
  assert.equal(follow.previous[0].question, first);
  assert.ok(
    follow.sources.some(
      (s) => s.sourceId === primary.sourceId || /LIM/.test(s.text),
    ),
  );
});

test('an interactive lookup has a link and no invented publisher quotation', () => {
  const context = contextFor([], 'Where can I find the Auckland flood map?');
  const s = context.sources.find((s) => s.kind === 'lookup');
  assert.equal(s.sourceId, 'ref-1');
  assert.equal(s.quote, '');
});

test('the publisher, quote, date and URL come from the selected local passage', () => {
  const s = contextFor([], 'What should I check at an open home?').sources[0];
  const result = readAnswer(
    JSON.stringify({
      answer: 'Read the passage.',
      sources: [s.key],
      url: 'https://example.org',
      quote: 'invented',
    }),
    [s],
  );
  assert.equal(result.citations[0].quote, s.quote);
  assert.equal(result.citations[0].url, s.url);
  assert.equal(result.citations[0].checkedOn, s.checkedOn);
  assert.throws(() =>
    readAnswer(JSON.stringify({ answer: 'Made up.', sources: ['BAD'] }), [s]),
  );
  assert.throws(() =>
    readAnswer(
      JSON.stringify({
        answer: 'They say “quote that does not exist in this article”.',
        sources: [s.key],
      }),
      [s],
    ),
  );
});

test('unknown evidence and unavailable inference degrade to labelled excerpts', async () => {
  const context = contextFor([], 'When should I talk to a lawyer?');
  const env = {
    AI: {
      async run(model, args) {
        assert.equal(model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
        assert.equal(
          JSON.parse(args.messages[1].content).question,
          context.question,
        );
        return {
          response: JSON.stringify({
            answer: 'Unknown source',
            sources: ['invalid'],
          }),
        };
      },
    },
  };
  assert.equal((await ask(env, context)).mode, 'sources');
  assert.equal((await ask({}, context)).mode, 'sources');
  assert.equal(
    (await ask(env, { question: 'unrelated', sources: [], previous: [] })).mode,
    'insufficient',
  );
});

test('daily neuron exhaustion shows the next NZ reset and keeps the matching sources', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const context = contextFor([], 'What does a LIM tell me?');
  const failure = (message) => ({
    AI: { async run() { throw Error(message); } },
  });
  for (const [now, expected, message] of [
    ['2026-11-20T23:59:59Z', 'Saturday 21 November at 1 pm', '3036: Account limited'],
    ['2026-04-04T23:59:59Z', 'Sunday 5 April at 12 pm', '3036: Account limited'],
    ['2026-09-26T23:59:59Z', 'Sunday 27 September at 1 pm', '3036: Account limited'],
    ['2026-06-30T00:00:00Z', 'Wednesday 1 July at 12 pm', 'You have used up your daily free allocation of 10,000 neurons.'],
  ]) {
    t.mock.timers.setTime(Date.parse(now));
    const reply = await ask(failure(message), context);
    assert.equal(reply.mode, 'sources');
    assert.ok(reply.answer.includes(expected + ' (New Zealand time)'), reply.answer);
    assert.ok(reply.citations.length > 0);
    for (const ref of reply.citations) {
      const source = context.sources.find((s) => s.sourceId === ref.sourceId);
      assert.equal(ref.url, source.url);
      assert.equal(ref.quote, source.quote);
    }
  }
  const busy = await ask(failure('3040: Capacity temporarily exceeded'), context);
  assert.match(busy.answer, /couldn’t verify/);
});

test('buyer input cannot select an external model URL', async () => {
  const context = contextFor([], 'What does a LIM tell me?');
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    throw Error('no network');
  };
  try {
    const reply = await ask(
      { OLLAMA_URL: 'https://example.org', OLLAMA_MODEL: 'unused' },
      context,
    );
    assert.equal(called, false);
    assert.equal(reply.mode, 'sources');
  } finally {
    globalThis.fetch = original;
  }
});

test('a local model redirect never forwards the conversation', async (t) => {
  const context = contextFor([], 'What does a LIM tell me?');
  const request = t.mock.method(globalThis, 'fetch', async () =>
    Response.redirect('https://example.org'),
  );
  const reply = await ask(
    { OLLAMA_URL: 'http://localhost', OLLAMA_MODEL: 'test' },
    context,
  );
  assert.equal(reply.mode, 'sources');
  assert.equal(request.mock.callCount(), 1);
  assert.equal(request.mock.calls[0].arguments[1].redirect, 'manual');
});
