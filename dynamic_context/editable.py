"""Decode with an editable user prompt and an immutable suffix of generated IDs."""

from collections.abc import Iterator

from .service import StreamEvent


def generate_editable(model, tokenizer, prompt: str, generated_ids: list[int], limit: int) -> Iterator[StreamEvent]:
    import torch

    # The client keeps only chunks it actually received. Resumption rebuilds the
    # entire input; it must never reuse a KV cache from the previous user prompt.
    prefix = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}], tokenize=False, add_generation_prompt=True,
    )
    if not prefix.rstrip().endswith("<think>"):
        prefix += "<think>\n"
    ids = tokenizer.encode(prefix, add_special_tokens=False) + generated_ids
    current = torch.tensor([ids], device=model.device)
    opening = tokenizer.convert_tokens_to_ids("<think>")
    closing = tokenizer.convert_tokens_to_ids("</think>")
    thinking = True
    for tid in generated_ids:
        if tid in (opening, closing):
            thinking = tid == opening
    count = len(generated_ids)
    ended = False
    while count < limit:
        with torch.inference_mode():
            outputs = model.generate(
                current, max_new_tokens=min(6, limit - count), do_sample=True,
                temperature=0.7, pad_token_id=tokenizer.eos_token_id,
            )
        chunk = outputs[0, current.shape[1]:].tolist()
        if not chunk:
            break
        # Emit the IDs and their visible text atomically: Pause always has a
        # checkpoint whose text exactly corresponds to what was displayed.
        parts = {"thinking": [], "answer": []}
        for tid in chunk:
            if tid == opening or tid == closing:
                thinking = tid == opening
            elif tid != tokenizer.eos_token_id:
                parts["thinking" if thinking else "answer"].append(tid)
        yield StreamEvent("chunk", {
            "ids": chunk,
            **{k: tokenizer.decode(v, skip_special_tokens=True) for k, v in parts.items()},
        })
        count += len(chunk)
        ended = tokenizer.eos_token_id in chunk
        if ended:
            break
        current = outputs
    yield StreamEvent("done", {"limited": count >= limit and not ended})
