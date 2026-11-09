import { Mic, MicOff } from 'lucide-react';
import { Reasoning } from './components/Lab';
import { Chat, ChatTurn } from './components/Chat';
import { Button } from './components/ui/button';
import { VOICE_API } from './demo/config';
import { useWebSocketVoice } from './hooks/useWebSocketVoice';

export default function Voice() {
  const v = useWebSocketVoice(VOICE_API);
  const connecting = v.stage === 'permission' || v.stage === 'connecting';
  const live = v.stage === 'live';
  const active = connecting || live;
  const latest = v.turns.at(-1);
  let title = 'Voice chat';
  let description =
    'Speak to Qwen3-8B. Follow its reasoning as you talk, then pause to hear its reply.';
  if (connecting) {
    title = 'Connecting…';
    description =
      v.stage === 'permission'
        ? 'Allow microphone access to start the session.'
        : 'Cold-starting GPUs. THis may take a minute';
  } else if (live) {
    title = v.muted ? 'Microphone muted' : 'Listening…';
    description = v.muted
      ? 'Unmute your microphone to speak.'
      : 'Start speaking to see your message and the model’s reasoning.';
  }
  const composer = (
    <>
      {live && latest && (
        <p role="status" className="muted">
          {v.muted
            ? 'Microphone muted'
            : latest.final && !latest.complete
              ? 'Answering…'
              : 'Listening…'}
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
      empty={!latest}
      busy={active}
      composer={composer}
    >
      {v.turns.map((turn) => (
        <ChatTurn
          key={turn.id}
          id={'voice-' + turn.id}
          question={turn.transcript}
        >
          {turn.reasoning && (
            <Reasoning
              title="Reasoning"
              text={turn.reasoning}
              expanded={turn.id === latest.id}
            />
          )}
          {turn.answer && <p className="answer">{turn.answer}</p>}
          {turn.audioError && (
            <p role="status" className="muted">
              Audio playback is unavailable for this reply.
            </p>
          )}
        </ChatTurn>
      ))}
    </Chat>
  );
}
