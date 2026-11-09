import { useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Reasoning } from './components/Lab';
import { Chat, ChatTurn } from './components/Chat';
import { Button } from './components/ui/button';
import { TranscriptInspector } from './components/TranscriptInspector';
import { VOICE_API } from './demo/config';
import example from './demo/voice-example.json';
import { useWebSocketVoice } from './hooks/useWebSocketVoice';

export default function Voice() {
  const v = useWebSocketVoice(VOICE_API);
  const [recorded, setRecorded] = useState(false);
  const [session, setSession] = useState(0);
  const active = ['permission', 'connecting', 'live'].includes(v.stage);
  const steps = recorded ? example.steps : v.steps;
  function start() {
    setRecorded(false);
    setSession((n) => n + 1);
    v.start();
  }
  const composer = (
    <>
      {active && (
        <p role="status" className="muted">
          {v.stage === 'live'
            ? v.muted
              ? 'Microphone muted'
              : v.phase
            : v.stage === 'connecting'
              ? 'Connecting to the model…'
              : 'Waiting for microphone access…'}
        </p>
      )}
      <div className="voice-actions">
        {!active ? (
          <Button onClick={start}>
            <Mic />
            Start microphone
          </Button>
        ) : (
          <>
            {v.stage === 'live' && (
              <Button variant="secondary" onClick={v.toggleMute}>
                {v.muted ? <MicOff /> : <Mic />}
                {v.muted ? 'Unmute' : 'Mute'} microphone
              </Button>
            )}
            <button className="link" onClick={v.end}>
              {v.stage === 'live' ? 'End session' : 'Cancel'}
            </button>
          </>
        )}
        {!active && !recorded && (
          <button className="link" onClick={() => setRecorded(true)}>
            See a recorded example
          </button>
        )}
      </div>
      {v.error && <p role="alert">{v.error}</p>}
    </>
  );
  return (
    <Chat
      title="Think while I speak."
      icon={Mic}
      description="Qwen3-8B starts planning while you speak. Try adding a detail that changes what it should say."
      empty={!v.transcript}
      busy={active}
      composer={composer}
      aside={
        steps.length > 0 && (
          <TranscriptInspector
            key={recorded ? 'recorded' : session}
            steps={steps}
            live={active}
            recorded={recorded}
            onClose={() => setRecorded(false)}
          />
        )
      }
    >
      {v.previousTurns.map((previous, i) => (
        <ChatTurn key={i} id={'voice-' + i} question={previous.transcript}>
          {previous.plan && (
            <Reasoning title="Model’s plan" text={previous.plan} />
          )}
          {previous.answer && <p className="answer">{previous.answer}</p>}
        </ChatTurn>
      ))}
      <ChatTurn
        key={v.previousTurns.length}
        id={'voice-' + v.previousTurns.length}
        question={v.transcript}
      >
        {v.plan && (
          <Reasoning
            title="Model’s plan"
            text={v.plan}
            expanded={active && !v.answer}
          />
        )}
        {v.answer && <p className="answer">{v.answer}</p>}
      </ChatTurn>
    </Chat>
  );
}
