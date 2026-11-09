import { useEffect, useRef, useState } from 'react';
import { MEMORY_API } from './demo/config';
import { readStream } from './demo/stream';
import { Reasoning } from './components/Lab';
import { Button } from './components/ui/button';
import { Chat, ChatInput, ChatTurn } from './components/Chat';
import { InputGroupButton } from './components/ui/input-group';
import { Pause } from 'lucide-react';

const example =
  'Plan a three-course dinner for six people. Explain your choices.';
const blank = () => ({ ids: [], thinking: '', answer: '', edits: [] });

export default function PromptDemo() {
  const [prompt, setPrompt] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [phase, setPhase] = useState('idle');
  const [notice, setNotice] = useState('');
  const [trace, setTrace] = useState(blank);
  const checkpoint = useRef(trace);
  const active = useRef(null);
  const editor = useRef(null);
  const intro = useRef(null);
  useEffect(() => {
    try {
      if (localStorage.getItem('dynamic-context-intro')) return;
    } catch {
      // The dialog also works when the browser disables persistent storage.
    }
    if (!intro.current.open) intro.current.showModal();
  }, []);
  function closeIntro() {
    try {
      localStorage.setItem('dynamic-context-intro', 'seen');
    } catch {
      // Dismiss for this visit.
    }
    editor.current?.focus();
  }

  const running = phase === 'running';
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (phase === 'paused') editor.current?.focus();
  }, [phase]);

  function pause() {
    const req = active.current;
    active.current = null;
    req?.abort();
    setPhase('paused');
  }
  function reset() {
    checkpoint.current = blank();
    setTrace(checkpoint.current);
    setPrompt('');
    setSubmitted('');
    setNotice('');
    setPhase('idle');
  }
  async function send(e) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || active.current) return;
    const req = new AbortController();
    active.current = req;
    if (submitted && submitted !== text && checkpoint.current.ids.length) {
      const next = {
        ...checkpoint.current,
        edits: [
          ...checkpoint.current.edits,
          {
            position: checkpoint.current.ids.length,
            previous: submitted,
            next: text,
          },
        ],
      };
      checkpoint.current = next;
      setTrace(next);
    }
    setSubmitted(text);
    setPhase('running');
    setNotice('');
    try {
      const res = await fetch(
        (import.meta.env.VITE_PROMPT_API_URL || MEMORY_API) + '/prompt/stream',
        {
          method: 'POST',
          signal: req.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: text,
            generated_ids: checkpoint.current.ids,
          }),
        },
      );
      if (!res.ok || !res.body) throw Error('HTTP ' + res.status);
      for await (const item of readStream(res.body)) {
        if (active.current !== req) return;
        if (item.type === 'chunk') {
          const old = checkpoint.current;
          const next = {
            ...old,
            ids: [...old.ids, ...item.ids],
            thinking: old.thinking + item.thinking,
            answer: old.answer + item.answer,
          };
          checkpoint.current = next;
          setTrace(next);
        } else if (item.type === 'done') {
          setPhase('finished');
          if (item.limited) setNotice('The model reached its output limit.');
          return;
        }
      }
      throw Error('The stream ended early.');
    } catch (err) {
      if (active.current === req) {
        setPhase('paused');
        setNotice(
          'The connection was interrupted. You can resume from here. ' +
            err.message,
        );
      }
    } finally {
      if (active.current === req) active.current = null;
    }
  }
  const composer =
    phase === 'finished' ? (
      <button className="secondary" onClick={reset}>
        New prompt
      </button>
    ) : (
      <ChatInput
        ref={editor}
        value={running ? '' : prompt}
        readOnly={running}
        onChange={setPrompt}
        onSubmit={send}
        label={phase === 'paused' ? 'Edit your prompt' : 'Your prompt'}
        action={phase === 'paused' ? 'Resume' : 'Send'}
        placeholder={running ? 'Pause to edit your prompt…' : 'Ask a question…'}
        tools={
          phase === 'idle' ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                setPrompt(example);
                editor.current?.focus();
              }}
            >
              Try an example
            </button>
          ) : (
            phase === 'paused' && (
              <button type="button" className="link" onClick={reset}>
                Start over
              </button>
            )
          )
        }
        control={
          running ? (
            <InputGroupButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={pause}
            >
              <Pause />
              Pause &amp; edit
            </InputGroupButton>
          ) : undefined
        }
      />
    );

  return (
    <>
      <Chat
        title="Edit a prompt mid-generation."
        description="Ask Qwen3-8B a question. Pause while it’s reasoning, edit your prompt, and see what it writes next."
        empty={!submitted}
        busy={running}
        composer={composer}
      >
        <ChatTurn id="prompt" question={submitted}>
          {trace.edits.length > 0 && (
            <details>
              <summary>Prompt edits ({trace.edits.length})</summary>
              {trace.edits.map((x, i) => (
                <p key={i}>
                  After {x.position} tokens: “{x.previous}” → “{x.next}”
                </p>
              ))}
            </details>
          )}
          {trace.thinking && (
            <Reasoning
              title="Reasoning"
              text={trace.thinking}
              expanded={!trace.answer}
            />
          )}
          {trace.answer && <p className="answer">{trace.answer}</p>}
          {running && !trace.ids.length && (
            <p role="status" className="muted">
              Waiting for the model…
            </p>
          )}
          {phase === 'paused' && !notice && (
            <p role="status" className="muted">
              Paused. Edit your prompt below to continue.
            </p>
          )}
          {notice && (
            <p role="status" className="muted">
              {notice}
            </p>
          )}
        </ChatTurn>
      </Chat>
      <dialog
        ref={intro}
        className="intro-dialog"
        aria-labelledby="intro-title"
        aria-describedby="intro-copy"
        onClose={closeIntro}
      >
        <h2 id="intro-title">Dynamic context</h2>
        <p id="intro-copy">
          What happens when you change what a model sees while it’s reasoning?
          Try it with a prompt you can edit, memories it can retrieve, or words
          you’re still speaking.
        </p>
        <form method="dialog">
          <Button type="submit">Go</Button>
        </form>
      </dialog>
    </>
  );
}
