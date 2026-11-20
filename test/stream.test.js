import assert from 'node:assert/strict';
import test from 'node:test';
import { readChat } from '../pages/public/stream.js';
import { handleRequest } from '../src/http.js';
import { modelText } from '../src/model-stream.js';

const encode = (s) => new TextEncoder().encode(s);
const event = (response) =>
  'data: ' + JSON.stringify({ response }) + '\r\n\r\n';
const end = 'data: [DONE]\n\n';

function chat(stream, record) {
  const request = new Request('https://veritas.test/api/chat', {
    method: 'POST',
    headers: {
      accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      question: 'What council documents should I ask for at a viewing?',
    }),
  });
  return handleRequest(request, {
    REQUEST_LIMIT: { limit: async () => ({ success: true }) },
    QUALITY: {
      getByName: () => ({ reserve: async () => ({ allowed: true }), record }),
    },
    AI: {
      async run(_, options) {
        assert.equal(options.stream, true);
        assert.equal(options.response_format, undefined);
        return stream;
      },
    },
  });
}

test('a buyer receives checked words before inference finishes and one receipt at completion', async () => {
  let upstream;
  const stream = new ReadableStream({
    start(controller) {
      upstream = controller;
    },
  });
  const records = [];
  const response = await chat(stream, async (...args) => {
    records.push(args);
    return 'receipt';
  });
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const first = Promise.withResolvers();
  const parts = [];
  const reply = readChat(response.body, (text) => {
    parts.push(text);
    first.resolve(text);
  });
  upstream.enqueue(encode(event('["S1"]\nAsk the council ')));
  assert.equal(await first.promise, 'Ask the council ');
  assert.equal(records.length, 0);
  upstream.enqueue(encode(event('for the file.') + end));
  upstream.close();
  const result = await reply;
  assert.equal(result.answer, 'Ask the council for the file.');
  assert.ok(result.answer.startsWith(parts.join('')));
  assert.equal(result.mode, 'assistant');
  assert.ok(result.citations[0].sourceId);
  assert.equal(result.receipt, 'receipt');
  assert.equal(records.length, 1);
  assert.equal(records[0].length, 2);
  assert.equal(records[0][1], 'assistant');
});

test('unknown sources, split links and unsupported quotations cannot appear in streamed text', async () => {
  for (const [tokens, forbidden] of [
    [['["S999"]\nInvented evidence. '], /Invented/],
    [['["S1"]\nRead htt', 'ps://example.org now. '], /http|example/],
    [
      ['["S1"]\nIt says “', 'made up council words', ' with no source”. '],
      /made up|no source/,
    ],
  ]) {
    const upstream = new Response(tokens.map(event).join('') + end);
    const response = await chat(upstream.body, async () => 'receipt');
    let visible = '';
    const reply = await readChat(response.body, (text) => {
      visible += text;
    });
    assert.doesNotMatch(visible, forbidden);
    assert.equal(reply.mode, 'sources');
    assert.ok(reply.citations.length);
  }
});

test('multiple passages from the index can ground a reply without word separators', async () => {
  const text = '可以向市议会索取相关记录。';
  const upstream = new Response(
    event('["S1","S2","S3"]\n' + text.slice(0, 5)) + event(text.slice(5)) + end,
  );
  const response = await chat(upstream.body, async () => 'receipt');
  const parts = [];
  const reply = await readChat(response.body, (part) => parts.push(part));
  assert.equal(reply.mode, 'assistant');
  assert.equal(reply.answer, text);
  assert.equal(parts[0], text.slice(0, 5));
  assert.ok(reply.citations.length > 0 && reply.citations.length <= 3);
});

test('a suggested buyer question is plain text and a claim attributed to the council still needs a source', async () => {
  const question = 'Are there any council plans showing the bedroom?';
  for (const [intro, mode] of [
    ['Take this specific question to your council: ', 'assistant'],
    ['According to the council: ', 'sources'],
  ]) {
    const upstream = new Response(
      event('["S1"]\n' + intro + '“') + event(question) + event('”') + end,
    );
    const response = await chat(upstream.body, async () => 'receipt');
    const parts = [];
    const reply = await readChat(response.body, (t) => parts.push(t));
    assert.equal(reply.mode, mode);
    if (mode === 'assistant') {
      assert.equal(reply.answer, intro + question);
      assert.ok(reply.answer.startsWith(parts.join('')));
    } else assert.ok(!parts.join('').includes(question));
  }
});

test('an incomplete provider stream ends with source excerpts, while an interrupted HTTP reply cannot be saved', async () => {
  const response = await chat(
    new Response(event('["S1"]\nRead the file ')).body,
    async () => 'receipt',
  );
  const reply = await readChat(response.body, () => {});
  assert.equal(reply.mode, 'sources');
  const partial = new Response('{"type":"delta","text":"Read the file "}\n');
  await assert.rejects(
    readChat(partial.body, () => {}),
    /interrupted/,
  );
});

test('a quota error in the provider stream finishes with the NZ reset and sources', async () => {
  const upstream = new Response('data: {"error":{"code":3036,"message":"Account limited"}}\n\n');
  const response = await chat(upstream.body, async () => 'receipt');
  const reply = await readChat(response.body);
  assert.equal(reply.mode, 'sources');
  assert.match(reply.answer, /AI replies will be back on .+ \(New Zealand time\)/);
  assert.ok(reply.citations.some((source) => source.quote && source.url));
});

test('Ollama streaming preserves split UTF-8 and excludes reasoning', async () => {
  const chunks = encode(
    JSON.stringify({
      message: { thinking: 'private reasoning', content: 'Māori ' },
      done: false,
    }) +
      '\r\n' +
      JSON.stringify({ message: { content: 'land' }, done: true }) +
      '\n',
  );
  const split = chunks.indexOf(0xc4) + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunks.slice(0, split));
      controller.enqueue(chunks.slice(split));
      controller.close();
    },
  });
  assert.deepEqual(await Array.fromAsync(modelText(stream, 'ollama')), [
    'Māori ',
    'land',
  ]);
});

test('disconnecting cancels unfinished inference and skips the receipt', async () => {
  let upstream;
  const cancelled = Promise.withResolvers();
  const stream = new ReadableStream({
    start(controller) {
      upstream = controller;
    },
    cancel() {
      cancelled.resolve();
    },
  });
  let records = 0;
  const response = await chat(stream, async () => {
    records++;
    return 'receipt';
  });
  const reader = response.body.getReader();
  upstream.enqueue(encode(event('["S1"]\nRead the ')));
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /Read the/,
  );
  await reader.cancel();
  await cancelled.promise;
  assert.equal(records, 0);
});
