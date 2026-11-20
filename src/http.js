import { ask } from './assistant.js';
import { dailyChatPause } from './chat-availability.js';
import { contextFor } from './retrieval.js';

const maxBytes = 32768;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
const problem = (error, status, headers) => json({ error }, status, headers);
const requestFailed = 'Could not finish this request. Try again shortly.';

function streamReply(request, complete) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const connection = new AbortController();
  const signal = AbortSignal.any([request.signal, connection.signal]);
  const stop = () => writer.abort(signal.reason).catch(() => {});
  signal.addEventListener('abort', stop, { once: true });
  writer.closed.catch(() => connection.abort());
  const write = (event) =>
    writer.write(encoder.encode(JSON.stringify(event) + '\n'));

  async function send() {
    try {
      const reply = await complete({
        onText: (text) => write({ type: 'delta', text }),
        signal,
      });
      await write({ type: 'done', reply });
    } catch {
      if (!signal.aborted) await write({ type: 'error', error: requestFailed });
    } finally {
      signal.removeEventListener('abort', stop);
      await writer.close();
    }
  }
  send().catch(stop);
  return new Response(readable, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
      vary: 'Accept',
    },
  });
}

async function body(request) {
  if (
    request.headers.get('content-type')?.split(';')[0].trim() !==
    'application/json'
  )
    throw problem('Send a JSON message.', 415);
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw problem('Message too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw problem('Empty message.', 400);
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw problem('Message too large.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw problem('Invalid JSON.', 400);
  }
}

function historyFrom(value = []) {
  if (!Array.isArray(value) || value.length > 8)
    throw problem('Too many previous messages.', 400);
  return value.map((m) => {
    if (
      !m ||
      !uuid.test(m.id) ||
      typeof m.question !== 'string' ||
      m.question.length > 750 ||
      typeof m.answer !== 'string' ||
      m.answer.length > 950 ||
      !Array.isArray(m.sourceIds) ||
      m.sourceIds.length > 3 ||
      m.sourceIds.some(
        (id) => typeof id !== 'string' || !/^[a-z0-9\/-]{1,65}$/i.test(id),
      )
    )
      throw problem('Invalid previous message.', 400);
    return {
      id: m.id,
      question: m.question,
      answer: m.answer,
      citations: m.sourceIds.map((sourceId) => ({ sourceId })),
    };
  });
}

const instructionRequest =
  /\b(?:reveal|show|print|repeat)\s+(?:(?:me|your|the|hidden|internal|secret|system|developer)\s+){1,5}(?:prompt|instructions)\b|\b(?:ignore|override|discard)\s+(?:(?:all|your|the|prior|previous|system|above)\s+){1,4}instructions\b/iu;
const scopeReply = {
  mode: 'scope',
  answer:
    'I can help with buying a home in New Zealand. What would you like to check about a viewing, a document or your next step?',
  citations: [],
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const feedback = url.pathname === '/api/feedback';
  if (!feedback && url.pathname !== '/api/chat')
    return problem('Unknown route.', 404);
  if (request.method !== 'POST')
    return problem('Use POST.', 405, { allow: 'POST' });
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== url.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return problem('Use this site to send the message.', 403);
  // The edge supplies this header. The local proxy shares one development allowance.
  const client = request.headers.get('cf-connecting-ip') || 'local';
  try {
    const { success } = await env.REQUEST_LIMIT.limit({
      key: (feedback ? 'vote:' : 'chat:') + client,
    });
    if (!success)
      return problem('Too many requests. Try again in a minute.', 429, {
        'retry-after': '60',
      });
    const input = await body(request);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return problem('Expected a message.', 400);
    const store = env.QUALITY.getByName('veritas');
    if (feedback) {
      if (
        typeof input.receipt !== 'string' ||
        !uuid.test(input.receipt) ||
        ![-1, 0, 1].includes(input.vote)
      )
        return problem('Invalid vote.', 400);
      return (await store.vote(input.receipt, input.vote))
        ? json({ vote: input.vote })
        : problem('Voting has closed for this answer.', 404);
    }
    const question =
      typeof input.question === 'string' ? input.question.trim() : '';
    if (!question || question.length > 2000)
      return problem('Enter a question of up to 2,000 characters.', 400);
    const history = historyFrom(input.history);
    const context = contextFor(history, question);
    const { allowed, style } = await store.reserve(context.topic);
    if (!allowed) {
      const { message, availability } = dailyChatPause();
      return json({ error: message, availability }, 429);
    }
    async function complete(options) {
      options.signal.throwIfAborted();
      const reply = instructionRequest.test(question)
        ? scopeReply
        : await ask(env, context, style, options);
      options.signal.throwIfAborted();
      const receipt = await store.record(
        reply.mode === 'scope' ? null : context.topic,
        reply.mode,
      );
      return { ...reply, receipt };
    }
    if (request.headers.get('accept')?.includes('application/x-ndjson'))
      return streamReply(request, complete);
    return json(await complete({ signal: request.signal }), 200, {
      vary: 'Accept',
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return problem(requestFailed, 503);
  }
}
