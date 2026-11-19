const byId = (id) => document.getElementById(id);
const toggle = byId('voice-toggle');
const tools = byId('voice-tools');
const engine = byId('voice-engine');
const language = byId('voice-language');
const dictate = byId('dictate');
const question = byId('question');
const status = byId('voice-status');
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let localDictation;
let whisperAvailable = false;
let whisperReady;
let playback;
let kokoroReady;
let kokoroModule;
let player;

function updateListenButton(button) {
  const reading = button.dataset.receipt === playback?.receipt;
  button.textContent = reading ? 'Stop reading' : 'Read aloud';
  button.setAttribute('aria-pressed', String(reading));
}
function updatePlayback() {
  for (const button of document.querySelectorAll('.listen'))
    updateListenButton(button);
}
function stopReading() {
  playback?.controller.abort();
  playback = null;
  updatePlayback();
}
function resetMic() {
  recognition = null;
  dictate.textContent = 'Dictate';
  dictate.setAttribute('aria-pressed', 'false');
}
function stopDictation() {
  const mic = recognition;
  localDictation?.controller.abort();
  localDictation = null;
  resetMic();
  mic?.abort();
}
export function stopVoice() {
  stopReading();
  stopDictation();
  status.textContent = '';
}
function chunks(text) {
  // Short segments also let the listener interrupt a long answer between sentences.
  const sentences = new Intl.Segmenter(language.value, {
    granularity: 'sentence',
  }).segment(text);
  const parts = [];
  for (const { segment } of sentences) {
    let rest = segment.trim();
    while (rest.length > 180) {
      const space = rest.lastIndexOf(' ', 180);
      const end = space > 0 ? space : 180;
      parts.push(rest.slice(0, end));
      rest = rest.slice(end).trimStart();
    }
    if (rest) parts.push(rest);
  }
  return parts;
}
function deviceVoice() {
  const voices =
    window.speechSynthesis?.getVoices().filter((voice) => voice.localService) ||
    [];
  const requested = language.value.toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === requested) ||
    voices.find(
      (voice) =>
        voice.lang.split(/[-_]/)[0].toLowerCase() === requested.split('-')[0],
    )
  );
}
async function waitForDeviceVoice(signal) {
  const synth = window.speechSynthesis;
  const found = deviceVoice();
  if (found || !synth || synth.getVoices().length) return found;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', finish);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 2000);
    synth.addEventListener('voiceschanged', finish);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted || synth.getVoices().length) finish();
  });
  signal.throwIfAborted();
  return deviceVoice();
}
function say(text, voice, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const cancel = () => {
      speechSynthesis.cancel();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    utterance.onend = () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    utterance.onerror = () => {
      signal.removeEventListener('abort', cancel);
      reject(
        Error(
          'Your device could not play this voice. Try another playback option.',
        ),
      );
    };
    speechSynthesis.speak(utterance);
  });
}
// Unlock playback inside the user's click. Kokoro may take several seconds to load.
function activatePlayer() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context)
    return Promise.reject(Error('This browser cannot play the Kokoro voice.'));
  player ??= new Context();
  return player.resume();
}
async function playAudio(blob, signal) {
  const samples = await player.decodeAudioData(await blob.arrayBuffer());
  signal.throwIfAborted();
  const source = player.createBufferSource();
  source.buffer = samples;
  source.connect(player.destination);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      source.onended = null;
      source.stop();
      source.disconnect();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    source.onended = () => {
      signal.removeEventListener('abort', cancel);
      source.disconnect();
      resolve();
    };
    source.start();
  });
}
async function readAloud(text, receipt, manual = false) {
  stopVoice();
  const controller = new AbortController();
  const { signal } = controller;
  playback = { receipt, controller };
  updatePlayback();
  try {
    const kokoro = engine.value === 'kokoro';
    let voice;
    if (kokoro) {
      if (manual) await activatePlayer();
      signal.throwIfAborted();
      if (player?.state !== 'running')
        throw Error('Tap Read aloud on the reply to start playback.');
      status.textContent = 'Loading the English voice…';
      kokoroModule ??= await import('./kokoro.js');
    } else {
      voice = await waitForDeviceVoice(signal);
      if (!voice)
        throw Error(
          'No installed voice matches this language. Choose another voice under Voice.',
        );
    }
    for (const part of chunks(text)) {
      signal.throwIfAborted();
      if (kokoro) {
        const audio = await kokoroModule.synthesizeKokoro(part, { signal });
        signal.throwIfAborted();
        status.textContent = '';
        await playAudio(audio, signal);
      } else {
        await say(part, voice, signal);
      }
    }
  } catch (error) {
    if (!signal.aborted)
      status.textContent = error.message || 'Could not play the reply.';
  } finally {
    if (playback?.controller === controller) {
      playback = null;
      updatePlayback();
    }
  }
}
export function listenButton(text, receipt) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'listen';
  button.dataset.receipt = receipt;
  updateListenButton(button);
  button.addEventListener('click', () => {
    if (playback?.receipt === receipt) stopVoice();
    else readAloud(text, receipt, true);
  });
  return button;
}
export function finishVoiceReply(text, receipt) {
  if (!tools.hidden && byId('auto-read').checked) readAloud(text, receipt);
}
async function updateEngines() {
  const available = await kokoroReady;
  const option = engine.querySelector('[value="kokoro"]');
  option.disabled = option.hidden =
    !available || !language.value.startsWith('en');
  if (option.disabled) engine.value = 'device';
  byId('kokoro-note').hidden = engine.value !== 'kokoro';
}
async function assetsPrepared(path) {
  // Pages may return index.html with 200 for a missing static asset.
  try {
    const response = await fetch(path);
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    )
      return false;
    const manifest = await response.json();
    return Array.isArray(manifest?.parts) && manifest.parts.length > 0;
  } catch {
    return false;
  }
}
function describeDictation() {
  dictate.disabled = !whisperAvailable && !Recognition;
  if (whisperAvailable) {
    byId('dictation-note').textContent =
      'Whisper downloads about 66 MB on first use. Record up to 30 seconds on this device.';
  } else {
    byId('dictation-note').textContent = Recognition
      ? 'Your browser may use its speech service for dictation.'
      : 'This browser does not offer dictation. You can type a question and listen to the reply.';
  }
}
toggle.addEventListener('click', () => {
  tools.hidden = !tools.hidden;
  toggle.setAttribute('aria-expanded', String(!tools.hidden));
  if (tools.hidden) {
    stopVoice();
    kokoroModule?.releaseKokoro();
    return;
  }
  window.speechSynthesis?.getVoices();
  kokoroReady ??= assetsPrepared('/voice-assets/ready.json');
  if (
    navigator.mediaDevices?.getUserMedia &&
    window.AudioContext &&
    window.AudioWorkletNode &&
    window.OfflineAudioContext
  ) {
    dictate.disabled = true;
    byId('dictation-note').textContent = 'Checking for on-device dictation…';
    whisperReady ??= assetsPrepared('/whisper-assets/ready.json');
    whisperReady.then((ready) => {
      whisperAvailable = ready;
      describeDictation();
    });
  }
  updateEngines();
});
language.addEventListener('change', () => {
  stopVoice();
  updateEngines();
});
function primeSelectedVoice() {
  if (engine.value === 'kokoro') activatePlayer().catch(() => {});
}
engine.addEventListener('change', () => {
  stopVoice();
  if (engine.value === 'device') kokoroModule?.releaseKokoro();
  primeSelectedVoice();
  updateEngines();
});
byId('composer').addEventListener(
  'submit',
  () => {
    if (!tools.hidden && byId('auto-read').checked) primeSelectedVoice();
  },
  true,
);
window.speechSynthesis?.getVoices();
byId('auto-read').addEventListener('change', () => {
  if (!byId('auto-read').checked) stopReading();
});
function insertTranscript(words) {
  const text = [question.value.trimEnd(), words.trim()]
    .filter(Boolean)
    .join(' ');
  question.value = text.slice(0, question.maxLength);
  question.dispatchEvent(new Event('input', { bubbles: true }));
  status.textContent =
    text.length > question.maxLength
      ? 'Your question reached the character limit. Edit it before sending.'
      : 'Review your question, then send it.';
  question.focus({ preventScroll: true });
}
async function dictateOnDevice() {
  const controller = new AbortController();
  const current = { controller };
  localDictation = current;
  dictate.textContent = 'Cancel';
  status.textContent = 'Waiting for microphone access…';
  try {
    const { beginDictation } = await import('./transcribe.js');
    controller.signal.throwIfAborted();
    const session = beginDictation({
      lang: language.value,
      signal: controller.signal,
      onRecording() {
        current.recording = true;
        dictate.textContent = 'Finish dictation';
        dictate.setAttribute('aria-pressed', 'true');
        status.textContent = 'Listening…';
      },
      onProcessing() {
        current.recording = false;
        dictate.textContent = 'Cancel';
        dictate.setAttribute('aria-pressed', 'false');
        status.textContent = 'Transcribing on this device…';
      },
    });
    current.stop = session.stop;
    const transcript = await session.result;
    controller.signal.throwIfAborted();
    if (!transcript.trim())
      throw Error('No speech was detected. Try again or type your question.');
    if (!question.readOnly) insertTranscript(transcript);
  } catch (error) {
    if (!controller.signal.aborted)
      status.textContent =
        error.name === 'NotAllowedError'
          ? 'Microphone access is off. Allow it in your browser or type your question.'
          : error.message || 'Dictation could not start.';
  } finally {
    if (localDictation === current) {
      localDictation = null;
      resetMic();
    }
  }
}
describeDictation();
dictate.addEventListener('click', () => {
  if (localDictation) {
    if (localDictation.recording) localDictation.stop();
    else stopVoice();
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }
  if (question.readOnly) return;
  stopVoice();
  if (whisperAvailable) {
    dictateOnDevice();
    return;
  }
  if (!Recognition) return;
  const mic = new Recognition();
  recognition = mic;
  mic.lang = language.value;
  mic.continuous = false;
  mic.interimResults = false;
  mic.onstart = () => {
    if (recognition !== mic) return;
    dictate.textContent = 'Finish dictation';
    dictate.setAttribute('aria-pressed', 'true');
    status.textContent = 'Listening…';
  };
  mic.onresult = (event) => {
    if (recognition !== mic || question.readOnly) return;
    const words = Array.from(event.results)
      .slice(event.resultIndex)
      .filter((result) => result.isFinal)
      .map((result) => result[0].transcript)
      .join(' ');
    if (words.trim()) insertTranscript(words);
  };
  mic.onerror = (event) => {
    if (recognition !== mic) return;
    status.textContent =
      event.error === 'not-allowed'
        ? 'Microphone access is off. Allow it in your browser or type your question.'
        : 'Could not hear a question. Try dictating again or type it.';
  };
  mic.onend = () => {
    if (recognition !== mic) return;
    resetMic();
    if (status.textContent === 'Listening…') status.textContent = '';
  };
  try {
    mic.start();
  } catch {
    resetMic();
    status.textContent = 'Dictation could not start in this browser.';
  }
});
window.addEventListener('pagehide', () => {
  stopVoice();
  kokoroModule?.releaseKokoro();
});
