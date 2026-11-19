const sampleRate = 16000;
const seconds = 30;
const abortError = () => new DOMException('Dictation stopped.', 'AbortError');

export async function transcribeSamples(
  samples,
  { lang = 'en-NZ', signal } = {},
) {
  signal?.throwIfAborted();
  if (
    !(samples instanceof Float32Array) ||
    !samples.length ||
    samples.length > sampleRate * seconds
  )
    throw Error('Record up to 30 seconds at a time.');
  if (!samples.some((value) => Math.abs(value) > 0.002))
    throw Error('No speech detected. Try again.');
  const worker = new Worker(
    new URL('./transcribe-worker.js', import.meta.url),
    { type: 'module' },
  );
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(abortError());
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = () =>
        reject(Error('Could not start on-device dictation.'));
      worker.onmessage = ({ data }) => {
        if (!data.text)
          reject(Error(data.error || 'No speech detected. Try again.'));
        else resolve(data.text);
      };
      worker.postMessage({ samples, lang });
    });
  } finally {
    worker.terminate();
    signal?.removeEventListener('abort', abort);
  }
}

// Stop finishes the recording; abort discards it, including any permission
// request that the browser resolves after the person has left the chat.
export function beginDictation({
  lang,
  signal,
  onRecording,
  onProcessing,
} = {}) {
  let stream,
    audio,
    capture,
    timer,
    settled = false,
    processing = false;
  let stop, abort;
  const releaseMic = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
  };
  const closeAudio = () => {
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
  };
  const result = new Promise((resolve, reject) => {
    abort = () => {
      if (settled) return;
      settled = true;
      releaseMic();
      closeAudio();
      reject(abortError());
    };
    function finishRecording() {
      if (processing || settled) return;
      processing = true;
      releaseMic();
      onProcessing?.();
    }
    stop = () => {
      if (processing || settled) return;
      if (!capture) return abort();
      finishRecording();
      capture.port.postMessage('finish');
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    async function start() {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioWorkletNode === 'undefined'
      )
        throw Error('Microphone recording is unavailable in this browser.');
      audio = new AudioContext();
      // Request activation on the initiating click, before awaiting permission.
      const running = audio.resume();
      running.catch(() => {});
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      if (settled) {
        releaseMic();
        return;
      }
      await audio.audioWorklet.addModule(
        new URL('./transcribe-capture.js', import.meta.url),
      );
      await running;
      if (settled) return;
      const source = audio.createMediaStreamSource(stream);
      capture = new AudioWorkletNode(audio, 'veritas-dictation', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      capture.onprocessorerror = () =>
        reject(Error('Could not record from the microphone.'));
      capture.port.onmessage = ({ data: samples }) => {
        if (settled) return;
        finishRecording();
        const rate = audio.sampleRate;
        closeAudio();
        async function transcribe() {
          if (!samples.length) throw Error('No speech detected. Try again.');
          const output = new OfflineAudioContext(
            1,
            Math.ceil((samples.length * sampleRate) / rate),
            sampleRate,
          );
          const buffer = output.createBuffer(1, samples.length, rate);
          buffer.copyToChannel(samples, 0);
          const player = output.createBufferSource();
          player.buffer = buffer;
          player.connect(output.destination);
          player.start();
          const mono = (await output.startRendering()).getChannelData(0);
          signal?.throwIfAborted();
          return transcribeSamples(mono, { lang, signal });
        }
        transcribe().then(resolve, reject);
      };
      source.connect(capture);
      capture.connect(audio.destination);
      timer = setTimeout(stop, seconds * 1000);
      onRecording?.();
    }
    start().catch(reject);
  }).finally(() => {
    settled = true;
    signal?.removeEventListener('abort', abort);
    releaseMic();
    closeAudio();
  });
  return { stop, result };
}
