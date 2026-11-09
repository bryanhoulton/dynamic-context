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

export function useWebSocketVoice(serverUrl) {
  const session = useRef(null);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [plan, setPlan] = useState('');
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState('');
  const [steps, setSteps] = useState([]);
  const [previousTurns, setPreviousTurns] = useState([]);
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
      completed: false,
      turn: { transcript: '', plan: '', answer: '' },
    };
    session.current = s;
    setPreviousTurns([]);
    setStage('permission');
    setError('');
    setSteps([]);
    setMuted(false);
    setTranscript('');
    setPlan('');
    setAnswer('');
    setPhase('Listening');
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
            if (s.completed && !m.is_final) {
              s.completed = false;
              const previous = s.turn;
              setPreviousTurns((turns) => [...turns, previous]);
              s.turn = { transcript: '', plan: '', answer: '' };
              setAnswer('');
              setPlan('');
              setSteps([]);
            }
            s.turn.transcript = m.full_transcript ?? m.text;
            setTranscript(s.turn.transcript);
            break;
          case 'context_injection':
            setSteps((prev) => [
              ...prev,
              { before: m.old, after: m.new, prefix: '' },
            ]);
            break;
          case 'context':
            setSteps((prev) =>
              !prev.at(-1)?.prefix && prev.length
                ? [...prev.slice(0, -1), { ...prev.at(-1), prefix: m.prompt }]
                : prev,
            );
            break;
          case 'restart_thinking':
            s.turn.plan = '';
            s.turn.answer = '';
            setPlan('');
            setAnswer('');
            break;
          case 'thinking_start':
            setPhase('Planning while listening');
            break;
          case 'thinking_stalled':
            setPhase('Waiting for more speech');
            break;
          case 'thinking_unstalled':
            setPhase('Planning while listening');
            break;
          case 'thinking_end':
            setPhase('Generating reply');
            break;
          case 'token':
            s.turn[m.is_thinking ? 'plan' : 'answer'] += m.t;
            (m.is_thinking ? setPlan : setAnswer)((t) => t + m.t);
            break;
          case 'response_complete':
            s.completed = true;
            setPhase('Reply complete');
            break;
          case 'tts_audio':
            playPcm(s, m.audio);
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
    phase,
    muted,
    error,
    transcript,
    previousTurns,
    plan,
    answer,
    steps,
    start,
    end: () => end(),
    toggleMute,
  };
}
