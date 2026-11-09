import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, Navigate } from 'react-router-dom';
import { PostHogProvider } from 'posthog-js/react';
import { Lab } from './components/Lab';
import Demo from './Demo';
import PromptDemo from './PromptDemo';
import Voice from './VoiceWebSocket';
import { LOCAL_POOL_API, MEMORY_API } from './demo/config';
import './index.css';

function App() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  const voice = ['/voice', '/voice-ws', '/voice-livekit'].includes(path);
  if (!voice && !['/', '/memory', '/demo', '/superdemo'].includes(path))
    return <Navigate to="/" replace />;
  const api = path === '/demo' ? LOCAL_POOL_API : MEMORY_API;
  const mode = voice ? 'voice' : path === '/' ? 'prompt' : 'memory';
  return (
    <Lab mode={mode}>
      {voice ? (
        <Voice />
      ) : mode === 'prompt' ? (
        <PromptDemo />
      ) : (
        <Demo key={api} api={api} />
      )}
    </Lab>
  );
}

const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {import.meta.env.VITE_PUBLIC_POSTHOG_KEY ? (
      <PostHogProvider
        apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
        options={{
          api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        }}
      >
        {app}
      </PostHogProvider>
    ) : (
      app
    )}
  </React.StrictMode>,
);
