import { env, pipeline } from '/whisper-assets/transformers.min.js';

const base = new URL('/whisper-assets/', location.origin);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', base).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL(
  '/voice-assets/',
  location.origin,
).href;

const decoder = new URL(
  'models/whisper-tiny/onnx/decoder_model_merged_quantized.onnx',
  base,
);
const assetFetch = self.fetch.bind(self);
self.fetch = async (input, options) => {
  const url = new URL(
    input instanceof Request ? input.url : input,
    location.href,
  );
  if (url.origin !== location.origin)
    throw Error('Unknown dictation resource.');
  if (url.href !== decoder.href) return assetFetch(input, options);
  const chunks = [];
  for (const name of ['decoder-0.bin', 'decoder-1.bin']) {
    const response = await assetFetch(new URL(name, base));
    if (!response.ok) throw Error('Could not load Whisper weights.');
    chunks.push(await response.blob());
  }
  return new Response(new Blob(chunks), {
    headers: { 'Content-Length': '30727765' },
  });
};

self.onmessage = async ({ data: { samples, lang } }) => {
  try {
    const model = await pipeline(
      'automatic-speech-recognition',
      'whisper-tiny',
      { device: 'wasm', dtype: 'q8' },
    );
    const answer = await model(samples, {
      language: lang.split('-')[0],
      task: 'transcribe',
    });
    self.postMessage({ text: answer.text.trim() });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
