import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };

const SECTIONS = [
  {
    id: 'missing_schedule',
    title: 'Missing Schedule',
    vfpTitle: 'MISSING SCHEDULE',
    countKey: 'missing_schedule',
    rowAction: 'account-master',
    rowHint: 'Click a row to open A/c Master and edit schedule.',
    columns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'SCHEDULE', label: 'Schedule', align: 'amount' },
    ],
  },
  {
    id: 'missing_code_in_master',
    title: 'Missing Code In Master',
    vfpTitle: 'MISSING CODE IN MASTER',
    countKey: 'missing_code_in_master',
    rowAction: 'ledger',
    rowHint: 'Click a row to open Ledger for this account code.',
    columns: [{ key: 'CODE', label: 'Code' }],
  },
  {
    id: 'missing_ledger_detail',
    title: 'Missing Ledger Detail',
    vfpTitle: 'MISSING CODE detail',
    countKey: 'missing_ledger_detail',
    rowAction: 'ledger',
    rowHint: 'Click a row to open Ledger for this account code.',
    columns: [
      { key: 'CODE', label: 'Code' },
      { key: 'VR_TYPE', label: 'Vr.Type' },
      { key: 'VR_DATE', label: 'Vr.Date', format: 'date' },
      { key: 'VR_NO', label: 'Vr.No.' },
      { key: 'TYPE', label: 'Type' },
      { key: 'DR_AMT', label: 'Dr.Amt', align: 'amount' },
      { key: 'CR_AMT', label: 'Cr.Amt', align: 'amount' },
    ],
  },
  {
    id: 'double_code_in_master',
    title: 'Double Code In Master',
    vfpTitle: 'DOUBLE CODE IN MASTER',
    countKey: 'double_code_in_master',
    rowAction: 'fix-double',
    rowHint: 'Click a row to delete duplicate MASTER rows (keeps oldest rowid).',
    columns: [{ key: 'CODE', label: 'Code' }],
  },
  {
    id: 'opening_diff',
    title: 'Opening Diff',
    vfpTitle: 'OPENING DIFF MASTER',
    countKey: null,
    isOpening: true,
  },
  {
    id: 'voucher_diff',
    title: 'Diff. In Vouchers',
    vfpTitle: 'DIFF.IN VOUCHERS',
    countKey: 'voucher_diff',
    columns: [
      { key: 'VR_TYPE', label: 'Vr.Type' },
      { key: 'VR_DATE', label: 'Vr.Date', format: 'date' },
      { key: 'VR_NO', label: 'Vr.No.' },
      { key: 'TYPE', label: 'Type' },
      { key: 'DR_AMT', label: 'Dr.Amt', align: 'amount' },
      { key: 'CR_AMT', label: 'Cr.Amt', align: 'amount' },
      { key: 'CLBAL', label: 'Cl.Bal', align: 'amount' },
    ],
  },
  {
    id: 'bikri_diff',
    title: 'Bikri Diff',
    vfpTitle: 'Bikri vs Sale',
    countKey: 'bikri_diff',
    columns: [
      { key: 'B_NO', label: 'B.No.' },
      { key: 'BIK_AMT', label: 'Bik.Amt', align: 'amount' },
      { key: 'SALE_AMT', label: 'Sale.Amt', align: 'amount' },
      { key: 'DIF_AMT', label: 'Dif.Amt', align: 'amount' },
    ],
  },
  {
    id: 'trading_bikri',
    title: 'Trading Bikri',
    vfpTitle: 'TRADING BIKRI',
    countKey: 'trading_bikri',
    columns: [
      { key: 'VR_TYPE', label: 'Vr.Type' },
      { key: 'VR_DATE', label: 'Vr.Date', format: 'date' },
      { key: 'VR_NO', label: 'Vr.No.' },
      { key: 'TYPE', label: 'Type' },
      { key: 'CODE', label: 'Code' },
      { key: 'DR_AMT', label: 'Dr.Amt', align: 'amount' },
      { key: 'CR_AMT', label: 'Cr.Amt', align: 'amount' },
      { key: 'B_NO', label: 'B.No.' },
      { key: 'BIKRI', label: 'Bikri' },
    ],
  },
];

function cellValue(row, key, format) {
  const v = row?.[key] ?? row?.[key.toLowerCase()] ?? '';
  if (format === 'date') return formatLedgerDateDisplay(v) || String(v ?? '');
  return v === null || v === undefined ? '' : String(v);
}

function sectionRows(payload, sectionId) {
  if (!payload) return [];
  if (sectionId === 'opening_diff') return [];
  const rows = payload[sectionId];
  return Array.isArray(rows) ? rows : [];
}

function sectionCount(payload, section) {
  if (section.isOpening) {
    return payload?.opening_diff?.has_difference ? 1 : 0;
  }
  if (section.countKey && payload?.counts) {
    return Number(payload.counts[section.countKey] ?? 0) || 0;
  }
  return sectionRows(payload, section.id).length;
}

function rowCode(row) {
  return String(row?.CODE ?? row?.code ?? '').trim();
}

/** VFP DO trldif — trial / ledger integrity checks. */
export default function Slide58TrialDifference({
  apiBase,
  formData,
  userName,
  onPrev,
  onOpenAccountMaster,
  onOpenLedger,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [err, setErr] = useState('');
  const [payload, setPayload] = useState(null);
  const [activeTab, setActiveTab] = useState(
    String(formData?.trialDifferenceReturnTab ?? '').trim() || SECTIONS[0].id
  );

  useEffect(() => {
    const tab = String(formData?.trialDifferenceReturnTab ?? '').trim();
    if (tab && SECTIONS.some((s) => s.id === tab)) setActiveTab(tab);
  }, [formData?.trialDifferenceReturnTab]);

  const activeSection = useMemo(
    () => SECTIONS.find((s) => s.id === activeTab) || SECTIONS[0],
    [activeTab]
  );

  const runReport = useCallback(async () => {
    setRunning(true);
    setErr('');
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/trial-difference'), {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName || '',
        },
        ...reqOpts,
      });
      setPayload(data);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Run failed';
      setErr(msg);
      alert(msg);
    } finally {
      setRunning(false);
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    void runReport();
  }, [runReport]);

  const handleFixDoubleCode = async (code) => {
    const c = String(code ?? '').trim();
    if (!c) return;
    if (
      !window.confirm(
        `Delete duplicate MASTER rows for code ${c}?\n\nKeeps the row with minimum ROWID for this company + code.`
      )
    ) {
      return;
    }
    setFixing(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/trial-difference-fix-double-code'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          code: c,
        },
        reqOpts
      );
      alert(data?.message || 'Done');
      await runReport();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setFixing(false);
    }
  };

  const handleRowClick = (row) => {
    const action = activeSection.rowAction;
    const code = rowCode(row);
    if (action === 'account-master') {
      if (!code) return;
      onOpenAccountMaster?.(code, activeTab);
      return;
    }
    if (action === 'ledger') {
      if (!code) return;
      onOpenLedger?.(code, activeTab);
      return;
    }
    if (action === 'fix-double') {
      if (fixing) return;
      void handleFixDoubleCode(code);
    }
  };

  const handleExcel = () => {
    const sec = activeSection;
    if (sec.isOpening) {
      if (!payload?.opening_diff) {
        alert('No data to export.');
        return;
      }
      downloadExcelRows(
        [
          {
            'Vr.Type': payload.opening_diff.vr_type || 'OP',
            OPDIF: payload.opening_diff.opdif,
          },
        ],
        'OpeningDiff',
        `${compName || 'Company'}_TrialDifference_Opening`
      );
      return;
    }
    const rows = sectionRows(payload, sec.id);
    if (!rows.length) {
      alert('No data to export for this section.');
      return;
    }
    const excelRows = rows.map((r) => {
      const out = {};
      for (const col of sec.columns) {
        out[col.label] = cellValue(r, col.key, col.format);
      }
      return out;
    });
    downloadExcelRows(
      excelRows,
      sec.title.replace(/\s+/g, ''),
      `${compName || 'Company'}_TrialDifference_${sec.id}`
    );
  };

  const activeRows = sectionRows(payload, activeSection.id);
  const rowsClickable = Boolean(activeSection.rowAction) && activeRows.length > 0;

  return (
    <div className="slide slide-58-trldif trldif-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head trldif-screen__head">
        <h2 className="sale-bill-page__title trldif-screen__title">Trial Difference</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="trial-difference" />
      </div>

      {err ? <p className="form-error trldif-screen__error">{err}</p> : null}

      <div className="trldif-screen__toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void runReport()} disabled={running || fixing}>
          {running ? 'Running…' : 'Run'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExcel} disabled={!payload}>
          Excel
        </button>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          Quit
        </button>
        {payload?.message ? <span className="trldif-screen__done">{payload.message}</span> : null}
      </div>

      <div className="trldif-screen__tabs" role="tablist" aria-label="Trial difference sections">
        {SECTIONS.map((sec) => {
          const n = sectionCount(payload, sec);
          const active = activeTab === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`trldif-screen__tab${active ? ' trldif-screen__tab--active' : ''}${n > 0 ? ' trldif-screen__tab--alert' : ''}`}
              onClick={() => setActiveTab(sec.id)}
            >
              {sec.title}
              <span className="trldif-screen__tab-count">({n})</span>
            </button>
          );
        })}
      </div>

      <div className="trldif-screen__body">
        {loading || running ? (
          <p className="loading-msg">Running trial difference checks…</p>
        ) : activeSection.isOpening ? (
          <div className="trldif-screen__opening">
            <h3>{activeSection.vfpTitle}</h3>
            {payload?.opening_diff?.has_difference ? (
              <p className="trldif-screen__opening-diff">
                Opening (OP) difference: <strong>{payload.opening_diff.opdif}</strong>
              </p>
            ) : (
              <p className="trldif-screen__opening-ok">No opening difference (OP Dr − Cr = 0).</p>
            )}
          </div>
        ) : (
          <div className="trldif-screen__grid-wrap">
            <h3 className="trldif-screen__section-title">{activeSection.vfpTitle}</h3>
            {activeSection.rowHint ? <p className="trldif-screen__row-hint">{activeSection.rowHint}</p> : null}
            <table className="trldif-screen__grid">
              <thead>
                <tr>
                  {activeSection.columns.map((col) => (
                    <th key={col.key} className={col.align === 'amount' ? 'amount' : ''}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRows.length === 0 ? (
                  <tr>
                    <td colSpan={activeSection.columns.length} className="trldif-screen__grid-empty">
                      No issues found in this section.
                    </td>
                  </tr>
                ) : (
                  activeRows.map((row, idx) => (
                    <tr
                      key={`${activeSection.id}-${idx}`}
                      className={rowsClickable ? 'trldif-screen__row--clickable' : ''}
                      onClick={rowsClickable ? () => handleRowClick(row) : undefined}
                      onKeyDown={
                        rowsClickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRowClick(row);
                              }
                            }
                          : undefined
                      }
                      tabIndex={rowsClickable ? 0 : undefined}
                      role={rowsClickable ? 'button' : undefined}
                    >
                      {activeSection.columns.map((col) => (
                        <td key={col.key} className={col.align === 'amount' ? 'amount' : ''}>
                          {cellValue(row, col.key, col.format)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
