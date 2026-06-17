import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import TransferElapsedClock from '../components/TransferElapsedClock';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import { useTransferElapsedClock } from '../utils/useTransferElapsedClock';

const reqOpts = { withCredentials: true, timeout: 600000 };
const EXEC_BATCH = 400;

function YnToggle({ label, value, onChange, disabled }) {
  return (
    <label className="stktrf-yn">
      <span className="stktrf-yn__lbl">{label}</span>
      <select
        className="inttrf-input stktrf-yn__sel"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="N">N</option>
        <option value="Y">Y</option>
      </select>
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

/** VFP DO FORM stktrf — rebuild LOTSTOCK from Purchase / Sale / CPUR / Production. */
export default function Slide69StockTransfer({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [result, setResult] = useState(null);
  const [gridRows, setGridRows] = useState([]);
  const [jobId, setJobId] = useState('');
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [phase, setPhase] = useState('idle');

  const [purchaseYn, setPurchaseYn] = useState('N');
  const [saleYn, setSaleYn] = useState('N');
  const [cpurYn, setCpurYn] = useState('N');
  const [productionYn, setProductionYn] = useState('N');

  const gridWrapRef = useRef(null);
  const activeRowRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/stock-transfer-user-permissions'), {
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
  }, [completed, transferring]);

  const clockRunning = previewing || transferring;
  const { elapsedMs, elapsedLabel, resetElapsed } = useTransferElapsedClock(clockRunning);

  const resetSession = () => {
    setGridRows([]);
    setResult(null);
    setJobId('');
    setTotal(0);
    setCompleted(0);
    setPhase('idle');
    resetElapsed();
  };

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    comp_year: compYear,
    user_name: userName,
    purchase: purchaseYn,
    sale: saleYn,
    cpur: cpurYn,
    production: productionYn,
    pyn: purchaseYn,
    syn: saleYn,
    cyn: cpurYn,
    pryn: productionYn,
  });

  const runTransfer = async (nextJobId) => {
    setTransferring(true);
    setPhase('transferring');
    setCompleted(0);
    try {
      let done = false;
      let lastCompleted = 0;
      while (!done) {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/stock-transfer-execute'),
          { ...buildPayload(), jobId: nextJobId, batchSize: EXEC_BATCH },
          reqOpts
        );
        lastCompleted = Number(data?.completed ?? 0) || 0;
        setCompleted(lastCompleted);
        done = Boolean(data?.done);
        if (data?.results) setResult(data.results);
      }
      setPhase('done');
      alert(`Done — ${lastCompleted} of ${total} transaction(s) transferred in ${elapsedLabel}.`);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Stock transfer failed';
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
    const any =
      purchaseYn === 'Y' || saleYn === 'Y' || cpurYn === 'Y' || productionYn === 'Y';
    if (!any) {
      alert('Select at least one module (Y) to rebuild LOTSTOCK.');
      return;
    }

    setPreviewing(true);
    setErr('');
    resetSession();
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/stock-transfer-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const count = Number(data?.total ?? rows.length) || 0;
      setGridRows(rows);
      setTotal(count);
      setResult(data?.results ?? null);
      setJobId(String(data?.jobId ?? '').trim());

      if (!count) {
        setPhase('idle');
        alert('No entries to transfer for the selected module(s).');
        return;
      }

      setPhase('ready');
      const modules = [
        purchaseYn === 'Y' ? 'Purchase' : null,
        saleYn === 'Y' ? 'Sale' : null,
        cpurYn === 'Y' ? 'Consignment Purchase' : null,
        productionYn === 'Y' ? 'Production' : null,
      ]
        .filter(Boolean)
        .join(', ');
      if (
        !window.confirm(
          `${count} transaction(s) listed below.\n\nRebuild LOTSTOCK for: ${modules}\n\nThis DELETES existing LOTSTOCK rows for those VR types and reloads from source tables. Start transfer?`
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
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-69-stktrf stktrf-screen inttrf-screen">
        <p className="loading-msg">Loading Stock Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-69-stktrf stktrf-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Stock Transfer</h2>
        <p className="stktrf-screen__subtitle">Rebuild LOTSTOCK</p>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="stock-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="stktrf-screen__panel">
        <p className="stktrf-screen__hint">
          VFP stktrf: set Y, click Proceed — all entries load in the grid first, then transfer runs with progress.
        </p>
        <div className="stktrf-screen__flags">
          <YnToggle
            label="Purchase (PU)"
            value={purchaseYn}
            onChange={(v) => {
              setPurchaseYn(v);
              resetSession();
            }}
            disabled={blocked || busy}
          />
          <YnToggle
            label="Sale (SL/CN/…)"
            value={saleYn}
            onChange={(v) => {
              setSaleYn(v);
              resetSession();
            }}
            disabled={blocked || busy}
          />
          <YnToggle
            label="Consignment Purchase (PC)"
            value={cpurYn}
            onChange={(v) => {
              setCpurYn(v);
              resetSession();
            }}
            disabled={blocked || busy}
          />
          <YnToggle
            label="Production (R/I/JR/…)"
            value={productionYn}
            onChange={(v) => {
              setProductionYn(v);
              resetSession();
            }}
            disabled={blocked || busy}
          />
        </div>

        {(total > 0 || previewing || transferring || phase === 'done') ? (
          <div className="stktrf-screen__progress">
            <div className="stktrf-screen__progress-label">
              <span>
                Total: <strong>{total}</strong>
              </span>
              <span>
                Completed: <strong>{completed}</strong>
                {phase === 'transferring' || phase === 'done' ? ` (${pct}%)` : ''}
              </span>
              <TransferElapsedClock
                elapsedMs={elapsedMs}
                label={elapsedLabel}
                visible={previewing || transferring || phase === 'done'}
                running={clockRunning}
              />
            </div>
            {(phase === 'transferring' || phase === 'done') && (
              <div className="stktrf-screen__progress-bar" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}>
                <div className="stktrf-screen__progress-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        ) : null}

        {result ? (
          <div className="stktrf-screen__results">
            {Object.entries(result).map(([key, val]) => {
              if (!val || typeof val !== 'object') return null;
              return (
                <p key={key}>
                  <strong>{key}:</strong> {val.count ?? val.inserted ?? 0} line(s)
                  {val.skipped != null ? `, skipped ${val.skipped}` : ''}
                </p>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap" ref={gridWrapRef}>
          <table className="inttrf-screen__grid stktrf-screen__grid">
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
                    {previewing ? 'Loading entries…' : 'Set Y on module(s) and click Proceed.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r, idx) => {
                  const done = idx < completed;
                  const active = transferring && idx === completed;
                  return (
                    <tr
                      key={r._id}
                      ref={active ? activeRowRef : null}
                      className={[done ? 'stktrf-row-done' : '', active ? 'stktrf-row-active' : ''].filter(Boolean).join(' ')}
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
              className="btn btn-primary inttrf-btn stktrf-screen__proceed"
              onClick={handleProceed}
              disabled={busy || blocked}
            >
              {previewing ? 'Loading…' : transferring ? `Transferring ${completed}/${total}` : 'Proceed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
