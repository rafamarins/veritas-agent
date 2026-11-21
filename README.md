# Ask Veritas

Ask Veritas helps people buying a home in New Zealand. Ask what to look for at a viewing, open the passage behind the answer, then come back when the agent sends the paperwork. [Run it locally](#try-it-locally)

In the buying guide, open **Ask Veritas** to ask a question while keeping your place. Close the panel to return to the guide. Reopening it on the same page restores your conversation and any unfinished draft.

## Screenshots

[![Ask Veritas start page with the chat input and suggested questions for a home viewing](docs/ask-veritas.png)](docs/ask-veritas.png)

The buyer saw a garage converted into a bedroom. When they ask about a carport in the council file, Veritas remembers the conversion and quotes MBIE's guidance.

[![Veritas answers the carport follow-up with a quotation from MBIE Building Performance and thumbs-up and thumbs-down buttons](docs/cited-reply.png)](docs/cited-reply.png)

## Try it locally

Use Node.js 24 or 26, npm and an Ollama chat model with JSON output. Start Ollama, then run these commands.

```sh
git clone https://github.com/rafamarins/veritas-agent.git
cd veritas-agent
npm ci
npm run model:local
npm run dev
```

Open [Ask Veritas on localhost](http://127.0.0.1:8794). The setup command lists your installed models and saves your choice in the ignored file `worker/.dev.vars`. The daily Jev review is optional for chat. You can also skip model setup to explore the indexed excerpts. Local development needs no Cloudflare account.

For a faster local demo, install `qwen2.5:7b` with Ollama and choose it during setup. To switch an existing checkout, change `OLLAMA_MODEL` in `worker/.dev.vars` and restart Wrangler. The 7B model gave its first readable words in a median of 2.1 seconds on an M3 Pro, compared with 8.8 seconds for Qwen3.8. It missed some source details in testing. [Model comparison and sample questions](docs/model-comparison.md)

### Try a follow-up

> I saw a garage converted into a bedroom at an open home. Which council records should I ask for?

Open the source under the reply. The quotation links to the publisher and shows its check date. Reload the page and ask this follow-up.

> The council paperwork only mentions a carport. Does that answer my earlier question?

You can read the answer as it arrives. Your browser saves the finished reply and its sources for your next question. Use the thumbs to mark an answer helpful or unhelpful. Click the same thumb again to remove your vote.

**Chat home** lists the conversations saved in this browser, most recent first. Open one to continue it, or choose **New chat** to start with an empty history. Each chat has its own link on this device. **Clear chat** removes the open conversation.

### Dictate a message

Tap the microphone beside **Send** and speak. The first time, allow microphone access in your browser. Tap the stop button to finish. Your words appear in the message box, where you can edit them and send when you're ready. Press **Escape** to discard the recording. To listen to a finished answer, choose **Read aloud** under the reply.

To include on-device speech models, run this once before starting Wrangler or building the Pages site.

```sh
npm run voice:prepare
```

Whisper Tiny detects the spoken language and transcribes up to 30 seconds at a time on your device. First use downloads about 66 MB. **Read aloud** uses a locally installed voice in your browser's language. If an English voice is missing, it can use Kokoro, which downloads about 117 MB on first playback. Both models share a runtime and load from this site. [Whisper Tiny model](https://huggingface.co/openai/whisper-tiny) · [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M)

If on-device dictation is unavailable, supported browsers offer their own speech recognition in the browser's language. A note under the microphone tells you when the browser may use its speech service.

## The guide and its sources

The app uses the Home Veritas artwork, fonts and boxed arrow. Its 52 topic cards and 82 detailed questions cover the buying process. The questions also have Brazilian Portuguese, Spanish and Simplified Chinese versions. [Read the buying guide](https://rafael.co.nz/outros/home-veritas/)

The [catalogue](sources/references.json) covers all 48 references in the guide. A clean checkout includes short, verified quotations from 44 publisher pages and links to four lookup tools. A buyer can use the Auckland Flood Viewer to look up their own address. The chat cannot see that search.

These commands add searchable passages from the publishers.

```sh
npx playwright install chromium
npm run references:refresh
```

The indexer checks each page for its reviewed excerpt before accepting more text. If wording changes or a publisher blocks the fetch, it keeps the last verified text and date. The expanded index stays outside Git. The Worker searches the index when a buyer asks a question.

Each refresh overwrites the local report at `test-results/source-refresh.json`. It lists each checked publisher page, its result, whether its indexed passages changed, and the check dates before and after the run. Use `review-needed` to find the exact reviewed passages that disappeared. Use `fetch-failed` or `extract-failed` to troubleshoot a page that could not be read.

## What lives where

| | What it keeps |
| --- | --- |
| Buyer's browser | Up to 30 chats, each with its latest 30 exchanges, citations, anonymous receipts and votes. An existing single-chat history appears under Your chats. |
| Worker request | The question and up to eight relevant earlier turns from the open chat. Buyer messages and replies do not go into the server database. |
| Cloudflare Durable Object | A random receipt per answer, its public guide topic, answer mode, UTC day and current vote. A receipt identifies one answer. There is no buyer or conversation ID. The daily job removes receipts older than 30 days. |
| Daily review | Copies of generated answers to public guide questions, source IDs, Jev scores, judge model and the decision for each topic. Active answer styles stay available for later requests. |

On localhost, Wrangler emulates Cloudflare storage and Ollama answers on the machine. On Cloudflare, Workers AI runs Llama 3.3 70B. The standalone Pages site calls the Worker through a service binding. The Home Veritas guide binds directly to the same Worker for its chat page, API and speech assets under `/outros/home-veritas/ask/`. Choose **Buying guide** there to return to the topic and language you were reading. Run `npm run voice:prepare` before packaging the Worker for the guide. Both frontends call their own origin.

Workers Free includes 10,000 AI neurons per account per day. A long question with several sources uses more than a short one, so the app's 200-question daily limit cannot guarantee 200 generated answers. If inference runs out of quota, the chat can still return source excerpts. On-device speech uses no AI neurons. An optional local Jev review uses TypeSafe credits separately. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Daily review with Jev

At 04:17 UTC the production Worker deletes receipts, budget counters and review records older than 30 days. Jev is disabled by default in production and local development. If explicitly enabled locally, it reviews up to two public guide questions per run. It starts with topics that received thumbs down or produced source-only answers in the past week. A rotating guide question keeps the review active on quiet days. Each vote can be changed or removed for 30 days.

The Worker answers each public question with two fixed styles. One gives the usual answer. The other starts with what a source establishes. It checks the quotations, then sends the public question, generated answer and cited passages to TypeSafe's System One endpoint at `https://api.typesafe.ai/v1/systemone`. Jev `jev-1.14.0` scores source support and usefulness in one request. A review of two topics uses up to four requests against the configured TypeSafe account. [Jev documentation](https://docs.typesafe.ai/)

The alternate style needs at least 0.85 for support and 0.75 for usefulness. When both answers can be scored, neither score may fall and their combined improvement must reach 0.15. These are initial thresholds for this project. If neither answer meets both thresholds, the run flags the topic for review. A failed judge run keeps the current style. Votes can move a question up the review list. They cannot rewrite prompts or edit guidance.

For a fresh local setup, export `TYPESAFE_API_KEY` from your secret manager before running `npm run model:local`. The setup script writes it to the private, ignored `worker/.dev.vars`. For an existing checkout, add that key to the same file and restart Wrangler. For an intentional local Jev review, enable `ENABLE_JEV_REVIEW` in the local Worker configuration before starting Wrangler, then run `npm run review:local`. Repeating a completed day skips the model calls.

## Chat safeguards

The chat can retrieve passages and write a vote. It cannot run commands, browse buyer-supplied URLs or send messages. The model treats questions, earlier replies and source text as data. The Worker accepts known citation IDs, checks direct quotations and supplies links from the index. The page renders replies as text. If inference or validation fails, it labels the excerpts it can show.

The Worker checks the request origin, JSON size, history length and question length before inference. The edge binding allows 12 requests per client per minute for each route and location. A shared daily limit caps accepted chat requests at 200. The public Worker URL and preview URLs are disabled. Cloudflare's network DDoS protection applies on deployment. The local suite checks the request limits and how the app responds when Cloudflare denies a request. [Rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [DDoS protection](https://developers.cloudflare.com/ddos-protection/)

## Checks and project files

```sh
npm test
npm run build
npx playwright install chromium webkit
npm run test:journey
npm run test:journey -- --webkit
npm run test:history
npm run test:voice
npm run eval:setup
npm run eval
```

With the voice assets prepared, run `npm run test:voice -- --kokoro` to check playback of two sentences and `node test/transcribe.browser.mjs` to dictate a fictional question. Add `--webkit` to either command to check WebKit.

Set `VERITAS_BASE_URL=http://127.0.0.1:8787/outros/home-veritas/ask/` in the environment to run the journeys and evals against the integrated local guide. The build compiles both Cloudflare bundles locally. The browser journeys and three Promptfoo samples need the running app with a local chat model. The samples cover a cited answer, a viewing follow-up and a request outside the agent's role. Eval setup installs a separate locked Promptfoo toolchain and skips optional peer dependencies. The eval command disables sharing, telemetry, caching and saved reports.

| File | What to look for |
| --- | --- |
| [Project prompt history](PROMPTS.md) | Rafael's prompts for this assignment |
| [Chat prompt and output checks](src/assistant.js) | Worker AI binding, local model and citation validation |
| [Retrieval](src/retrieval.js) | How the guide, the index and previous turns inform an answer |
| [Browser chat](pages/public/app.js) and [device history](pages/public/history.js) | Saved chats, migration from the original history, follow-ups and votes |
| [HTTP handler](src/http.js) and [shared storage](src/quality-store.js) | Input limits, receipts, votes and the daily budget |
| [Voice controls](pages/public/voice.js) | Editable dictation and on-device playback |
| [Daily review](src/review.js) and [sample evals](evals/promptfooconfig.yaml) | Jev decisions and reproducible checks |
| [Worker configuration](worker/wrangler.jsonc) and [Pages configuration](pages/wrangler.jsonc) | Llama, Durable Objects, rate limiting, cron and service binding |

[Contributor instructions](AGENTS.md) · [Verification skill](.agents/skills/verify-veritas/SKILL.md)
