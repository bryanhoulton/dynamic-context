export function emptyRun() {
  return {
    thinking: '',
    closing: '',
    answer: '',
    end: '',
    memory: '',
    range: null,
  };
}

export function readEvent(run, e) {
  if (e.type === 'context_start') {
    return { ...run, message: e.prompt, prefix: e.prefix, memory: e.memory };
  }
  if (!run.prefix)
    throw Error('This service did not supply the model context.');
  switch (e.type) {
    case 'lookup': {
      // Mark only the exact text used by the retriever. A window can begin
      // halfway through a Unicode character at a tokenizer boundary.
      const end = run.thinking.length;
      const range =
        e.query && run.thinking.endsWith(e.query)
          ? [end - e.query.length, end]
          : null;
      return { ...run, memory: e.memory, range };
    }
    case 'output': {
      const range =
        run.range &&
        e.thinking.slice(...run.range) === run.thinking.slice(...run.range)
          ? run.range
          : null;
      return {
        ...run,
        range,
        thinking: e.thinking,
        closing: e.closing,
        answer: e.answer,
        end: e.end,
      };
    }
    case 'done':
      return { ...run, complete: true, limited: e.limited };
    default:
      return run;
  }
}

export function modelContext(run) {
  return (
    run.prefix + run.memory + run.thinking + run.closing + run.answer + run.end
  );
}

// The service uses one JSON data line per SSE message. Network chunks may split UTF-8
// characters or contain several messages; decoding and framing are separate operations.
export async function* readStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buf += done
        ? decoder.decode() + '\n'
        : decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data:')) yield JSON.parse(line.slice(5));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
