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

function formatNum(v, dec = 3) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(dec);
}

function mapGridRow(r, idx) {
  const vrDate = String(r.VR_DATE ?? r.vr_date ?? '').trim();
  return {
    _id: `${idx}-${vrDate}-${r.VR_NO}-${r.ITEM_CODE}-${r.STATUS}`,
    VR_DATE: vrDate,
    VR_NO: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
    ITEM_CODE: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    QNTY: formatNum(r.QNTY ?? r.qnty, 3),
    WEIGHT: formatNum(r.WEIGHT ?? r.weight, 3),
    LOT: Number(r.LOT ?? r.lot ?? 0) || 0,
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
  };
}

/** VFP DO FORM purtrf — re-post purchase bills to LOTSTOCK (PURCHASE_GST transfer mode). */
export default function Slide72PurchaseTransfer({ apiBase, formData, userName, onPrev }) {
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
  const [totalBills, setTotalBills] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [completedBills, setCompletedBills] = useState(0);
  const [completedLines, setCompletedLines] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [jobId, setJobId] = useState('');

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);

  const activeRowRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/purchase-transfer-user-permissions'), {
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
    setTotalBills(0);
    setLineCount(0);
    setCompletedBills(0);
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
  });

  const runTransfer = async (nextJobId) => {
    setTransferring(true);
    setPhase('transferring');
    setCompletedBills(0);
    setCompletedLines(0);
    try {
      let done = false;
      let lastBills = 0;
      let lastLines = 0;
      while (!done) {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/purchase-transfer-execute'),
          { ...buildPayload(), jobId: nextJobId, batchSize: EXEC_BATCH },
          reqOpts
        );
        lastBills = Number(data?.completed ?? 0) || 0;
        lastLines = Number(data?.completedLines ?? 0) || 0;
        setCompletedBills(lastBills);
        setCompletedLines(lastLines);
        done = Boolean(data?.done);
      }
      setPhase('done');
      alert(`Done — ${lastBills} bill(s) / ${lastLines} line(s) transferred in ${elapsedLabel}.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Purchase transfer failed';
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
      const { data } = await axios.post(apiUrl(apiBase, '/api/purchase-transfer-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const bills = Number(data?.total ?? 0) || 0;
      const lines = Number(data?.lineCount ?? rows.length) || 0;
      setGridRows(rows);
      setTotalBills(bills);
      setLineCount(lines);
      setJobId(String(data?.jobId ?? '').trim());
      if (!bills) {
        setPhase('idle');
        alert('No purchase bills found for the selected criteria.');
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
    if (!jobId || !totalBills) {
      alert('List purchase bills first (Proceed), then Post.');
      return;
    }
    if (
      !window.confirm(
        `${totalBills} purchase bill(s) / ${lineCount} line(s) listed.\n\nPost to LOTSTOCK now?`
      )
    ) {
      return;
    }
    await runTransfer(jobId);
  };

  const busy = previewing || transferring;
  const canPost = phase === 'ready' && totalBills > 0 && Boolean(jobId) && !transferring;
  const blocked = !perms?.canOpen;
  const billPct = totalBills > 0 ? Math.min(100, Math.round((completedBills / totalBills) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-72-purtrf purtrf-screen inttrf-screen">
        <p className="loading-msg">Loading Purchase Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-72-purtrf purtrf-screen saletrf-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Purchase Transfer</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="purchase-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="saletrf-screen__panel">
        <p className="saletrf-screen__hint">
          VFP purtrf: set date range for TYPE PU purchase bills. Proceed lists entries; Post asks to confirm before
          writing to LOTSTOCK.
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
        </div>

        {(totalBills > 0 || previewing || transferring || phase === 'done') ? (
          <div className="saletrf-screen__progress">
            <div className="saletrf-screen__progress-label">
              <span>
                Bills — Total: <strong>{totalBills}</strong> · Completed: <strong>{completedBills}</strong>
              </span>
              <span>
                Lines — Total: <strong>{lineCount}</strong> · Completed: <strong>{completedLines}</strong>
                {phase === 'transferring' || phase === 'done' ? ` (${billPct}%)` : ''}
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
                aria-valuenow={completedBills}
                aria-valuemin={0}
                aria-valuemax={totalBills}
              >
                <div className="saletrf-screen__progress-fill" style={{ width: `${billPct}%` }} />
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid saletrf-screen__grid purtrf-screen__grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>No</th>
                <th>Item Code</th>
                <th>Qty</th>
                <th>Weight</th>
                <th>Lot</th>
                <th>Status</th>
                <th>B_No</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="inttrf-screen__grid-empty">
                    {previewing
                      ? 'Loading entries…'
                      : phase === 'ready'
                        ? 'Review the list, then click Post.'
                        : 'Set filters and click Proceed.'}
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
                      <td>{r.VR_NO}</td>
                      <td>{r.ITEM_CODE}</td>
                      <td className="num">{r.QNTY}</td>
                      <td className="num">{r.WEIGHT}</td>
                      <td>{r.LOT}</td>
                      <td>{r.STATUS}</td>
                      <td>{r.B_NO}</td>
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
            <div className="inttrf-screen__footer-right purtrf-screen__footer-actions">
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
                className="btn btn-primary inttrf-btn purtrf-screen__post"
                onClick={handlePost}
                disabled={!canPost || blocked}
              >
                {transferring ? `Posting ${completedBills}/${totalBills}` : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
