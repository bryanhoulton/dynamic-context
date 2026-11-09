import asyncio
import unittest

from dynamic_context.voice import CHUNK_TOKENS, CONTEXT_TOKENS, VoiceConversation, VoiceTurn, voice_input


class CharacterTokenizer:
    def apply_chat_template(self, messages, **kwargs):
        return "".join(f"<{m['role']}>{m['content']}" for m in messages) + "<assistant>"

    def encode(self, text, **kwargs):
        return list(map(ord, text))

    def decode(self, ids):
        return "".join(map(chr, ids))


class VoicePromptTests(unittest.TestCase):
    def test_reuses_recent_user_and_assistant_turns_within_the_model_window(self):
        tokenizer = CharacterTokenizer()
        history = [("obsolete" * 900, "earliest reply"), ("Remember Lima.", "I will.")]
        turn = VoiceTurn(2, "Which city?", final=True, plan="Recall the city.", plan_ids=tokenizer.encode("Recall the city."))
        text = tokenizer.decode(voice_input(tokenizer, history, turn, True))
        self.assertNotIn("obsolete", text)
        self.assertIn("<user>Remember Lima.<assistant>I will.", text)
        self.assertTrue(text.endswith("Recall the city.<user>Which city?<assistant><think>\n</think>\n\n"))
        turn.transcript = "word " * 1500 + "last words"
        ids = voice_input(tokenizer, history, turn, False)
        self.assertLessEqual(len(ids) + CHUNK_TOKENS, CONTEXT_TOKENS)
        self.assertIn("last words<assistant>", tokenizer.decode(ids))


class VoiceTurnTests(unittest.IsolatedAsyncioTestCase):
    async def test_final_transcript_freezes_reasoning_and_only_answers_once(self):
        events = []
        session = VoiceConversation(lambda kind, index, **data: events.append((kind, index, data)))
        plan_started = asyncio.Event()
        release_chunk = asyncio.Event()
        replied = asyncio.Event()

        async def generate(history, turn, answering, limit):
            if answering:
                self.assertEqual(turn.transcript, "Take the bus.")
                self.assertEqual(turn.plan, "Compare routes.")
                replied.set()
                return [3], "Okay.", True
            if turn.plan_ids:
                plan_started.set()
                await release_chunk.wait()
                return [2], "Compare routes. Late text.", False
            return [1], "Compare routes.", False

        session.transcript(0, "Take the")
        worker = asyncio.create_task(session.generate(generate))
        try:
            await asyncio.wait_for(plan_started.wait(), 1)
            session.transcript(0, "Take the bus.", final=True)
            session.transcript(0, "Take the bus.", final=True)
            release_chunk.set()
            await asyncio.wait_for(replied.wait(), 1)
            self.assertEqual([e[0] for e in events], [
                "transcript", "token", "transcript", "thinking_end", "token", "response_complete",
            ])
            self.assertTrue(session.current.complete)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    async def test_interruption_keeps_published_reply_and_drops_in_flight_audio_text(self):
        events = []
        session = VoiceConversation(lambda kind, index, **data: events.append((kind, index, data)))
        pending = asyncio.Event()
        release = asyncio.Event()
        next_turn = asyncio.Event()

        async def generate(history, turn, answering, limit):
            if turn.index == 1:
                self.assertEqual(history, [("My city is Lima.", "Lima")])
                next_turn.set()
                return [3], "Lima.", True
            if turn.reply:
                pending.set()
                await release.wait()
                return [2], "Lima is wonderful.", True
            return [1], "Lima", False

        session.transcript(0, "My city is Lima.", final=True)
        worker = asyncio.create_task(session.generate(generate))
        try:
            await asyncio.wait_for(pending.wait(), 1)
            session.transcript(1, "Which city?", final=True)
            session.transcript(0, "stale", final=True)
            release.set()
            await asyncio.wait_for(next_turn.wait(), 1)
            self.assertEqual([(i, data["full_text"]) for kind, i, data in events if kind == "token"],
                             [(0, "Lima"), (1, "Lima.")])
            self.assertEqual(session.current.index, 1)
        finally:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
