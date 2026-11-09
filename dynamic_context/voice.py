"""One live transcript, reasoning trace and reply per recognized speech turn."""

import asyncio
from dataclasses import dataclass, field

CONTEXT_TOKENS = 4096
CHUNK_TOKENS = 12
PLAN_TOKENS = 384
REPLY_TOKENS = 384
SYSTEM = "You are having a spoken conversation. Give brief, natural spoken replies."
PLANNING = "The user is still speaking. Consider the words so far and keep your plan open as the transcript changes."
ANSWERING = "The latest user message is now complete. Answer its full wording, including any corrections or instructions at the end. Your earlier reasoning may have been based on only the first few words."


@dataclass
class VoiceTurn:
    index: int
    transcript: str = ""
    final: bool = False
    plan_ids: list[int] = field(default_factory=list)
    plan: str = ""
    reply_ids: list[int] = field(default_factory=list)
    reply: str = ""
    complete: bool = False


def voice_input(tokenizer, history, turn, answering):
    """Retain generated IDs as the transcript changes. Drop oldest whole turns to fit."""
    if answering:
        # The confirmed user message follows the provisional plan. Prefilling an
        # answer directly after an early guess can cause Qwen to answer that guess.
        close = tokenizer.encode("</think>\n\n", add_special_tokens=False)
        suffix = close + turn.reply_ids
    else:
        suffix = turn.plan_ids
    room = CONTEXT_TOKENS - CHUNK_TOKENS - len(suffix)
    text = turn.transcript
    instruction = SYSTEM + " " + (ANSWERING if answering else PLANNING)
    while True:
        messages = [{"role": "system", "content": instruction}]
        for user, assistant in history:
            messages.append({"role": "user", "content": user})
            if assistant:
                messages.append({"role": "assistant", "content": assistant})
        if answering and turn.plan:
            messages.append({"role": "assistant", "content": "Provisional reasoning while listening:\n" + turn.plan})
        messages.append({"role": "user", "content": text})
        prefix = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        if not prefix.rstrip().endswith("<think>"):
            prefix += "<think>\n"
        ids = tokenizer.encode(prefix, add_special_tokens=False)
        if len(ids) <= room:
            return ids + suffix
        if history:
            history = history[1:]
        else:
            user_ids = tokenizer.encode(text, add_special_tokens=False)
            keep = len(user_ids) - (len(ids) - room) - 1
            text = tokenizer.decode(user_ids[-keep:]) if keep > 0 else ""


class VoiceConversation:
    def __init__(self, emit):
        self.emit = emit
        self.current = None
        self.history = []
        self.changed = asyncio.Event()

    def transcript(self, index, text, final=False):
        turn = self.current
        if not text.strip() or (turn and index < turn.index):
            return
        if turn is None or index > turn.index:
            if turn:
                self.history.append((turn.transcript, turn.reply))
            turn = self.current = VoiceTurn(index)
        if turn.final or (text == turn.transcript and not final):
            return
        turn.transcript = text
        turn.final = final
        self.emit("transcript", index, full_transcript=text, text=text, is_final=final)
        if final:
            self.emit("thinking_end", index)
        self.changed.set()

    async def generate(self, next_chunk):
        # A single worker owns the GPU. An in-flight chunk can finish after a final
        # transcript or interruption; only its original turn and phase may publish it.
        while True:
            await self.changed.wait()
            self.changed.clear()
            turn = self.current
            while turn is self.current and not turn.complete:
                self.changed.clear()
                answering = turn.final
                ids = turn.reply_ids if answering else turn.plan_ids
                # Pace the provisional trace with incoming speech so the model
                # cannot spend its whole reasoning budget on the first word.
                plan_budget = min(PLAN_TOKENS, 3 * len(turn.transcript.split()) + 3)
                budget = (REPLY_TOKENS if answering else plan_budget) - len(ids)
                if budget <= 0:
                    break
                source = turn.transcript
                new_ids, text, stopped = await next_chunk(self.history, turn, answering, min(CHUNK_TOKENS, budget))
                if self.current is not turn or turn.final != answering:
                    continue
                previous = turn.reply if answering else turn.plan
                ids.extend(new_ids)
                if answering:
                    turn.reply = text
                else:
                    turn.plan = text
                if text != previous:
                    self.emit("token", turn.index, t=text[len(previous):], full_text=text, is_thinking=not answering)
                if stopped or not new_ids or len(new_ids) >= budget:
                    if answering:
                        turn.complete = True
                        self.emit("response_complete", turn.index)
                    elif turn.transcript != source and len(ids) < PLAN_TOKENS:
                        continue
                    # If planning ended first, wait for fresh words or the final transcript.
                    break
