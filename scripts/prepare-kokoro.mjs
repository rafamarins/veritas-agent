// Self-host only the English voice and CPU runtime used by the browser worker.
import { prepareAssets, runtimeFiles } from './prepare-speech-assets.mjs';
import { writeFile } from 'node:fs/promises';

const root = new URL('../pages/public/voice-assets/', import.meta.url);
const model =
  'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';
const npm = 'https://unpkg.com/';
const files = [
  ...runtimeFiles,
  [
    'kokoro.web.js',
    npm + 'kokoro-js@1.2.1/dist/kokoro.web.js',
    '6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f',
  ],
  [
    'bf_emma.bin',
    model + 'voices/bf_emma.bin',
    '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
  ],
  [
    'config.json',
    model + 'config.json',
    'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  ],
  [
    'tokenizer.json',
    model + 'tokenizer.json',
    '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34',
  ],
  [
    'tokenizer_config.json',
    model + 'tokenizer_config.json',
    'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
  ],
  [
    'model',
    model + 'onnx/model_quantized.onnx',
    'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
  ],
  [
    'MODEL-CARD.txt',
    model + 'README.md',
    'b8fd888b4782f4d4ae85e2f1587cafd727037f4f138f72429ef1bd5908c0e9d8',
  ],
  [
    'LICENSE-kokoro.txt',
    npm + 'kokoro-js@1.2.1/LICENSE',
    'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  ],
  [
    'LICENSE-phonemizer.txt',
    npm + 'phonemizer@1.2.1/LICENSE',
    'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  ],
  [
    'LICENSE-espeak-ng.txt',
    'https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.52.0/COPYING',
    '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
  ],
];
const parts = Array.from({ length: 5 }, (_, i) => `model-${i}.bin`);
await prepareAssets(root, files, { model: parts });
await writeFile(
  new URL('SOURCES.txt', root),
  [
    'Kokoro 82M v1.0 ONNX weights and bf_emma voice: Apache-2.0. See MODEL-CARD.txt and LICENSE-kokoro.txt.',
    model,
    'Kokoro.js browser distribution: https://github.com/hexgrad/kokoro/tree/main/kokoro.js',
    'English phonemization: https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278',
    'eSpeak NG: https://github.com/espeak-ng/espeak-ng (see LICENSE-espeak-ng.txt).',
    'Transformers.js: https://github.com/huggingface/transformers.js/tree/3.5.1',
    'ONNX Runtime Web: https://github.com/microsoft/onnxruntime/tree/v1.21.0',
    ...files.map(([name, url, checksum]) => [name, checksum, url].join('  ')),
  ].join('\n') + '\n',
);
await writeFile(new URL('ready.json', root), JSON.stringify({ parts }));
console.log('English Kokoro voice ready in pages/public/voice-assets.');
