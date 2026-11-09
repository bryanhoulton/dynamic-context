export const MEMORY_API =
  import.meta.env.VITE_SUPERMEMORY_API_URL ||
  'https://orin-labs--dynamic-context-memory.us-east.modal.run';
export const LOCAL_POOL_API =
  import.meta.env.VITE_API_URL ||
  'https://orin-labs--dynamic-context-local.us-east.modal.run';
export const VOICE_API =
  import.meta.env.VITE_VOICE_API_URL ||
  'https://bryanhoulton--websocket-voice-agent-voiceagent-web-app.modal.run';

export const questions = [
  'Should I renew my apartment lease? Give me one reason to stay and one to move.',
  'What birthday gift would Mom actually use?',
  'What are Mom and Dad looking forward to on their anniversary trip?',
];
export const defaults = {
  update_every_n: 10,
  lookback_tokens: 60,
  max_memories: 3,
};
