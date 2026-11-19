import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const npm = 'https://unpkg.com/';
const runtime = npm + '@huggingface/transformers@3.5.1/dist/';
export const runtimeFiles = [
  [
    'ort-wasm-simd-threaded.jsep.mjs',
    runtime + 'ort-wasm-simd-threaded.jsep.mjs',
    '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9',
  ],
  [
    'ort-wasm-simd-threaded.jsep.wasm',
    runtime + 'ort-wasm-simd-threaded.jsep.wasm',
    'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39',
  ],
  [
    'LICENSE-transformers.txt',
    npm + '@huggingface/transformers@3.5.1/LICENSE',
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  ],
  [
    'LICENSE-onnxruntime.txt',
    'https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v1.21.0/LICENSE',
    '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
  ],
  [
    'NOTICES-onnxruntime.txt',
    'https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v1.21.0/ThirdPartyNotices.txt',
    '8c06e8cff286a4a117b3b246a4c7da68428a144af757823db50e3d6520941ec6',
  ],
];
const chunkBytes = 20 * 1024 * 1024;

// Check the digest across all parts. A partial download is never marked ready.
export async function prepareAssets(root, files, splits = {}) {
  for (const [name, url, expected] of files) {
    const targets = (splits[name] ?? [name]).map((part) => new URL(part, root));
    const existing = createHash('sha256');
    for (const target of targets) {
      existing.update(
        await readFile(target).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        }),
      );
    }
    if (existing.digest('hex') === expected) continue;
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok)
      throw Error('Could not download ' + name + ': ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw Error('Checksum mismatch for ' + name);
    if (splits[name] && targets.length !== Math.ceil(bytes.length / chunkBytes))
      throw Error('Unexpected part count for ' + name);
    for (const [i, target] of targets.entries()) {
      const part = splits[name]
        ? bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes)
        : bytes;
      if (part.length > 25 * 1024 * 1024)
        throw Error('Asset exceeds the Pages file limit: ' + name);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, part);
    }
  }
}
