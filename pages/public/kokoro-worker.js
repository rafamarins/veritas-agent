// The packaged loader requests Hugging Face URLs for the model and voice. Resolve
// those exact files locally inside this worker; no text or audio goes to a server.
const assets = new URL('/voice-assets/', location.origin);
const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const remotePrefix = 'https://huggingface.co/' + modelId + '/resolve/main/';
const localFetch = self.fetch.bind(self);
let engine;

async function loadEngine() {
  const manifest = await localFetch(new URL('ready.json', assets));
  if (!manifest.ok) throw Error('Kokoro assets are unavailable.');
  const { parts } = await manifest.json();
  if (
    !Array.isArray(parts) ||
    parts.length !== 5 ||
    !parts.every((name, i) => name === 'model-' + i + '.bin')
  )
    throw Error('Invalid voice assets.');

  self.fetch = async (input, options) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      location.href,
    );
    if (url.origin === location.origin) return localFetch(input, options);
    if (!url.href.startsWith(remotePrefix))
      throw Error('Unknown voice resource.');
    const file = url.href.slice(remotePrefix.length);
    if (file === 'onnx/model_quantized.onnx') {
      const contents = [];
      for (const part of parts) {
        const response = await localFetch(new URL(part, assets));
        if (!response.ok) throw Error('Could not load voice weights.');
        contents.push(await response.blob());
      }
      return new Response(new Blob(contents), {
        headers: { 'Content-Length': '92361116' },
      });
    }
    if (
      [
        'tokenizer.json',
        'tokenizer_config.json',
        'config.json',
        'voices/bf_emma.bin',
      ].includes(file)
    )
      return localFetch(new URL(file.split('/').at(-1), assets));
    return new Response(null, { status: 404 });
  };
  const { KokoroTTS, env } = await import('/voice-assets/kokoro.web.js');
  env.wasmPaths = assets.href;
  return KokoroTTS.from_pretrained(modelId, { dtype: 'q8', device: 'wasm' });
}

self.onmessage = async ({ data: text }) => {
  try {
    const tts = await (engine ??= loadEngine());
    const audio = await tts.generate(text, { voice: 'bf_emma' });
    self.postMessage({ audio: audio.toBlob() });
  } catch (error) {
    self.postMessage({ error: 'Kokoro: ' + error.message });
  }
};
