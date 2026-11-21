// The browser journeys and evals use fictional questions against the local preview.
export const appURL = new URL(
  process.env.VERITAS_BASE_URL || 'http://127.0.0.1:8794/',
);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(appURL.hostname) ||
  !['http:', 'https:'].includes(appURL.protocol)
)
  throw Error('VERITAS_BASE_URL must point to a local preview.');
if (!appURL.pathname.endsWith('/')) appURL.pathname += '/';
