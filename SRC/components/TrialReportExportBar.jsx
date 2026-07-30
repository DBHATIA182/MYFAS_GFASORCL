import React from 'react';
import ReportExportMenu from './ReportExportMenu';

export default function TrialReportExportBar({
  pdfBusy,
  onPdf,
  onExcel,
  onPrint,
  onWhatsApp,
  printDisabled,
}) {
  return (
    <div className="fas-tb-export-bar fas-tb-export-bar--menu">
      <ReportExportMenu
        onPdf={onPdf}
        onExcel={onExcel}
        onWhatsApp={onWhatsApp}
        onPrint={onPrint}
        showPrint={Boolean(onPrint)}
        printDisabled={printDisabled}
        pdfDisabled={pdfBusy}
        whatsAppDisabled={pdfBusy}
      />
    </div>
  );
}
