export function compdetAccessStorageKey(compCode, compUid, compYear) {
  const code = String(compCode ?? '1').trim();
  const uid = String(compUid ?? '').trim();
  const year = String(compYear ?? '').trim();
  return `gfas.compdetAccess.${code}.${uid}.${year}`;
}

export function loadCompdetAccess(compCode, compUid, compYear) {
  try {
    const raw = sessionStorage.getItem(compdetAccessStorageKey(compCode, compUid, compYear));
    if (!raw) return { token: '', accessLevel: '' };
    const parsed = JSON.parse(raw);
    return {
      token: String(parsed?.token ?? '').trim(),
      accessLevel: String(parsed?.accessLevel ?? '').trim(),
    };
  } catch {
    return { token: '', accessLevel: '' };
  }
}

export function saveCompdetAccess(compCode, compUid, compYear, token, accessLevel) {
  try {
    const key = compdetAccessStorageKey(compCode, compUid, compYear);
    if (token) {
      sessionStorage.setItem(key, JSON.stringify({ token, accessLevel }));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore storage failures */
  }
}

export function compdetRequestOpts(compCode, accessToken, base = { withCredentials: true, timeout: 120000 }) {
  return {
    ...base,
    headers: {
      ...(base.headers || {}),
      'X-Compdet-Access-Token': accessToken || '',
      'X-Comp-Code': String(compCode ?? '1').trim(),
    },
  };
}
