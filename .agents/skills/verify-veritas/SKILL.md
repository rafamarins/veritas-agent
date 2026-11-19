---
name: verify-veritas
description: Verify the single-page chat, anonymous feedback and daily answer review.
---

Run `npm test` and `npm run build`. Install the eval tools once with `npm run eval:setup`. With the local app and Ollama running, run `npm run eval`, `npm run test:journey` and the same journey with `-- --webkit`. Inspect the app at desktop and mobile widths.

The browser checks a publisher quote, follow-up after reload, separate browsers, changing and removing a vote, and clearing chat across tabs. Run `npm run test:history` for legacy migration, reopening a chat and isolated follow-up context. Run `npm run test:voice` for the microphone and delayed device-voice events. After `npm run voice:prepare`, run `npm run test:voice -- --kokoro` for non-silent playback and `node test/transcribe.browser.mjs` for a recording transcribed on-device into an editable draft. Repeat both with `--webkit`. Only generate README images with the fictional journey and `-- --screenshots`.

For reference changes, run `npm run references:refresh`. Check a quotation against the publisher and confirm failed fetches keep their earlier check dates. For review changes, configure the local Worker secret `TYPESAFE_API_KEY` and run `npm run review:local`. Check the stored decision and repeat the day to verify idempotence.

Before publication, inspect the tracked files and reachable commit history for local settings, credentials and private transcripts.
