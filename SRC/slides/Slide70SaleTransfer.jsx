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
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '').trim(),
    ITEM_CODE: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    QNTY: formatNum(r.QNTY ?? r.qnty, 3),
    WEIGHT: formatNum(r.WEIGHT ?? r.weight, 3),
    LOT: Number(r.LOT ?? r.lot ?? 0) || 0,
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
  };
}

/** VFP DO FORM saletrf — re-post sale bills to LOTSTOCK (SALE_GST transfer mode). */
export default function Slide70SaleTransfer({ apiBase, formData, userName, onPrev }) {
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

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [bType, setBType] = useState('');
  const [billNo, setBillNo] = useState('');
  const [bikriNo, setBikriNo] = useState('');

  const activeRowRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/sale-transfer-user-permissions'), {
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
    b_type: bType.trim(),
    bill_no: billNo.trim() ? Number(billNo) : 0,
    b_no: bikriNo.trim() ? Number(bikriNo) : 0,
    bikri_no: bikriNo.trim() ? Number(bikriNo) : 0,
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
          apiUrl(apiBase, '/api/sale-transfer-execute'),
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
      const msg = e?.response?.data?.error || e.message || 'Sale transfer failed';
      setErr(msg);
      setPhase('ready');
      alert(msg);
    } finally {
      setTransferring(false);
    }
  };

  const handleProceed = async () => {
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
      const { data } = await axios.post(apiUrl(apiBase, '/api/sale-transfer-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const bills = Number(data?.total ?? 0) || 0;
      const lines = Number(data?.lineCount ?? rows.length) || 0;
      setGridRows(rows);
      setTotalBills(bills);
      setLineCount(lines);
      if (!bills) {
        setPhase('idle');
        alert('No sale bills found for the selected criteria.');
        return;
      }
      setPhase('ready');
      setPreviewing(false);
      if (
        !window.confirm(
          `${bills} sale bill(s) / ${lines} line(s) listed below.\n\nRe-post LOTSTOCK for these sale bills. Start transfer?`
        )
      ) {
        return;
      }
      await runTransfer(String(data?.jobId ?? '').trim());
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Preview failed';
      setErr(msg);
      alert(msg);
    } finally {
      setPreviewing(false);
    }
  };

  const busy = previewing || transferring;
  const blocked = !perms?.canOpen;
  const billPct = totalBills > 0 ? Math.min(100, Math.round((completedBills / totalBills) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-70-saletrf saletrf-screen inttrf-screen">
        <p className="loading-msg">Loading Sale Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-70-saletrf saletrf-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Sale Transfer</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="sale-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="saletrf-screen__panel">
        <p className="saletrf-screen__hint">
          VFP saletrf: set date range and optional B.Type / Bill No / Bikri No. Proceed lists all lines, then
          transfers bill by bill.
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
          <Field label="Specific B.Type">
            <input
              type="text"
              className="inttrf-input"
              value={bType}
              maxLength={6}
              disabled={blocked || busy}
              onChange={(e) => {
                setBType(e.target.value);
                resetSession();
              }}
            />
          </Field>
          <Field label="Specific Bill No.">
            <input
              type="number"
              className="inttrf-input"
              value={billNo}
              min={0}
              disabled={blocked || busy}
              onChange={(e) => {
                setBillNo(e.target.value);
                resetSession();
              }}
            />
          </Field>
          <Field label="Bikri / Lot No.">
            <input
              type="number"
              className="inttrf-input"
              value={bikriNo}
              min={0}
              disabled={blocked || busy}
              onChange={(e) => {
                setBikriNo(e.target.value);
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
              <div className="saletrf-screen__progress-bar" role="progressbar" aria-valuenow={completedBills} aria-valuemin={0} aria-valuemax={totalBills}>
                <div className="saletrf-screen__progress-fill" style={{ width: `${billPct}%` }} />
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid saletrf-screen__grid">
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
                    {previewing ? 'Loading entries…' : 'Set filters and click Proceed.'}
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
                      className={[done ? 'saletrf-row-done' : '', active ? 'saletrf-row-active' : ''].filter(Boolean).join(' ')}
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
            <button
              type="button"
              className="btn btn-primary inttrf-btn saletrf-screen__proceed"
              onClick={handleProceed}
              disabled={busy || blocked || !sdt || !edt}
            >
              {previewing ? 'Loading…' : transferring ? `Transferring ${completedBills}/${totalBills}` : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
