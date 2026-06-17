import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import TransferElapsedClock from '../components/TransferElapsedClock';
import { formatLedgerDateDisplay, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import { useTransferElapsedClock } from '../utils/useTransferElapsedClock';

const reqOpts = { withCredentials: true, timeout: 600000 };
const EXEC_BATCH = 2;

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function formatNum(v, dec = 2) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(dec);
}

function mapGridRow(r, idx) {
  const vrDate = String(r.VR_DATE ?? r.vr_date ?? '').trim();
  return {
    _id: `${idx}-${vrDate}-${r.VR_TYPE}-${r.VR_NO}-${r.TYPE}-${r.TRN_NO}`,
    VR_DATE: vrDate,
    VR_TYPE: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
    VR_NO: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
    TYPE: String(r.TYPE ?? r.type ?? '').trim(),
    TRN_NO: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    DR_AMT: formatNum(r.DR_AMT ?? r.dr_amt, 2),
    CR_AMT: formatNum(r.CR_AMT ?? r.cr_amt, 2),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
  };
}

/** VFP DO FORM voutrf — re-post cash/bank/journal vouchers to LEDGER (VOUCHER form transfer mode). */
export default function Slide71VoucherTransfer({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT ?? formData.s_date);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT ?? formData.e_date);

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [gridRows, setGridRows] = useState([]);
  const [totalVouchers, setTotalVouchers] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [completedVouchers, setCompletedVouchers] = useState(0);
  const [completedLines, setCompletedLines] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [jobId, setJobId] = useState('');

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [vrType, setVrType] = useState('');

  const activeRowRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/voucher-transfer-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data?.permissions ?? data ?? null);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName]);

  useEffect(() => {
    if (transferring && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [completedLines, transferring]);

  const clockRunning = previewing || transferring;
  const { elapsedMs, elapsedLabel, resetElapsed } = useTransferElapsedClock(clockRunning);

  const resetSession = () => {
    setGridRows([]);
    setTotalVouchers(0);
    setLineCount(0);
    setCompletedVouchers(0);
    setCompletedLines(0);
    setJobId('');
    setPhase('idle');
    resetElapsed();
  };

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    comp_year: compYear,
    user_name: userName,
    s_date: toOracleDate(sdt),
    e_date: toOracleDate(edt),
    vr_type: vrType.trim(),
  });

  const runTransfer = async (nextJobId) => {
    setTransferring(true);
    setPhase('transferring');
    setCompletedVouchers(0);
    setCompletedLines(0);
    try {
      let done = false;
      let lastVouchers = 0;
      let lastLines = 0;
      while (!done) {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/voucher-transfer-execute'),
          { ...buildPayload(), jobId: nextJobId, batchSize: EXEC_BATCH },
          reqOpts
        );
        lastVouchers = Number(data?.completed ?? 0) || 0;
        lastLines = Number(data?.completedLines ?? 0) || 0;
        setCompletedVouchers(lastVouchers);
        setCompletedLines(lastLines);
        done = Boolean(data?.done);
      }
      setPhase('done');
      alert(`Done — ${lastVouchers} voucher(s) / ${lastLines} line(s) transferred in ${elapsedLabel}.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Voucher transfer failed';
      setErr(msg);
      setPhase('ready');
      alert(msg);
    } finally {
      setTransferring(false);
    }
  };

  const handleList = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setPreviewing(true);
    setErr('');
    resetSession();
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/voucher-transfer-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const vouchers = Number(data?.total ?? 0) || 0;
      const lines = Number(data?.lineCount ?? rows.length) || 0;
      setGridRows(rows);
      setTotalVouchers(vouchers);
      setLineCount(lines);
      setJobId(String(data?.jobId ?? '').trim());
      if (!vouchers) {
        setPhase('idle');
        alert('No vouchers found for the selected criteria.');
        return;
      }
      setPhase('ready');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Preview failed';
      setErr(msg);
      alert(msg);
    } finally {
      setPreviewing(false);
    }
  };

  const handlePost = async () => {
    if (!perms?.canOpen || !perms?.canAdd) {
      alert('Access Denied');
      return;
    }
    if (!jobId || !totalVouchers) {
      alert('List vouchers first (Proceed), then Post.');
      return;
    }
    if (
      !window.confirm(
        `${totalVouchers} voucher(s) / ${lineCount} line(s) listed.\n\nPost to LEDGER now?`
      )
    ) {
      return;
    }
    await runTransfer(jobId);
  };

  const busy = previewing || transferring;
  const canPost = phase === 'ready' && totalVouchers > 0 && Boolean(jobId) && !transferring;
  const blocked = !perms?.canOpen;
  const voucherPct =
    totalVouchers > 0 ? Math.min(100, Math.round((completedVouchers / totalVouchers) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-71-voutrf voutrf-screen inttrf-screen">
        <p className="loading-msg">Loading Voucher Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-71-voutrf voutrf-screen saletrf-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Voucher Transfer</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="voucher-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="saletrf-screen__panel">
        <p className="saletrf-screen__hint">
          VFP voutrf: set date range and optional Voucher Type (CV, BV, JV, …). Proceed lists entries;
          Post asks to confirm before writing to LEDGER.
        </p>
        <div className="saletrf-screen__filters inttrf-screen__header-panel">
          <Field label="Starting Date *">
            <input
              type="date"
              className="inttrf-input"
              value={sdt}
              disabled={blocked || busy}
              onChange={(e) => {
                setSdt(e.target.value);
                resetSession();
              }}
            />
          </Field>
          <Field label="Ending Date *">
            <input
              type="date"
              className="inttrf-input"
              value={edt}
              disabled={blocked || busy}
              onChange={(e) => {
                setEdt(e.target.value);
                resetSession();
              }}
            />
          </Field>
          <Field label="Specific Voucher Type">
            <input
              type="text"
              className="inttrf-input inttrf-input--code"
              value={vrType}
              maxLength={6}
              placeholder="CV, BV, JV…"
              disabled={blocked || busy}
              onChange={(e) => {
                setVrType(e.target.value.toUpperCase());
                resetSession();
              }}
            />
          </Field>
        </div>

        {(totalVouchers > 0 || previewing || transferring || phase === 'done') ? (
          <div className="saletrf-screen__progress">
            <div className="saletrf-screen__progress-label">
              <span>
                Vouchers — Total: <strong>{totalVouchers}</strong> · Completed: <strong>{completedVouchers}</strong>
              </span>
              <span>
                Lines — Total: <strong>{lineCount}</strong> · Completed: <strong>{completedLines}</strong>
                {phase === 'transferring' || phase === 'done' ? ` (${voucherPct}%)` : ''}
              </span>
              <TransferElapsedClock
                elapsedMs={elapsedMs}
                label={elapsedLabel}
                visible={previewing || transferring || phase === 'done'}
                running={clockRunning}
              />
            </div>
            {(phase === 'transferring' || phase === 'done') && (
              <div
                className="saletrf-screen__progress-bar"
                role="progressbar"
                aria-valuenow={completedVouchers}
                aria-valuemin={0}
                aria-valuemax={totalVouchers}
              >
                <div className="saletrf-screen__progress-fill" style={{ width: `${voucherPct}%` }} />
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid saletrf-screen__grid voutrf-screen__grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vr Type</th>
                <th>No</th>
                <th>Type</th>
                <th>Trn</th>
                <th>Code</th>
                <th>Dr Amt</th>
                <th>Cr Amt</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="inttrf-screen__grid-empty">
                    {previewing ? 'Loading entries…' : phase === 'ready' ? 'Review the list, then click Post.' : 'Set filters and click Proceed.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r, idx) => {
                  const done = idx < completedLines;
                  const active = transferring && idx === completedLines;
                  return (
                    <tr
                      key={r._id}
                      ref={active ? activeRowRef : null}
                      className={[done ? 'saletrf-row-done' : '', active ? 'saletrf-row-active' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td>{formatLedgerDateDisplay(r.VR_DATE) || r.VR_DATE}</td>
                      <td>{r.VR_TYPE}</td>
                      <td>{r.VR_NO}</td>
                      <td>{r.TYPE}</td>
                      <td>{r.TRN_NO}</td>
                      <td>{r.CODE}</td>
                      <td className="num amount">{r.DR_AMT}</td>
                      <td className="num amount">{r.CR_AMT}</td>
                      <td>{r.DETAIL}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel">
          <div className="inttrf-screen__footer-toolbar">
            <div className="inttrf-screen__footer-left">
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev} disabled={busy}>
                Quit
              </button>
            </div>
            <div className="inttrf-screen__footer-right voutrf-screen__footer-actions">
              <button
                type="button"
                className="btn btn-primary inttrf-btn saletrf-screen__proceed"
                onClick={handleList}
                disabled={busy || blocked || !sdt || !edt}
              >
                {previewing ? 'Loading…' : 'Proceed'}
              </button>
              <button
                type="button"
                className="btn btn-primary inttrf-btn voutrf-screen__post"
                onClick={handlePost}
                disabled={!canPost || blocked}
              >
                {transferring ? `Posting ${completedVouchers}/${totalVouchers}` : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
