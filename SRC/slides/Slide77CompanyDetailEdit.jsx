import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import CompanyDetailPasswordGate from '../components/CompanyDetailPasswordGate';
import {
  COMPDET_TABS,
  compdetFieldsForTab,
  COMPDET_FIELD_SPECS,
  COMPDET_LIMITED_LOCKED_KEYS,
} from '../data/compdetFieldConfig';
import { toInputDateString } from '../utils/dateFormat';
import {
  compdetRequestOpts,
  loadCompdetAccess,
  saveCompdetAccess,
} from '../utils/compdetAccessSession';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function emptyForm() {
  const out = {};
  for (const tab of COMPDET_TABS) {
    for (const f of compdetFieldsForTab(tab.id)) {
      out[f.key] = '';
    }
  }
  return out;
}

const COMPDET_DATE_KEYS = new Set(
  COMPDET_FIELD_SPECS.filter((f) => f.type === 'date').map((f) => f.key)
);

function mapRowToForm(row) {
  const out = emptyForm();
  if (!row) return out;
  for (const key of Object.keys(out)) {
    const raw = row[key] ?? row[key.toLowerCase()];
    if (raw == null) continue;
    if (COMPDET_DATE_KEYS.has(key) || raw instanceof Date) {
      out[key] = toInputDateString(raw);
    } else {
      out[key] = String(raw).trim();
    }
  }
  return out;
}

function CompdetField({ spec, value, disabled, onChange, onEnterNext }) {
  const id = `compdet-${spec.key}`;
  const onKeyDown = onEnterNext
    ? (e) => {
        onEnterNext(e);
      }
    : undefined;
  const common = {
    id,
    className: 'compdet-field__input',
    disabled,
    value: value ?? '',
    onChange: (e) => onChange(spec.key, e.target.value),
    onKeyDown,
  };

  if (spec.readOnly) {
    return <input {...common} readOnly tabIndex={-1} />;
  }
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
  if (spec.type === 'password') {
    return <input {...common} type="password" autoComplete="off" />;
  }
  return <input {...common} type="text" maxLength={spec.maxLen || 120} />;
}

function isFieldLocked(accessLevel, key) {
  return accessLevel === 'limited' && COMPDET_LIMITED_LOCKED_KEYS.has(key);
}

/** VFP DO FORM compdet — edit COMPDET for current company/year. */
export default function Slide77CompanyDetailEdit({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = formData.comp_year ?? formData.COMP_YEAR;

  const [accessToken, setAccessToken] = useState('');
  const [accessLevel, setAccessLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);
  const [tab, setTab] = useState('company');
  const [form, setForm] = useState(emptyForm);
  const [snapshot, setSnapshot] = useState(emptyForm);
  const formRef = useRef(null);

  const blocked = !perms?.canOpen && !perms?.isSupervisor;
  const fields = useMemo(() => compdetFieldsForTab(tab), [tab]);
  const limitedAccess = accessLevel === 'limited';

  const clearAccess = useCallback(() => {
    setAccessToken('');
    setAccessLevel('');
    saveCompdetAccess(compCode, compUid, compYear, '', '');
    setEditing(false);
    setForm(emptyForm());
    setSnapshot(emptyForm());
    setPerms(null);
  }, [compCode, compUid, compYear]);

  const loadData = useCallback(
    async (token) => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/company-detail'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            comp_year: compYear,
            user_name: userName || '',
          },
          ...compdetRequestOpts(compCode, token, reqOpts),
        });
        setPerms(data?.permissions ?? null);
        const mapped = mapRowToForm(data?.row ?? data);
        setForm(mapped);
        setSnapshot(mapped);
        setEditing(false);
      } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.error || e.message || 'Load failed';
        if (status === 403 && /password|token|expired/i.test(msg)) {
          clearAccess();
        }
        setErr(msg);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, compCode, compUid, compYear, userName, clearAccess]
  );

  useEffect(() => {
    const saved = loadCompdetAccess(compCode, compUid, compYear);
    if (saved.token) {
      setAccessToken(saved.token);
      setAccessLevel(saved.accessLevel);
      void loadData(saved.token);
    }
  }, [compCode, compUid, compYear, loadData]);

  const handleVerified = (token, level) => {
    setAccessToken(token);
    setAccessLevel(level);
    saveCompdetAccess(compCode, compUid, compYear, token, level);
    void loadData(token);
  };

  const setField = (key, val) => {
    if (isFieldLocked(accessLevel, key)) return;
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleEdit = () => {
    if (!accessToken) {
      alert('Password required before edit.');
      return;
    }
    setEditing(true);
  };

  const handleCancel = () => {
    setForm(snapshot);
    setEditing(false);
  };

  const handleFormEnter = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  }, []);

  const handleSave = async () => {
    if (!accessToken) {
      alert('Password required before save.');
      return;
    }
    if (!form.COMP_NAME?.trim()) {
      alert('Company Name is required.');
      return;
    }
    if (!window.confirm('Save company detail changes to COMPDET and COMPANY?')) return;
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.put(
        apiUrl(apiBase, '/api/company-detail'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          comp_year: compYear,
          user_name: userName,
          fields: form,
        },
        compdetRequestOpts(compCode, accessToken, reqOpts)
      );
      const mapped = mapRowToForm(data?.row ?? form);
      setForm(mapped);
      setSnapshot(mapped);
      setEditing(false);
      alert('Saved.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!accessToken) {
    return (
      <CompanyDetailPasswordGate
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onVerified={handleVerified}
        onCancel={onPrev}
      />
    );
  }

  if (loading && !form.COMP_CODE) {
    return (
      <div className="slide slide-77-compdet compdet-screen">
        <p className="loading-msg">Loading Company Detail…</p>
      </div>
    );
  }

  const disabled = !editing || saving || blocked;

  return (
    <div className="slide slide-77-compdet compdet-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Company Detail Edit</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="company-detail-edit" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}
      {blocked ? (
        <p className="form-error inttrf-screen__error">You do not have permission to open this screen.</p>
      ) : null}

      <p className="compdet-screen__hint">
        Edit current company/year COMPDET (VFP <code>DO FORM compdet</code>).
        {limitedAccess ? (
          <>
            {' '}
            <strong>Limited access:</strong> company name and financial year dates cannot be changed.
          </>
        ) : null}
      </p>

      <div className="compdet-screen__tabs" role="tablist">
        {COMPDET_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`compdet-screen__tab${tab === t.id ? ' compdet-screen__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={saving}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="compdet-screen__panel" role="tabpanel">
        <form
          ref={formRef}
          className="compdet-screen__form"
          onSubmit={(e) => e.preventDefault()}
          onKeyDownCapture={handleFormEnter}
        >
          <div className="compdet-screen__grid">
            {fields.map((spec) => {
              const locked = isFieldLocked(accessLevel, spec.key);
              return (
                <label
                  key={spec.key}
                  className={`compdet-field${locked ? ' compdet-field--locked' : ''}`}
                >
                  <span className="compdet-field__lbl">{spec.label}</span>
                  <CompdetField
                    spec={spec}
                    value={form[spec.key]}
                    disabled={disabled || spec.readOnly || locked}
                    onChange={setField}
                    onEnterNext={editing ? handleFormEnter : undefined}
                  />
                  {locked ? <span className="compdet-field__hint">Locked for your password level</span> : null}
                  {!locked && spec.hint ? <span className="compdet-field__hint">{spec.hint}</span> : null}
                </label>
              );
            })}
          </div>
        </form>
      </div>

      <div className="compdet-screen__footer">
        <button type="button" className="btn btn-secondary" onClick={onPrev} disabled={saving}>
          Quit
        </button>
        <div className="compdet-screen__footer-actions">
          <button type="button" className="btn btn-secondary" onClick={clearAccess} disabled={saving || editing}>
            Lock
          </button>
          {editing ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || blocked}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleEdit} disabled={blocked}>
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
