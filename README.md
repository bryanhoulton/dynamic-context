# Dynamic Context Engineering

Three interactive experiments ask the same question: what happens if part of a language model’s input can change *after* decoding starts?

[Open the demos](https://context.bryanhoulton.com/).

| Experiment | What changes the prompt? | What to inspect |
| --- | --- | --- |
| **Prompt** | Pause the stream, edit the user message, then resume decoding with the new prefix and **the exact token IDs already shown**. | The earlier trace stays in place. Does the model revise its reasoning after the edit? |
| **Memory** | Each run starts with one user message. The retriever places up to three notes immediately after the opening reasoning token. Later lookups replace that block and preserve every generated token ID. | The current notes appear in blue at the top of Reasoning. The highlighted text is the most recent retrieval query. Copy the model context to see the literal chat tokens. |
| **Voice** | Partial speech recognition updates the speaker’s transcript while the model plans. After the confirmed end of speech, the reply prompt places the provisional plan before the complete user message. | Watch your message and the reasoning fill in together. The confirmed end of speech starts the answer. Follow-up turns include earlier messages and replies within the model’s context window. |

All three experiments use Qwen3-8B. They change the text used for subsequent decoding steps; none modifies the model’s weights. A retrieved note being present does not establish that it caused the reply. The demos are probes, not a controlled quality or latency comparison.

## Run the interface

From `frontend/`:

```sh
yarn install --frozen-lockfile
yarn dev
```

Open the Vite URL. On the first visit, choose Go in the introduction. Type a question, press Enter, then use Pause & edit. Shift+Enter inserts a line break. Memory uses the same chat composer and the hosted Supermemory-backed service. It first looks up the question. Every 10 generated reasoning tokens, it queries the last 60 reasoning tokens and replaces the memory block. Retrieval stops when the reasoning closes. Each question starts a fresh context. Voice connects to its WebSocket service only when you start the microphone. Microphone capture requires localhost or HTTPS.

For a production build run `yarn build`; for the stream checks run `yarn test`. The CPU continuation tests run from the repository root with `uv run --with torch python -m unittest discover -s tests` (no model weights needed). Vercel rewrites direct links to the app. `/` opens Prompt; `/memory` and `/superdemo` open Memory. `/demo` preserves the original local-embedding retriever with the same UI. `/voice`, `/voice-ws` and `/voice-livekit` open the WebSocket Voice experiment.

## Services

Deploy the updated memory service before publishing this frontend. Prompt requires its new `POST /prompt/stream` endpoint; Memory uses the `context_start`, `output`, and `lookup` events from `POST /chat/stream`. For a temporary preview, run `uv run modal serve deployments/family_assistant_supermemory.py` and set `VITE_SUPERMEMORY_API_URL` to the printed preview URL. To run your own, install local tooling with `uv sync` and authenticate Modal. GPU inference packages are installed in the individual Modal images.

| Service | Source | Frontend override (base URL) |
| --- | --- | --- |
| Memory, hosted search | `deployments/family_assistant_supermemory.py` | `VITE_SUPERMEMORY_API_URL` |
| Memory, local BGE retrieval | `deployments/family_assistant.py` | `VITE_API_URL` |
| Voice, Qwen/vLLM with Deepgram and ElevenLabs | `deployments/websocket_agent.py` | `VITE_VOICE_API_URL` |

Set overrides in `frontend/.env.local`. For the default memory backend, put `SUPERMEMORY_API_KEY` in the repository’s local `.env` and ingest the notebook once with `uv run python scripts/ingest_supermemory.py --container-tag family-assistant-prod`. The local BGE variant uses the same `examples/dad_memories.json` without hosted search. The Voice deployment reads the Modal secrets `deepgram-secret` and `elevenlabs-secret`. To deploy a service under your Modal account, run `uv run modal deploy <source-file>`.

The memory service serves `GET /health`, `POST /chat/stream` (memory), and `POST /prompt/stream` (editable prompt). Both streams use SSE; the latter accepts a prompt and previously generated token IDs. Pausing aborts the client stream. Resuming starts a new inference request seeded with those IDs, without reusing the old KV cache. `VITE_PROMPT_API_URL` optionally overrides just this endpoint’s base URL. Voice serves `GET /health` and `/ws`: mono 16 kHz PCM16 input, turn-indexed transcripts, reasoning and answer text, and 24 kHz PCM16 audio output.
