/** Initial-flow branding (reads product from connection.config when set). */
import connectionConfig from '../../connection.config.json';

const product = connectionConfig.product || {};
const displayName = String(product.displayName || 'GRAINFAS').trim() || 'GRAINFAS';
const displayTitle =
  String(product.displayTitle || '').trim() || `(FAS) ${displayName} - Financial Accounting System`;

export const WINDAL_BRAND = {
  fasPrefix: '(FAS)',
  productName: displayName,
  tagline: 'Financial Accounting System',
  logoLetter: displayName.charAt(0).toUpperCase() || 'G',
  documentTitle: displayTitle,
  footerNote: `Oracle • ${displayName}`,
};

export function getWindalDocumentTitle(configTitle) {
  const custom = String(configTitle || '').trim();
  if (custom && !/mahavira|mffas/i.test(custom)) {
    return custom;
  }
  return WINDAL_BRAND.documentTitle;
}
