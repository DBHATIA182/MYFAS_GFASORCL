import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import MasterPartyPickList from './MasterPartyPickList';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function capsField(v) {
  return String(v ?? '').toUpperCase();
}

export default function CostMastFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  accountOptions = [],
  editRow = null,
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const formRef = useRef(null);
  const codeInputRef = useRef(null);
  const [costCode, setCostCode] = useState('');
  const [costName, setCostName] = useState('');
  const [acCode, setAcCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const accountNameMap = useMemo(() => {
    const m = {};
    for (const o of accountOptions) {
      const c = String(o.value ?? o.CODE ?? '').trim();
      if (c) m[c] = String(o.label ?? o.NAME ?? '').trim();
    }
    return m;
  }, [accountOptions]);

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  const resetForm = useCallback(() => {
    setCostCode('');
    setCostName('');
    setAcCode('');
    setErr('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (isEdit && editRow) {
      setCostCode(String(editRow.COST_CODE ?? editRow.cost_code ?? '').trim());
      setCostName(capsField(editRow.COST_NAME ?? editRow.cost_name));
      setAcCode(String(editRow.CODE ?? editRow.code ?? '').trim().toUpperCase());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/cost-mast-next-code'), {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        });
        if (!cancelled && data?.next_code) setCostCode(String(data.next_code).trim());
      } catch {
        /* optional suggestion */
      }
      if (!cancelled) codeInputRef.current?.focus();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, editRow, resetForm, apiBase, compCode, compUid]);

  const handleSave = async (e) => {
    e.preventDefault();
    const code = capsField(costCode).trim();
    const name = capsField(costName).trim();
    const account = capsField(acCode).trim();
    if (!code) {
      setErr('Cost centre code is required.');
      return;
    }
    if (!name) {
      setErr('Cost centre name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      cost_code: code,
      cost_name: name,
      code: account,
    };
    try {
      if (isEdit) {
        await axios.put(apiUrl(apiBase, '/api/cost-mast'), payload, reqOpts);
        onUpdated?.({ cost_code: code, cost_name: name, code: account });
      } else {
        await axios.post(apiUrl(apiBase, '/api/cost-mast'), payload, reqOpts);
        onCreated?.({ cost_code: code, cost_name: name, code: account });
      }
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const acName = acCode ? accountNameMap[acCode] || '' : '';

  return createPortal(
    <div
      className="sale-bill-modal-backdrop master-party-modal-backdrop item-master-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sale-bill-modal master-party-modal item-master-modal cost-mast-modal" role="dialog">
        <div className="sale-bill-modal-head item-master-modal__head">
          <h3>{isEdit ? 'Edit cost centre' : 'New cost centre'}</h3>
          <p className="item-master-modal__subtitle">Cost Centre Master · COST</p>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form ref={formRef} className="item-master-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          <div className="item-master-form cost-mast-form">
            <label className="item-master-field">
              <span className="sale-bill-field__label">Cost code</span>
              <input
                ref={codeInputRef}
                className="form-input item-master-input"
                value={costCode}
                readOnly={isEdit}
                disabled={saving || isEdit}
                maxLength={6}
                placeholder={isEdit ? '' : 'Cost centre code'}
                onChange={(e) => setCostCode(capsField(e.target.value))}
              />
            </label>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">Name</span>
              <input
                className="form-input item-master-input"
                value={costName}
                maxLength={50}
                disabled={saving}
                placeholder="Cost centre name"
                onChange={(e) => setCostName(capsField(e.target.value))}
              />
            </label>
            <label className="item-master-field item-master-field--full cost-mast-form__ac">
              <span className="sale-bill-field__label">Account (A/c Master)</span>
              <div className="cost-mast-form__ac-row">
                <MasterPartyPickList
                  options={accountOptions}
                  value={acCode}
                  onChange={(v) => setAcCode(String(v ?? '').trim().toUpperCase())}
                  disabled={saving}
                  title="Account"
                  placeholder="Code"
                  filterPlaceholder="Code or name…"
                  showSearchIcon
                  getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
                  getLabel={(o) => `${o.value ?? o.CODE ?? ''} — ${o.label ?? o.NAME ?? ''}`}
                  getTriggerLabel={(o) => String(o.value ?? o.CODE ?? acCode)}
                />
                <span className="cost-mast-form__ac-name" title={acName}>
                  {acName || '—'}
                </span>
              </div>
            </label>
          </div>
          <div className="item-master-modal__foot">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
