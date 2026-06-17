import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { apiUrl } from '../utils/resolveApiBase';
import { isDesktopOnlyFrozen, PRIMARY_KEY_DESKTOP_ONLY_MESSAGE } from '../utils/appViewMode';

const reqOpts = { withCredentials: true, timeout: 600000 };

function clientViewHeaders() {
  return { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
}

/** VFP DO primary_key — rebuild primary keys via PRIMARY_KEY.TXT / SQL*Plus. */
export default function Slide51PrimaryKey({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const mobileFrozen = isDesktopOnlyFrozen();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [tables, setTables] = useState([]);
  const [liveResults, setLiveResults] = useState([]);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);

  const schema = useMemo(() => String(compUid ?? '').trim(), [compUid]);
  const totalTables = tables.length;
  const completedCount = liveResults.length;
  const remainingCount =
    progress?.remaining ?? Math.max(0, totalTables - (progress?.current ?? completedCount));
  const progressPct =
    totalTables && progress
      ? Math.round(((progress.current - 1) / totalTables) * 100)
      : summary
        ? 100
        : 0;

  const resultByTable = useMemo(() => {
    const map = new Map();
    for (const row of liveResults) {
      if (row?.table) map.set(row.table, row);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/primary-key/context'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          headers: clientViewHeaders(),
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data?.permissions ?? null);
        setTables(Array.isArray(data?.context?.tables) ? data.context.tables : []);
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

  const handleRebuild = async () => {
    if (mobileFrozen) {
      alert(PRIMARY_KEY_DESKTOP_ONLY_MESSAGE);
      return;
    }
    if (!perms?.canProceed) {
      alert('Supervisor access required.');
      return;
    }
    if (
      !window.confirm(
        `Rebuild primary keys on schema ${schema || '—'}?\n\nThis drops and recreates PK constraints on ${tables.length} tables.`
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
      for (let index = 0; index < tables.length; index += 1) {
        const row = tables[index];
        setProgress({
          current: index + 1,
          total: tables.length,
          remaining: Math.max(0, tables.length - index - 1),
          table: row.table,
          constraint: row.constraint,
        });

        const { data } = await axios.post(
          apiUrl(apiBase, '/api/primary-key/table'),
          {
            comp_uid: compUid,
            user_name: userName,
            table: row.table,
            index,
            client_view: mobileFrozen ? 'mobile' : 'desktop',
          },
          { ...reqOpts, headers: clientViewHeaders() }
        );

        const result = data?.result;
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
      setSummary({
        okCount,
        skipCount,
        schema,
        message: 'DONE',
      });
      setProgress(null);
      alert('DONE');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Rebuild failed';
      setErr(msg);
      alert(msg);
    } finally {
      setRunning(false);
    }
  };

  const showResults = running || liveResults.length > 0;

  if (loading) {
    return (
      <div className="slide slide-51-primary-key primary-key-screen primary-key-screen--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Primary Key</h2>
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
      <div className="slide slide-51-primary-key primary-key-screen">
        <div className="primary-key-screen__head">
          <h2 className="sale-bill-page__title">Primary Key</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="primary-key" />
        </div>
        <div className="primary-key-denied primary-key-denied--mobile">
          <p className="primary-key-denied__badge">Desktop only</p>
          <p>
            <strong>Not available on mobile.</strong> Primary Key rebuild cannot be run from a phone or Mobile View.
            Use a desktop computer, or open Settings and switch to <strong>Desktop View</strong>.
          </p>
          <p className="primary-key-screen__hint">{PRIMARY_KEY_DESKTOP_ONLY_MESSAGE}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  if (!perms?.canProceed) {
    return (
      <div className="slide slide-51-primary-key primary-key-screen">
        <div className="primary-key-screen__head">
          <h2 className="sale-bill-page__title">Primary Key</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="primary-key" />
        </div>
        <div className="primary-key-denied">
          <p className="primary-key-denied__badge">Supervisor only</p>
          <p>{err || 'Supervisor access required to rebuild primary keys.'}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-51-primary-key primary-key-screen">
      <div className="primary-key-screen__head">
        <div className="primary-key-screen__head-bar">
          <h2 className="sale-bill-page__title">Primary Key</h2>
          <SessionToolbarChrome helpReportId="primary-key" helpCompanyName={compName} />
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="primary-key" />
      </div>

      <div className="primary-key-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

        <p className="primary-key-screen__hint">
          Rebuilds primary key constraints on the current company schema (<strong>{schema || '—'}</strong>).
          Same as VFP <code>DO primary_key</code> / <code>PRIMARY_KEY.TXT</code>.
        </p>

        {running && progress ? (
          <div className="primary-key-progress" role="status" aria-live="polite">
            <p className="primary-key-progress__title">Generating primary key…</p>
            <p className="primary-key-progress__current">
              <strong>{progress.table}</strong>
              {progress.constraint ? (
                <>
                  {' '}
                  (<code>{progress.constraint}</code>)
                </>
              ) : null}
            </p>
            <p className="primary-key-progress__counts">
              {progress.current} of {progress.total} &nbsp;·&nbsp; {remainingCount} remaining
            </p>
            <div
              className="primary-key-progress__track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, progressPct))}
            >
              <div className="primary-key-progress__fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}

        <div className="primary-key-screen__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRebuild}
            disabled={running || !schema}
          >
            {running ? 'Rebuilding…' : 'Rebuild primary keys'}
          </button>
        </div>

        <div className="primary-key-screen__grid-wrap">
          <table className="primary-key-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Table</th>
                <th>Primary key columns</th>
                <th>Constraint</th>
                {showResults ? <th>Result</th> : null}
              </tr>
            </thead>
            <tbody>
              {tables.map((row, idx) => {
                const result = resultByTable.get(row.table);
                const isCurrent = running && progress?.table === row.table;
                const rowClass = isCurrent
                  ? 'primary-key-grid__row is-current'
                  : result
                    ? 'primary-key-grid__row is-done'
                    : 'primary-key-grid__row';
                return (
                  <tr key={row.table} className={rowClass}>
                    <td className="num">{idx + 1}</td>
                    <td>{row.table}</td>
                    <td>{row.columns}</td>
                    <td>{row.constraint}</td>
                    {showResults ? (
                      <td
                        className={
                          isCurrent
                            ? 'primary-key-grid__working'
                            : result?.status === 'ok'
                              ? 'primary-key-grid__ok'
                              : result
                                ? 'primary-key-grid__skip'
                                : ''
                        }
                      >
                        {isCurrent ? 'Generating…' : result?.status === 'ok' ? 'OK' : result?.message || '—'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {summary ? (
          <p className="primary-key-screen__summary">
            {summary.okCount ?? 0} rebuilt, {summary.skipCount ?? 0} skipped on schema {summary.schema || schema}.
          </p>
        ) : null}
      </div>

      <div className="primary-key-screen__footer">
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
