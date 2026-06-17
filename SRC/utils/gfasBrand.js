/** GFASORCL\\APPTEST product branding (from connection.config.json). */
import connectionConfig from '../../connection.config.json';

const product = connectionConfig.product || {};
const displayName = String(product.displayName || 'GRAINFAS').trim() || 'GRAINFAS';
const projectName = String(product.projectName || 'GFASORCL').trim() || 'GFASORCL';
const displayTitle =
  String(product.displayTitle || '').trim() || `(FAS) ${displayName} - Financial Accounting System`;

export const GFAS_BRAND = {
  projectName,
  fasPrefix: '(FAS)',
  productName: displayName,
  appName: `${displayName} Accounting`,
  tagline: 'Financial Accounting System',
  logoLetter: displayName.charAt(0).toUpperCase() || 'G',
  documentTitle: displayTitle,
  footerNote: `${projectName} • ${displayName} • Oracle`,
};

export function getDefaultAppName() {
  return GFAS_BRAND.appName;
}

export function getGfasDocumentTitle(configTitle) {
  const custom = String(configTitle || '').trim();
  if (custom && !/mahavira|mffas|windal/i.test(custom)) {
    return custom;
  }
  return GFAS_BRAND.documentTitle;
}
