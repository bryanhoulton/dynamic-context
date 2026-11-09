"""
Core dynamic context service.

Platform-agnostic implementation of streaming generation with dynamic memory retrieval.
"""

import json
from dataclasses import dataclass
from typing import Any, Generator, Protocol

from .config import AssistantConfig
from .memory import Memory


class Retriever(Protocol):
    def retrieve(self, query: str, *, max_memories: int) -> list[Memory]: ...


class Tokenizer(Protocol):
    """Protocol for tokenizer interface."""

    eos_token_id: int

    def encode(self, text: str, *, add_special_tokens: bool = False) -> list[int]: ...
    def convert_tokens_to_ids(self, token: str) -> int: ...
    def decode(self, token_ids: list[int], skip_special_tokens: bool = False) -> str: ...
    def apply_chat_template(
        self, messages: list[dict], tokenize: bool = False, add_generation_prompt: bool = False
    ) -> str: ...


class Model(Protocol):
    """Protocol for model interface."""

    device: Any
    generation_config: Any

    def generate(self, input_ids: Any, **kwargs) -> Any: ...


@dataclass
class StreamEvent:
    """An event yielded during streaming generation."""

    type: str
    data: dict

    def to_sse(self) -> str:
        """Convert to Server-Sent Event format."""
        return f"data: {json.dumps({'type': self.type, **self.data})}\n\n"


class DynamicContextService:
    """Decode with one replaceable notebook excerpt at the start of reasoning."""

    def __init__(self, config: AssistantConfig, pool: Retriever, tokenizer: Tokenizer, model: Model):
        self.config = config
        self.pool = pool
        self.tokenizer = tokenizer
        self.model = model

    def generate_stream(
        self,
        message: str,
        update_every_n: int = 10,
        max_memories: int = 3,
        lookback_tokens: int = 60,
    ) -> Generator[StreamEvent, None, None]:
        import torch

        tokenizer = self.tokenizer
        decode = tokenizer.decode
        prefix = tokenizer.apply_chat_template(
            [{"role": "user", "content": message}], tokenize=False, add_generation_prompt=True,
        )
        if not prefix.rstrip().endswith("<think>"):
            prefix += "<think>\n"
        prefix_ids = tokenizer.encode(prefix, add_special_tokens=False)
        close_id = tokenizer.convert_tokens_to_ids("</think>")
        eos = self.model.generation_config.eos_token_id
        end_ids = {eos} if isinstance(eos, int) else set(eos or [tokenizer.eos_token_id])

        def memory_ids_for(query: str) -> list[int]:
            notes = self.pool.retrieve(query, max_memories=max_memories)
            if not notes:
                return []
            block = "Here are some memories I remember about the user:\n"
            block += "".join(f"- {note.content}\n" for note in notes) + "\n"
            return tokenizer.encode(block, add_special_tokens=False)

        memory_ids = memory_ids_for(message)
        yield StreamEvent("context_start", {
            "prompt": message, "prefix": decode(prefix_ids), "memory": decode(memory_ids),
        })

        generated: list[int] = []
        limit = self.config.model.max_tokens
        while len(generated) < limit:
            # This is the entire input. Only the memory slot can change between chunks.
            current = torch.tensor([prefix_ids + memory_ids + generated], device=self.model.device)
            with torch.inference_mode():
                output = self.model.generate(
                    current, attention_mask=torch.ones_like(current),
                    max_new_tokens=min(update_every_n, limit - len(generated)),
                    do_sample=True, temperature=self.config.model.temperature,
                    pad_token_id=tokenizer.eos_token_id,
                )
            chunk = output[0, current.shape[1]:].tolist()
            if not chunk:
                raise RuntimeError("The model returned no tokens.")
            generated.extend(chunk)
            ended = generated[-1] in end_ids
            visible = generated[:-1] if ended else generated
            close = visible.index(close_id) if close_id in visible else len(visible)
            yield StreamEvent("output", {
                "thinking": decode(visible[:close]),
                "closing": decode(visible[close:close + 1]),
                "answer": decode(visible[close + 1:]),
                "end": decode(generated[-1:]) if ended else "",
            })
            if ended or len(generated) == limit:
                yield StreamEvent("done", {"limited": not ended})
                return
            if close == len(visible):
                query = decode(generated[-lookback_tokens:], skip_special_tokens=True)
                memory_ids = memory_ids_for(query)
                yield StreamEvent("lookup", {"query": query, "memory": decode(memory_ids)})
