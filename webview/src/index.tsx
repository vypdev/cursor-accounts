import { createRoot } from 'react-dom/client';
import { App } from './App';

function showBootError(message: string): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  root.innerHTML = `<p style="padding:12px;color:var(--vscode-errorForeground,#f88);font-family:var(--vscode-font-family,sans-serif);">${message}</p>`;
}

try {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Root element #root not found');
  }

  createRoot(root).render(<App />);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unknown webview startup error';
  showBootError(`Cursor Accounts failed to start: ${message}`);
  console.error('[Webview] Startup failed:', error);
}
