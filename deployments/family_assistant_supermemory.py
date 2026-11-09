"""
Family Assistant deployment on Modal — Supermemory-backed.

Same shape as ``deployments/family_assistant.py`` (Qwen3-8B on an A100 serving
``/chat/stream`` SSE) so the frontend can talk to it unchanged. The only
difference is that ``MemoryPool`` is swapped for ``SupermemoryPool``, so every
N-token re-retrieval against the reasoning trace goes through Supermemory.

Dev (ephemeral hot-reload URL):
    uv run modal serve deployments/family_assistant_supermemory.py

Deploy (stable URL):
    uv run modal deploy deployments/family_assistant_supermemory.py

Then in ``frontend/.env.local``:
    VITE_SUPERMEMORY_API_URL=<the URL printed by Modal>

and run ``yarn dev`` in ``frontend/``.
"""

import sys
from datetime import datetime
from pathlib import Path

import modal

MODEL_ID = "Qwen/Qwen3-8B"
APP_NAME = "dynamic-context-supermemory"

# Stable tag: memories are ingested once via scripts/ingest_supermemory.py
# and every container cold start just attaches to them.
CONTAINER_TAG = "family-assistant-prod"

repo_root = Path(__file__).parent.parent
package_path = repo_root / "dynamic_context"
dad_memories_path = repo_root / "examples" / "dad_memories.json"


def download_model():
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_ID, ignore_patterns=["*.gguf"])
    print(f"Downloaded {MODEL_ID}")


app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.11.0",
        "transformers==5.5.4",
        "accelerate>=0.28",
        "numpy",
        "huggingface_hub",
        "fastapi",
        "uvicorn",
        "pydantic",
        "sentencepiece>=0.1.99",
        "supermemory==3.34.0",
        "httpx==0.28.1",
    )
    .run_function(download_model)
    .add_local_file(dad_memories_path, "/app/dad_memories.json")
    .add_local_dir(package_path, "/root/dynamic_context")
)


@app.cls(
    image=image,
    gpu="A100",
    timeout=600,
    scaledown_window=300,
    secrets=[modal.Secret.from_dotenv(str(repo_root / ".env"))],
)
class FamilyAssistantSupermemory:
    """Family Assistant with a Supermemory-backed pool."""

    @modal.enter()
    def startup(self):
        import json

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        sys.path.insert(0, "/root")
        from dynamic_context.config import FAMILY_ASSISTANT
        from dynamic_context.service import DynamicContextService
        from dynamic_context.supermemory_pool import SupermemoryPool

        print(f"Loading {MODEL_ID}...")
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.bfloat16,
            device_map="auto",
            trust_remote_code=True,
        )
        self.model.eval()
        print(f"LLM loaded on {next(self.model.parameters()).device}")

        print(f"Attaching to Supermemory container_tag: {CONTAINER_TAG}")
        self.pool = SupermemoryPool(container_tag=CONTAINER_TAG)

        remote_count = self.pool.count_remote()
        print(f"Supermemory has {remote_count} docs under this tag")
        if remote_count == 0:
            raise RuntimeError(
                f"No memories found in Supermemory under container_tag={CONTAINER_TAG!r}. "
                "Run scripts/ingest_supermemory.py once locally before starting this app."
            )

        # Mirror the JSON into the local pool WITHOUT re-uploading — this just
        # populates pool.memories so token bookkeeping works. Content→id
        # mapping is rebuilt from the same JSON; must match what was ingested.
        with open("/app/dad_memories.json") as f:
            memories = json.load(f)

        for i, mem in enumerate(memories):
            created_str = mem.get("created_at", "")
            try:
                dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                created_at = dt.replace(tzinfo=None)
            except Exception:
                created_at = datetime.now()
            self.pool.attach_existing(
                content=mem["content"],
                emotional_intensity=mem.get("emotional_intensity", 0.5),
                memory_id=f"mem_{i}",
                created_at=created_at,
            )

        self.service = DynamicContextService(
            config=FAMILY_ASSISTANT,
            pool=self.pool,
            tokenizer=self.tokenizer,
            model=self.model,
        )
        self.config = FAMILY_ASSISTANT
        print("Container ready — using Supermemory retrieval.")

    @modal.asgi_app(label="dynamic-context-memory")
    def serve(self):
        from dynamic_context.api import create_app
        return create_app(
            service=self.service,
            config=self.config,
            model_id=f"{MODEL_ID} + Supermemory",
        )
