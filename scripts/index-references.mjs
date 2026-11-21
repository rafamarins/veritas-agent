import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { chromium } from 'playwright';
import reviewedPassages from '../sources/reviewed-passages.json' with { type: 'json' };
import { htmlPassages, pdfPassages } from './source-text.mjs';

const catalog = JSON.parse(
  await readFile(new URL('../sources/references.json', import.meta.url)),
);
const target = new URL('../src/guide/reference-index.json', import.meta.url);
const fingerprint = createHash('sha256')
  .update(JSON.stringify(catalog))
  .digest('hex');
const refresh = process.argv.includes('--refresh');
const startedAt = new Date();
const results = new Map();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(startedAt);
let previous;
try {
  previous = JSON.parse(await readFile(target));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function seed(ref) {
  return {
    id: ref.id,
    checkedOn: ref.checkedOn,
    coverage: 'excerpt',
    passages: [{ heading: '', text: ref.excerpt }, ...(reviewedPassages[ref.id] ?? [])],
  };
}
function uniquePassages(rows) {
  const seen = new Set();
  return rows.filter(({ text, heading }) => {
    if (
      seen.has(text) ||
      /newsletter|feedback on this page|related (articles|links)|share this page/i.test(
        heading,
      )
    )
      return false;
    seen.add(text);
    return true;
  });
}
async function capture(page, ref) {
  let bytes;
  try {
    const response = await fetch(ref.url, {
      signal: AbortSignal.timeout(18000),
      headers: {
        'user-agent': 'HomeVeritas/1.0 (NZ home buying guide reference check)',
      },
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    bytes = await response.arrayBuffer();
  } catch (error) {
    return { status: 'fetch-failed', reason: error.cause?.message ?? error.message };
  }
  let passages;
  try {
    const pdf = new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF';
    ({ passages } = pdf
      ? await pdfPassages(bytes)
      : await htmlPassages(page, new TextDecoder().decode(bytes)));
  } catch (error) {
    return { status: 'extract-failed', reason: error.message };
  }
  const missing = seed(ref).passages.filter(
    (reviewed) => !passages.some((p) => p.text.includes(reviewed.text)),
  );
  if (missing.length) {
    return {
      status: 'review-needed',
      reason: 'reviewed excerpt absent from article',
      missingPassages: missing,
    };
  }
  return {
    status: 'refreshed',
    record: {
      id: ref.id,
      checkedOn: today,
      coverage: ref.scope === 'excerpt' ? 'excerpt' : 'article',
      passages:
        ref.scope === 'excerpt'
          ? seed(ref).passages
          : uniquePassages([{ heading: '', text: ref.excerpt }, ...passages]),
    },
  };
}
const refs = catalog.filter((ref) => ref.excerpt);
const records = new Map(
  refs.map((ref) => {
    const old =
      previous?.fingerprint === fingerprint &&
      previous.records.find((r) => r.id === ref.id);
    if (!old) return [ref.id, seed(ref)];
    const missing = (reviewedPassages[ref.id] ?? []).filter(
      (reviewed) => !old.passages.some((p) => p.text.includes(reviewed.text)),
    );
    if (!missing.length) return [ref.id, old];
    const additions = missing.map((p) => ({ ...p, checkedOn: ref.checkedOn }));
    return [ref.id, { ...old, passages: [...old.passages, ...additions] }];
  }),
);
// Expanded snapshots keep their original passages and are reused when already complete.
if (
  !refresh &&
  previous?.fingerprint === fingerprint &&
  previous.records.length === records.size &&
  previous.records.every((r) => records.get(r.id) === r)
) process.exit(0);
if (refresh) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const queue = [...refs];
    async function visit() {
      const page = await context.newPage();
      for (let ref; (ref = queue.shift()); ) {
        const before = records.get(ref.id);
        const { record, ...outcome } = await capture(page, ref);
        if (record) {
          records.set(ref.id, record);
        } else {
          console.warn(
            `${ref.title}: ${outcome.reason}; keeping snapshot checked ${before.checkedOn}`,
          );
        }
        const after = records.get(ref.id);
        results.set(ref.id, {
          id: ref.id,
          title: ref.title,
          url: ref.url,
          ...outcome,
          previousCheckedOn: before.checkedOn,
          checkedOn: after.checkedOn,
          coverage: after.coverage,
          passagesChanged:
            after.passages.length !== before.passages.length ||
            after.passages.some(
              (passage, i) =>
                passage.heading !== before.passages[i].heading ||
                passage.text !== before.passages[i].text,
            ),
        });
      }
    }
    await Promise.all([visit(), visit(), visit()]);
  } finally {
    await browser.close();
  }
}
const index = { fingerprint, records: [...records.values()] };
async function writeJson(file, value, spacing) {
  const temp = new URL(file.href + '.' + process.pid + '.tmp');
  await writeFile(temp, JSON.stringify(value, null, spacing) + '\n');
  await rename(temp, file);
}
await writeJson(target, index);
if (refresh) {
  const directory = new URL('../test-results/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const sources = refs.map((ref) => results.get(ref.id));
  await writeJson(
    new URL('source-refresh.json', directory),
    { startedAt: startedAt.toISOString(), sources },
    2,
  );
  const matched = sources.filter((source) => source.status === 'refreshed').length;
  console.log(`Matched reviewed text on ${matched} of ${sources.length} pages.`);
  console.log('Report: test-results/source-refresh.json');
}
console.log(
  index.records.length +
    ' cited pages, ' +
    index.records.reduce((n, r) => n + r.passages.length, 0) +
    ' searchable passages, ' +
    (catalog.length - refs.length) +
    ' lookup links.',
);
