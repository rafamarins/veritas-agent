import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const prompts = createInterface({ input: stdin, output: stdout });
try {
  const input = (
    await prompts.question('Local Ollama URL [http://127.0.0.1:11434]: ')
  ).trim();
  const endpoint = new URL(input || 'http://127.0.0.1:11434');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw Error('Enter a loopback URL without credentials.');
  const response = await fetch(new URL('/api/tags', endpoint), {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('Could not read the local model list.');
  const models = (await response.json()).models.filter(
    (m) => !m.name.includes('embedding'),
  );
  if (!models.length)
    throw Error('Install an Ollama chat model, then run this command again.');
  models.forEach((m, i) => stdout.write(i + 1 + '. ' + m.name + '\n'));
  const index =
    Number((await prompts.question('Chat model [1]: ')).trim() || 1) - 1;
  if (!Number.isInteger(index) || !models[index])
    throw Error('Select a model from the list.');
  const path = new URL('../worker/.dev.vars', import.meta.url);
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(
      'OLLAMA_URL=' +
        JSON.stringify(endpoint.origin) +
        '\nOLLAMA_MODEL=' +
        JSON.stringify(models[index].name) +
        '\n' +
        (process.env.TYPESAFE_API_KEY
          ? 'TYPESAFE_API_KEY=' +
            JSON.stringify(process.env.TYPESAFE_API_KEY) +
            '\n'
          : ''),
    );
  } finally {
    await file.close();
  }
  console.log(
    'Saved local-only settings in worker/.dev.vars. Restart the local server to use them.',
  );
} catch (error) {
  console.error(
    error.code === 'EEXIST'
      ? 'worker/.dev.vars already exists. Edit that local file to change models.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  prompts.close();
}
