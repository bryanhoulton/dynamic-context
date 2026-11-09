import { useState } from 'react';

function TranscriptChange({ step }) {
  // Recognition may revise words in the middle of a partial transcript.
  // Highlight only the changed suffix; never assume each event just appends words.
  const before = step.before.split(/\s+/);
  const after = step.after.split(/\s+/);
  let n = 0;
  while (n < before.length && n < after.length && before[n] === after[n]) n++;
  return (
    <div className="speech-diff">
      {step.before && (
        <p>
          <span>Before</span>
          {step.before}
        </p>
      )}
      <p>
        <span>In the prompt</span>
        {after.slice(0, n).join(' ')}
        {n > 0 && ' '}
        <mark>{after.slice(n).join(' ')}</mark>
      </p>
    </div>
  );
}

export function TranscriptInspector({ steps, live, recorded, onClose }) {
  const [pinned, setPinned] = useState(null);
  const index = Math.min(pinned ?? steps.length - 1, steps.length - 1);
  const step = steps[index];
  if (!step) return null;
  return (
    <section className="inspector" aria-label="Context inspector">
      <div className="inspector-title">
        <h2>Transcript changes</h2>
        {recorded && (
          <button className="link" onClick={onClose}>
            Close example
          </button>
        )}
      </div>
      {recorded && (
        <p className="muted">
          Recorded example: a speaker learns the station is closed.
        </p>
      )}
      <div className="timeline">
        <button
          aria-label="Previous change"
          disabled={index < 1}
          onClick={() => setPinned(index - 1)}
        >
          ←
        </button>
        <select
          aria-label="Select context change"
          value={pinned === null ? 'latest' : index}
          onChange={(e) =>
            setPinned(e.target.value === 'latest' ? null : +e.target.value)
          }
        >
          <option value="latest">
            {live ? 'Follow latest' : 'Latest'} · Transcript {steps.length}
          </option>
          {steps.map((_, i) => (
            <option key={i} value={i}>
              Transcript {i + 1}
            </option>
          ))}
        </select>
        <button
          aria-label="Next change"
          disabled={index === steps.length - 1}
          onClick={() => setPinned(index + 1)}
        >
          →
        </button>
      </div>
      <TranscriptChange step={step} />
      <details>
        <summary>Exact model input</summary>
        {step.prefix ? (
          <pre>{step.prefix}</pre>
        ) : (
          <p>No prompt text was reported at this step.</p>
        )}
      </details>
    </section>
  );
}
