"""
Supermemory-backed drop-in replacement for MemoryPool.

Same `retrieve(query, max_memories=...)` and `add(...)` interface as
``dynamic_context.memory.MemoryPool``, but memories live in Supermemory's
hosted store and retrieval is performed via their hybrid search API.

This lets us swap the Hebbian in-process pool for a managed vector/graph memory
service without changing the DynamicContextService at all.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

import numpy as np
from supermemory import Supermemory

from .memory import Memory


class SupermemoryPool:
    """MemoryPool-compatible wrapper over Supermemory.

    The service consumes:
      - ``retrieve(query, max_memories=N) -> list[Memory]``
      - ``memories: dict[str, Memory]`` (used for pool-size bookkeeping)
      which we implement faithfully here.
    """

    def __init__(
        self,
        container_tag: str,
        api_key: Optional[str] = None,
        search_mode: str = "memories",
        threshold: float = 0.6,
        rerank: bool = True,
        rewrite_query: bool = False,
        min_similarity: float = 0.62,
    ):
        self.client = Supermemory(api_key=api_key or os.environ["SUPERMEMORY_API_KEY"])
        self.container_tag = container_tag
        self.search_mode = search_mode
        self.threshold = threshold
        self.rerank = rerank
        self.rewrite_query = rewrite_query
        # Client-side cut: results with similarity below this are dropped even
        # if Supermemory returned them. Acts as a hard floor on off-topic noise.
        self.min_similarity = min_similarity

        self.memories: dict[str, Memory] = {}
        self._content_to_id: dict[str, str] = {}


    def attach_existing(
        self,
        content: str,
        emotional_intensity: float = 0.5,
        memory_id: Optional[str] = None,
        created_at: Optional[datetime] = None,
    ) -> Memory:
        """Register a memory that is already in Supermemory under this tag.

        This does not hit the Supermemory API. It populates the local mirror so bookkeeping (``pool.memories``,
        content→id map) works. Use this at startup when memories were ingested
        in a previous run under a stable container_tag.
        """
        local_id = memory_id or f"mem_{len(self.memories)}"
        mem = Memory(
            id=local_id,
            content=content,
            embedding=np.zeros(1, dtype=np.float32),
            emotional_intensity=emotional_intensity,
            created_at=created_at or datetime.now(),
        )
        self.memories[local_id] = mem
        self._content_to_id[content] = local_id
        return mem

    def count_remote(self) -> int:
        """Number of documents currently in Supermemory for this container_tag."""
        resp = self.client.documents.list(
            container_tags=[self.container_tag], limit=1
        )
        pag = getattr(resp, "pagination", None)
        if pag is None:
            return 0
        total = getattr(pag, "total_items", None) or getattr(pag, "totalItems", 0)
        return int(total or 0)

    # ------------------------------------------------------------- retrieve

    def retrieve(
        self,
        query: str,
        token_budget: int = 3000,
        max_memories: int = 10,
        now: Optional[datetime] = None,
    ) -> list[Memory]:
        now = now or datetime.now()
        if not query or not query.strip():
            return []

        resp = self.client.search.memories(
            q=query,
            container_tag=self.container_tag,
            search_mode=self.search_mode,
            limit=max_memories,
            threshold=self.threshold,
            rerank=self.rerank,
            rewrite_query=self.rewrite_query,
        )

        selected: list[Memory] = []
        tokens_used = 0
        for r in getattr(resp, "results", []) or []:
            content = getattr(r, "memory", None) or getattr(r, "chunk", None)
            if not content:
                continue

            # Hard client-side similarity floor — Supermemory's server-side
            # threshold is advisory and it still returns weak matches to pad
            # up to `limit`. We want empty results for off-topic queries.
            sim = getattr(r, "similarity", None)
            if sim is not None and sim < self.min_similarity:
                continue

            local_id = self._content_to_id.get(content)
            if local_id is None:
                # Supermemory extracts/compresses facts, so the returned content
                # may differ from the ingested document. Create a shell Memory
                # keyed by the remote id so timelines stay stable.
                remote_id = getattr(r, "id", None) or f"sm_{len(self.memories)}"
                local_id = f"sm_{remote_id}"
                if local_id not in self.memories:
                    meta = getattr(r, "metadata", None) or {}
                    emo = 0.5
                    try:
                        if isinstance(meta, dict) and "emotional_intensity" in meta:
                            emo = float(meta["emotional_intensity"])
                    except (TypeError, ValueError):
                        pass
                    self.memories[local_id] = Memory(
                        id=local_id,
                        content=content,
                        embedding=np.zeros(1, dtype=np.float32),
                        emotional_intensity=emo,
                        created_at=now,
                    )
                self._content_to_id[content] = local_id

            mem = self.memories[local_id]
            if tokens_used + mem.token_estimate() > token_budget:
                continue

            mem.retrieval_count += 1
            mem.last_retrieved = now
            selected.append(mem)
            tokens_used += mem.token_estimate()

            if len(selected) >= max_memories:
                break

        return selected
