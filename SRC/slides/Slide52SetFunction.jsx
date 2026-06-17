import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { apiUrl } from '../utils/resolveApiBase';
import { isDesktopOnlyFrozen, SET_FUNCTION_DESKTOP_ONLY_MESSAGE } from '../utils/appViewMode';

const reqOpts = { withCredentials: true, timeout: 600000 };

function clientViewHeaders() {
  return { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
}

/** VFP DO setFUNC — ORAFUN, TAKAJAFUN, TAKAJA view, indexes, SORAFUN. */
export default function Slide52SetFunction({ apiBase, formData, userName, onPrev, onReset }) {
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const mobileFrozen = isDesktopOnlyFrozen();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [steps, setSteps] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [liveResults, setLiveResults] = useState([]);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);

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
        const { data } = await axios.get(apiUrl(apiBase, '/api/set-function/context'), {
          params: { user_name: userName || '' },
          headers: clientViewHeaders(),
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data?.permissions ?? null);
        setSchemas(Array.isArray(data?.context?.schemas) ? data.context.schemas : []);
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
  }, [apiBase, userName, mobileFrozen]);

  const handleRun = async () => {
    if (mobileFrozen) {
      alert(SET_FUNCTION_DESKTOP_ONLY_MESSAGE);
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
        `Run Set Function on ${schemas.length} schema(s) and ${steps.length} step(s)?\n\nThis runs ORAFUN, TAKAJAFUN, rebuilds TAKAJA view/indexes, then SORAFUN.`
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
          apiUrl(apiBase, '/api/set-function/step'),
          {
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
      setSummary({ okCount, skipCount, message: 'PROCESS COMPLETED' });
      setProgress(null);
      alert('PROCESS COMPLETED');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Set Function failed';
      setErr(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  };

  const showResults = running || liveResults.length > 0;

  if (loading) {
    return (
      <div className="slide slide-52-set-function set-function-screen set-function-screen--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Set Function</h2>
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
      <div className="slide slide-52-set-function set-function-screen">
        <div className="set-function-screen__head">
          <h2 className="sale-bill-page__title">Set Function</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="set-function" />
        </div>
        <div className="set-function-denied set-function-denied--mobile">
          <p className="set-function-denied__badge">Desktop only</p>
          <p>
            <strong>Not available on mobile.</strong> Set Function cannot be run from a phone or Mobile View.
            Use a desktop computer, or open Settings and switch to <strong>Desktop View</strong>.
          </p>
          <p className="set-function-screen__hint">{SET_FUNCTION_DESKTOP_ONLY_MESSAGE}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  if (!perms?.canProceed) {
    return (
      <div className="slide slide-52-set-function set-function-screen">
        <div className="set-function-screen__head">
          <h2 className="sale-bill-page__title">Set Function</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="set-function" />
        </div>
        <div className="set-function-denied">
          <p className="set-function-denied__badge">Supervisor only</p>
          <p>{err || 'Supervisor access required to run Set Function.'}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-52-set-function set-function-screen">
      <div className="set-function-screen__head">
        <div className="set-function-screen__head-bar">
          <h2 className="sale-bill-page__title">Set Function</h2>
          <SessionToolbarChrome helpReportId="set-function" helpCompanyName={compName} />
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="set-function" />
      </div>

      <div className="set-function-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

        <p className="set-function-screen__hint">
          Runs Oracle function scripts for <strong>{schemas.length}</strong> comp_uid schema(s), rebuilds{' '}
          <code>TAKAJA</code> view and indexes, then <code>SORAFUN</code>. Same as VFP{' '}
          <code>DO setFUNC</code>.
        </p>

        {running && progress ? (
          <div className="set-function-progress" role="status" aria-live="polite">
            <p className="set-function-progress__title">Running Set Function…</p>
            <p className="set-function-progress__current">
              <strong>{progress.label}</strong>
              {progress.schema ? (
                <>
                  {' '}
                  on <code>{progress.schema}</code>
                </>
              ) : null}
            </p>
            <p className="set-function-progress__counts">
              {progress.current} of {progress.total} &nbsp;·&nbsp; {remainingCount} remaining
            </p>
            <div
              className="set-function-progress__track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, progressPct))}
            >
              <div className="set-function-progress__fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}

        <div className="set-function-screen__actions">
          <button type="button" className="btn btn-primary" onClick={handleRun} disabled={running || !steps.length}>
            {running ? 'Running…' : 'Run Set Function'}
          </button>
        </div>

        <div className="set-function-screen__grid-wrap">
          <table className="set-function-grid">
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
                  ? 'set-function-grid__row is-current'
                  : result
                    ? 'set-function-grid__row is-done'
                    : 'set-function-grid__row';
                return (
                  <tr key={`${step.phase}-${step.schema || 'hub'}-${idx}`} className={rowClass}>
                    <td className="num">{idx + 1}</td>
                    <td>{step.label}</td>
                    <td>{step.schema || '—'}</td>
                    {showResults ? (
                      <td
                        className={
                          isCurrent
                            ? 'set-function-grid__working'
                            : result?.status === 'ok'
                              ? 'set-function-grid__ok'
                              : result
                                ? 'set-function-grid__skip'
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
          <p className="set-function-screen__summary">
            {summary.okCount ?? 0} completed, {summary.skipCount ?? 0} skipped — {summary.message}
          </p>
        ) : null}
      </div>

      <div className="set-function-screen__footer">
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
