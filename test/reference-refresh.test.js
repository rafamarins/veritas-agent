import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('a failed refresh keeps unchanged sources across catalogue edits and reports actual changes', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'veritas-reference-refresh-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const write = (name, value) => writeFile(join(cwd, name), JSON.stringify(value));
  const read = async (name) => JSON.parse(await readFile(join(cwd, name), 'utf8'));

  await Promise.all(['scripts', 'sources', 'src/guide', 'node_modules/playwright'].map(
    (dir) => mkdir(join(cwd, dir), { recursive: true }),
  ));
  for (const script of ['index-references.mjs', 'source-text.mjs']) {
    await copyFile(new URL('../scripts/' + script, import.meta.url), join(cwd, 'scripts', script));
  }
  await write('node_modules/playwright/package.json', { exports: './index.mjs' });
  await writeFile(join(cwd, 'node_modules/playwright/index.mjs'), `
    export const chromium = {
      launch: async () => ({
        close: async () => {},
        newContext: async () => ({
          route: async () => {},
          newPage: async () => ({}),
        }),
      }),
    };
  `);
  await writeFile(join(cwd, 'offline.mjs'),
    "globalThis.fetch = async () => new Response('', { status: 503 });");
  const refresh = (...flags) =>
    run(process.execPath, ['--import', './offline.mjs', 'scripts/index-references.mjs', ...flags], { cwd });

  const sources = ['unchanged', 'repointed'].map((id) => ({
    id,
    title: id,
    url: 'https://fixture.invalid/' + id,
    excerpt: 'Verified wording from this publisher’s page.',
    checkedOn: '2026-01-01',
  }));
  const lookup = { id: 'lookup', kind: 'lookup', title: 'Original lookup title' };
  const catalogue = [...sources, lookup];
  const fingerprint = createHash('sha256').update(JSON.stringify(catalogue)).digest('hex');
  const records = sources.map(({ id, excerpt }) => ({
    id,
    checkedOn: '2026-10-01',
    coverage: 'article',
    passages: [
      { heading: '', text: excerpt },
      { heading: 'More', text: 'Expanded text from the previously verified URL.' },
    ],
  }));
  const indexPath = 'src/guide/reference-index.json';
  await write(indexPath, { fingerprint, records });
  await write('sources/references.json', catalogue);
  await write('sources/reviewed-passages.json', {});
  await refresh();

  const newUrl = 'https://fixture.invalid/replacement';
  await write('sources/references.json', [
    sources[0],
    { ...sources[1], url: newUrl },
    { ...lookup, title: 'Updated lookup title' },
  ]);
  await refresh('--refresh');

  const index = await read(indexPath);
  const report = await read('test-results/source-refresh.json');
  assert.deepEqual(index.records[0], { ...records[0], url: sources[0].url });
  assert.deepEqual(index.records[1], {
    id: sources[1].id,
    url: newUrl,
    checkedOn: sources[1].checkedOn,
    coverage: 'excerpt',
    passages: [{ heading: '', text: sources[1].excerpt }],
  });
  assert.deepEqual(
    report.sources.map(({ status, previousCheckedOn, checkedOn, passagesChanged }) =>
      ({ status, previousCheckedOn, checkedOn, passagesChanged })),
    [
      {
        status: 'fetch-failed',
        previousCheckedOn: '2026-10-01',
        checkedOn: '2026-10-01',
        passagesChanged: false,
      },
      {
        status: 'fetch-failed',
        previousCheckedOn: '2026-10-01',
        checkedOn: '2026-01-01',
        passagesChanged: true,
      },
    ],
  );
});
