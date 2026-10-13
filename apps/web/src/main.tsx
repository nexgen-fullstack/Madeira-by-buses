import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { lightStatusBar } from './lib/device.ts';
import { startPwa } from './lib/pwa.ts';
import './styles.css';

// Our website only in a window of its own: another site showing it in a frame under its own
// name gets the reader sent to the real one instead (the built site; not while developing).
if (import.meta.env.PROD && window.top !== window.self) {
  try {
    window.top!.location.replace(window.location.href);
  } catch {
    document.documentElement.style.display = 'none';
  }
}

startPwa();
lightStatusBar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
