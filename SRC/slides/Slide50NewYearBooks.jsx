import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { deriveFromEndingDate, suggestNextFinancialYear } from '../utils/newYearBooksUtils';
import { apiUrl } from '../utils/resolveApiBase';
import { DESKTOP_ONLY_UTILITY_MESSAGE, isDesktopOnlyFrozen } from '../utils/appViewMode';
import {
  advanceReportFormOnEnter,
  handleReportDateEnter,
} from '../utils/reportFormFocus';

const reqOpts = { withCredentials: true, timeout: 120000 };
const proceedOpts = { withCredentials: true, timeout: 1800000 };

function proceedStatusMessage(elapsedSec) {
  if (elapsedSec < 20) return 'Creating compdet row and Oracle user…';
  if (elapsedSec < 120) return 'Cloning tables from current year schema — usually 2–15 minutes…';
  if (elapsedSec < 600) return 'Still cloning tables — not frozen. Watch the server console for progress.';
  return 'Large database — still working. Do not close the browser. Server may need 15–30 minutes.';
}

function clientViewHeaders() {
  return { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
}

/** VFP DO FORM prepare — Prepare New Year Books (compdet row). */
export default function Slide50NewYearBooks({ apiBase, formData, userName, onPrev, onReset, onYearCreated }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const formRef = useRef(null);
  const dirInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [proceedElapsed, setProceedElapsed] = useState(0);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [ctx, setCtx] = useState(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [directoryName, setDirectoryName] = useState('');
  const [newYear, setNewYear] = useState('');

  const mobileFrozen = isDesktopOnlyFrozen();
  const directoryPrefix = ctx?.directoryPrefix || 'GRAIN';

  const currentYearLabel = useMemo(
    () => String(ctx?.currentYear ?? formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
    [ctx, formData]
  );

  const applyEndingDateDerivation = (endVal, { focusDirectory = false } = {}) => {
    const val = endVal || '';
    setEndDate(val);
    const derived = deriveFromEndingDate(val, directoryPrefix);
    if (derived.newYear) setNewYear(derived.newYear);
    if (derived.directoryName) setDirectoryName(derived.directoryName);
    if (focusDirectory) {
      requestAnimationFrame(() => {
        dirInputRef.current?.focus();
        dirInputRef.current?.select?.();
      });
    }
  };

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
        const { data } = await axios.get(apiUrl(apiBase, '/api/new-year-books/context'), {
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
        setCtx(data?.context ?? null);
        const c = data?.context ?? {};
        const prefix = c.directoryPrefix || 'GRAIN';
        const start = toInputDateString(c.suggestedStartDate) || '';
        const end = toInputDateString(c.suggestedEndDate) || '';
        setStartDate(start);
        if (end) {
          setEndDate(end);
          const derived = deriveFromEndingDate(end, prefix);
          setNewYear(String(c.suggestedNewYear ?? derived.newYear ?? '').trim());
          setDirectoryName(String(c.suggestedDirectoryName ?? derived.directoryName ?? '').trim());
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
  }, [apiBase, compCode, compUid, userName, mobileFrozen]);

  useEffect(() => {
    if (!saving) {
      setProceedElapsed(0);
      return undefined;
    }
    const t0 = Date.now();
    const id = setInterval(() => setProceedElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [saving]);

  const handleQuit = () => {
    if (saving) {
      const ok = window.confirm(
        'Prepare is still running on the server (cloning Oracle tables).\n\nLeaving this screen does NOT cancel it.\n\nStay and wait if you can (2–20 min). Quit only if the server console shows an error.'
      );
      if (!ok) return;
    }
    onPrev();
  };

  const reapplySuggestions = () => {
    const s = suggestNextFinancialYear(
      ctx?.currentEndDate ?? formData.comp_e_dt ?? formData.COMP_E_DT,
      directoryPrefix
    );
    if (s.startDate) setStartDate(s.startDate);
    if (s.endDate) applyEndingDateDerivation(s.endDate);
  };

  const onFormFieldEnter = (e) => advanceReportFormOnEnter(e, formRef.current);
  const onStartDateEnter = (e) => handleReportDateEnter(e, formRef.current);
  const onEndDateEnter = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    applyEndingDateDerivation(e.target.value, { focusDirectory: true });
  };

  const handleProceed = async (e) => {
    e.preventDefault();
    if (mobileFrozen) {
      alert(DESKTOP_ONLY_UTILITY_MESSAGE);
      return;
    }
    if (!perms?.canProceed) {
      alert('Only Supervisor users can prepare new year books.');
      return;
    }
    if (!startDate || !endDate) {
      alert('Please set starting and ending dates.');
      return;
    }
    const mpath = directoryName.trim().toUpperCase();
    if (!mpath) {
      alert('!!! Directory Name Should Not Be Empty !!!');
      dirInputRef.current?.focus();
      return;
    }
    if (!newYear.trim()) {
      alert('Please set the new year number.');
      return;
    }
    if (
      !window.confirm(
        `Create new year books?\n\nCompany: ${compName || compCode}\nDirectory: ${mpath}\nNew year: ${newYear}\nDates: ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}\n\nThis clones all Oracle tables and may take 2–20 minutes. Please wait — do not click Proceed again.`
      )
    ) {
      return;
    }

    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/new-year-books'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName || '',
          start_date: toOracleDate(startDate),
          end_date: toOracleDate(endDate),
          new_year: Number(newYear),
          directory_name: mpath,
          client_view: isDesktopOnlyFrozen() ? 'mobile' : 'desktop',
        },
        { ...proceedOpts, headers: clientViewHeaders() }
      );
      const msg = data?.message || 'New Year Books Prepared Successfully.';
      if (data?.yearRow && typeof onYearCreated === 'function') {
        onYearCreated(data.yearRow);
      } else {
        alert(msg);
      }
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-50-new-year-books">
        <p className="loading-msg">Loading New Year Books…</p>
      </div>
    );
  }

  if (mobileFrozen) {
    return (
      <div className="slide slide-50-new-year-books">
        <div className="broker-os-form-chrome">
          <SessionInfoLine
            formData={formData}
            actions={
              <>
                <SessionToolbarChrome helpReportId="new-year-books" helpCompanyName={compName} />
                <button type="button" onClick={onPrev} className="btn btn-secondary btn-toolbar-back">
                  ← Back
                </button>
              </>
            }
          />
        </div>
        <div className="new-year-books-denied new-year-books-denied--mobile">
          <p className="new-year-books-denied__badge">Desktop only</p>
          <p>
            <strong>Not available on mobile.</strong> Prepare New Year Books cannot be run from a phone or Mobile View.
            Use a desktop computer, or open Settings and switch to <strong>Desktop View</strong>.
          </p>
          <p className="sale-bill-section__hint">{DESKTOP_ONLY_UTILITY_MESSAGE}</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (!perms?.canProceed) {
    return (
      <div className="slide slide-50-new-year-books">
        <div className="broker-os-form-chrome">
          <SessionInfoLine
            formData={formData}
            actions={
              <>
                <SessionToolbarChrome helpReportId="new-year-books" helpCompanyName={compName} />
                <button type="button" onClick={onPrev} className="btn btn-secondary btn-toolbar-back">
                  ← Back
                </button>
              </>
            }
          />
        </div>
        <div className="new-year-books-denied">
          <p>
            <strong>Supervisor only.</strong> Prepare New Year Books (VFP <code>DO FORM prepare</code>) requires a
            user with <code>SUPERVISOR = Y</code> in USERS.
          </p>
          {err ? <p className="form-api-error">{err}</p> : null}
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back to menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-50-new-year-books">
      <div className="broker-os-form-chrome">
        <SessionInfoLine
          formData={formData}
          actions={
            <>
              <SessionToolbarChrome helpReportId="new-year-books" helpCompanyName={compName} />
              <button type="button" onClick={onPrev} className="btn btn-secondary btn-toolbar-back">
                ← Back
              </button>
            </>
          }
        />
      </div>

      <form
        ref={formRef}
        id="new-year-books-form"
        className="new-year-books-form"
        onSubmit={handleProceed}
        onKeyDown={onFormFieldEnter}
      >
        <div className="new-year-books-card">
          <h2 className="new-year-books-card__title">Prepare New Year Books</h2>

          <div className="form-row-broker form-row-broker--dates">
            <div className="form-group">
              <label htmlFor="nyb-start">Starting date</label>
              <input
                id="nyb-start"
                type="date"
                lang="en-GB"
                className="form-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onKeyDown={onStartDateEnter}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="nyb-end">Ending date</label>
              <input
                id="nyb-end"
                type="date"
                lang="en-GB"
                className="form-input"
                value={endDate}
                onChange={(e) => applyEndingDateDerivation(e.target.value)}
                onKeyDown={onEndDateEnter}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="nyb-dir">Directory name</label>
            <input
              ref={dirInputRef}
              id="nyb-dir"
              type="text"
              className="form-input"
              value={directoryName}
              onChange={(e) => setDirectoryName(e.target.value.toUpperCase())}
              placeholder={`${directoryPrefix}2027`}
              autoComplete="off"
              required
            />
            <p className="sale-bill-section__hint">
              VFP: <code>GRAIN</code> + year of ending date. Oracle user / <code>comp_uid</code> = directory name.
            </p>
          </div>

          <div className="form-row-broker">
            <div className="form-group">
              <label htmlFor="nyb-cur">Current year</label>
              <input
                id="nyb-cur"
                type="text"
                className="form-input"
                value={currentYearLabel}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
              />
            </div>
            <div className="form-group">
              <label htmlFor="nyb-new">New year</label>
              <input
                id="nyb-new"
                type="number"
                inputMode="numeric"
                className="form-input"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                required
              />
            </div>
          </div>

          <p className="sale-bill-section__hint">
            Current session schema: <strong>{compUid}</strong>
            {ctx?.yearExists ? (
              <>
                {' '}
                · Year <strong>{newYear}</strong> already exists — adjust before Proceed.
              </>
            ) : null}
          </p>

          {saving ? (
            <div className="new-year-books-progress" role="status" aria-live="polite">
              <p className="new-year-books-progress__title">Preparing new year books…</p>
              <p className="new-year-books-progress__msg">{proceedStatusMessage(proceedElapsed)}</p>
              <p className="new-year-books-progress__elapsed">
                Elapsed: {Math.floor(proceedElapsed / 60)}:{String(proceedElapsed % 60).padStart(2, '0')}
              </p>
              <p className="sale-bill-section__hint">
                Not frozen — cloning tables in Oracle. Check the <strong>server console</strong> for lines like{' '}
                <code>new-year-books: clone table …</code>
              </p>
            </div>
          ) : null}

          {err ? (
            <div className="form-api-error" role="alert">
              {err}
            </div>
          ) : null}

          <div className="new-year-books-card__actions">
            <button type="submit" className="btn btn-primary" disabled={saving || ctx?.yearExists}>
              {saving ? 'Preparing…' : 'Proceed'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={reapplySuggestions} disabled={saving}>
              Reset dates
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleQuit}>
              Quit
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
