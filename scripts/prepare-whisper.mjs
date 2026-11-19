// Prepare browser dictation without downloading the optional Kokoro voice.
import { writeFile } from 'node:fs/promises';
import { prepareAssets, runtimeFiles } from './prepare-speech-assets.mjs';

const root = new URL('../pages/public/whisper-assets/', import.meta.url);
const runtimeRoot = new URL('../pages/public/voice-assets/', import.meta.url);
const source =
  'https://huggingface.co/Xenova/whisper-tiny/resolve/5332fcc35e32a33b86612b9a57a89be7906102b1/';
const modelDir = 'models/whisper-tiny/';
const modelFiles = [
  [
    'config.json',
    '2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94',
  ],
  [
    'generation_config.json',
    '68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c',
  ],
  [
    'preprocessor_config.json',
    'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  ],
  [
    'tokenizer.json',
    '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
  ],
  [
    'tokenizer_config.json',
    '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
  ],
  [
    'onnx/encoder_model_quantized.onnx',
    'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
  ],
  [
    'onnx/decoder_model_merged_quantized.onnx',
    '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
  ],
];
const files = [
  ...modelFiles.map(([name, checksum]) => [
    modelDir + name,
    source + name,
    checksum,
  ]),
  [
    'transformers.min.js',
    'https://unpkg.com/@huggingface/transformers@3.5.1/dist/transformers.min.js',
    '79fad8c1c2fd165bf1e77ace20ce023fab4dc13b6621f0e586c9b8c59c4d09d8',
  ],
  [
    'MODEL-CARD.txt',
    source + 'README.md',
    'cdd395427d195f122aee69c00e34183f2fadd8bc217aef35ca7c43395b96d29d',
  ],
  [
    'LICENSE-whisper.txt',
    'https://cdn.jsdelivr.net/gh/openai/whisper@v20250625/LICENSE',
    'b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d',
  ],
];
const parts = ['decoder-0.bin', 'decoder-1.bin'];
await prepareAssets(runtimeRoot, runtimeFiles);
await prepareAssets(root, files, {
  [modelDir + 'onnx/decoder_model_merged_quantized.onnx']: parts,
});
await writeFile(
  new URL('SOURCES.txt', root),
  [
    source,
    ...files.map((row) => row.join('  ')),
    'See /voice-assets/ for Transformers and ONNX Runtime licenses and notices.',
  ].join('\n') + '\n',
);
await writeFile(new URL('ready.json', root), JSON.stringify({ parts }));
console.log('Whisper Tiny dictation ready in pages/public/whisper-assets.');
