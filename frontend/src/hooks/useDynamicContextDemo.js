import { useEffect, useRef, useState } from 'react';
import { defaults, questions } from '../demo/config';
import { emptyRun, readEvent, readStream } from '../demo/stream';

export function useDynamicContextDemo(api) {
  const [input, setInput] = useState(questions[0]);
  const [run, setRun] = useState(null);
  const controller = useRef(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  async function send() {
    const message = input.trim();
    if (!message || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    let current = { ...emptyRun(), message, status: 'connecting' };
    setRun(current);
    setInput('');
    try {
      const res = await fetch(api + '/chat/stream', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...defaults }),
      });
      if (!res.ok || !res.body)
        throw Error('Service returned HTTP ' + res.status);
      for await (const e of readStream(res.body)) {
        if (controller.current !== request) return;
        const next = readEvent(current, e);
        if (next !== current) {
          current = { ...next, status: 'running' };
          setRun(current);
        }
      }
      if (!current.complete)
        throw Error('The stream ended before the turn finished.');
      if (controller.current !== request) return;
      current = { ...current, status: 'complete' };
    } catch (err) {
      if (controller.current !== request) return;
      current = {
        ...current,
        status: request.signal.aborted ? 'stopped' : 'error',
        error: err.message,
      };
      setInput(message);
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setRun(current);
      }
    }
  }
  return {
    input,
    setInput,
    run,
    send,
    stop: () => {
      const req = controller.current;
      if (!req) return;
      controller.current = null;
      req.abort();
      setRun((prev) => ({ ...prev, status: 'stopped' }));
      setInput(run.message);
    },
    busy: run?.status === 'connecting' || run?.status === 'running',
  };
}
