import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { chromium } from 'playwright';
import { htmlPassages, pdfPassages } from './source-text.mjs';

const catalog = JSON.parse(
  await readFile(new URL('../sources/references.json', import.meta.url)),
);
const target = new URL('../src/guide/reference-index.json', import.meta.url);
const fingerprint = createHash('sha256')
  .update(JSON.stringify(catalog))
  .digest('hex');
const refresh = process.argv.includes('--refresh');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
let previous;
try {
  previous = JSON.parse(await readFile(target));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!refresh && previous?.fingerprint === fingerprint) process.exit(0);

function seed(ref) {
  return {
    id: ref.id,
    checkedOn: ref.checkedOn,
    coverage: 'excerpt',
    passages: [{ heading: '', text: ref.excerpt }],
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
  const response = await fetch(ref.url, {
    signal: AbortSignal.timeout(18000),
    headers: {
      'user-agent': 'HomeVeritas/1.0 (NZ home buying guide reference check)',
    },
  });
  if (!response.ok) throw Error('HTTP ' + response.status);
  const bytes = await response.arrayBuffer();
  const pdf = new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF';
  const { passages } = pdf
    ? await pdfPassages(bytes)
    : await htmlPassages(page, new TextDecoder().decode(bytes));
  if (!passages.some((p) => p.text.includes(ref.excerpt)))
    throw Error('reviewed excerpt absent from article');
  return {
    id: ref.id,
    checkedOn: today,
    coverage: ref.scope === 'excerpt' ? 'excerpt' : 'article',
    passages:
      ref.scope === 'excerpt'
        ? seed(ref).passages
        : uniquePassages([{ heading: '', text: ref.excerpt }, ...passages]),
  };
}
const refs = catalog.filter((ref) => ref.excerpt);
const records = new Map(
  refs.map((ref) => {
    const old =
      previous?.fingerprint === fingerprint &&
      previous.records.find((r) => r.id === ref.id);
    return [ref.id, old || seed(ref)];
  }),
);
if (refresh) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const queue = [...refs];
    const successes = [];
    async function visit() {
      const page = await context.newPage();
      for (let ref; (ref = queue.shift()); ) {
        try {
          records.set(ref.id, await capture(page, ref));
          successes.push(ref.id);
        } catch (error) {
          console.warn(
            ref.title +
              ': ' +
              error.message +
              '; keeping snapshot checked ' +
              records.get(ref.id).checkedOn,
          );
        }
      }
    }
    await Promise.all([visit(), visit(), visit()]);
    console.log(
      'Matched reviewed text on ' +
        successes.length +
        ' of ' +
        refs.length +
        ' pages.',
    );
  } finally {
    await browser.close();
  }
}
const index = { fingerprint, records: [...records.values()] };
const temp = new URL(target.href + '.' + process.pid + '.tmp');
await writeFile(temp, JSON.stringify(index) + '\n');
await rename(temp, target);
console.log(
  index.records.length +
    ' cited pages, ' +
    index.records.reduce((n, r) => n + r.passages.length, 0) +
    ' searchable passages, ' +
    (catalog.length - refs.length) +
    ' lookup links.',
);
