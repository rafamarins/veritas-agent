import { env, pipeline } from './whisper-assets/transformers.min.js';

const base = new URL('./whisper-assets/', import.meta.url);
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', base).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL(
  './voice-assets/',
  import.meta.url,
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

// Transformers.js 3.5.1 otherwise inserts an English language token.
// Let Whisper choose its language token, then transcribe without timestamps.
function spokenLanguage(config) {
  const prefix = [
    Object.values(config.lang_to_id),
    [config.task_to_id.transcribe],
    [config.no_timestamps_token_id],
  ];
  function selectPrefix([tokens], scores) {
    const allowed = prefix[tokens.length - 1];
    if (!allowed) return scores;
    const logits = scores.data;
    const token = allowed.reduce((best, id) =>
      logits[id] > logits[best] ? id : best,
    );
    logits.fill(-Infinity);
    logits[token] = 0;
    return scores;
  }
  return {
    decoder_input_ids: [config.decoder_start_token_id],
    logits_processor: [selectPrefix],
  };
}

self.onmessage = async ({ data: { samples } }) => {
  try {
    const model = await pipeline(
      'automatic-speech-recognition',
      'whisper-tiny',
      { device: 'wasm', dtype: 'q8' },
    );
    const answer = await model(
      samples,
      spokenLanguage(model.model.generation_config),
    );
    self.postMessage({ text: answer.text.trim() });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
