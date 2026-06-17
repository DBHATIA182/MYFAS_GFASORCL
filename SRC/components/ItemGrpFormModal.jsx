import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function capsField(v) {
  return String(v ?? '').toUpperCase();
}

/** VFP DO FORM CAT → ITEM_GRP (group code + name). */
export default function ItemGrpFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  editRow = null,
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const formRef = useRef(null);
  const codeInputRef = useRef(null);
  const [grpCode, setGrpCode] = useState('');
  const [grpName, setGrpName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  const resetForm = useCallback(() => {
    setGrpCode('');
    setGrpName('');
    setErr('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (isEdit && editRow) {
      setGrpCode(String(editRow.GRP_CODE ?? editRow.grp_code ?? '').trim());
      setGrpName(capsField(editRow.GRP_NAME ?? editRow.grp_name));
      return;
    }
    const t = window.setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, isEdit, editRow, resetForm]);

  const handleSave = async (e) => {
    e.preventDefault();
    const code = capsField(grpCode).trim();
    const name = capsField(grpName).trim();
    if (!code) {
      setErr('Group code is required.');
      return;
    }
    if (!name) {
      setErr('Group name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      grp_code: code,
      grp_name: name,
    };
    try {
      if (isEdit) {
        await axios.put(apiUrl(apiBase, '/api/item-grp'), payload, reqOpts);
        onUpdated?.({ grp_code: code, grp_name: name });
      } else {
        await axios.post(apiUrl(apiBase, '/api/item-grp'), payload, reqOpts);
        onCreated?.({ grp_code: code, grp_name: name });
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

  return createPortal(
    <div
      className="sale-bill-modal-backdrop master-party-modal-backdrop item-master-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sale-bill-modal master-party-modal item-master-modal item-grp-modal" role="dialog">
        <div className="sale-bill-modal-head item-master-modal__head">
          <h3>{isEdit ? 'Edit item group' : 'New item group'}</h3>
          <p className="item-master-modal__subtitle">Item Group Master · ITEM_GRP (VFP CAT)</p>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form ref={formRef} className="item-master-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          <div className="item-master-form item-grp-form">
            <label className="item-master-field">
              <span className="sale-bill-field__label">Group code</span>
              <input
                ref={codeInputRef}
                className="form-input item-master-input"
                value={grpCode}
                readOnly={isEdit}
                disabled={saving || isEdit}
                maxLength={6}
                placeholder={isEdit ? '' : 'Enter group code'}
                onChange={(e) => setGrpCode(capsField(e.target.value))}
              />
            </label>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">Name</span>
              <input
                className="form-input item-master-input"
                value={grpName}
                maxLength={50}
                disabled={saving}
                placeholder="Group name"
                onChange={(e) => setGrpName(capsField(e.target.value))}
              />
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
