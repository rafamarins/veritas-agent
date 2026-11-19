# Local chat model comparison

Ask Veritas retrieves the same publisher passages regardless of the model. The model still needs to select relevant citations, interpret a follow-up and recognise when a source cannot answer the question.

For an English local demo, use Qwen2.5 7B Instruct. Across these four questions its median time to first text was 2.1 seconds and it finished in 6.1 seconds. Qwen3.8 took 8.8 and 18.7 seconds. The original prompt produced an English answer to a Portuguese question on the 7B model. The revised prompt corrected the language in a seven-question follow-up. The smaller model still made an unsupported claim about council records in Portuguese. The comparison supports a fast local demo option. It does not establish equivalent accuracy on the whole guide.

## Reproduce

Start Ollama and install the models you want to compare. Generate the local source index, then run the comparison from the repository root.

```sh
npm ci
node scripts/index-references.mjs
ollama pull qwen2.5:7b
node scripts/compare-models.mjs http://127.0.0.1:11434 qwen2.5:7b
```

Pass additional installed model names after the endpoint to compare them in order. Each JSON line includes the complete answer and the excerpts the interface would display. The script preloads each model with an empty conversation, then runs public examples through the real retrieval, streaming, citation checks and fallback. The first-text time ends at the first validated answer fragment. An answer without a fragment has no first-text time. Browser rendering, network travel to Cloudflare and model loading are outside these timings.

## Original four-question benchmark on 19 November 2026

Apple M3 Pro, 36 GiB unified memory, Ollama 0.40.16. Each model saw the questions once in the same order, using the same index, 16,384-token context capacity, temperature zero and a 650-token generation cap. Each cell shows seconds to first readable text / to finished reply. A dash means the app returned its source excerpts without a generated answer.

| Ollama model | LIM report | Carport follow-up | Portuguese rent question | Unknown insurance approval |
| --- | ---: | ---: | ---: | ---: |
| Qwen3.8 27.8B | 12.1 / 23.2 | 9.0 / 19.5 | 4.9 / 17.9 | 8.6 / 17.1 |
| Qwen2.5 7B Instruct | 3.3 / 7.3 | 1.2 / 3.9 | 1.6 / 5.5 | 2.5 / 6.8 |
| Qwen3 4B | – / 2.3 | – / 1.1 | – / 1.4 | – / 2.0 |
| DeepSeek-R1-Distill-Qwen 7B | 13.9 / 17.6 | 16.8 / 21.2 | 12.8 / 16.8 | 12.4 / 15.7 |

Qwen3.8 explained the limits of a LIM, remembered the garage conversion, answered in Portuguese and declined to confirm insurance cover. Some displayed citations only support part of an answer. For instance, the Portuguese answer discusses the flexibility of renting, but its displayed excerpt defines a mortgage. That comparison is in the guide notes.

Qwen2.5 gave a cited answer to all four questions. It described the limits of council records and correctly distinguished a carport from the observed garage conversion. Its follow-up suggested comparing plans but omitted the specific question to ask the council. It referred the buyer to their insurer without claiming cover was approved. Its rent answer was in English despite the Portuguese input.

Qwen3 4B returned source excerpts for all four questions. On inspection, the LIM response began with commentary about the question where the parser requires the citation list. DeepSeek supplied recognised source IDs for every answer, but answered the Portuguese question in English and suggested asking the council to add missing records. The cited passage only establishes the limits of what a LIM records.

## Follow-up on answer language

The current prompt puts the buyer's question after the evidence and tells the model to use that question's language. For the 246 translated guide questions, the guide already identifies the language. Veritas includes its name in the system instruction for an exact match. Free-form questions use the model's language recognition. Moving the question alone still produced English for the Portuguese and Spanish rent questions.

On the revised prompt, Qwen2.5 7B returned a cited answer for each of seven questions. The original three English checks still produced a council-records explanation, a carport/garage distinction and a referral to the insurer without confirming cover. The rent questions received replies in Portuguese, Spanish and Chinese. A separate, free-form question about a LIM received a Portuguese answer. It correctly explained the exclusion of building plans, but also described ownership and financial-interest records without support from the cited LIM passages. The Chinese rent answer relied on a real, narrowly applicable grant for some Kāinga Ora tenants. A valid source ID and the right language alone do not establish that a reply is fully supported or relevant.

The expanded script now includes all seven questions. The original speed table compares the same four questions across models; the language reruns reused prompt caches and are excluded from that comparison.

### Model versions

The Ollama manifest prefixes for this run were `47951e4a6661` for Qwen3.8 (NVFP4, MLX), `359d7dd4bcda` for Qwen3 4B (Q4_K_M), `845dbda0ea48` for Qwen2.5 7B Instruct (Q4_K_M) and `0a8c26691023` for DeepSeek (Q4_K_M). The three Qwen models ship with Apache-2.0 licenses. DeepSeek distributes the distill model under MIT and identifies the original Qwen2.5 base license as Apache-2.0. [Qwen3.8](https://ollama.com/library/qwen3.8) · [Qwen3 4B model card](https://huggingface.co/Qwen/Qwen3-4B) · [Qwen2.5 7B model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) · [DeepSeek distill model card](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B)

For a hosted comparison, Cloudflare recommends Gemma 4 26B A4B and Qwen3.8 27B for smaller workloads. Either would need the same citation and latency checks on Workers AI. Cloudflare scheduled the older Qwen3-30B-A3B-FP8 for retirement on 20 November 2026. [Cloudflare model changes](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)
