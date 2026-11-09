"""
Configuration for dynamic context deployments.

Define memory sources and deployment-specific settings.
"""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class MemoryConfig:
    """Configuration for a memory pool."""

    # Path to JSON file with memories (each item has "content", optional "emotional_intensity", "created_at")
    memory_file: str | Path

    # MemoryPool parameters
    softmax_temperature: float = 0.15
    diversity_weight: float = 0.5
    association_weight: float = 0.5


@dataclass
class ModelConfig:
    """Configuration for the LLM."""

    model_id: str = "Qwen/Qwen3-8B"
    torch_dtype: str = "bfloat16"
    temperature: float = 0.7
    max_tokens: int = 1500


@dataclass
class AssistantConfig:
    """Complete configuration for a dynamic context assistant."""

    # Unique name for this assistant
    name: str

    # Memory configuration
    memory: MemoryConfig

    # Model configuration (optional, uses defaults)
    model: ModelConfig = field(default_factory=ModelConfig)

    # Optional description for UI
    description: str = ""


# Pre-built configurations

FAMILY_ASSISTANT = AssistantConfig(
    name="family-assistant",
    description="Personal assistant with access to your memories and notes",
    memory=MemoryConfig(
        memory_file="/app/dad_memories.json",
    ),
)

