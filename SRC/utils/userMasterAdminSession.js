export function userMasterAdminStorageKey(compCode) {
  return `gfas.userMasterAdminToken.${String(compCode ?? '1').trim()}`;
}

export function loadUserMasterAdminToken(compCode) {
  try {
    return sessionStorage.getItem(userMasterAdminStorageKey(compCode)) || '';
  } catch {
    return '';
  }
}

export function saveUserMasterAdminToken(compCode, token) {
  try {
    const key = userMasterAdminStorageKey(compCode);
    if (token) sessionStorage.setItem(key, token);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore storage failures */
  }
}

/** Axios opts with VFP user.scx admin gate token (COMPANY.COMP_P_D). */
export function userMasterRequestOpts(compCode, adminToken, base = { withCredentials: true, timeout: 120000 }) {
  return {
    ...base,
    headers: {
      ...(base.headers || {}),
      'X-User-Master-Admin-Token': adminToken || '',
      'X-Comp-Code': String(compCode ?? '1').trim(),
    },
  };
}
