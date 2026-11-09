import { useEffect, useRef, useState } from 'react';

function base64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function playPcm(session, encoded) {
  const pcm = new Int16Array(
    Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer,
  );
  const buffer = session.ctx.createBuffer(1, pcm.length, 24000);
  buffer.copyToChannel(
    Float32Array.from(pcm, (n) => n / 32768),
    0,
  );
  const source = session.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(session.ctx.destination);
  const when = Math.max(session.ctx.currentTime, session.playAt);
  session.playback.add(source);
  source.onended = () => session.playback.delete(source);
  source.start(when);
  session.playAt = when + buffer.duration;
}
function release(s) {
  if (!s) return;
  s.controller.abort();
  clearTimeout(s.timeout);
  if (s.ws) {
    s.ws.onmessage = s.ws.onerror = s.ws.onclose = null;
    s.ws.close();
  }
  s.stream?.getTracks().forEach((track) => track.stop());
  s.source?.disconnect();
  s.capture?.disconnect();
  if (s.ctx && s.ctx.state !== 'closed') s.ctx.close().catch(() => {});
}

function updateTurns(turns, event) {
  const last = turns.at(-1);
  if (event.type === 'transcript' && (!last || event.turn_id > last.id)) {
    return [
      ...turns,
      {
        id: event.turn_id,
        transcript: event.full_transcript,
        reasoning: '',
        answer: '',
        final: event.is_final,
        complete: false,
      },
    ];
  }
  if (!last || last.id !== event.turn_id) return turns;
  let next;
  switch (event.type) {
    case 'transcript':
      next = {
        ...last,
        transcript: event.full_transcript,
        final: event.is_final,
      };
      break;
    case 'token':
      next = {
        ...last,
        [event.is_thinking ? 'reasoning' : 'answer']: event.full_text,
      };
      break;
    case 'response_complete':
      next = { ...last, complete: true };
      break;
    case 'audio_error':
      next = { ...last, audioError: true };
      break;
    default:
      return turns;
  }
  return [...turns.slice(0, -1), next];
}

export function useWebSocketVoice(serverUrl) {
  const session = useRef(null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState([]);
  useEffect(
    () => () => {
      const s = session.current;
      session.current = null;
      release(s);
    },
    [],
  );

  function end(problem = '') {
    const s = session.current;
    session.current = null;
    release(s);
    setStage('ended');
    setMuted(false);
    setError(problem);
  }

  async function start() {
    if (session.current) return;
    const s = {
      controller: new AbortController(),
      playAt: 0,
      playback: new Set(),
      turnId: null,
    };
    session.current = s;
    setTurns([]);
    setStage('permission');
    setError('');
    setMuted(false);
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      s.ctx = new AC();
      await s.ctx.resume();
      if (session.current !== s) return;
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (session.current !== s) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      s.stream = mic;
      await s.ctx.audioWorklet.addModule('/mic-capture.js');
      if (session.current !== s) return;
      s.source = s.ctx.createMediaStreamSource(mic);
      s.capture = new AudioWorkletNode(s.ctx, 'mic-capture');
      s.capture.port.onmessage = ({ data }) => {
        if (s.ready && s.ws?.readyState === WebSocket.OPEN)
          s.ws.send(JSON.stringify({ type: 'audio', audio: base64(data) }));
      };
      s.source.connect(s.capture).connect(s.ctx.destination);
      setStage('connecting');
      // An HTTP request can wait for a cold GPU before the browser's shorter
      // WebSocket upgrade deadline begins. Cancellation releases both transports.
      s.timeout = setTimeout(() => {
        if (session.current === s && !s.ready)
          end('The voice service took too long to start. Please try again.');
      }, 240000);
      const url = new URL(
        serverUrl.endsWith('/') ? serverUrl : serverUrl + '/',
      );
      const health = await fetch(new URL('health', url), {
        signal: s.controller.signal,
        cache: 'no-store',
      });
      if (!health.ok || (await health.json()).status !== 'ok')
        throw Error('The voice model is unavailable. Please try again.');
      if (session.current !== s) return;
      const socketUrl = new URL('ws', url);
      socketUrl.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
      const ws = new WebSocket(socketUrl);
      s.ws = ws;
      ws.onclose = () => {
        if (session.current === s)
          end(
            'The voice service disconnected. Start a new session to reconnect.',
          );
      };
      ws.onerror = () => {
        if (session.current === s)
          end('Could not connect to the voice service. Try again.');
      };
      ws.onmessage = ({ data }) => {
        if (session.current !== s) return;
        const m = JSON.parse(data);
        switch (m.type) {
          case 'connected':
            s.ready = true;
            clearTimeout(s.timeout);
            setStage('live');
            break;
          case 'transcript':
            if (s.turnId === null || m.turn_id > s.turnId) {
              // Stop queued speech as soon as the user begins the next turn.
              for (const source of s.playback) source.stop();
              s.playback.clear();
              s.playAt = 0;
              s.turnId = m.turn_id;
            }
            setTurns((prev) => updateTurns(prev, m));
            break;
          case 'token':
          case 'response_complete':
          case 'audio_error':
            setTurns((prev) => updateTurns(prev, m));
            break;
          case 'tts_audio':
            if (m.turn_id === s.turnId) playPcm(s, m.audio);
            break;
          case 'error':
            end(m.message || 'The voice service reported an error.');
            break;
        }
      };
    } catch (err) {
      if (session.current === s)
        end(
          err.name === 'NotAllowedError'
            ? 'Microphone access was denied. Allow microphone access in your browser and try again.'
            : 'Could not start the voice session: ' + err.message,
        );
    }
  }
  function toggleMute() {
    const track = session.current?.stream?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }
  return {
    stage,
    muted,
    error,
    turns,
    start,
    end: () => end(),
    toggleMute,
  };
}
