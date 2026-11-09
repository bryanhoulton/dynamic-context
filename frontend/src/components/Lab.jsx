import { Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Lab({ mode, children }) {
  return (
    <>
      <header className="topbar">
        <Link className="wordmark" to="/">
          Dynamic context engineering
        </Link>
        <nav aria-label="Experiments">
          <Link aria-current={mode === 'prompt' ? 'page' : undefined} to="/">
            Prompt
          </Link>
          <Link
            aria-current={mode === 'memory' ? 'page' : undefined}
            to="/memory"
          >
            Memory
          </Link>
          <Link
            aria-current={mode === 'voice' ? 'page' : undefined}
            to="/voice"
          >
            Voice
          </Link>
        </nav>
        {import.meta.env.VITE_SOURCE_URL && (
          <a
            className="source-link"
            aria-label="Source code on GitHub"
            title="Source code"
            href={import.meta.env.VITE_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={18} />
          </a>
        )}
      </header>
      <main>{children}</main>
    </>
  );
}

export function Reasoning({ title, text, expanded, children }) {
  return (
    <details className="reasoning" open={expanded || undefined}>
      <summary>{title}</summary>
      <div className="scroll-text">{children ?? text}</div>
    </details>
  );
}

export function Highlighted({ text, range, offset = 0 }) {
  if (!range) return text;
  const start = Math.max(0, range[0] - offset);
  const end = Math.min(text.length, range[1] - offset);
  return start < end ? (
    <>
      {text.slice(0, start)}
      <mark title="Text used for the last retrieval query">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  ) : (
    text
  );
}
