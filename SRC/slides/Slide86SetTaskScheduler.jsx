import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

const DRIVE_OPTIONS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => ({ value: d, label: d }));

function SchtaskField({ label, children, hint }) {
  return (
    <label className="schtask-field">
      <span className="schtask-field__lbl">{label}</span>
      <span className="schtask-field__ctl">{children}</span>
      {hint ? <span className="schtask-field__hint">{hint}</span> : null}
    </label>
  );
}

/** VFP DO FORM schtask WITH 1 — ORABACK Windows task + DEFVALUE PKG/BACK folders. */
export default function Slide86SetTaskScheduler({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [pkgFolder, setPkgFolder] = useState('');
  const [backFolder, setBackFolder] = useState('');
  const [rtime, setRtime] = useState('1');
  const [meta, setMeta] = useState(null);
  const formRef = React.useRef(null);

  const canProceed = Boolean(perms?.canEdit || perms?.isSupervisor);

  const loadContext = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/schtask'), {
      params: { comp_code: compCode, comp_uid: compUid, user_name: userName || '' },
      ...reqOpts,
    });
    setPerms(data?.permissions ?? null);
    setPkgFolder(String(data?.pkg_folder ?? '').trim().toUpperCase().slice(0, 1));
    setBackFolder(String(data?.back_folder ?? '').trim().toUpperCase().slice(0, 1));
    setRtime(String(data?.rtime ?? 1));
    setMeta(data?.meta ?? null);
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        await loadContext();
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadContext]);

  const handleProceed = async () => {
    if (!canProceed) {
      alert('You Can Not Edit');
      return;
    }
    const pkg = String(pkgFolder).trim().toUpperCase().slice(0, 1);
    const back = String(backFolder).trim().toUpperCase().slice(0, 1);
    const hours = Number(rtime);
    if (!pkg || !/^[A-Z]$/.test(pkg)) {
      alert('Enter a valid Package Folder drive letter (A–Z).');
      return;
    }
    if (!back || !/^[A-Z]$/.test(back)) {
      alert('Enter a valid Backup Folder drive letter (A–Z).');
      return;
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 999) {
      alert('Repeat Backup Every must be between 1 and 999 hours.');
      return;
    }
    if (!window.confirm('Create / replace Windows scheduled task ORABACK and save folder drives to DEFVALUE?')) {
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/schtask/proceed'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          pkg_folder: pkg,
          back_folder: back,
          rtime: hours,
        },
        reqOpts
      );
      alert(data?.message || 'TASK CREATED');
      await loadContext();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-86-schtask schtask-screen">
        <p className="loading-msg">Loading Set Task Scheduler…</p>
      </div>
    );
  }

  if (!perms?.canOpen && !perms?.isSupervisor) {
    return (
      <div className="slide slide-86-schtask schtask-screen">
        <h2 className="sale-bill-page__title">Set Task Scheduler</h2>
        <p className="form-error">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-86-schtask schtask-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head">
        <div className="schtask-screen__head-bar">
          <h2 className="sale-bill-page__title">Set Task Scheduler</h2>
          <MasterScreenToolbar onPrev={onPrev} onReset={onReset} onRefresh={loadContext} listLoading={proceeding}>
            <GfasToolbarBtn
              label={proceeding ? 'Proceeding…' : 'Proceed'}
              variant="primary"
              onClick={handleProceed}
              disabled={proceeding || !canProceed}
            />
          </MasterScreenToolbar>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="set-task-scheduler" />
      </div>

      <p className="schtask-screen__hint">
        VFP <code>DO FORM schtask WITH 1</code> — creates Windows task <strong>ORABACK</strong> (hourly backup) and
        saves drive letters to <strong>DEFVALUE.PKG_FOLDER</strong> / <strong>BACK_FOLDER</strong>.
      </p>

      {err ? <p className="form-error">{err}</p> : null}

      {meta && !meta.is_windows ? (
        <p className="form-error">Scheduled tasks can only be created on the Windows server running the API.</p>
      ) : null}

      <form
        ref={formRef}
        className="schtask-screen__form"
        onSubmit={(e) => e.preventDefault()}
        onKeyDownCapture={(e) => focusNextOnEnter(e, formRef, { submitOnLast: false })}
      >
        <div className="schtask-screen__panel">
          <SchtaskField label="Package Folder" hint="Drive letter (DEFVALUE.PKG_FOLDER)">
            <select
              className="form-input schtask-field__input"
              value={pkgFolder}
              disabled={proceeding}
              onChange={(e) => setPkgFolder(e.target.value)}
            >
              <option value="">—</option>
              {DRIVE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SchtaskField>

          <SchtaskField label="Backup Folder" hint="Drive letter (DEFVALUE.BACK_FOLDER); creates \BACKUP on Proceed">
            <select
              className="form-input schtask-field__input"
              value={backFolder}
              disabled={proceeding}
              onChange={(e) => setBackFolder(e.target.value)}
            >
              <option value="">—</option>
              {DRIVE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SchtaskField>

          <SchtaskField label="Repeat Backup Every (hours)" hint="ORABACK task interval (/SC HOURLY /MO n)">
            <input
              className="form-input schtask-field__input schtask-field__input--num"
              type="number"
              min={1}
              max={999}
              value={rtime}
              disabled={proceeding}
              onChange={(e) => setRtime(e.target.value)}
            />
          </SchtaskField>
        </div>

        {meta ? (
          <div className="schtask-screen__meta">
            <p>
              <strong>ORABACK exe:</strong> {meta.oraback_exe || '—'}
              {meta.oraback_exe_exists ? '' : ' (not found on server)'}
            </p>
            <p>
              <strong>Task ORABACK:</strong> {meta.oraback_task_exists ? 'Registered' : 'Not registered'}
              {meta.start_time ? ` · starts ${meta.start_time}` : ''}
            </p>
          </div>
        ) : null}
      </form>
    </div>
  );
}
