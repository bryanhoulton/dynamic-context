import { Mic, MicOff } from 'lucide-react';
import { Reasoning } from './components/Lab';
import { Chat, ChatTurn } from './components/Chat';
import { Button } from './components/ui/button';
import { TranscriptInspector } from './components/TranscriptInspector';
import { VOICE_API } from './demo/config';
import { useWebSocketVoice } from './hooks/useWebSocketVoice';

export default function Voice() {
  const v = useWebSocketVoice(VOICE_API);
  const connecting = v.stage === 'permission' || v.stage === 'connecting';
  const live = v.stage === 'live';
  const active = connecting || live;
  let title = 'Voice chat';
  let description =
    'Speak to Qwen3-8B and watch its plan change as you add details.';
  if (connecting) {
    title = 'Connecting…';
    description =
      v.stage === 'permission'
        ? 'Allow microphone access to start the session.'
        : 'Starting the voice service. The first connection can take a minute.';
  } else if (live) {
    title = v.muted ? 'Microphone muted' : 'Listening…';
    description = v.muted
      ? 'Unmute your microphone to speak.'
      : 'Start speaking to see your words and the model’s plan.';
  }
  const composer = (
    <>
      {live && v.transcript && (
        <p role="status" className="muted">
          {v.muted ? 'Microphone muted' : v.phase}
        </p>
      )}
      <div className="voice-actions">
        {!active ? (
          <Button onClick={v.start}>
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
      </div>
      {v.error && <p role="alert">{v.error}</p>}
    </>
  );
  return (
    <Chat
      title={title}
      icon={Mic}
      description={description}
      empty={!v.transcript}
      busy={active}
      composer={composer}
      aside={
        v.steps.length > 0 && (
          <TranscriptInspector steps={v.steps} live={live} />
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
