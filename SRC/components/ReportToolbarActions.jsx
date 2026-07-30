import React from 'react';
import ReportExportMenu from './ReportExportMenu';
import ReportHelpButton from './ReportHelpButton';

/**
 * Standard report toolbar: ? help (circle) · Back · ⋮ export menu · optional Menu.
 * Use on report result screens (desktop + mobile).
 */
export default function ReportToolbarActions({
  reportId,
  helpViewKey = null,
  helpProps = {},
  onBack,
  backLabel = '← Back',
  onPdf,
  onExcel,
  onWhatsApp,
  onPrint,
  showPdf = true,
  showExcel = true,
  showWhatsApp = true,
  showPrint = false,
  printDisabled = false,
  pdfDisabled = false,
  whatsAppDisabled = false,
  onMenu,
  menuLabel = 'Menu',
  menuClassName = 'btn btn-secondary',
  exportVariant = 'light',
  compactMobile = false,
  extra = null,
  className = '',
}) {
  return (
    <div
      className={`toolbar-actions toolbar-actions--export-menu${compactMobile ? ' toolbar-actions--compact-mobile' : ''}${className ? ` ${className}` : ''}`}
    >
      {reportId ? (
        <ReportHelpButton reportId={reportId} viewKey={helpViewKey} iconOnly {...helpProps} />
      ) : null}
      {onBack ? (
        <button type="button" className="btn btn-toolbar-back" onClick={onBack}>
          {backLabel}
        </button>
      ) : null}
      <ReportExportMenu
        onPdf={onPdf}
        onExcel={onExcel}
        onWhatsApp={onWhatsApp}
        onPrint={onPrint}
        showPdf={showPdf}
        showExcel={showExcel}
        showWhatsApp={showWhatsApp}
        showPrint={showPrint}
        printDisabled={printDisabled}
        pdfDisabled={pdfDisabled}
        whatsAppDisabled={whatsAppDisabled}
        variant={exportVariant}
      />
      {onMenu && !compactMobile ? (
        <button type="button" className={menuClassName} onClick={onMenu}>
          {menuLabel}
        </button>
      ) : null}
      {extra}
    </div>
  );
}
