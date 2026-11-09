"""Check the context shown to the client against the tensor used for every model call."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import torch

from dynamic_context.service import DynamicContextService


class Tokenizer:
    eos_token_id = 300
    closing_id = 301

    def apply_chat_template(self, messages, **kwargs):
        assert len(messages) == 1 and messages[0]["role"] == "user"
        return "<user>" + messages[0]["content"] + "</user><assistant>"

    def encode(self, text, **kwargs):
        return list(text.encode())

    def convert_tokens_to_ids(self, token):
        assert token == "</think>"
        return self.closing_id

    def decode(self, ids, **kwargs):
        if ids == [self.closing_id]:
            return "</think>"
        if ids == [self.eos_token_id]:
            return "<end>"
        return bytes(ids).decode(errors="replace")


class MemoryContextTest(unittest.TestCase):
    def test_every_submitted_input_matches_the_displayed_context(self):
        tok = Tokenizer()
        note = lambda text: SimpleNamespace(content=text)
        pool = Mock()
        pool.retrieve.side_effect = [[note("old")], [note("café")], []]
        model = Mock(device="cpu", generation_config=SimpleNamespace(eos_token_id=[300]))
        chunks = iter([list(b"xy"), list(b"zz"), [301, ord("A")], [300]])
        inputs = []

        def generate(current, **kwargs):
            inputs.append(current[0].tolist())
            return torch.cat([current, torch.tensor([next(chunks)])], dim=1)

        model.generate.side_effect = generate
        config = SimpleNamespace(model=SimpleNamespace(temperature=0.7, max_tokens=12))
        service = DynamicContextService(config, pool, tok, model)
        events = list(service.generate_stream("rent?", update_every_n=2, lookback_tokens=3))
        self.assertEqual([c.args[0] for c in pool.retrieve.call_args_list], ["rent?", "xy", "yzz"])
        prefix = "<user>rent?</user><assistant><think>\n"
        old = "Here are some memories I remember about the user:\n- old\n\n"
        new = old.replace("old", "café")
        self.assertEqual(inputs, [
            tok.encode(prefix + old), tok.encode(prefix + new + "xy"),
            tok.encode(prefix + "xyzz"), tok.encode(prefix + "xyzz") + [301, ord("A")],
        ])
        start = events[0].data
        self.assertEqual((start["prefix"], start["memory"], start["prompt"]), (prefix, old, "rent?"))
        self.assertEqual([e.data["memory"] for e in events if e.type == "lookup"], [new, ""])
        self.assertEqual(events[-2].data, {"thinking": "xyzz", "closing": "</think>", "answer": "A", "end": "<end>"})
        self.assertEqual(events[-1].data, {"limited": False})
