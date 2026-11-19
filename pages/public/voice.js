import { beginDictation } from './transcribe.js';

const byId = (id) => document.getElementById(id);
const dictate = byId('dictate');
const question = byId('question');
const status = byId('voice-status');
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const locale = navigator.language || document.documentElement.lang;
let provider;
let capture;
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
export function stopVoice() {
  stopReading();
  capture?.controller.abort();
  capture = null;
  syncComposerActions();
  status.textContent = '';
}
export function syncComposerActions() {
  const busy = question.readOnly || Boolean(capture);
  byId('send').disabled = busy;
  for (const button of document.querySelectorAll('.starter'))
    button.disabled = busy;
  dictate.disabled = !provider || question.readOnly;
  const listening = capture?.listening === true;
  const label = listening
    ? 'Finish dictation'
    : capture
      ? 'Cancel dictation'
      : 'Dictate message';
  dictate.title = label;
  dictate.setAttribute('aria-label', label);
  dictate.toggleAttribute('data-active', Boolean(capture));
}
function chunks(text) {
  // Short segments also let the listener interrupt a long answer between sentences.
  const sentences = new Intl.Segmenter(locale, {
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
  const requested = locale.toLowerCase();
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
      reject(Error('Your device could not play this reply.'));
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
async function readAloud(text, receipt) {
  stopVoice();
  const controller = new AbortController();
  const { signal } = controller;
  playback = { receipt, controller };
  updatePlayback();
  try {
    // A browser may publish its device voices after this click. Unlock the
    // English fallback here while the user gesture is still active.
    const fallback =
      !deviceVoice() && /^en\b/i.test(locale)
        ? activatePlayer().then(
            () => true,
            () => false,
          )
        : null;
    const voice = await waitForDeviceVoice(signal);
    if (!voice) {
      if (!fallback)
        throw Error('No installed voice matches your browser language.');
      kokoroReady ??= assetsPrepared('/voice-assets/ready.json');
      if (!(await fallback) || !(await kokoroReady))
        throw Error('No voice is available to read this reply.');
      signal.throwIfAborted();
      status.textContent = 'Loading the English voice…';
      kokoroModule ??= await import('./kokoro.js');
    }
    for (const part of chunks(text)) {
      signal.throwIfAborted();
      if (!voice) {
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
    else readAloud(text, receipt);
  });
  return button;
}
async function assetsPrepared(path) {
  // Pages may return index.html with 200 for a missing static asset.
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(5000) });
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
async function prepareMicrophone() {
  const canRecord =
    navigator.mediaDevices?.getUserMedia &&
    window.AudioContext &&
    window.AudioWorkletNode &&
    window.OfflineAudioContext;
  if (canRecord && (await assetsPrepared('/whisper-assets/ready.json'))) {
    provider = 'whisper';
  } else if (Recognition) {
    provider = 'browser';
    byId('dictation-note').hidden = false;
    dictate.setAttribute('aria-describedby', 'dictation-note');
  } else {
    provider = 'unavailable';
  }
  syncComposerActions();
}

function beginBrowserDictation({ signal, onRecording, onProcessing }) {
  const mic = new Recognition();
  mic.lang = locale;
  mic.continuous = false;
  mic.interimResults = false;
  let abort;
  const result = new Promise((resolve, reject) => {
    let transcript = '';
    abort = () => {
      reject(signal.reason);
      mic.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    mic.onstart = onRecording;
    mic.onresult = ({ results }) => {
      transcript = Array.from(results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(' ');
    };
    mic.onerror = ({ error }) => {
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        reject(
          new DOMException('Microphone access is off.', 'NotAllowedError'),
        );
      } else {
        reject(Error('Could not hear a question. Try again or type it.'));
      }
    };
    mic.onend = () => resolve(transcript);
    mic.start();
  }).finally(() => {
    signal.removeEventListener('abort', abort);
    mic.onstart = mic.onend = mic.onresult = mic.onerror = null;
  });
  return {
    result,
    stop() {
      onProcessing();
      mic.stop();
    },
  };
}

function insertTranscript(words) {
  const text = [question.value.trimEnd(), words.trim()]
    .filter(Boolean)
    .join(' ');
  question.value = text.slice(0, question.maxLength);
  question.dispatchEvent(new Event('input', { bubbles: true }));
  status.textContent =
    text.length > question.maxLength
      ? 'Your message reached the character limit. Edit it before sending.'
      : '';
  question.focus({ preventScroll: true });
}

async function startDictation() {
  stopVoice();
  if (provider === 'unavailable') {
    status.textContent =
      'This browser cannot use dictation. You can type your message.';
    question.focus();
    return;
  }
  const current = { controller: new AbortController(), listening: false };
  capture = current;
  syncComposerActions();
  status.textContent = 'Waiting for microphone access…';
  try {
    const begin =
      provider === 'whisper' ? beginDictation : beginBrowserDictation;
    // Start capture inside the click so the browser can request microphone access.
    const session = begin({
      signal: current.controller.signal,
      onRecording() {
        if (capture !== current) return;
        current.listening = true;
        syncComposerActions();
        status.textContent = 'Listening…';
      },
      onProcessing() {
        if (capture !== current) return;
        current.listening = false;
        syncComposerActions();
        status.textContent = 'Transcribing…';
      },
    });
    current.stop = session.stop;
    const words = await session.result;
    if (capture !== current) return;
    if (!words.trim()) throw Error('No speech detected. Try again.');
    insertTranscript(words);
  } catch (error) {
    if (capture === current)
      status.textContent =
        error.name === 'NotAllowedError'
          ? 'Allow microphone access for this site, then tap the microphone again.'
          : error.message || 'Could not start dictation.';
  } finally {
    if (capture === current) {
      capture = null;
      syncComposerActions();
    }
  }
}

dictate.addEventListener('click', () => {
  if (capture?.listening) capture.stop();
  else if (capture) stopVoice();
  else if (!question.readOnly) startDictation();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && capture) {
    event.preventDefault();
    stopVoice();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && capture) stopVoice();
});
window.addEventListener('pagehide', () => {
  stopVoice();
  kokoroModule?.releaseKokoro();
});
prepareMicrophone();
