"""
FastAPI app factory for dynamic context service.

Creates a FastAPI app that can be mounted in any ASGI server.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pydantic import BaseModel, ConfigDict, Field

from .editable import generate_editable
from .config import AssistantConfig
from .service import DynamicContextService


class MemoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=8000)
    update_every_n: int = Field(default=10, ge=1, le=100)
    max_memories: int = Field(default=3, ge=1, le=3)
    lookback_tokens: int = Field(default=60, ge=1, le=1500)


class EditableRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    generated_ids: list[int] = Field(default_factory=list, max_length=1500)


def create_app(
    service: DynamicContextService,
    config: AssistantConfig,
    model_id: str = "unknown",
) -> FastAPI:
    """
    Create a FastAPI app for the dynamic context service.

    Args:
        service: The DynamicContextService instance
        config: Assistant configuration
        model_id: Model identifier for health endpoint

    Returns:
        FastAPI app ready to be served
    """
    app = FastAPI(title=f"Dynamic Context - {config.name}")

    # CORS for frontend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        """Health check endpoint."""
        return {
            "status": "ok",
            "model": model_id,
            "assistant": config.name,
        }

    @app.post("/prompt/stream")
    def editable_stream(data: EditableRequest):
        if not data.prompt.strip() or any(t < 0 or t >= len(service.tokenizer) for t in data.generated_ids):
            raise HTTPException(422, "A prompt and valid model token IDs are required.")
        stream = generate_editable(service.model, service.tokenizer, data.prompt, data.generated_ids, config.model.max_tokens)
        return StreamingResponse(
            (event.to_sse() for event in stream), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/chat/stream")
    def chat_stream(data: MemoryRequest):
        if not data.message.strip():
            raise HTTPException(422, "A question is required.")
        stream = service.generate_stream(**data.model_dump())
        return StreamingResponse(
            (event.to_sse() for event in stream), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app
