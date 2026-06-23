import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import FasReportHeader from '../components/FasReportHeader';
import TrialDrillLedgerView from '../components/TrialDrillLedgerView';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import TrialReportExportBar from '../components/TrialReportExportBar';
import FlexAmount from '../components/FlexAmount';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import {
  generatePDF,
  sharePdfWithWhatsApp,
  buildReportHtml,
  buildLedgerStatementPdfMetadata,
} from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';
import { sortTrialBalanceRows, computeTrialTopSummary, trialBalanceRowKind } from '../utils/trialBalanceSort';
import { useTrialLedgerDrilldown } from '../utils/useTrialLedgerDrilldown';
import SessionInfoLine from '../components/SessionInfoLine';
import ReportHelpButton from '../components/ReportHelpButton';

const VIEW = { FORM: 'form', SUMMARY: 'summary', DETAIL: 'detail', LEDGER: 'ledger', VOUCHER: 'voucher' };

function TrialShell({ className = '', header, exportBar = null, footer = null, children }) {
  const isForm = className.includes('fas-tb-host--form');
  return (
    <div className={`slide slide-30-tb-summary fas-tb-host${className ? ` ${className}` : ''}`}>
      <div className={`fas-flow fas-tb-flow${isForm ? ' fas-tb-flow--form-app' : ''}`}>
        <div className="fas-ledger-sticky-top">
          {header}
          {!isForm ? exportBar : null}
        </div>
        <div className={`fas-flow-body fas-tb-body${isForm ? ' fas-tb-body--form-scroll' : ''}`}>{children}</div>
        {isForm && footer ? <div className="fas-tb-form-footer-bar">{footer}</div> : null}
      </div>
    </div>
  );
}

function formatIndianAmount(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

export default function Slide30TrialBalanceSummary({ apiBase, formData, onPrev, onReset, viewMode: appViewMode = 'desktop' }) {
  const [viewMode, setViewMode] = useState(VIEW.FORM);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [allRows, setAllRows] = useState([]);
  const [detailRows, setDetailRows] = useState([]);
  const [selectedAnnexure, setSelectedAnnexure] = useState({ schedule: '', label: '' });
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const periodStartLabel = toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const periodEndLabel = toDisplayDate(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));

  const drill = useTrialLedgerDrilldown({ apiBase, formData, compCode, compUid });

  useEffect(() => {
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (e) setEndDate(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || compUid == null || String(compUid).trim() === '') {
      setCompLedgerHeader(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
        });
        if (!cancelled) setCompLedgerHeader(data && typeof data === 'object' ? data : null);
      } catch {
        if (!cancelled) setCompLedgerHeader(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid]);

  const fetchTrial = async (scheduleFilter = '0') => {
    const { data } = await axios.get(`${apiBase}/api/trial-balance`, {
      params: {
        comp_code: compCode,
        e_date: toOracleDate(endDate),
        schedule: scheduleFilter,
        comp_uid: compUid,
      },
      withCredentials: true,
    });
    return sortTrialBalanceRows(Array.isArray(data) ? data : []);
  };

  const runSummary = async () => {
    if (!endDate) {
      alert('Please set the ending date (as-of date).');
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchTrial('0');
      setAllRows(rows);
      setViewMode(VIEW.SUMMARY);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const openAnnexureDetail = async (schedule, label) => {
    const schedStr = String(schedule ?? '').trim();
    if (!schedStr) return;
    setLoading(true);
    setSelectedAnnexure({ schedule: schedStr, label: label || schedStr });
    try {
      const rows = await fetchTrial(schedStr);
      setDetailRows(rows);
      setViewMode(VIEW.DETAIL);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const runLedgerFromRow = async (code, name) => {
    const rows = await drill.runLedger(code, name);
    if (rows) setViewMode(VIEW.LEDGER);
  };

  const summaryRowsForExport = useMemo(
    () => allRows.filter((r) => trialBalanceRowKind(r) === 1 || trialBalanceRowKind(r) === 2),
    [allRows]
  );

  const activeRows = viewMode === VIEW.DETAIL ? detailRows : allRows;
  const activeReportType = viewMode === VIEW.SUMMARY ? 'trial-balance-summary' : 'trial-balance';
  const activeExportRows = viewMode === VIEW.SUMMARY ? summaryRowsForExport : detailRows;

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      endDate:
        viewMode === VIEW.DETAIL
          ? `Annexure ${selectedAnnexure.schedule} — As of ${toDisplayDate(endDate)}`
          : `As of ${toDisplayDate(endDate)}`,
      periodLabel:
        viewMode === VIEW.DETAIL
          ? `Annexure ${selectedAnnexure.schedule} — ${selectedAnnexure.label}`
          : 'Trial Balance Summary',
    }),
    [compName, compYear, endDate, viewMode, selectedAnnexure]
  );

  const trialTotals = useMemo(() => computeTrialTopSummary(activeRows), [activeRows]);

  const runPdfAction = async (fn) => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await fn();
    } finally {
      setPdfBusy(false);
    }
  };

  const exportPdf = () =>
    runPdfAction(() =>
      generatePDF(activeReportType, activeExportRows.length ? activeExportRows : activeRows, pdfMeta)
    );

  const exportWhatsApp = () =>
    runPdfAction(() =>
      sharePdfWithWhatsApp(
        activeReportType,
        activeExportRows.length ? activeExportRows : activeRows,
        pdfMeta,
        `Trial Balance Summary — ${compName}\n${pdfMeta.endDate}`
      )
    );

  const exportExcel = () => {
    try {
      const label =
        viewMode === VIEW.DETAIL
          ? `TrialBalance_Annexure_${selectedAnnexure.schedule}`
          : 'TrialBalance_Summary';
      downloadExcelRows(activeExportRows.length ? activeExportRows : activeRows, label, `${compName}_${label}`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const exportPrint = () => {
    const html = buildReportHtml(activeReportType, activeExportRows.length ? activeExportRows : activeRows, pdfMeta);
    printHtmlDocument(html, { title: 'Trial Balance Summary' });
  };

  const exportBar = (
    <TrialReportExportBar
      pdfBusy={pdfBusy}
      onPdf={() => exportPdf().catch((e) => alert(e?.message || String(e)))}
      onExcel={exportExcel}
      onPrint={exportPrint}
      onWhatsApp={() => exportWhatsApp().catch((e) => alert(e?.message || String(e)))}
      printDisabled={!activeRows.length}
    />
  );

  const ledgerAccountCode = String(drill.ledgerRows[0]?.CODE ?? drill.ledgerRows[0]?.code ?? '');
  const ledgerPdfMeta = buildLedgerStatementPdfMetadata({
    formData,
    compLedgerHeader,
    ledgerFirstRow: drill.ledgerRows[0],
    year: compYear,
    endDate: `${periodStartLabel} – ${periodEndLabel}`,
    accountNameOverride: drill.ledgerTitle,
    accountCodeOverride: ledgerAccountCode,
  });
  const ledgerFyLine = [compYear ? `FY ${compYear}` : '', periodStartLabel && periodEndLabel ? `${periodStartLabel} – ${periodEndLabel}` : '']
    .filter(Boolean)
    .join(' · ');

  const isDesktopView = appViewMode === 'desktop';

  if (viewMode === VIEW.VOUCHER) {
    return (
      <div className="slide slide-report">
        <SessionInfoLine formData={formData} helpReportId="trial-balance-summary" helpViewKey="voucher" />
        <div className="report-toolbar">
          <h2>Voucher entries</h2>
          <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.LEDGER)}>
            ← Ledger
          </button>
        </div>
        <ReportTable data={drill.voucherRows} type="ledger-voucher" />
      </div>
    );
  }

  if (viewMode === VIEW.LEDGER) {
    return (
      <TrialDrillLedgerView
        appViewMode={appViewMode}
        slideClassName="slide-30-tb-summary"
        onBack={() => setViewMode(VIEW.DETAIL)}
        helpReportId="trial-balance-summary"
        formData={formData}
        compName={compName}
        compYear={compYear}
        compLedgerHeader={compLedgerHeader}
        ledgerRows={drill.ledgerRows}
        ledgerTitle={drill.ledgerTitle}
        ledgerAccountCode={ledgerAccountCode}
        ledgerPdfMeta={ledgerPdfMeta}
        fyLine={ledgerFyLine}
        pdfBusy={pdfBusy}
        runPdfAction={runPdfAction}
        onVoucherClick={async (row) => {
          const ok = await drill.runLedgerVoucher(row);
          if (ok) setViewMode(VIEW.VOUCHER);
          return ok;
        }}
        onLedgerSaleBillClick={drill.openLedgerSaleBill}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billPrintOpen={drill.billPrintOpen}
        setBillPrintOpen={drill.setBillPrintOpen}
        billPrintParams={drill.billPrintParams}
        secondaryBackLabel="← Annexure detail"
        onSecondaryBack={() => setViewMode(VIEW.DETAIL)}
      />
    );
  }

  if (viewMode === VIEW.SUMMARY || viewMode === VIEW.DETAIL) {
    const title =
      viewMode === VIEW.SUMMARY
        ? 'Trial Balance Summary'
        : `Annexure ${selectedAnnexure.schedule} — ${selectedAnnexure.label}`;
    return (
      <TrialShell
        className="fas-tb-host--results"
        header={
          <FasReportHeader
            title={title}
            onBack={() => (viewMode === VIEW.DETAIL ? setViewMode(VIEW.SUMMARY) : setViewMode(VIEW.FORM))}
            rightSlot={<span className="fas-report-header__meta">As of {toDisplayDate(endDate)}</span>}
          />
        }
        exportBar={exportBar}
      >
        {loading || drill.drillLoading ? (
          <p className="fas-tb-status-hint" role="status">
            Loading…
          </p>
        ) : null}
        <TrialBalanceSessionCard formData={formData} />
        {viewMode === VIEW.SUMMARY ? (
          <p className="sale-list-hint">Tap an annexure row to open account-wise detail for that schedule.</p>
        ) : (
          <p className="sale-list-hint">Tap an account row to open ledger.</p>
        )}
        <div className="fas-tb-totals fas-tb-totals--debit-first">
          <div className="fas-tb-total-card fas-tb-total-card--debit">
            <div className="fas-tb-total-card__label">Total Debit</div>
            <FlexAmount
              className="fas-tb-total-card__value"
              value={formatIndianAmount(trialTotals.closingDr)}
              prefix="₹"
            />
          </div>
          <div className="fas-tb-total-card fas-tb-total-card--credit">
            <div className="fas-tb-total-card__label">Total Credit</div>
            <FlexAmount
              className="fas-tb-total-card__value"
              value={formatIndianAmount(trialTotals.closingCr)}
              prefix="₹"
            />
          </div>
        </div>
        <div className="fas-tb-table-wrap">
          {viewMode === VIEW.SUMMARY ? (
            <ReportTable data={allRows} type="trial-balance-summary" onAnnexureClick={openAnnexureDetail} />
          ) : (
            <ReportTable
              data={detailRows}
              type="trial-balance"
              onLedgerClick={(code, name) => runLedgerFromRow(code, name)}
            />
          )}
        </div>
      </TrialShell>
    );
  }

  return (
    <TrialShell
      className="fas-tb-host--form"
      footer={
        isDesktopView ? (
          <button
            type="button"
            className="fas-btn fas-btn-primary fas-tb-run-bottom"
            onClick={() => void runSummary()}
            disabled={loading}
          >
            {loading ? 'Running…' : '▶ Run Report'}
          </button>
        ) : null
      }
      header={
        <FasReportHeader
          title="Trial Balance Summary"
          onBack={onPrev}
          rightSlot={
            isDesktopView ? (
              <ReportHelpButton reportId="trial-balance-summary" />
            ) : (
              <button type="button" className="fas-report-header__run" onClick={runSummary} disabled={loading}>
                {loading ? 'Running…' : '▶ Run'}
              </button>
            )
          }
        />
      }
    >
      <div className="fas-tb-form-shell">
        <TrialBalanceSessionCard compact formData={formData} helpReportId="trial-balance-summary" />
        <div className="fas-field-group">
          <div className="fas-field-label">Ending date — as-of</div>
          <div className="fas-field-input fas-tb-date-field">
            <span className="fas-field-icon" aria-hidden="true">
              📅
            </span>
            <input
              id="tbs-end-date"
              type="date"
              lang="en-GB"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="fas-info-tip">
          Shows annexure (schedule) totals first. Tap a row to drill into accounts, then tap an account for ledger.
        </div>
        {!isDesktopView ? (
          <div className="fas-tb-form-footer">
            <button type="button" className="fas-btn fas-btn-primary fas-tb-run-bottom" onClick={runSummary} disabled={loading}>
              {loading ? 'Running…' : '▶ Run Report'}
            </button>
          </div>
        ) : null}
      </div>
    </TrialShell>
  );
}
