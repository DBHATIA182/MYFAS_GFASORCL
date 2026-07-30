/**
 * Live VFP9 GFASORCL install paths (desktop app).
 * Web module configs reference these for menu, forms, PRG, and reports.
 */
export const GFASORCL_VFP_ROOT = 'e:\\gfasorcl';

export const GFASORCL_VFP_PATHS = {
  root: GFASORCL_VFP_ROOT,
  menu: `${GFASORCL_VFP_ROOT}\\menu`,
  menuMpr: `${GFASORCL_VFP_ROOT}\\menu\\BW_MENU.MPR`,
  menuMnx: `${GFASORCL_VFP_ROOT}\\menu\\bw_menu.mnx`,
  forms: `${GFASORCL_VFP_ROOT}\\forms`,
  prg: `${GFASORCL_VFP_ROOT}\\prg`,
  reports: `${GFASORCL_VFP_ROOT}\\reports`,
};

/** Prefix relative VFP asset paths for display (forms/foo.scx → full path hint). */
export function gfasorclVfpFileLabel(relativePath) {
  const p = String(relativePath || '').trim().replace(/^[/\\]+/, '');
  if (!p) return '';
  if (/^(forms|prg|reports|menu)[/\\]/i.test(p)) {
    return `${GFASORCL_VFP_ROOT}\\${p.replace(/\//g, '\\')}`;
  }
  if (/^menu[/\\]/i.test(p)) return `${GFASORCL_VFP_PATHS.menu}\\${p.split(/[/\\]/).pop()}`;
  return `${GFASORCL_VFP_ROOT}\\${p.replace(/\//g, '\\')}`;
}
