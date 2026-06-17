import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import TransferElapsedClock from '../components/TransferElapsedClock';
import { formatLedgerDateDisplay, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import { useTransferElapsedClock } from '../utils/useTransferElapsedClock';

const reqOpts = { withCredentials: true, timeout: 600000 };
const EXEC_BATCH = 25;

function Field({ label, children }) {
  return (
    <label className="inttrf-field usinv-field">
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

function mapGridRow(r, idx) {
  return {
    _id: `${idx}-${r.BILL_DATE}-${r.BILL_NO}-${r.B_TYPE}`,
    BILL_DATE: String(r.BILL_DATE ?? r.bill_date ?? '').trim(),
    BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '').trim(),
    OLD_INV_NO: String(r.OLD_INV_NO ?? r.old_inv_no ?? '').trim(),
    NEW_INV_NO: String(r.NEW_INV_NO ?? r.new_inv_no ?? '').trim(),
  };
}

/** VFP DO FORM update_sale_inv_no — rebuild SALE_INV_NO on SALE and LEDGER. */
export default function Slide73UpdateSaleInvNo({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT ?? formData.s_date);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT ?? formData.e_date);

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [gridRows, setGridRows] = useState([]);
  const [totalBills, setTotalBills] = useState(0);
  const [completedBills, setCompletedBills] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [jobId, setJobId] = useState('');

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);

  const activeRowRef = useRef(null);
  const clockRunning = previewing || updating;
  const { elapsedMs, elapsedLabel, resetElapsed } = useTransferElapsedClock(clockRunning);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/update-sale-inv-no-user-permissions'), {
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
    if (updating && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [completedBills, updating]);

  const resetSession = () => {
    setGridRows([]);
    setTotalBills(0);
    setCompletedBills(0);
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

  const runUpdate = async (nextJobId) => {
    setUpdating(true);
    setPhase('updating');
    setCompletedBills(0);
    try {
      let done = false;
      let lastBills = 0;
      while (!done) {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/update-sale-inv-no-execute'),
          { ...buildPayload(), jobId: nextJobId, batchSize: EXEC_BATCH },
          reqOpts
        );
        lastBills = Number(data?.completed ?? 0) || 0;
        setCompletedBills(lastBills);
        done = Boolean(data?.done);
      }
      setPhase('done');
      alert(`Done — ${lastBills} bill(s) updated in ${elapsedLabel}.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Update failed';
      setErr(msg);
      setPhase('ready');
      alert(msg);
    } finally {
      setUpdating(false);
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
      const { data } = await axios.post(apiUrl(apiBase, '/api/update-sale-inv-no-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const bills = Number(data?.total ?? 0) || 0;
      setGridRows(rows);
      setTotalBills(bills);
      setJobId(String(data?.jobId ?? '').trim());
      if (!bills) {
        setPhase('idle');
        alert('No sale bills found for the selected criteria.');
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
      alert('List bills first (Proceed), then Post.');
      return;
    }
    if (!window.confirm(`${totalBills} bill(s) listed.\n\nUpdate SALE_INV_NO on SALE and LEDGER now?`)) {
      return;
    }
    await runUpdate(jobId);
  };

  const busy = previewing || updating;
  const canPost = phase === 'ready' && totalBills > 0 && Boolean(jobId) && !updating;
  const blocked = !perms?.canOpen;
  const billPct = totalBills > 0 ? Math.min(100, Math.round((completedBills / totalBills) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-73-usinv usinv-screen inttrf-screen">
        <p className="loading-msg">Loading Update SaleInvNo…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-73-usinv usinv-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Update SaleInvNo</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="update-sale-inv-no" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="usinv-screen__panel">
        <p className="usinv-screen__hint">
          Set date range, Proceed lists old/new invoice numbers; Post confirms before updating SALE and LEDGER.
        </p>
        <div className="usinv-screen__filters inttrf-screen__header-panel">
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

        {(totalBills > 0 || previewing || updating || phase === 'done') && (
          <div className="usinv-screen__progress">
            <div className="usinv-screen__progress-label">
              <span>
                Bills — Total: <strong>{totalBills}</strong> · Updated: <strong>{completedBills}</strong>
                {phase === 'updating' || phase === 'done' ? ` (${billPct}%)` : ''}
              </span>
              <TransferElapsedClock
                elapsedMs={elapsedMs}
                label={elapsedLabel}
                visible={previewing || updating || phase === 'done'}
                running={clockRunning}
              />
            </div>
            {(phase === 'updating' || phase === 'done') && (
              <div className="usinv-screen__progress-bar" role="progressbar" aria-valuenow={completedBills} aria-valuemin={0} aria-valuemax={totalBills}>
                <div className="usinv-screen__progress-fill" style={{ width: `${billPct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid usinv-screen__grid">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No</th>
                <th>B.Type</th>
                <th>Old Inv No</th>
                <th>New Inv No</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="inttrf-screen__grid-empty">
                    {previewing
                      ? 'Loading…'
                      : phase === 'ready'
                        ? 'Review the list, then tap Post.'
                        : 'Set dates and tap Proceed.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r, idx) => {
                  const done = idx < completedBills;
                  const active = updating && idx === completedBills;
                  return (
                    <tr
                      key={r._id}
                      ref={active ? activeRowRef : null}
                      className={[done ? 'usinv-row-done' : '', active ? 'usinv-row-active' : ''].filter(Boolean).join(' ')}
                    >
                      <td>{formatLedgerDateDisplay(r.BILL_DATE) || r.BILL_DATE}</td>
                      <td>{r.BILL_NO}</td>
                      <td>{r.B_TYPE}</td>
                      <td>{r.OLD_INV_NO || '—'}</td>
                      <td className="usinv-new">{r.NEW_INV_NO}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel usinv-screen__footer">
          <div className="inttrf-screen__footer-toolbar usinv-screen__footer-toolbar">
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev} disabled={busy}>
              Quit
            </button>
            <div className="usinv-screen__footer-actions">
              <button
                type="button"
                className="btn btn-primary inttrf-btn"
                onClick={handleList}
                disabled={busy || blocked || !sdt || !edt}
              >
                {previewing ? 'Loading…' : 'Proceed'}
              </button>
              <button type="button" className="btn btn-primary inttrf-btn usinv-screen__post" onClick={handlePost} disabled={!canPost || blocked}>
                {updating ? `Posting ${completedBills}/${totalBills}` : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
