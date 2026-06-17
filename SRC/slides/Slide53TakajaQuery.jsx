import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { apiUrl } from '../utils/resolveApiBase';
import { isDesktopOnlyFrozen, TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE } from '../utils/appViewMode';

const reqOpts = { withCredentials: true, timeout: 600000 };

function clientViewHeaders() {
  return { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
}

/** VFP DO TAKAJA_QUERY — drop/create TAKAJA view + TAKAJAFUN.TXT. */
export default function Slide53TakajaQuery({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const mobileFrozen = isDesktopOnlyFrozen();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [steps, setSteps] = useState([]);
  const [liveResults, setLiveResults] = useState([]);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);

  const schema = useMemo(() => String(compUid ?? '').trim(), [compUid]);
  const totalSteps = steps.length;
  const completedCount = liveResults.length;
  const remainingCount =
    progress?.remaining ?? Math.max(0, totalSteps - (progress?.current ?? completedCount));
  const progressPct =
    totalSteps && progress
      ? Math.round(((progress.current - 1) / totalSteps) * 100)
      : summary
        ? 100
        : 0;

  const resultByIndex = useMemo(() => {
    const map = new Map();
    for (const row of liveResults) {
      if (Number.isFinite(row?.index)) map.set(row.index, row);
    }
    return map;
  }, [liveResults]);

  useEffect(() => {
    if (mobileFrozen) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/takaja-query/context'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          headers: clientViewHeaders(),
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data?.permissions ?? null);
        setSteps(Array.isArray(data?.context?.steps) ? data.context.steps : []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName, mobileFrozen]);

  const handleRun = async () => {
    if (mobileFrozen) {
      alert(TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE);
      return;
    }
    if (!perms?.canProceed) {
      alert('Supervisor access required.');
      return;
    }
    if (!steps.length) {
      alert('No steps to run.');
      return;
    }
    if (
      !window.confirm(
        `Run Takaja Query on schema ${schema || '—'}?\n\nDrop/create TAKAJA view, then run TAKAJAFUN.TXT.`
      )
    ) {
      return;
    }

    setRunning(true);
    setErr('');
    setLiveResults([]);
    setSummary(null);

    const accumulated = [];
    try {
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        setProgress({
          current: index + 1,
          total: steps.length,
          remaining: Math.max(0, steps.length - index - 1),
          label: step.label,
          phase: step.phase,
          schema: step.schema,
        });

        const { data } = await axios.post(
          apiUrl(apiBase, '/api/takaja-query/step'),
          {
            comp_uid: compUid,
            user_name: userName,
            index,
            client_view: mobileFrozen ? 'mobile' : 'desktop',
          },
          { ...reqOpts, headers: clientViewHeaders() }
        );

        const result = data?.result ? { ...data.result, index } : null;
        if (result) {
          accumulated.push(result);
          setLiveResults([...accumulated]);
        }
        if (data?.progress) {
          setProgress({
            ...data.progress,
            remaining: Math.max(0, data.progress.total - data.progress.current),
          });
        }
      }

      const okCount = accumulated.filter((r) => r.status === 'ok').length;
      const skipCount = accumulated.filter((r) => r.status === 'skipped').length;
      setSummary({ okCount, skipCount, message: 'DONE' });
      setProgress(null);
      alert('DONE');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Takaja Query failed';
      setErr(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  };

  const showResults = running || liveResults.length > 0;

  if (loading) {
    return (
      <div className="slide slide-53-takaja-query takaja-query-screen takaja-query-screen--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Takaja Query</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (mobileFrozen) {
    return (
      <div className="slide slide-53-takaja-query takaja-query-screen">
        <div className="takaja-query-screen__head">
          <h2 className="sale-bill-page__title">Takaja Query</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="takaja-query" />
        </div>
        <div className="takaja-query-denied takaja-query-denied--mobile">
          <p className="takaja-query-denied__badge">Desktop only</p>
          <p>
            <strong>Not available on mobile.</strong> Takaja Query cannot be run from a phone or Mobile View.
            Use a desktop computer, or open Settings and switch to <strong>Desktop View</strong>.
          </p>
          <p className="takaja-query-screen__hint">{TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  if (!perms?.canProceed) {
    return (
      <div className="slide slide-53-takaja-query takaja-query-screen">
        <div className="takaja-query-screen__head">
          <h2 className="sale-bill-page__title">Takaja Query</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="takaja-query" />
        </div>
        <div className="takaja-query-denied">
          <p className="takaja-query-denied__badge">Supervisor only</p>
          <p>{err || 'Supervisor access required to run Takaja Query.'}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-53-takaja-query takaja-query-screen">
      <div className="takaja-query-screen__head">
        <div className="takaja-query-screen__head-bar">
          <h2 className="sale-bill-page__title">Takaja Query</h2>
          <SessionToolbarChrome helpReportId="takaja-query" helpCompanyName={compName} />
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="takaja-query" />
      </div>

      <div className="takaja-query-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

        <p className="takaja-query-screen__hint">
          Rebuilds <code>TAKAJA</code> view on hub schema, then runs <code>TAKAJAFUN.TXT</code> on{' '}
          <strong>{schema || '—'}</strong>. Same as VFP <code>DO TAKAJA_QUERY</code>.
        </p>

        {running && progress ? (
          <div className="takaja-query-progress" role="status" aria-live="polite">
            <p className="takaja-query-progress__title">Running Takaja Query…</p>
            <p className="takaja-query-progress__current">
              <strong>{progress.label}</strong>
              {progress.schema ? (
                <>
                  {' '}
                  on <code>{progress.schema}</code>
                </>
              ) : null}
            </p>
            <p className="takaja-query-progress__counts">
              {progress.current} of {progress.total} &nbsp;·&nbsp; {remainingCount} remaining
            </p>
            <div
              className="takaja-query-progress__track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, progressPct))}
            >
              <div className="takaja-query-progress__fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}

        <div className="takaja-query-screen__actions">
          <button type="button" className="btn btn-primary" onClick={handleRun} disabled={running || !schema}>
            {running ? 'Running…' : 'Run Takaja Query'}
          </button>
        </div>

        <div className="takaja-query-screen__grid-wrap">
          <table className="takaja-query-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Step</th>
                <th>Schema</th>
                {showResults ? <th>Result</th> : null}
              </tr>
            </thead>
            <tbody>
              {steps.map((step, idx) => {
                const result = resultByIndex.get(idx);
                const isCurrent = running && progress?.current === idx + 1;
                const rowClass = isCurrent
                  ? 'takaja-query-grid__row is-current'
                  : result
                    ? 'takaja-query-grid__row is-done'
                    : 'takaja-query-grid__row';
                return (
                  <tr key={`${step.phase}-${idx}`} className={rowClass}>
                    <td className="num">{idx + 1}</td>
                    <td>{step.label}</td>
                    <td>{step.schema || 'hub'}</td>
                    {showResults ? (
                      <td
                        className={
                          isCurrent
                            ? 'takaja-query-grid__working'
                            : result?.status === 'ok'
                              ? 'takaja-query-grid__ok'
                              : result
                                ? 'takaja-query-grid__skip'
                                : ''
                        }
                      >
                        {isCurrent
                          ? 'Running…'
                          : result?.status === 'ok'
                            ? result.message || 'OK'
                            : result?.message || '—'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {summary ? (
          <p className="takaja-query-screen__summary">
            {summary.okCount ?? 0} completed, {summary.skipCount ?? 0} skipped — {summary.message}
          </p>
        ) : null}
      </div>

      <div className="takaja-query-screen__footer">
        <button type="button" className="btn btn-secondary" onClick={onPrev} disabled={running}>
          ← Back to menu
        </button>
        <button type="button" className="btn btn-secondary" onClick={onReset} disabled={running}>
          Home
        </button>
      </div>
    </div>
  );
}
