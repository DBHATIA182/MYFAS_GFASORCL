import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import TransferElapsedClock from '../components/TransferElapsedClock';
import { apiUrl } from '../utils/resolveApiBase';
import { useTransferElapsedClock } from '../utils/useTransferElapsedClock';

const reqOpts = { withCredentials: true, timeout: 600000 };
const EXEC_BATCH = 50;

function mapGridRow(r, idx) {
  return {
    _id: `${idx}-${r.CODE}`,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    GST_NO: String(r.GST_NO ?? r.gst_no ?? '').trim(),
    NEW_PAN: String(r.NEW_PAN ?? r.new_pan ?? '').trim(),
  };
}

/** VFP DO pan_with_gstin — set MASTER.PAN from GSTIN (SUBSTR GST_NO, 3, 10). */
export default function Slide74UpdatePanWithGstIn({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [gridRows, setGridRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [completedRows, setCompletedRows] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [jobId, setJobId] = useState('');

  const activeRowRef = useRef(null);
  const clockRunning = previewing || updating;
  const { elapsedMs, elapsedLabel, resetElapsed } = useTransferElapsedClock(clockRunning);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/update-pan-with-gstin-user-permissions'), {
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
  }, [completedRows, updating]);

  const resetSession = () => {
    setGridRows([]);
    setTotalRows(0);
    setCompletedRows(0);
    setJobId('');
    setPhase('idle');
    resetElapsed();
  };

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
  });

  const runUpdate = async (nextJobId) => {
    setUpdating(true);
    setPhase('updating');
    setCompletedRows(0);
    try {
      let done = false;
      let lastRows = 0;
      while (!done) {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/update-pan-with-gstin-execute'),
          { ...buildPayload(), jobId: nextJobId, batchSize: EXEC_BATCH },
          reqOpts
        );
        lastRows = Number(data?.completed ?? 0) || 0;
        setCompletedRows(lastRows);
        done = Boolean(data?.done);
      }
      setPhase('done');
      alert(`Done — ${lastRows} account(s) updated in ${elapsedLabel}.`);
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
    setPreviewing(true);
    setErr('');
    resetSession();
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/update-pan-with-gstin-preview'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      const total = Number(data?.total ?? 0) || 0;
      setGridRows(rows);
      setTotalRows(total);
      setJobId(String(data?.jobId ?? '').trim());
      if (!total) {
        setPhase('idle');
        alert('No accounts found with GSTIN and blank PAN.');
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
    if (!jobId || !totalRows) {
      alert('List accounts first (Proceed), then Post.');
      return;
    }
    if (!window.confirm(`${totalRows} account(s) listed.\n\nUpdate PAN from GSTIN on MASTER now?`)) {
      return;
    }
    await runUpdate(jobId);
  };

  const busy = previewing || updating;
  const canPost = phase === 'ready' && totalRows > 0 && Boolean(jobId) && !updating;
  const blocked = !perms?.canOpen;
  const rowPct = totalRows > 0 ? Math.min(100, Math.round((completedRows / totalRows) * 100)) : 0;

  if (loading) {
    return (
      <div className="slide slide-74-panpgst panpgst-screen inttrf-screen">
        <p className="loading-msg">Loading Update Pan With GstIn…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-74-panpgst panpgst-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Update Pan With GstIn</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="update-pan-with-gstin" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? <p className="form-error inttrf-screen__error">You do not have permission to run this utility.</p> : null}

      <div className="panpgst-screen__panel">
        <p className="panpgst-screen__hint">
          Proceed lists accounts where PAN is blank and GSTIN is set; Post confirms before copying PAN from GSTIN
          (characters 3–12).
        </p>

        {(totalRows > 0 || previewing || updating || phase === 'done') && (
          <div className="panpgst-screen__progress">
            <div className="panpgst-screen__progress-label">
              <span>
                Accounts — Total: <strong>{totalRows}</strong> · Updated: <strong>{completedRows}</strong>
                {phase === 'updating' || phase === 'done' ? ` (${rowPct}%)` : ''}
              </span>
              <TransferElapsedClock
                elapsedMs={elapsedMs}
                label={elapsedLabel}
                visible={previewing || updating || phase === 'done'}
                running={clockRunning}
              />
            </div>
            {(phase === 'updating' || phase === 'done') && (
              <div
                className="panpgst-screen__progress-bar"
                role="progressbar"
                aria-valuenow={completedRows}
                aria-valuemin={0}
                aria-valuemax={totalRows}
              >
                <div className="panpgst-screen__progress-fill" style={{ width: `${rowPct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap">
          <table className="inttrf-screen__grid panpgst-screen__grid">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>GSTIN</th>
                <th>New PAN</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="inttrf-screen__grid-empty">
                    {previewing
                      ? 'Loading…'
                      : phase === 'ready'
                        ? 'Review the list, then tap Post.'
                        : 'Tap Proceed to list accounts.'}
                  </td>
                </tr>
              ) : (
                gridRows.map((r, idx) => {
                  const done = idx < completedRows;
                  const active = updating && idx === completedRows;
                  return (
                    <tr
                      key={r._id}
                      ref={active ? activeRowRef : null}
                      className={[done ? 'panpgst-row-done' : '', active ? 'panpgst-row-active' : ''].filter(Boolean).join(' ')}
                    >
                      <td>{r.CODE}</td>
                      <td>{r.NAME}</td>
                      <td>{r.GST_NO}</td>
                      <td className="panpgst-new">{r.NEW_PAN}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel panpgst-screen__footer">
          <div className="inttrf-screen__footer-toolbar panpgst-screen__footer-toolbar">
            <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev} disabled={busy}>
              Quit
            </button>
            <div className="panpgst-screen__footer-actions">
              <button type="button" className="btn btn-primary inttrf-btn" onClick={handleList} disabled={busy || blocked}>
                {previewing ? 'Loading…' : 'Proceed'}
              </button>
              <button
                type="button"
                className="btn btn-primary inttrf-btn panpgst-screen__post"
                onClick={handlePost}
                disabled={!canPost || blocked}
              >
                {updating ? `Posting ${completedRows}/${totalRows}` : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
