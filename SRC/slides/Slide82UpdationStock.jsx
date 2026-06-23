import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import TransferElapsedClock from '../components/TransferElapsedClock';
import { toInputDateString, toOracleDate } from '../utils/dateFormat';
import { isDesktopOnlyFrozen } from '../utils/appViewMode';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';
import { useTransferElapsedClock } from '../utils/useTransferElapsedClock';

const reqOpts = { withCredentials: true, timeout: 120000 };
const proceedOpts = { withCredentials: true, timeout: 1800000 };

function clientViewHeaders() {
  return { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`inttrf-field updt-field ${className}`.trim()}>
      <span className="inttrf-field__lbl">{label}</span>
      <span className="inttrf-field__ctl">{children}</span>
    </label>
  );
}

/** VFP DO FORM stkupdt — stock balance updation from old year to new year (desktop only). */
export default function Slide82UpdationStock({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const formRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [ctx, setCtx] = useState(null);

  const [nextDir, setNextDir] = useState('');
  const [endDate, setEndDate] = useState('');

  const { elapsedMs, elapsedLabel, resetElapsed } = useTransferElapsedClock(running);

  const currentDir = String(ctx?.currentYearDirectory ?? compUid ?? '').trim();
  const canProceed = Boolean(perms?.canEdit || perms?.isSupervisor);
  const hasNextYear = Boolean(ctx?.hasNextYear);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/updation-stock/context'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            user_name: userName || '',
          },
          headers: clientViewHeaders(),
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data?.permissions ?? null);
        const c = data?.context ?? {};
        setCtx(c);
        setNextDir(String(c.nextYearDirectory ?? '').trim());
        setEndDate(toInputDateString(c.endDate) || '');
        if (!c.hasNextYear) {
          setErr('No Data Found For Updation — next year directory not found in COMPDET.');
        }
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, userName]);

  const handleFormEnter = (e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  };

  const handleProceed = async () => {
    if (!canProceed) {
      alert('You do not have permission to run stock updation.');
      return;
    }
    if (!nextDir.trim()) {
      alert('!!! Directory Name Should Not Be Empty !!!');
      return;
    }
    if (!endDate) {
      alert('Ending Date is required.');
      return;
    }
    if (
      !window.confirm(
        'Proceed with stock updation to next year schema?\n\nThis rebuilds opening CPUR and LOTSTOCK (PC) rows in the target year.'
      )
    ) {
      return;
    }
    setRunning(true);
    resetElapsed();
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/updation-stock/execute'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          source_comp_uid: currentDir,
          next_year_directory: nextDir.trim(),
          end_date: toOracleDate(endDate),
          user_name: userName,
          client_view: isDesktopOnlyFrozen() ? 'mobile' : 'desktop',
        },
        { headers: clientViewHeaders(), ...proceedOpts }
      );
      alert(
        `DONE\n\nCPUR rows: ${data?.cpurInserted ?? 0}\nLOTSTOCK rows: ${data?.lotstockInserted ?? 0}\nSource lots: ${data?.sourceLots ?? 0}`
      );
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Stock updation failed';
      setErr(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-82-stkupdt updt-screen">
        <div className="updt-screen__card updt-screen__card--loading">
          <p className="loading-msg">Loading Updation Stock…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-82-stkupdt updt-screen detail-mast-screen account-master-screen">
      <div className="updt-screen__card">
        <div className="account-master-screen__head inttrf-screen__head">
          <h2 className="sale-bill-page__title inttrf-screen__title">Updation Stock</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="updation-stock" />
        </div>

        {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

        <p className="updt-screen__hint">
          Stock balance updation from old year to new year (VFP <code>DO FORM stkupdt</code>). Desktop only.
        </p>

        <form
          ref={formRef}
          className="updt-screen__form"
          onSubmit={(e) => e.preventDefault()}
          onKeyDownCapture={handleFormEnter}
        >
          <Field label="Current Year Directory">
            <input className="inttrf-input" type="text" value={currentDir} readOnly tabIndex={-1} />
          </Field>
          <Field label="Next Year Directory">
            <input
              className="inttrf-input"
              type="text"
              value={nextDir}
              onChange={(e) => setNextDir(e.target.value)}
              disabled={running}
              maxLength={40}
            />
          </Field>
          <Field label="Ending Date">
            <input
              className="inttrf-input"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={running}
            />
          </Field>
        </form>

        {running ? (
          <p className="updt-screen__status">
            Running stock updation… <TransferElapsedClock elapsedMs={elapsedMs} label={elapsedLabel} />
          </p>
        ) : null}

        <div className="updt-screen__footer">
          <button type="button" className="btn btn-secondary" onClick={onPrev} disabled={running}>
            Quit
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleProceed}
            disabled={running || !canProceed || !hasNextYear}
          >
            {running ? 'Processing…' : 'Proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}
