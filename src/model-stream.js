import { lines } from '../pages/public/stream.js';

// Workers AI sends server-sent events. Ollama sends one JSON object per line.
export async function* modelText(body, provider, signal) {
  for await (const line of lines(body, signal)) {
    if (provider === 'ollama') {
      const token = JSON.parse(line);
      if (token.error || token.done_reason === 'length')
        throw Error('Local inference failed');
      if (typeof token.message?.content === 'string' && token.message.content)
        yield token.message.content;
      if (token.done === true) return;
    } else if (line.startsWith('data:')) {
      const data = line.slice(5).trimStart();
      if (data === '[DONE]') return;
      const token = JSON.parse(data);
      if (token.error) {
        const code = token.error.internalCode ?? token.error.code ?? token.code;
        const message = token.error.message ?? token.error;
        throw Error(code ? `${code}: ${message}` : message);
      }
      if (token.finish_reason === 'length') throw Error('Workers AI inference failed');
      if (typeof token.response === 'string' && token.response)
        yield token.response;
    }
  }
  throw Error('Inference ended without a final record');
}
