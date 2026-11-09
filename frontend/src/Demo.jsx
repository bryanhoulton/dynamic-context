import { useEffect, useState } from 'react';
import { BookOpen, Check, Copy, Square } from 'lucide-react';
import { Chat, ChatInput, ChatTurn } from './components/Chat';
import { InputGroupButton } from './components/ui/input-group';
import { Highlighted, Reasoning } from './components/Lab';
import { useDynamicContextDemo } from './hooks/useDynamicContextDemo';
import { modelContext } from './demo/stream';
import { questions } from './demo/config';

function MemoryText({ text }) {
  // Key by the actual line so a retained note stays still when others are replaced.
  const counts = new Map();
  return (
    <span className="memory-text" aria-label="Retrieved memories">
      {text.match(/[^\n]*\n|[^\n]+$/g)?.map((line) => {
        const occurrence = (counts.get(line) ?? 0) + 1;
        counts.set(line, occurrence);
        return <span key={line + occurrence}>{line}</span>;
      })}
    </span>
  );
}

function CopyContext({ run }) {
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      className="copy-context"
      type="button"
      aria-label={status || 'Copy exact model context'}
      title={status || 'Copy exact model context'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(modelContext(run));
          setStatus('Copied');
        } catch {
          setStatus('Copy failed');
        }
      }}
    >
      {status === 'Copied' ? <Check size={15} /> : <Copy size={15} />}
      {status === 'Copy failed' && status}
    </button>
  );
}

export default function Demo({ api }) {
  const lab = useDynamicContextDemo(api);
  const { run, busy } = lab;
  function send(e) {
    e.preventDefault();
    if (!lab.input.trim() || busy) return;
    lab.send();
  }
  const tools = !run && (
    <button
      type="button"
      className="link"
      onClick={() =>
        lab.setInput(
          questions[(questions.indexOf(lab.input) + 1) % questions.length],
        )
      }
    >
      Another question
    </button>
  );
  return (
    <Chat
      title="Ask the family notebook."
      icon={BookOpen}
      description="Blue text shows the memories at the start of the model’s reasoning. Every 10 reasoning tokens, a new lookup can replace them."
      empty={!run}
      busy={busy}
      composer={
        <ChatInput
          label="Question"
          value={lab.input}
          readOnly={busy}
          onChange={lab.setInput}
          onSubmit={send}
          placeholder={busy ? 'Generating a response…' : 'Ask a new question…'}
          action="Send"
          tools={tools}
          control={
            busy ? (
              <InputGroupButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={lab.stop}
              >
                <Square /> Stop run
              </InputGroupButton>
            ) : undefined
          }
        />
      }
    >
      {run && (
        <ChatTurn id="memory" question={run.message}>
          {run.prefix && (
            <Reasoning title="Reasoning" expanded>
              <MemoryText text={run.memory} />
              <Highlighted text={run.thinking} range={run.range} />
            </Reasoning>
          )}
          {run.answer && <p className="answer">{run.answer}</p>}
          {run.prefix && <CopyContext run={run} />}
          {busy && !run.prefix && (
            <p role="status" className="muted">
              Retrieving memories…
            </p>
          )}
          {run.limited && (
            <p className="muted">The model reached its output limit.</p>
          )}
          {run.status === 'stopped' && (
            <p role="status" className="muted">
              Run stopped.
            </p>
          )}
          {run.status === 'error' && (
            <p role="alert">The run was interrupted. {run.error}</p>
          )}
        </ChatTurn>
      )}
    </Chat>
  );
}
