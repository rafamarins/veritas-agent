import { ask } from './assistant.js';
import { contextFor, reviewQuestions } from './retrieval.js';

const questions = {
  grounded: {
    type: 'noul',
    instructions:
      'Does the answer limit factual claims to the supplied evidence, with no unsupported legal, financial or property-specific conclusion?',
  },
  useful: {
    type: 'noul',
    instructions:
      'Does the answer address this buyer question and give a useful next step supported by the passages?',
  },
};

export async function judgeAnswer(env, question, reply, sources) {
  if (reply.mode !== 'assistant' || !reply.citations.length) return null;
  const endpoint = new URL(env.KEV_URL);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && local && env.OLLAMA_URL))
  ) {
    throw Error('Invalid reviewer endpoint');
  }
  const evidence = reply.citations.map(
    (c) =>
      sources.find((s) => s.sourceId === c.sourceId && s.text.includes(c.quote))
        ?.text,
  );
  if (evidence.some((text) => !text)) return null;
  const response = await fetch(new URL('/v1/systemone', endpoint), {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
    headers: {
      'content-type': 'application/json',
      ...(env.KEV_TOKEN ? { authorization: 'Bearer ' + env.KEV_TOKEN } : {}),
    },
    body: JSON.stringify({
      model: 'kev-latest',
      questions,
      state: JSON.stringify({ question, answer: reply.answer, evidence }),
    }),
  });
  if (!response.ok) throw Error('Reviewer unavailable');
  const { answers } = await response.json();
  const scores = [answers?.grounded?.noul, answers?.useful?.noul];
  if (!scores.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    throw Error('Invalid reviewer result');
  return { grounded: scores[0], useful: scores[1] };
}

// Votes select public questions to replay. Only the evidence check can change how a topic is answered.
const meetsThreshold = (score) =>
  score && score.grounded >= 0.85 && score.useful >= 0.75;
export function reviewDecision(current, alternate) {
  if (
    meetsThreshold(alternate) &&
    (!current ||
      (alternate.grounded >= current.grounded &&
        alternate.useful >= current.useful &&
        alternate.grounded +
          alternate.useful -
          current.grounded -
          current.useful >=
          0.15))
  )
    return 'promote';
  return meetsThreshold(current) ? 'keep' : 'needs-review';
}

async function evaluate(env, topic, style) {
  const question = reviewQuestions.get(topic);
  const context = contextFor([], question);
  const reply = await ask(env, context, style);
  const scores = await judgeAnswer(env, question, reply, context.sources);
  return {
    style,
    mode: reply.mode,
    answer: reply.answer,
    sourceIds: reply.citations.map((c) => c.sourceId),
    scores,
  };
}

export async function runDailyReview(env, day) {
  const store = env.QUALITY.getByName('veritas');
  const job = await store.beginReview(day);
  if (!job) return 'already-reviewed';
  if (job.running) return 'in-progress';
  const results = [];
  try {
    if (!env.KEV_URL) throw Error('Reviewer unconfigured');
    for (const { topic, style } of job.topics) {
      const current = await evaluate(env, topic, style);
      const alternate = await evaluate(
        env,
        topic,
        style === 'standard' ? 'source-first' : 'standard',
      );
      results.push({
        topic,
        current,
        alternate,
        decision: reviewDecision(current.scores, alternate.scores),
      });
    }
    const saved = await store.completeReview(day, job.id, results, 'complete');
    if (!saved) return 'superseded';
    for (const result of results)
      console.info(
        JSON.stringify({
          day,
          topic: result.topic,
          decision: result.decision,
          current: result.current.scores,
          alternate: result.alternate.scores,
        }),
      );
    return 'complete';
  } catch (error) {
    await store.completeReview(day, job.id, [], 'needs-review');
    throw Error(
      error.message === 'Reviewer unconfigured'
        ? error.message
        : 'Daily review could not finish',
    );
  }
}
