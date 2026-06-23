/** DEFVALUE image/path fields stored as \\GFASORCL\\... (no drive letter). */

export const GFAS_FILE_PICKER_KEYS = new Set([
  'DEF_PIC',
  'SALE_LOGO',
  'SIGNATURE_FILE',
  'BANK_QR_LOGO',
  'SALE_LOGO2',
]);

const GFAS_ROOT_TOKEN = '\\GFASORCL';

/**
 * Normalize a path to VFP style: \\GFASORCL\\LOGO\\FILE.JPG (strip D:/E:/F: etc).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeGfasorclFilePath(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  s = s.replace(/\//g, '\\');
  s = s.replace(/^[A-Za-z]:/i, '');

  const upper = s.toUpperCase();
  const rootIdx = upper.indexOf(GFAS_ROOT_TOKEN);
  if (rootIdx >= 0) {
    s = s.slice(rootIdx);
  } else {
    const trimmed = s.replace(/^\\+/, '');
    s = trimmed ? `${GFAS_ROOT_TOKEN}\\${trimmed}` : GFAS_ROOT_TOKEN;
  }

  return s.replace(/\\{2,}/g, '\\');
}

/** Relative path under GFASORCL root from a VFP path, e.g. LOGO\\LOR30S.JPG */
export function gfasorclRelativeFromVfpPath(vfpPath) {
  const normalized = normalizeGfasorclFilePath(vfpPath);
  if (!normalized || normalized.toUpperCase() === GFAS_ROOT_TOKEN) return '';
  const prefix = `${GFAS_ROOT_TOKEN}\\`;
  if (normalized.toUpperCase().startsWith(prefix.toUpperCase())) {
    return normalized.slice(prefix.length);
  }
  return '';
}

/** Parent VFP folder path or null at GFASORCL root. */
export function gfasorclParentVfpPath(vfpPath) {
  const normalized = normalizeGfasorclFilePath(vfpPath);
  if (!normalized || normalized.toUpperCase() === GFAS_ROOT_TOKEN) return null;
  const parts = normalized.split('\\').filter(Boolean);
  if (parts.length <= 1) return GFAS_ROOT_TOKEN;
  parts.pop();
  return `\\${parts.join('\\')}`;
}

/** Relative folder under GFASORCL for file browser (strips filename if present). */
export function gfasorclBrowseRelPath(vfpPath, defaultRel = 'LOGO') {
  let rel = gfasorclRelativeFromVfpPath(vfpPath);
  if (rel) {
    const parts = rel.split('\\').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (/\.[a-z0-9]{2,8}$/i.test(last)) parts.pop();
    rel = parts.join('\\');
  }
  if (!rel) {
    rel = String(defaultRel || 'LOGO')
      .trim()
      .replace(/\//g, '\\')
      .replace(/^\\+/, '')
      .replace(/^GFASORCL\\?/i, '');
  }
  return rel;
}
