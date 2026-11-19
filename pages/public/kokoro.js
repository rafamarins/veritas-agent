let worker;
let pending;

export function releaseKokoro() {
  if (pending) pending.fail(new DOMException('Speech stopped.', 'AbortError'));
  else {
    worker?.terminate();
    worker = undefined;
  }
}

export async function synthesizeKokoro(text, { signal } = {}) {
  signal?.throwIfAborted();
  if (!text.trim() || text.length > 1500)
    throw Error('Choose a shorter passage to read.');
  if (pending) throw Error('Kokoro is already reading a passage.');
  worker ??= new Worker(new URL('./kokoro-worker.js', import.meta.url), {
    type: 'module',
  });
  const owner = worker;
  return new Promise((resolve, reject) => {
    function cleanup() {
      owner.onerror = null;
      owner.onmessage = null;
      signal?.removeEventListener('abort', abort);
      pending = undefined;
    }
    function fail(error) {
      if (pending?.fail !== fail) return;
      cleanup();
      owner.terminate();
      if (worker === owner) worker = undefined;
      reject(error);
    }
    function abort() {
      fail(new DOMException('Speech stopped.', 'AbortError'));
    }
    pending = { fail };
    signal?.addEventListener('abort', abort, { once: true });
    owner.onerror = () => fail(Error('Could not start the Kokoro voice.'));
    owner.onmessage = ({ data }) => {
      if (pending?.fail !== fail) return;
      if (!(data.audio instanceof Blob)) {
        fail(Error(data.error || 'Kokoro could not read this passage.'));
        return;
      }
      cleanup();
      resolve(data.audio);
    };
    try {
      owner.postMessage(text);
    } catch (error) {
      fail(error);
    }
  });
}
