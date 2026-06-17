/** VFP MASTER codes are 1 letter + 5 digits (e.g. O06004). PUREXP may store legacy numeric (006004). */

export function purExpLegacyMasterCode(code) {
  const c = String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
  if (!c) return '';
  if (/^[A-Z]\d{5}$/.test(c)) return c;
  if (/^\d+$/.test(c)) {
    const n = parseInt(c, 10);
    if (!Number.isFinite(n) || n < 0) return c;
    return `O${String(n).padStart(5, '0').slice(-5)}`;
  }
  return c;
}

export function purExpAccountCodeAliases(code) {
  const c = String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
  if (!c) return [];
  const out = new Set([c]);
  const legacy = purExpLegacyMasterCode(c);
  if (legacy) out.add(legacy);
  if (/^[A-Z]\d{5}$/.test(c)) {
    const digits = c.slice(1);
    out.add(digits);
    out.add(digits.padStart(6, '0'));
  }
  return [...out];
}

export function buildPurExpAccountNameMap(accounts) {
  const m = new Map();
  for (const a of accounts || []) {
    const code = String(a.CODE ?? a.code ?? '')
      .trim()
      .toUpperCase();
    const name = String(a.NAME ?? a.name ?? '').trim();
    if (!code || !name) continue;
    for (const key of purExpAccountCodeAliases(code)) {
      if (!m.has(key)) m.set(key, name);
    }
  }
  return m;
}

export function resolvePurExpAccountName(code, nameByCode) {
  if (!nameByCode) return '';
  for (const key of purExpAccountCodeAliases(code)) {
    const name = nameByCode.get(key);
    if (name) return name;
  }
  return '';
}
