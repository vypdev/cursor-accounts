import { createRoot } from 'react-dom/client';
import { App } from './App';
import { logBridgeLifecycle } from './api/vscodeApi';
import { showBootError } from './bootError';

try {
  logBridgeLifecycle('react.boot-start', 'index.tsx executing');

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element #root not found');
  }

  logBridgeLifecycle('react.mount', 'createRoot.render starting');
  createRoot(root).render(<App />);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown webview startup error';
  logBridgeLifecycle('react.boot-error', message);
  showBootError(
    document.getElementById('root'),
    `Cursor Accounts failed to start: ${message}`
  );
  console.error('[Webview] Startup failed:', error);
}
