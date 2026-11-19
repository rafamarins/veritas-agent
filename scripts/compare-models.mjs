import { ask } from '../src/assistant.js';
import { contextFor } from '../src/retrieval.js';

const [endpoint, ...models] = process.argv.slice(2);
if (!models.length) {
  throw Error(
    'Usage: node scripts/compare-models.mjs <loopback Ollama URL> <model> [model...]',
  );
}
const url = new URL(endpoint);
if (
  url.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
) {
  throw Error('Use a local Ollama server.');
}

const previous = [
  {
    id: '62f1f206-8bc3-4264-8482-041742436c74',
    question:
      'I saw a garage converted into a bedroom. Which council records should I ask for?',
    answer: 'Compare the council plans with the work you saw.',
    citations: [{ sourceId: 'ref-9' }],
  },
];
const samples = [
  ['LIM', 'What does a LIM tell me about a house?'],
  [
    'Follow-up',
    'The council paperwork only mentions a carport. Does that answer my earlier question?',
    previous,
  ],
  ['Portuguese', 'Aluguel é mesmo dinheiro jogado fora?'],
  [
    'Portuguese free-form',
    'Estou vendo uma casa em Auckland. O que posso descobrir com um LIM e o que ele deixa de fora?',
  ],
  ['Spanish', '¿Alquilar es realmente tirar el dinero?'],
  ['Chinese', '租房真的是在浪费钱吗？'],
  [
    'Missing evidence',
    'Can you confirm that the insurer has already approved cover for my particular house?',
  ],
];

for (const model of models) {
  // Load the weights and context at the same capacity as chat, without caching a test prompt.
  const warmup = await fetch(new URL('/api/chat', url), {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages: [],
      options: { num_ctx: 16384 },
      stream: false,
    }),
  });
  if (!warmup.ok) throw Error(model + ' warmup failed: ' + warmup.status);
  await warmup.json();
  for (const [sample, question, history = []] of samples) {
    const start = performance.now();
    let firstTextMs = null;
    const env = { OLLAMA_URL: endpoint, OLLAMA_MODEL: model };
    const context = contextFor(history, question);
    const reply = await ask(env, context, 'standard', {
      onText() {
        firstTextMs ??= Math.round(performance.now() - start);
      },
    });
    const totalMs = Math.round(performance.now() - start);
    console.log(
      JSON.stringify({
        model,
        sample,
        firstTextMs,
        totalMs,
        mode: reply.mode,
        answer: reply.answer,
        citations: reply.citations.map(({ sourceId, quote }) => ({
          sourceId,
          quote,
        })),
      }),
    );
  }
}
