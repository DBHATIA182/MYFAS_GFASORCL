import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import NewCompanyPasswordGate from '../components/NewCompanyPasswordGate';
import NewCompanyDeletePicker from '../components/NewCompanyDeletePicker';
import NewCompanyProgressPanel from '../components/NewCompanyProgressPanel';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import {
  NEWCOMP_FIELD_SPECS,
  NEWCOMP_DATE_KEYS,
  emptyNewcompForm,
} from '../data/newcompFieldConfig';
import { toInputDateString, toOracleDate } from '../utils/dateFormat';
import { isDesktopOnlyFrozen } from '../utils/appViewMode';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const saveOpts = { withCredentials: true, timeout: 600000 };

function clientViewHeaders(accessToken) {
  const headers = { 'X-Client-View': isDesktopOnlyFrozen() ? 'mobile' : 'desktop' };
  if (accessToken) headers['X-New-Company-Access-Token'] = accessToken;
  return headers;
}

function mapContextToForm(ctx) {
  const base = emptyNewcompForm();
  base.COMP_CODE = String(ctx?.suggestedCompCode ?? '');
  base.COMP_YEAR = String(ctx?.defaultCompYear ?? '');
  base.COMP_UID = String(ctx?.schemaUid ?? '');
  base.COMP_S_DT = toInputDateString(ctx?.defaultStartDate) || '';
  base.COMP_E_DT = toInputDateString(ctx?.defaultEndDate) || '';
  return base;
}

function NewcompField({ spec, value, disabled, onChange, onEnterNext }) {
  const id = `newcomp-${spec.key}`;
  const onKeyDown = onEnterNext ? (e) => onEnterNext(e) : undefined;
  const common = {
    id,
    className: 'newcomp-field__input inttrf-input',
    disabled,
    value: value ?? '',
    onChange: (e) => onChange(spec.key, e.target.value),
    onKeyDown,
  };

  if (spec.readOnly) {
    return <input {...common} readOnly tabIndex={-1} />;
  }
  if (spec.type === 'date') {
    return <input {...common} type="date" />;
  }
  if (spec.type === 'password') {
    return <input {...common} type="password" autoComplete="off" maxLength={spec.maxLen || 30} />;
  }
  return <input {...common} type="text" maxLength={spec.maxLen || 120} />;
}

function progressLineFromStep(step, extra = {}) {
  return {
    schema: step?.schema,
    table: step?.table,
    command: step?.command,
    rows: step?.rows,
    skipped: step?.skipped,
    ...extra,
  };
}

/** VFP DO FORM newcomp — add company to COMPANY/COMPDET and clone master templates. */
export default function Slide83NewCompanyAddition({ apiBase, formData, userName, onPrev, onCompaniesChanged }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const formRef = useRef(null);
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [form, setForm] = useState(emptyNewcompForm);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteCompanies, setDeleteCompanies] = useState([]);
  const [deletePickerLoading, setDeletePickerLoading] = useState(false);
  const [deletePickerErr, setDeletePickerErr] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [progressTitle, setProgressTitle] = useState('');
  const [progressLines, setProgressLines] = useState([]);

  const canAdd = Boolean(perms?.canAdd || perms?.isSupervisor);
  const canDelete = Boolean(perms?.canDelete || perms?.isSupervisor);
  const busy = saving || deleting;

  const appendProgress = useCallback((line) => {
    setProgressLines((prev) => [...prev, line]);
  }, []);

  const loadContext = useCallback(
    async (token) => {
      if (!token) return;
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/new-company/context'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            user_name: userName || '',
            access_token: token,
          },
          headers: clientViewHeaders(token),
          ...reqOpts,
        });
        setPerms(data?.permissions ?? null);
        const c = data?.context ?? {};
        setCtx(c);
        setForm(mapContextToForm(c));
        requestAnimationFrame(() => {
          document.getElementById('newcomp-COMP_NAME')?.focus();
        });
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        if (e?.response?.status === 403) setAccessToken('');
      } finally {
        setLoading(false);
      }
    },
    [apiBase, compCode, compUid, userName]
  );

  useEffect(() => {
    if (accessToken) loadContext(accessToken);
  }, [accessToken, loadContext]);

  const handlePasswordVerified = (token) => {
    setAccessToken(token);
  };

  const handleFormEnter = (e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  };

  const runSteppedSave = async () => {
    const newCode = Number(form.COMP_CODE ?? 0) || 0;
    const newYear = Number(form.COMP_YEAR ?? ctx?.templateCompYear ?? 0) || 0;
    const payload = { ...form };
    for (const key of NEWCOMP_DATE_KEYS) {
      if (payload[key]) payload[key] = toOracleDate(payload[key]);
    }

    const { data: planData } = await axios.get(apiUrl(apiBase, '/api/new-company/save/plan'), {
      params: {
        comp_code: compCode,
        comp_uid: compUid,
        user_name: userName || '',
        access_token: accessToken,
        template_comp_code: ctx?.templateCompCode,
        new_comp_code: newCode,
        comp_year: newYear,
      },
      headers: clientViewHeaders(accessToken),
      ...reqOpts,
    });

    const steps = planData?.steps ?? [];
    const total = steps.length || 1;
    const lines = [];

    setDeleteStatus(`Step 1/${total}: INSERT COMPANY/COMPDET…`);
    const { data: insertData } = await axios.post(
      apiUrl(apiBase, '/api/new-company/save/insert'),
      {
        comp_code: compCode,
        comp_uid: compUid,
        user_name: userName,
        access_token: accessToken,
        template_comp_year: ctx?.templateCompYear,
        fields: payload,
        client_view: isDesktopOnlyFrozen() ? 'mobile' : 'desktop',
      },
      { headers: clientViewHeaders(accessToken), ...saveOpts }
    );
    lines.push(
      progressLineFromStep(steps[0] || { command: insertData?.command }, { rows: 1 }),
      progressLineFromStep(steps[1] || { command: 'INSERT COMPDET' }, { rows: 1 })
    );
    setProgressLines([...lines]);

    const cloneSteps = steps.filter((s) => s.phase === 'clone');
    for (let i = 0; i < cloneSteps.length; i += 1) {
      const step = cloneSteps[i];
      const stepNo = (step.index ?? i) + 1;
      setDeleteStatus(`Step ${stepNo}/${total}: cloning ${step.table}…`);
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/new-company/clone/table'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          access_token: accessToken,
          template_comp_code: ctx?.templateCompCode,
          new_comp_code: newCode,
          comp_year: newYear,
          table: step.table,
          step_index: step.index ?? i,
          total_steps: total,
          client_view: isDesktopOnlyFrozen() ? 'mobile' : 'desktop',
        },
        { headers: clientViewHeaders(accessToken), ...saveOpts }
      );
      const p = data?.progress ?? {};
      lines.push(
        progressLineFromStep(step, {
          rows: p.rows ?? data?.result?.rows ?? 0,
          skipped: p.skipped || data?.result?.skipped,
          command: p.command || step.command,
        })
      );
      setProgressLines([...lines]);
    }

    const finishStep = steps.find((s) => s.phase === 'update');
    if (finishStep) {
      setDeleteStatus(`Step ${finishStep.index + 1}/${total}: ${finishStep.table} OP_BALANCE…`);
      const { data: fin } = await axios.post(
        apiUrl(apiBase, '/api/new-company/clone/finish'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          access_token: accessToken,
          new_comp_code: newCode,
          comp_year: newYear,
        },
        { headers: clientViewHeaders(accessToken), ...saveOpts }
      );
      lines.push(progressLineFromStep(finishStep, { command: fin?.command }));
      setProgressLines([...lines]);
    }

    return { newCode, lines, masterRows: lines.find((l) => l.table === 'MASTER')?.rows };
  };

  const handleSave = async () => {
    if (!canAdd) {
      alert('Access Denied');
      return;
    }
    const name = String(form.COMP_NAME ?? '').trim();
    if (!name) {
      alert('Company Name is required.');
      document.getElementById('newcomp-COMP_NAME')?.focus();
      return;
    }
    if (!form.COMP_S_DT || !form.COMP_E_DT) {
      alert('Financial year start and end dates are required.');
      return;
    }
    if (
      !window.confirm(
        `Save new company ${form.COMP_CODE} — ${name}?\n\nMaster data will be copied from company ${ctx?.templateCompCode}.`
      )
    ) {
      return;
    }
    setSaving(true);
    setErr('');
    setProgressLines([]);
    setProgressTitle('Creating company…');
    setDeleteStatus('Preparing save plan…');
    try {
      const { newCode, lines } = await runSteppedSave();
      alert(
        `DONE\n\nCompany ${newCode} created.\n` +
          `Commands executed: ${lines.length}`
      );
      onCompaniesChanged?.();
      await loadContext(accessToken);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      appendProgress({ command: 'ERROR', error: msg });
      alert(msg);
    } finally {
      setSaving(false);
      setDeleteStatus('');
      setProgressTitle('');
    }
  };

  const runSteppedDelete = async (targetCode) => {
    const { data: planData } = await axios.get(apiUrl(apiBase, '/api/new-company/delete/plan'), {
      params: {
        comp_code: compCode,
        comp_uid: compUid,
        user_name: userName || '',
        target_comp_code: targetCode,
        access_token: accessToken,
      },
      headers: clientViewHeaders(accessToken),
      ...reqOpts,
    });

    const steps = planData?.steps ?? [];
    const total = steps.length || 1;
    const lines = [];

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      setDeleteStatus(`Deleting ${step.schema}.${step.table} (${i + 1}/${total})…`);
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/new-company/delete/step'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          access_token: accessToken,
          target_comp_code: targetCode,
          table: step.table,
          schema: step.schema,
          step_index: step.index ?? i,
          total_steps: total,
        },
        { headers: clientViewHeaders(accessToken), ...saveOpts }
      );
      const p = data?.progress ?? data?.step ?? {};
      lines.push(
        progressLineFromStep(step, {
          rows: p.rows ?? 0,
          skipped: p.rows === 0 && !p.deleted,
          command: p.command || step.command,
        })
      );
      setProgressLines([...lines]);
    }

    return { targetCode, lines };
  };

  const confirmAndDeleteCompany = async (targetCode, companyName = '') => {
    setDeleting(true);
    setProgressLines([]);
    setProgressTitle(`Deleting company ${targetCode}…`);
    setDeleteStatus(`Checking company ${targetCode}…`);
    setErr('');
    try {
      const { data: check } = await axios.get(apiUrl(apiBase, '/api/new-company/delete-check'), {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName || '',
          target_comp_code: targetCode,
          access_token: accessToken,
        },
        headers: clientViewHeaders(accessToken),
        ...reqOpts,
      });

      const label = companyName || check?.companyName || '';
      const warn = check?.transactionWarning;
      const counts = warn?.counts ?? {};
      const countLines = Object.entries(counts)
        .map(([t, n]) => `${t}: ${n}`)
        .join('\n');

      let proceed = window.confirm(
        `Delete company ${targetCode}${label ? ` — ${label}` : ''}?\n\n` +
          'This removes COMP_CODE from all tables in the current schema and GRAINFAS (COMPANY, COMPDET).'
      );
      if (!proceed) return;

      if (warn?.hasTransactions) {
        proceed = window.confirm(
          `WARNING — transaction data exists for company ${targetCode}:\n\n${countLines}\n\n` +
            'Delete anyway? LEDGER, SALE, PURCHASE, and VOUCHER rows will be removed.'
        );
        if (!proceed) return;
      }

      const { lines } = await runSteppedDelete(targetCode);
      setDeletePickerOpen(false);
      alert(`DONE\n\nCompany ${targetCode} deleted.\nTables processed: ${lines.length}`);
      onCompaniesChanged?.();
      await loadContext(accessToken);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      appendProgress({ command: 'ERROR', error: msg });
      alert(msg);
    } finally {
      setDeleting(false);
      setDeleteStatus('');
      setProgressTitle('');
    }
  };

  const handleDelete = async () => {
    if (!canDelete) {
      alert('Access Denied');
      return;
    }
    setDeletePickerOpen(true);
    setDeletePickerLoading(true);
    setDeletePickerErr('');
    setDeleteCompanies([]);
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/new-company/list'), {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName || '',
          access_token: accessToken,
        },
        headers: clientViewHeaders(accessToken),
        ...reqOpts,
      });
      setDeleteCompanies(data?.companies ?? []);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Could not load company list';
      setDeletePickerErr(msg);
      setDeleteCompanies([]);
    } finally {
      setDeletePickerLoading(false);
    }
  };

  const handleDeletePick = (targetCode, companyName) => {
    if (Number(compCode) === Number(targetCode)) {
      alert('Cannot delete the logged-in company. Switch company first.');
      return;
    }
    confirmAndDeleteCompany(targetCode, companyName);
  };

  const handleExit = () => {
    if (!window.confirm('Exit New Company Addition?')) return;
    onPrev?.();
  };

  if (!accessToken) {
    return (
      <NewCompanyPasswordGate
        apiBase={apiBase}
        compCode={compCode}
        userName={userName}
        onVerified={handlePasswordVerified}
        onCancel={onPrev}
      />
    );
  }

  if (loading && !ctx) {
    return (
      <div className="slide slide-83-newcomp newcomp-screen">
        <p className="loading-msg">Loading New Company Addition…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-83-newcomp newcomp-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Company Installation</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="new-company-addition" />
      </div>

      <MasterScreenToolbar className="newcomp-screen__toolbar">
        <GfasToolbarBtn
          label={saving ? 'Saving…' : 'Save'}
          variant="primary"
          onClick={handleSave}
          disabled={!canAdd || busy || loading}
        />
        <GfasToolbarBtn
          label={deleting ? 'Deleting…' : deletePickerLoading ? 'Loading…' : 'Delete'}
          variant="danger"
          onClick={handleDelete}
          disabled={!canDelete || busy || loading || deletePickerLoading}
        />
        <GfasToolbarBtn label="Exit" onClick={handleExit} disabled={busy} />
      </MasterScreenToolbar>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <NewCompanyProgressPanel
        title={progressTitle}
        busy={busy}
        currentLabel={deleteStatus}
        lines={progressLines}
      />

      <p className="newcomp-screen__hint">
        VFP <code>DO FORM newcomp</code> — adds a company to GRAINFAS.COMPANY/COMPDET and copies master templates from
        the current session company ({ctx?.templateCompCode ?? compCode}). Use <strong>Delete</strong> to pick a company
        from the list.
      </p>

      <form
        ref={formRef}
        className="newcomp-screen__form"
        onSubmit={(e) => e.preventDefault()}
        onKeyDownCapture={handleFormEnter}
      >
        {NEWCOMP_FIELD_SPECS.map((spec) => (
          <label key={spec.key} className="newcomp-field inttrf-field">
            <span className="inttrf-field__lbl">{spec.label}</span>
            <span className="inttrf-field__ctl">
              <NewcompField
                spec={spec}
                value={form[spec.key]}
                disabled={busy || loading || spec.readOnly}
                onChange={(key, val) => setForm((prev) => ({ ...prev, [key]: val }))}
                onEnterNext={handleFormEnter}
              />
            </span>
          </label>
        ))}
      </form>

      {deletePickerOpen ? (
        <NewCompanyDeletePicker
          companies={deleteCompanies}
          currentCompCode={compCode}
          loading={deletePickerLoading}
          deleting={deleting}
          deleteStatus={deleteStatus}
          progressLines={progressLines}
          progressLines={progressLines}
          error={deletePickerErr}
          onSelect={handleDeletePick}
          onClose={() => {
            if (deleting || deletePickerLoading) return;
            setDeletePickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
