import React, { useMemo, useState, useEffect, useLayoutEffect } from 'react';
import ReportTable from './ReportTable';
import SaleBillPrintModal from './SaleBillPrintModal';
import LedgerReportContextCard from './LedgerReportContextCard';
import FasReportHeader from './FasReportHeader';
import LedgerMobileView from './LedgerMobileView';
import LedgerRowFilterBar from './LedgerRowFilterBar';
import LedgerExportMenu from './LedgerExportMenu';
import FlexAmount from './FlexAmount';
import SessionToolbarChrome from './SessionToolbarChrome';
import { computeLedgerSummary } from '../utils/ledgerSummary';
import {
  filterLedgerRows,
  countLedgerFilterStats,
  ledgerFilterIsActive,
  collectLedgerVrTypes,
} from '../utils/ledgerMobileDisplay';
import { toInputDateString } from '../utils/dateFormat';
import { generatePDF, sharePdfWithWhatsApp, buildReportHtml } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';
import { LEDGER_FLOW_STYLE, LEDGER_SHELL_STYLE, mountLedgerFullBleedLayout } from '../utils/ledgerFullBleedLayout';

function formatIndianAmount(val) {
  return (parseFloat(val) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function DrillLedgerShell({ slideClassName, header, children }) {
  useLayoutEffect(() => mountLedgerFullBleedLayout(), []);

  return (
    <div
      className={`slide ${slideClassName} fas-tb-host ledger-full-bleed fas-tb-host--results fas-ledger-host fas-ledger-host--desktop`}
      style={LEDGER_SHELL_STYLE}
    >
      <div className="fas-flow fas-tb-flow" style={LEDGER_FLOW_STYLE}>
        <div className="fas-ledger-sticky-top">{header}</div>
        <div className="fas-flow-body fas-tb-body">{children}</div>
      </div>
    </div>
  );
}

/** Desktop/mobile ledger drill-down with row filters (matches Trial Balance Slide 4). */
export default function TrialDrillLedgerView({
  appViewMode = 'desktop',
  slideClassName,
  onBack,
  helpReportId,
  formData,
  compName,
  compLedgerHeader,
  ledgerRows,
  ledgerTitle,
  ledgerAccountCode,
  ledgerPdfMeta,
  fyLine,
  hint = 'Tap a row for voucher detail; sale bill print opens where mapping is available.',
  ledgerStartDate,
  ledgerEndDate,
  pdfBusy,
  runPdfAction,
  onVoucherClick,
  onLedgerSaleBillClick,
  apiBase,
  compCode,
  compUid,
  billPrintOpen,
  setBillPrintOpen,
  billPrintParams,
  secondaryBackLabel,
  onSecondaryBack,
}) {
  const [ledgerRowFilter, setLedgerRowFilter] = useState('');
  const [ledgerAmountSide, setLedgerAmountSide] = useState('all');
  const [ledgerVrType, setLedgerVrType] = useState('all');

  useEffect(() => {
    setLedgerRowFilter('');
    setLedgerAmountSide('all');
    setLedgerVrType('all');
  }, [ledgerAccountCode, ledgerTitle]);

  const ledgerFirstRow = ledgerRows[0];
  const ledgerTotals = useMemo(() => computeLedgerSummary(ledgerRows), [ledgerRows]);
  const ledgerVrTypeOptions = useMemo(() => collectLedgerVrTypes(ledgerRows), [ledgerRows]);
  const ledgerFilterStats = useMemo(
    () =>
      countLedgerFilterStats(ledgerRows, ledgerRowFilter, {
        amountSide: ledgerAmountSide,
        vrType: ledgerVrType,
      }),
    [ledgerRows, ledgerRowFilter, ledgerAmountSide, ledgerVrType]
  );
  const filteredLedgerRows = useMemo(
    () =>
      filterLedgerRows(ledgerRows, ledgerRowFilter, {
        keepOpening: true,
        amountSide: ledgerAmountSide,
        vrType: ledgerVrType,
      }),
    [ledgerRows, ledgerRowFilter, ledgerAmountSide, ledgerVrType]
  );

  const startDate =
    ledgerStartDate || toInputDateString(formData?.comp_s_dt ?? formData?.COMP_S_DT);
  const endDate = ledgerEndDate || toInputDateString(formData?.comp_e_dt ?? formData?.COMP_E_DT);

  const downloadLedgerPdf = () => runPdfAction(() => generatePDF('ledger', ledgerRows, ledgerPdfMeta));

  const shareLedgerWhatsApp = () =>
    runPdfAction(() =>
      sharePdfWithWhatsApp(
        'ledger',
        ledgerRows,
        ledgerPdfMeta,
        `Ledger — ${compName}\n${ledgerTitle} (${ledgerAccountCode})\n${fyLine || ''}`
      )
    );

  const billPrintModal = (
    <SaleBillPrintModal
      open={billPrintOpen}
      onClose={() => setBillPrintOpen(false)}
      apiBase={apiBase}
      compCode={compCode}
      compUid={compUid}
      billParams={billPrintParams}
      companyName={compName}
    />
  );

  if (appViewMode === 'mobile') {
    return (
      <>
        <LedgerMobileView
          companyName={compName}
          accountName={ledgerTitle}
          accountCode={ledgerAccountCode}
          startDate={startDate}
          endDate={endDate}
          opening={ledgerTotals.opening}
          sumDr={ledgerTotals.sumDr}
          sumCr={ledgerTotals.sumCr}
          closing={ledgerTotals.closing}
          rows={ledgerRows}
          onBack={onBack}
          onVoucherClick={onVoucherClick}
          onLedgerSaleBillClick={onLedgerSaleBillClick}
          onExportPdf={() => downloadLedgerPdf().catch((e) => alert(e?.message || String(e)))}
          onExportExcel={() => {
            try {
              downloadExcelRows(ledgerRows, 'Ledger', `${compName}_Ledger_${ledgerAccountCode}`);
            } catch (e) {
              alert(String(e?.message || e));
            }
          }}
          onExportWhatsApp={() => shareLedgerWhatsApp().catch((e) => alert(e?.message || String(e)))}
          helpReportId={helpReportId}
          helpCompanyName={compName}
        />
        {billPrintModal}
      </>
    );
  }

  return (
    <DrillLedgerShell
      slideClassName={slideClassName}
      header={
        <FasReportHeader
          className="fas-report-header--ledger-desktop"
          title="Ledger Report"
          onBack={onBack}
          rightSlot={
            <>
              <LedgerExportMenu
                printDisabled={!ledgerRows.length}
                onPdf={() => downloadLedgerPdf().catch((e) => alert(e?.message || String(e)))}
                onWhatsApp={() => shareLedgerWhatsApp().catch((e) => alert(e?.message || String(e)))}
                onExcel={() => {
                  try {
                    downloadExcelRows(ledgerRows, 'Ledger', `${compName}_Ledger_${ledgerAccountCode}`);
                  } catch (e) {
                    alert(String(e?.message || e));
                  }
                }}
                onPrint={() => {
                  if (!ledgerRows.length) return;
                  const html = buildReportHtml('ledger', ledgerRows, ledgerPdfMeta);
                  printHtmlDocument(html, { title: 'Ledger Report' });
                }}
              />
              <SessionToolbarChrome
                helpReportId={helpReportId}
                helpViewKey="ledger"
                helpCompanyName={compName}
              />
            </>
          }
        />
      }
    >
      {pdfBusy ? (
        <p className="fas-tb-status-hint" role="status">
          Preparing PDF for share…
        </p>
      ) : null}

      <nav className="fas-ledger-desktop-crumb" aria-label="Breadcrumb">
        <span className="fas-ledger-desktop-crumb__sep">/</span>
        <span>Ledger</span>
        <span className="fas-ledger-desktop-crumb__sep">/</span>
        <span className="fas-ledger-desktop-crumb__account" title={ledgerTitle}>
          {ledgerTitle || 'Account'}
        </span>
      </nav>

      <LedgerReportContextCard
        compHeader={compLedgerHeader}
        companyNameFallback={compName}
        account={ledgerFirstRow}
        accountNameFallback={ledgerTitle}
        accountCodeFallback={ledgerAccountCode}
        fyLine={fyLine}
        hint={hint}
      />

      <div className="fas-ledger-totals">
        <div className="fas-tb-total-card fas-ledger-total-card--opening">
          <div className="fas-tb-total-card__label">Opening Balance</div>
          <FlexAmount
            className="fas-tb-total-card__value"
            value={formatIndianAmount(ledgerTotals.opening)}
            prefix="₹"
          />
        </div>
        <div className="fas-tb-total-card fas-tb-total-card--debit fas-ledger-total-card--debit">
          <div className="fas-tb-total-card__label">Total Debit</div>
          <FlexAmount
            className="fas-tb-total-card__value"
            value={formatIndianAmount(ledgerTotals.sumDr)}
            prefix="₹"
          />
        </div>
        <div className="fas-tb-total-card fas-tb-total-card--credit fas-ledger-total-card--credit">
          <div className="fas-tb-total-card__label">Total Credit</div>
          <FlexAmount
            className="fas-tb-total-card__value"
            value={formatIndianAmount(ledgerTotals.sumCr)}
            prefix="₹"
          />
        </div>
      </div>

      <LedgerRowFilterBar
        value={ledgerRowFilter}
        onChange={setLedgerRowFilter}
        amountSide={ledgerAmountSide}
        onAmountSideChange={setLedgerAmountSide}
        vrType={ledgerVrType}
        vrTypeOptions={ledgerVrTypeOptions}
        onVrTypeChange={setLedgerVrType}
        shownCount={ledgerFilterStats.shown}
        totalCount={ledgerFilterStats.total}
        className="fas-ledger-filter--desktop"
      />

      <div className="fas-ledger-table-wrap">
        <ReportTable
          data={filteredLedgerRows}
          type="ledger"
          onVoucherClick={onVoucherClick}
          onLedgerSaleBillClick={onLedgerSaleBillClick}
          filterActive={ledgerFilterIsActive(ledgerRowFilter, ledgerAmountSide, ledgerVrType)}
        />
      </div>

      {secondaryBackLabel && onSecondaryBack ? (
        <div className="fas-ledger-footer fas-ledger-footer--mobile-only">
          <button type="button" className="fas-btn fas-btn--outline" onClick={onSecondaryBack}>
            {secondaryBackLabel}
          </button>
        </div>
      ) : null}

      {billPrintModal}
    </DrillLedgerShell>
  );
}
