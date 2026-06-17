import { formatApiBaseForDisplay } from './resolveApiBase';

function extractServerMessage(err) {
  const data = err?.response?.data;
  if (!data) return '';
  if (typeof data === 'object' && data.error) return String(data.error);
  if (typeof data === 'string') {
    const t = data.trim();
    if (t.length && t.length < 500) return t;
  }
  return '';
}

/** User-facing login failure text (mobile LAN / API port / server 500). */
export function formatLoginError(err, apiBase) {
  const serverMsg = extractServerMessage(err);
  if (serverMsg) return serverMsg;

  const target = formatApiBaseForDisplay(apiBase);
  const status = err?.response?.status;

  if (status === 500) {
    return `Server error (500) at ${target}. Restart the API on the PC (npm run server, port 5002) and try again.`;
  }
  if (status === 404) {
    return `Login API not found (404) at ${target}. Start node server.cjs on port 5002 on the same PC as this app.`;
  }
  if (err?.code === 'ERR_NETWORK' || !err?.response) {
    return `Cannot reach API at ${target}. On mobile: use the PC’s Wi‑Fi IP (not localhost), same Wi‑Fi, API running, or set API server in Settings (⚙).`;
  }

  return err?.message || 'Login failed.';
}
