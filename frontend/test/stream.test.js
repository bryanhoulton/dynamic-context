import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyRun,
  modelContext,
  readEvent,
  readStream,
} from '../src/demo/stream.js';

test('keeps a single memory slot before the trace and preserves raw control tokens', () => {
  const start = {
    type: 'context_start',
    prompt: 'Rent?',
    prefix: '<user>Rent?</user><think>',
    memory: 'old\n',
  };
  let run = readEvent(emptyRun(), start);
  run = readEvent(run, {
    type: 'output',
    thinking: 'look at rent',
    closing: '',
    answer: '',
    end: '',
  });
  run = readEvent(run, { type: 'lookup', memory: 'new\n', query: 'rent' });
  assert.equal(modelContext(run), start.prefix + 'new\nlook at rent');
  assert.equal(run.thinking.slice(...run.range), 'rent');
  run = readEvent(run, {
    type: 'output',
    thinking: 'look at rent first',
    closing: '</think>',
    answer: 'Stay.',
    end: '<end>',
  });
  assert.equal(run.thinking.slice(...run.range), 'rent');
  assert.equal(
    modelContext(run),
    start.prefix + 'new\nlook at rent first</think>Stay.<end>',
  );
  run = readEvent(run, {
    type: 'lookup',
    memory: '',
    query: 'unmatched token boundary',
  });
  assert.equal(run.memory, '');
  assert.equal(run.range, null);
});

test('refuses a legacy stream that inserts memories into a hidden system prompt', () => {
  assert.throws(
    () => readEvent(emptyRun(), { type: 'memories', memories: ['rent'] }),
    /model context/,
  );
});

test('reassembles split UTF-8 and processes a final event without a blank line', async () => {
  const wire = new TextEncoder().encode(
    'data: {"type":"lookup","memory":"café"}\r\n\r\ndata: {"type":"done"}',
  );
  const body = new ReadableStream({
    start(c) {
      for (const byte of wire) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const events = [];
  for await (const event of readStream(body)) events.push(event);
  assert.deepEqual(events, [
    { type: 'lookup', memory: 'café' },
    { type: 'done' },
  ]);
});
