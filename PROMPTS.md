# Veritas Agent prompt history

Rafael’s prompts to Codex, in order.

1. “could we use it to be the home-veritas home agent? meaning it would act as their personal agents available at anytime and respond to questions they might have along the process, including home visits and such. Agent is able to answer questions about the buying process, about home inspections, build compliance, insurance, legal, and all the rest?”

2. “let’s pivot to the Home Veritas veritas-agent for the Cloudflare assignment. use the existing guide and design, and build the full journey from a home visit to following up on documents. keep it local until I review it”

3. “make sure we follow the all recommended components and anything else needed.”

4. “ask veritas is what I had in mind as the singe page for veritas agent and users will just use the chat to using the website data and reference resources to answer the questions. Would that fit all recommendations for the agent we're building?”

5. “let’s make Ask Veritas the only page. use the Home Veritas design and guide, index the official references so the chat can quote them, and remember the conversation for follow-ups. keep it local until I review it”

6. “deleted the old repo and created a new one <https://github.com/rafamarins/veritas-agent>
   we need to make sure we have a good readme for the project.”

7. “and use the same arrows as home-veritas”

8. “be sure that there's nothing in the public repo that could create any security concerns, no keys, env vars or anything like that, keep what needs to be local local and what can be public public”

9. “make sure you run a clean up on the repo for unsued items
   another unslop round
   rename where necesary for veritas-agent
   include promptfoo evals, some basic sample evals only
   make sure we proptect our agent against prompt injection, bad behaviour, ddos, spam and all the standards for any sort of agentic chats.
   keep chat history in the users broswer storage
   cloudflare storage to be used for improving answers and self improvement of the agent via scheduled/cron workflows on the server running daily to verify questions and answers and run some decision model like kev on it to help improve responses as needed.”

   When Codex asked which Kev project he meant, Rafael linked [jaredpalmer/kev](https://github.com/jaredpalmer/kev).

10. “pause the work if we drop under 60% usage, use subagents intelligently to manage usage and split up work as need with different models used based on the tasks requirements.”

11. “we should get feedback on the answers provided with thumbs up or down icon buttons below the answer to know how good that was and save that in our CF memory”

12. “include screenshots in the readme”

13. “update the chat response to streamed and make the Reading the guide and references… pulsing between opacity .5 and 1 while it loads the answer”

14. “We could use Jev instead I have some credits there and we can use their endpoint, look at the configs for [$chrome-agent-jev-cua] that will have the endpoit to use.
    And for the chat we should have a way to go back to the initial screen and see past chats to open and such and the ability to start new chats.
    We could also enable voice mode for the chat, we could use Kokoro TTS or other lightweight voice models for that.
    Also look at any other OSS models for the chat that might be faster, we're doing rag here with the data so we can chose something lighter that might work best for rag.”

    The local path to the Chrome Agent and Jev skill was omitted. Codex compared Ollama models using the same guide questions, checked Jev against public examples, and tested navigation and on-device speech in separate browser profiles.

15. “the voice feature is too complicated, should just be like the codex one, a microphone and we start listening to what the user has to say”
