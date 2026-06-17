/** Parse / build VFP USERS.Fn 4-character rights strings (1110 = access,add,edit,no delete). */

export function rightsBitsFromString(s) {
  const str = String(s ?? '').trim();
  const ch = (i) => (str.length > i ? str.charAt(i) : '0');
  const bit = (i) => ch(i) === '1';
  return {
    access: bit(0),
    add: bit(1),
    edit: bit(2),
    delete: bit(3),
    raw: str.padEnd(4, '0').slice(0, 4),
  };
}

export function rightsStringFromBits({ access, add, edit, delete: del }) {
  return [
    access ? '1' : '0',
    add ? '1' : '0',
    edit ? '1' : '0',
    del ? '1' : '0',
  ].join('');
}

export function normalizeRightsField(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return rightsStringFromBits({});
  const padded = raw.padEnd(4, '0').slice(0, 4);
  return rightsStringFromBits(rightsBitsFromString(padded));
}

export function mapRowModuleRights(row) {
  const mods = {};
  for (let i = 1; i <= 13; i++) {
    const k = `F${i}`;
    const raw = row?.[k] ?? row?.[k.toLowerCase()] ?? '';
    mods[k] = normalizeRightsField(raw);
  }
  return mods;
}

export function buildModuleRightsPayload(formModules) {
  const out = {};
  for (let i = 1; i <= 13; i++) {
    const k = `F${i}`;
    const bits = formModules?.[k] || formModules?.[k.toLowerCase()] || {};
    out[k] = rightsStringFromBits(bits);
  }
  return out;
}
