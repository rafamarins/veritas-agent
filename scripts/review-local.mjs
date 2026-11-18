// Local Explorer targets the Worker inside the running Pages dev session.
const input = process.argv[2];
const requested = input ? new Date(input + 'T04:17:00Z') : new Date();
if (
  Number.isNaN(requested.getTime()) ||
  (input && requested.toISOString().slice(0, 10) !== input)
)
  throw Error('Use a UTC date in YYYY-MM-DD format.');
const response = await fetch(
  'http://127.0.0.1:8794/cdn-cgi/local/explorer/api/local/scheduled?worker=veritas-agent',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(650000),
    body: JSON.stringify({
      cron: '17 4 * * *',
      scheduled_time: requested.getTime(),
    }),
  },
);
if (!response.ok)
  throw Error(
    'Wrangler could not dispatch the review. Check the local server, then retry.',
  );
const result = await response.json();
if (!result.success || result.result?.outcome !== 'ok')
  throw Error(
    'The daily handler failed. Check the Worker output for the review status.',
  );
console.log(
  'Wrangler finished the scheduled invocation for ' +
    requested.toISOString().slice(0, 10) +
    '. See the Worker output for the decision.',
);
