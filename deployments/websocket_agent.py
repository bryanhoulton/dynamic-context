"""Live voice conversation with a changing user transcript during reasoning."""

import asyncio
import base64
import json
import os
import time
from pathlib import Path

import modal

MODEL_ID = "Qwen/Qwen3-8B"
APP_NAME = "websocket-voice-agent"
ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"


app = modal.App(APP_NAME)

# Optimized image - combine pip installs into fewer layers
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "vllm==0.13.0",
        "torch==2.9.0",
        "transformers==4.57.3",
        "numpy==2.2.6",
        "huggingface_hub==0.36.0",
        "fastapi[standard]==0.128.0",
        "websockets==15.0.1",
        "deepgram-sdk==6.1.1",
        extra_options="--no-cache-dir",
    )
    .run_commands(
        f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{MODEL_ID}', ignore_patterns=['*.gguf'])\""
    )
    .add_local_dir(Path(__file__).resolve().parents[1] / "dynamic_context", "/root/dynamic_context")
)


@app.cls(
    image=image,
    gpu="A10G",
    timeout=600,
    scaledown_window=60,
    secrets=[
        modal.Secret.from_name("deepgram-secret"),
        modal.Secret.from_name("elevenlabs-secret"),
    ],
)
class VoiceAgent:
    @modal.enter()
    def load_model(self):
        """Load model once when container starts - Modal optimizes this."""
        from huggingface_hub import snapshot_download
        from transformers import AutoTokenizer
        from vllm import LLM

        print(f"[enter] Loading {MODEL_ID} with vLLM...")
        start = time.time()

        model_path = snapshot_download(MODEL_ID, local_files_only=True)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        self.control_ids = {self.tokenizer.convert_tokens_to_ids(t) for t in ("</think>", "<|im_end|>", "<|endoftext|>")}
        self.llm = LLM(
            model=model_path,
            trust_remote_code=True,
            dtype="bfloat16",
            gpu_memory_utilization=0.9,
            max_model_len=4096,
            enforce_eager=True,
            disable_log_stats=True,
        )

        print(f"[enter] vLLM loaded in {time.time() - start:.1f}s!")

    async def next_chunk(self, history, turn, answering, limit):
        from dynamic_context.voice import voice_input
        from vllm import SamplingParams

        prompt = voice_input(self.tokenizer, history, turn, answering)
        existing = turn.reply_ids if answering else turn.plan_ids
        params = SamplingParams(
            temperature=0.7, max_tokens=limit,
            stop_token_ids=[self.tokenizer.convert_tokens_to_ids("</think>")] if not answering else [],
        )
        request = asyncio.create_task(asyncio.to_thread(
            self.llm.generate, [{"prompt_token_ids": prompt}], params, use_tqdm=False,
        ))
        try:
            outputs = await asyncio.shield(request)
        except asyncio.CancelledError:
            # The synchronous GPU call still owns the engine until it returns.
            await request
            raise
        result = outputs[0].outputs[0]
        ids = list(result.token_ids)
        # vLLM can include the terminating control ID in its ID output.
        if ids and ids[-1] in self.control_ids:
            ids.pop()
        text = self.tokenizer.decode(existing + ids, skip_special_tokens=True, clean_up_tokenization_spaces=False)
        # A UTF-8 character can straddle chunks. Publish it when all its bytes arrive.
        return ids, text.rstrip("\ufffd"), result.finish_reason == "stop"

    @modal.asgi_app()
    def web_app(self):
        import websockets
        from deepgram import AsyncDeepgramClient
        from deepgram.core.events import EventType
        from dynamic_context.voice import VoiceConversation
        from fastapi import FastAPI, WebSocket, WebSocketDisconnect
        from fastapi.middleware.cors import CORSMiddleware

        fastapi_app = FastAPI()
        fastapi_app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

        @fastapi_app.get("/health")
        async def health():
            return {"status": "ok", "model": MODEL_ID}

        @fastapi_app.websocket("/ws")
        async def websocket_endpoint(websocket: WebSocket):
            await websocket.accept()
            outbound = asyncio.Queue()
            speech_tasks = set()
            speech_task = None
            speech_queue = None
            active_index = None

            async def speak(index, words):
                uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_24000"
                try:
                    async with websockets.connect(uri) as speaker:
                        await speaker.send(json.dumps({
                            "text": " ", "xi_api_key": os.environ["ELEVEN_API_KEY"],
                            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                        }))

                        async def write_words():
                            buffered = ""
                            while True:
                                delta = await words.get()
                                if delta is None:
                                    if buffered:
                                        await speaker.send(json.dumps({"text": buffered + " "}))
                                    await speaker.send(json.dumps({"text": ""}))
                                    return
                                buffered += delta
                                # Preserve words split by a model chunk boundary.
                                split = max((i + 1 for i, c in enumerate(buffered) if c.isspace()), default=0)
                                if split:
                                    await speaker.send(json.dumps({"text": buffered[:split], "try_trigger_generation": True}))
                                    buffered = buffered[split:]

                        writer = asyncio.create_task(write_words())
                        try:
                            async for message in speaker:
                                data = json.loads(message)
                                if data.get("audio") and active_index == index:
                                    outbound.put_nowait({"type": "tts_audio", "turn_id": index, "audio": data["audio"]})
                                if data.get("isFinal"):
                                    break
                        finally:
                            writer.cancel()
                            await asyncio.gather(writer, return_exceptions=True)
                except Exception as err:
                    print(f"Speech playback failed: {err}")
                    if active_index == index:
                        outbound.put_nowait({"type": "audio_error", "turn_id": index})

            def emit(kind, index, **data):
                nonlocal active_index, speech_task, speech_queue
                if kind == "transcript" and index != active_index:
                    if speech_task:
                        speech_task.cancel()
                    active_index, speech_task, speech_queue = index, None, None
                outbound.put_nowait({"type": kind, "turn_id": index, **data})
                if kind == "token" and not data["is_thinking"]:
                    if speech_queue is None:
                        speech_queue = asyncio.Queue()
                        speech_task = asyncio.create_task(speak(index, speech_queue))
                        speech_tasks.add(speech_task)
                        speech_task.add_done_callback(speech_tasks.discard)
                    speech_queue.put_nowait(data["t"])
                if kind == "response_complete" and speech_queue is not None:
                    speech_queue.put_nowait(None)

            conversation = VoiceConversation(emit)

            def recognition(message):
                event = getattr(message, "event", None)
                if event in ("StartOfTurn", "Update", "EagerEndOfTurn", "TurnResumed", "EndOfTurn"):
                    conversation.transcript(message.turn_index, message.transcript, final=event == "EndOfTurn")

            async def send_to_client():
                while True:
                    await websocket.send_json(await outbound.get())

            async def microphone(connection):
                while True:
                    data = await websocket.receive_json()
                    if data.get("type") == "stop":
                        return
                    if data.get("type") == "audio":
                        await connection.send_media(base64.b64decode(data["audio"]))

            try:
                client = AsyncDeepgramClient(api_key=os.environ["DEEPGRAM_API_KEY"])
                async with client.listen.v2.connect(
                    model="flux-general-en", encoding="linear16", sample_rate="16000",
                    eot_threshold="0.9", eot_timeout_ms="6000",
                ) as connection:
                    connection.on(EventType.MESSAGE, recognition)
                    def speech_error(_error):
                        outbound.put_nowait({"type": "error", "message": "Speech recognition disconnected. Start a new session to reconnect."})
                    connection.on(EventType.ERROR, speech_error)
                    await websocket.send_json({"type": "connected"})
                    tasks = [
                        asyncio.create_task(send_to_client()), asyncio.create_task(microphone(connection)),
                        asyncio.create_task(connection.start_listening()), asyncio.create_task(conversation.generate(self.next_chunk)),
                    ]
                    try:
                        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                        for task in done:
                            task.result()
                    finally:
                        pending = [*tasks, *speech_tasks]
                        for task in pending:
                            task.cancel()
                        await asyncio.gather(*pending, return_exceptions=True)
            except WebSocketDisconnect:
                pass
            except Exception as err:
                print(f"Voice session failed: {err}")
                try:
                    await websocket.send_json({"type": "error", "message": "The voice session was interrupted. Please reconnect."})
                except (WebSocketDisconnect, RuntimeError):
                    pass

        return fastapi_app
