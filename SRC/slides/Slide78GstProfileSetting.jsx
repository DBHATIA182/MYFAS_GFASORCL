import React, { useCallback, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import GstProfilePasswordGate from '../components/GstProfilePasswordGate';
import {
  GST_PROFILE_TABS,
  gstProfileFieldsForTab,
  GST_PROFILE_FIELD_SPECS,
} from '../data/gstProfileFieldConfig';
import { toInputDateString } from '../utils/dateFormat';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { gstProfileRequestOpts } from '../utils/gstProfileAccessSession';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

const GST_PROFILE_DATE_KEYS = new Set(
  GST_PROFILE_FIELD_SPECS.filter((f) => f.type === 'date').map((f) => f.key)
);

function emptyForm(compCode) {
  const out = {};
  for (const tab of GST_PROFILE_TABS) {
    for (const f of gstProfileFieldsForTab(tab.id)) {
      out[f.key] = '';
    }
  }
  out.COMP_CODE = String(compCode ?? '').trim();
  return out;
}

function mapRowToForm(row, compCode) {
  const out = emptyForm(compCode);
  if (!row) return out;
  for (const key of Object.keys(out)) {
    const raw = row[key] ?? row[key.toLowerCase()];
    if (raw == null) continue;
    if (GST_PROFILE_DATE_KEYS.has(key) || raw instanceof Date) {
      out[key] = toInputDateString(raw);
    } else {
      out[key] = String(raw).trim();
    }
  }
  return out;
}

function GstProfileField({ spec, value, disabled, onChange, onEnterNext }) {
  const id = `gstprof-${spec.key}`;
  const onKeyDown = onEnterNext ? (e) => onEnterNext(e) : undefined;
  const common = {
    id,
    className: 'gstprof-field__input',
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
    return <input {...common} type="password" autoComplete="off" />;
  }
  return <input {...common} type="text" maxLength={spec.maxLen || 200} />;
}

/** VFP DO FORM gst_profile — GST_PROFILE for current company. */
export default function Slide78GstProfileSetting({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [hasRow, setHasRow] = useState(false);
  const [tab, setTab] = useState('company');
  const [form, setForm] = useState(() => emptyForm(compCode));
  const [snapshot, setSnapshot] = useState(() => emptyForm(compCode));
  const formRef = useRef(null);

  const canEdit = Boolean(accessToken);
  const fields = useMemo(() => gstProfileFieldsForTab(tab), [tab]);

  const clearAccess = useCallback(() => {
    setAccessToken('');
    setEditing(false);
    setForm(emptyForm(compCode));
    setSnapshot(emptyForm(compCode));
    setHasRow(false);
    setErr('');
  }, [compCode]);

  const loadData = useCallback(
    async (token) => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/gst-profile'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            user_name: userName || '',
          },
          ...gstProfileRequestOpts(compCode, token, reqOpts),
        });
        setHasRow(Boolean(data?.exists));
        const mapped = mapRowToForm(data?.row, compCode);
        setForm(mapped);
        setSnapshot(mapped);
        setEditing(false);
      } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.error || e.message || 'Load failed';
        if (status === 403 && /password|token|expired/i.test(msg)) clearAccess();
        setErr(msg);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, compCode, compUid, userName, clearAccess]
  );

  const handleVerified = (token) => {
    setAccessToken(token);
    void loadData(token);
  };

  const handleQuit = () => {
    clearAccess();
    onPrev();
  };

  const handleFormEnter = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  }, []);

  const setField = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleEdit = () => {
    if (!canEdit) {
      alert('You do not have permission to edit GST profile.');
      return;
    }
    setEditing(true);
  };

  const handleCancel = () => {
    setForm(snapshot);
    setEditing(false);
  };

  const handleSave = async () => {
    if (!canEdit) {
      alert('Access Denied');
      return;
    }
    if (!form.GST_NO?.trim()) {
      alert('GST No. is required.');
      return;
    }
    if (!window.confirm(hasRow ? 'Save GST profile changes?' : 'Create GST profile for this company?')) return;
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.put(
        apiUrl(apiBase, '/api/gst-profile'),
        {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          fields: form,
        },
        gstProfileRequestOpts(compCode, accessToken, reqOpts)
      );
      const mapped = mapRowToForm(data?.row ?? form, compCode);
      setForm(mapped);
      setSnapshot(mapped);
      setHasRow(true);
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
      <GstProfilePasswordGate
        apiBase={apiBase}
        compCode={compCode}
        userName={userName}
        onVerified={handleVerified}
        onCancel={handleQuit}
      />
    );
  }

  if (loading && !form.COMP_CODE) {
    return (
      <div className="slide slide-78-gstprof gstprof-screen">
        <p className="loading-msg">Loading GST Profile…</p>
      </div>
    );
  }

  const disabled = !editing || saving;

  return (
    <div className="slide slide-78-gstprof gstprof-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Gst Profile Setting</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="gst-profile-setting" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <p className="gstprof-screen__hint">
        GST e-invoice / e-way profile for company <strong>{compCode}</strong> (VFP <code>DO FORM gst_profile</code>).
        {!hasRow ? (
          <>
            {' '}
            <strong>No profile yet</strong> — click Edit to add, then Save.
          </>
        ) : null}
      </p>

      <div className="gstprof-screen__tabs" role="tablist">
        {GST_PROFILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`gstprof-screen__tab${tab === t.id ? ' gstprof-screen__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={saving}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="gstprof-screen__panel" role="tabpanel">
        <form
          ref={formRef}
          className="gstprof-screen__form"
          onSubmit={(e) => e.preventDefault()}
          onKeyDownCapture={handleFormEnter}
        >
          <div className="gstprof-screen__grid">
            {fields.map((spec) => (
              <label key={spec.key} className="gstprof-field">
                <span className="gstprof-field__lbl">{spec.label}</span>
                <GstProfileField
                  spec={spec}
                  value={form[spec.key]}
                  disabled={disabled || spec.readOnly}
                  onChange={setField}
                  onEnterNext={editing ? handleFormEnter : undefined}
                />
                {spec.hint ? <span className="gstprof-field__hint">{spec.hint}</span> : null}
              </label>
            ))}
          </div>
        </form>
      </div>

      <div className="gstprof-screen__footer">
        <button type="button" className="btn btn-secondary" onClick={handleQuit} disabled={saving}>
          Quit
        </button>
        <div className="gstprof-screen__footer-actions">
          <button type="button" className="btn btn-secondary" onClick={clearAccess} disabled={saving || editing}>
            Lock
          </button>
          {editing ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !canEdit}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleEdit} disabled={!canEdit}>
              {hasRow ? 'Edit' : 'New'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
