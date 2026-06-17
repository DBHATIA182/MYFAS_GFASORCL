import connectionConfig from '../../connection.config.json';

const API_OVERRIDE_KEY = 'gfas_api_base_override';

export function getSafeHostname() {
  try {
    return typeof window !== 'undefined' && window.location ? String(window.location.hostname || '') : '';
  } catch {
    return '';
  }
}

/** RFC1918 + loopback — phone on Wi‑Fi opening http://192.168.x.x:5173 */
export function isPrivateLanHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function normalizeApiBase(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  return s.replace(/\/+$/, '');
}

function readApiOverride() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return normalizeApiBase(window.localStorage.getItem(API_OVERRIDE_KEY));
  } catch {
    return '';
  }
}

export function saveApiBaseOverride(url) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const v = normalizeApiBase(url);
    if (v) window.localStorage.setItem(API_OVERRIDE_KEY, v);
    else window.localStorage.removeItem(API_OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

/** e.g. dal-demo.fasaccountingsoftware.in → dal-demo (not dal). */
export function getClientKeyFromHost(host, rootDomain) {
  if (!host || !rootDomain) return null;
  const suffix = `.${rootDomain}`;
  if (!host.endsWith(suffix)) return null;
  const subdomain = host.slice(0, -suffix.length).toLowerCase();
  if (!subdomain || subdomain.includes('.')) return null;
  return subdomain;
}

export function buildRemoteApiBase(clientKey, config = connectionConfig) {
  if (!clientKey) return '';
  if (config.apiBase) return normalizeApiBase(config.apiBase);
  const fromConfig = config.clients?.[clientKey]?.apiBase;
  if (fromConfig) return normalizeApiBase(fromConfig);
  const rootDomain = config.domain?.rootDomain || 'fasaccountingsoftware.in';
  const apiSubdomainSuffix = config.domain?.apiSubdomainSuffix || '-api';
  return `https://${clientKey}${apiSubdomainSuffix}.${rootDomain}`;
}

/**
 * Web app host (e.g. dal-modern.fasaccountingsoftware.in), not the *-api host.
 * API calls use same-origin /api so Cloudflare → Vite :5173 → Node :5002 (desktop + mobile).
 */
export function isFasWebAppHost(hostname, config = connectionConfig) {
  const root = String(config.domain?.rootDomain || '').trim().toLowerCase();
  const apiSuffix = String(config.domain?.apiSubdomainSuffix || '-api').toLowerCase();
  const h = String(hostname || '').trim().toLowerCase();
  if (!root || !h.endsWith(`.${root}`)) return false;
  const sub = h.slice(0, -(`.${root}`.length));
  if (!sub || sub.includes('.')) return false;
  if (apiSuffix && sub.endsWith(apiSuffix)) return false;
  return true;
}

/** Join API base + path; empty base → same-origin path (required for tunnel / Vite proxy). */
export function apiUrl(apiBase, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = normalizeApiBase(apiBase);
  return base ? `${base}${p}` : p;
}

/**
 * Where the browser should call /api/* — critical for mobile on LAN (not localhost).
 */
export function resolveApiBase(options = {}) {
  const {
    isDev = false,
    hostname = getSafeHostname(),
    config = connectionConfig,
    remoteApiBase = '',
  } = options;

  const override = readApiOverride();
  if (override) return override;

  const apiPort = Number(config.local?.apiPort || config.local?.apiBase?.match(/:(\d+)/)?.[1] || 5002) || 5002;
  const host = String(hostname || '').toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  const onLan = isPrivateLanHost(host);

  // GFASORCL cloud (demo.fasaccountingsoftware.in) → tunnel to Vite :5173 → /api proxy → :5002
  if (isFasWebAppHost(host, config)) {
    return '';
  }

  // GFASORCL dev: always Vite :5173 → /api proxy → :5002 (localhost, demo tunnel, or phone on :5173)
  if (isDev) {
    return '';
  }

  if (isLoopback) {
    return normalizeApiBase(config.local?.apiBase) || `http://localhost:${apiPort}`;
  }

  if (onLan) {
    return `http://${host}:${apiPort}`;
  }

  return normalizeApiBase(remoteApiBase);
}

export function formatApiBaseForDisplay(apiBase) {
  const s = normalizeApiBase(apiBase);
  if (!s) return 'Same page (/api proxy)';
  return s;
}

export function readApiBaseOverride() {
  return readApiOverride();
}

export { API_OVERRIDE_KEY };
