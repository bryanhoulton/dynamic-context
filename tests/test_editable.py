"""Exercise continuation on CPU without loading model weights (requires torch)."""
import unittest

import torch

from dynamic_context.editable import generate_editable


class Tokenizer:
    eos_token_id = 0

    def apply_chat_template(self, messages, **kwargs):
        return messages[0]["content"] + "\n"

    def encode(self, text, **kwargs):
        return list(text.encode("utf8"))

    def convert_tokens_to_ids(self, token):
        return {"<think>": 1, "</think>": 2}[token]

    def decode(self, ids, **kwargs):
        return bytes(ids).decode("utf8")


class Model:
    device = "cpu"

    def __init__(self, chunks):
        self.chunks = iter(chunks)
        self.inputs = []

    def generate(self, current, **kwargs):
        self.inputs.append(current[0].tolist())
        return torch.cat([current, torch.tensor([next(self.chunks)])], dim=1)


class EditablePromptTest(unittest.TestCase):
    def test_resume_replaces_user_text_and_preserves_all_generated_ids(self):
        tok = Tokenizer()
        model = Model([list(b"think"), [2, *b"yes", 0]])
        start = generate_editable(model, tok, "old", [], 30)
        received = next(start).data
        start.close()  # A client only acknowledges chunks it displayed.
        events = list(generate_editable(model, tok, "new", received["ids"], 30))
        self.assertEqual(model.inputs[1], tok.encode("new\n<think>\n") + list(b"think"))
        self.assertEqual(received["thinking"], "think")
        self.assertEqual(events[0].data["answer"], "yes")
        self.assertEqual(events[-1].type, "done")

    def test_resume_after_reasoning_stays_in_the_answer(self):
        model = Model([[*b"!", 0]])
        events = list(generate_editable(model, Tokenizer(), "edit", [*b"think", 2, *b"answer"], 30))
        self.assertEqual(events[0].data["thinking"], "")
        self.assertEqual(events[0].data["answer"], "!")
