import { readFile } from 'node:fs/promises';
import { appURL } from '../test/local-app.mjs';
import { readChat } from '../pages/public/stream.js';
const index = JSON.parse(
  await readFile(new URL('../src/guide/reference-index.json', import.meta.url)),
);
const catalogue = JSON.parse(
  await readFile(new URL('../sources/references.json', import.meta.url)),
);

export default class VeritasProvider {
  id() {
    return 'veritas-agent-local';
  }
  async callApi(question, context) {
    const response = await fetch(new URL('api/chat', appURL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      redirect: 'error',
      body: JSON.stringify({ question, history: context.vars.history ?? [] }),
      signal: AbortSignal.timeout(145000),
    });
    if (!response.ok)
      return { error: 'Local chat returned HTTP ' + response.status };
    const { mode, answer, citations } = await readChat(response.body);
    const verified = citations.filter(
      (c) =>
        c.kind === 'reference' &&
        catalogue.some((r) => r.id === c.sourceId && r.url === c.url) &&
        index.records
          .find((r) => r.id === c.sourceId)
          ?.passages.some((p) => c.quote && p.text.includes(c.quote)),
    );
    return {
      output: JSON.stringify({
        mode,
        answer,
        publisherQuotes: verified.length,
      }),
    };
  }
}
