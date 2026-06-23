import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import GfasFilePickList from '../components/GfasFilePickList';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import {
  DEFAULT_SETTING_TABS,
  DEFAULT_SETTING_FIELD_SPECS,
  defaultSettingFieldsForTab,
} from '../data/defaultSettingFieldConfig';
import { toInputDateString } from '../utils/dateFormat';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { normalizeGfasorclFilePath } from '../utils/gfasorclFilePath';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;

const DATE_KEYS = new Set(
  DEFAULT_SETTING_FIELD_SPECS.filter((f) => f.type === 'date').map((f) => f.key)
);

function mapAccountPickOption(a) {
  return {
    value: String(a.CODE ?? a.code ?? '').trim(),
    label: String(a.NAME ?? a.name ?? '').trim(),
    CODE: a.CODE ?? a.code,
    NAME: a.NAME ?? a.name,
    CITY: String(a.CITY ?? a.city ?? '').trim(),
  };
}

function accountHelpPickProps(triggerCode) {
  return {
    panelVariant: 'voucherParty',
    showAllWhenEmpty: true,
    filterPlaceholder: 'Type name, city or code…',
    getValue: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getLabel: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getOptionLabel: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
    getOptionCity: (o) => String(o.CITY ?? '').trim(),
  };
}

function emptyForm(compCode) {
  const out = { COMP_CODE: String(compCode ?? '').trim() };
  for (const f of DEFAULT_SETTING_FIELD_SPECS) {
    out[f.key] = f.type === 'yn' ? 'N' : '';
  }
  return out;
}

function mapRowToForm(row, compCode) {
  const out = emptyForm(compCode);
  if (!row) return out;
  for (const f of DEFAULT_SETTING_FIELD_SPECS) {
    const raw = row[f.key] ?? row[f.key.toLowerCase()];
    if (raw == null) continue;
    if (DATE_KEYS.has(f.key) || raw instanceof Date) {
      out[f.key] = toInputDateString(raw);
    } else if (typeof raw === 'object') {
      out[f.key] = '';
    } else if (f.type === 'gfasFile') {
      out[f.key] = normalizeGfasorclFilePath(raw);
    } else {
      out[f.key] = String(raw).trim();
    }
  }
  out.COMP_CODE = String(row.COMP_CODE ?? row.comp_code ?? compCode ?? '').trim();
  return out;
}

function DefaultSettingField({
  spec,
  value,
  disabled,
  onChange,
  onEnterNext,
  apiBase,
  accountOptions,
  onAccountFilterChange,
  onAccountPickerOpen,
  accountName,
}) {
  const id = `defset-${spec.key}`;
  const onKeyDown = onEnterNext ? (e) => onEnterNext(e) : undefined;

  if (spec.type === 'gfasFile') {
    return (
      <GfasFilePickList
        apiBase={apiBase}
        value={value}
        onChange={(v) => onChange(spec.key, v)}
        disabled={disabled}
        title={spec.label}
        placeholder="\\GFASORCL\\LOGO\\file.jpg"
        browseStart={spec.browseStart || 'LOGO'}
        dataField={id}
        onKeyDown={onKeyDown}
      />
    );
  }

  if (spec.type === 'code') {
    const code = String(value ?? '').trim();
    return (
      <div className="defset-field__code-wrap">
        <MasterPartyPickList
          options={accountOptions}
          value={code}
          onChange={(v) => onChange(spec.key, String(v ?? '').trim().toUpperCase())}
          disabled={disabled}
          title={spec.label}
          placeholder="Code"
          showSearchIcon
          dataMpField={id}
          onFilterChange={onAccountFilterChange}
          onOpen={onAccountPickerOpen}
          onKeyDown={onKeyDown}
          {...accountHelpPickProps(code)}
        />
        <span className="defset-field__ac-name" title={accountName || undefined}>
          {accountName || '—'}
        </span>
      </div>
    );
  }

  const common = {
    id,
    className: 'defset-field__input',
    disabled,
    value: value ?? '',
    onChange: (e) => onChange(spec.key, e.target.value),
    onKeyDown,
  };

  if (spec.type === 'yn') {
    return (
      <select {...common} value={(value || 'N').toUpperCase().slice(0, 1)}>
        <option value="Y">Y</option>
        <option value="N">N</option>
      </select>
    );
  }
  if (spec.type === 'date') {
    return <input {...common} type="date" />;
  }
  return <input {...common} type="text" maxLength={spec.maxLen || 120} />;
}

/** VFP DO FORM default + default2 — DEFVALUE system defaults (tabbed). */
export default function Slide85DefaultSetting({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [hasRow, setHasRow] = useState(false);
  const [tab, setTab] = useState('general');
  const [form, setForm] = useState(() => emptyForm(compCode));
  const [snapshot, setSnapshot] = useState(() => emptyForm(compCode));
  const [accountOptions, setAccountOptions] = useState([]);
  const formRef = useRef(null);
  const accountSearchDebounceRef = useRef(null);

  const canEdit = Boolean(perms?.canEdit || perms?.canAdd || perms?.isSupervisor);
  const fields = useMemo(() => defaultSettingFieldsForTab(tab), [tab]);
  const disabled = !editing || saving;

  const accountNameMap = useMemo(() => {
    const m = {};
    for (const o of accountOptions) {
      const c = String(o.value ?? o.CODE ?? '').trim();
      if (c) m[c] = String(o.NAME ?? o.label ?? '').trim();
    }
    return m;
  }, [accountOptions]);

  const fetchAccounts = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      try {
        const trimmed = String(q ?? '').trim();
        const params = { comp_code: compCode, comp_uid: compUid };
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params,
          ...reqOpts,
        });
        setAccountOptions((Array.isArray(data) ? data : []).map(mapAccountPickOption));
      } catch {
        setAccountOptions([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleAccountFilterChange = useCallback(
    (q) => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
      accountSearchDebounceRef.current = setTimeout(() => {
        void fetchAccounts(q);
      }, ACCOUNT_SEARCH_DEBOUNCE_MS);
    },
    [fetchAccounts]
  );

  const handleAccountPickerOpen = useCallback(() => {
    void fetchAccounts('');
  }, [fetchAccounts]);

  useEffect(
    () => () => {
      if (accountSearchDebounceRef.current) clearTimeout(accountSearchDebounceRef.current);
    },
    []
  );

  const loadData = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/defvalue'), {
      params: { comp_code: compCode, comp_uid: compUid, user_name: userName || '' },
      ...reqOpts,
    });
    setHasRow(Boolean(data?.exists));
    const mapped = mapRowToForm(data?.row, compCode);
    setForm(mapped);
    setSnapshot(mapped);
    setEditing(false);
    void fetchAccounts('');
  }, [apiBase, compCode, compUid, userName, fetchAccounts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/defvalue-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data);
        if (data?.canOpen || data?.isSupervisor) await loadData();
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName, loadData]);

  const handleFormEnter = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  }, []);

  const setField = (key, val) => {
    const spec = DEFAULT_SETTING_FIELD_SPECS.find((f) => f.key === key);
    const next =
      spec?.type === 'gfasFile' ? normalizeGfasorclFilePath(val) : val;
    setForm((prev) => ({ ...prev, [key]: next }));
  };

  const handleEdit = () => {
    if (!canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setEditing(true);
    void fetchAccounts('');
  };

  const handleCancel = () => {
    setForm(snapshot);
    setEditing(false);
  };

  const handleSave = async () => {
    if (!canEdit) {
      alert('You Can Not Edit');
      return;
    }
    if (!window.confirm('Save default settings (DEFVALUE)?')) return;
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.put(
        apiUrl(apiBase, '/api/defvalue'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          fields: form,
        },
        reqOpts
      );
      alert(data?.message || 'DONE');
      const mapped = mapRowToForm(data?.row ?? form, compCode);
      setForm(mapped);
      setSnapshot(mapped);
      setHasRow(true);
      setEditing(false);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-85-defset defset-screen">
        <p className="loading-msg">Loading Default Setting…</p>
      </div>
    );
  }

  if (!perms?.canOpen && !perms?.isSupervisor) {
    return (
      <div className="slide slide-85-defset defset-screen">
        <h2 className="sale-bill-page__title">Default Setting</h2>
        <p className="form-error">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-85-defset defset-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head">
        <div className="defset-screen__head-bar">
          <h2 className="sale-bill-page__title">Default Setting</h2>
          <MasterScreenToolbar onPrev={onPrev} onReset={onReset} onRefresh={loadData} listLoading={saving || loading}>
            <GfasToolbarBtn label="Get Data" onClick={loadData} disabled={saving || loading} />
            {canEdit && !editing ? (
              <GfasToolbarBtn label={hasRow ? 'Edit' : 'New'} variant="primary" onClick={handleEdit} disabled={saving} />
            ) : null}
            {editing ? (
              <>
                <GfasToolbarBtn label="Cancel" onClick={handleCancel} disabled={saving} />
                <GfasToolbarBtn
                  label={saving ? 'Saving…' : 'Save'}
                  variant="primary"
                  onClick={handleSave}
                  disabled={saving}
                />
              </>
            ) : null}
          </MasterScreenToolbar>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="default-setting" />
      </div>

      <p className="defset-screen__hint">
        VFP <code>DO FORM default</code> + <code>DO FORM default2</code> — <strong>DEFVALUE</strong> for company{' '}
        <strong>{compCode}</strong>.         Code fields: press <strong>F1</strong> or click <strong>?</strong> for MASTER lookup (Name, City, Code).
        Image paths: <strong>F1</strong> or <strong>?</strong> to browse <code>\\GFASORCL\\LOGO</code> (drive letter removed on save).
        {!hasRow ? (
          <>
            {' '}
            <strong>No DEFVALUE row yet</strong> — click New/Edit then Save.
          </>
        ) : null}
      </p>

      {err ? <p className="form-error">{err}</p> : null}

      <div className="defset-screen__tabs" role="tablist">
        {DEFAULT_SETTING_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`defset-screen__tab${tab === t.id ? ' defset-screen__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={saving}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="defset-screen__panel" role="tabpanel">
        <form
          ref={formRef}
          className="defset-screen__form"
          onSubmit={(e) => e.preventDefault()}
          onKeyDownCapture={handleFormEnter}
        >
          <div className="defset-screen__grid">
            {fields.map((spec) => (
              <label key={spec.key} className="defset-field">
                <span className="defset-field__lbl" title={spec.key}>
                  {spec.label}
                  {spec.source === 'default2' ? <span className="defset-field__tag">default2</span> : null}
                </span>
                <DefaultSettingField
                  spec={spec}
                  value={form[spec.key]}
                  disabled={disabled}
                  onChange={setField}
                  onEnterNext={editing ? handleFormEnter : undefined}
                  apiBase={apiBase}
                  accountOptions={accountOptions}
                  onAccountFilterChange={handleAccountFilterChange}
                  onAccountPickerOpen={handleAccountPickerOpen}
                  accountName={
                    spec.type === 'code' ? accountNameMap[String(form[spec.key] ?? '').trim()] || '' : ''
                  }
                />
              </label>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
