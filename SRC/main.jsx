import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

function renderFatalStartupMessage(errorLike) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root) return;
    const msg = String(errorLike?.message || errorLike || 'Unknown startup error');
    root.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937;">
        <h2 style="margin: 0 0 12px;">GRAINFAS Accounting</h2>
        <p style="margin: 0 0 10px; font-weight: 600;">App could not start on this browser.</p>
        <p style="margin: 0 0 8px;">Please refresh once. If it still fails, clear browser site data/cache.</p>
        <pre style="white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px;">${msg}</pre>
      </div>
    `;
  } catch {
    /* last-resort fallback only */
  }
}

try {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      renderFatalStartupMessage(event?.error || event?.message || 'Runtime error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      renderFatalStartupMessage(event?.reason || 'Unhandled promise rejection');
    });
  }

  const rootElement = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
} catch (err) {
  renderFatalStartupMessage(err);
}
