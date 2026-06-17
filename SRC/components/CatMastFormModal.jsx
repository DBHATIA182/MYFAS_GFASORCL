import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function capsField(v) {
  return String(v ?? '').toUpperCase();
}

export default function CatMastFormModal({
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
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  const resetForm = useCallback(() => {
    setCatCode('');
    setCatName('');
    setErr('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (isEdit && editRow) {
      setCatCode(String(editRow.CAT_CODE ?? editRow.cat_code ?? '').trim());
      setCatName(capsField(editRow.CAT_NAME ?? editRow.cat_name));
      return;
    }
    const t = window.setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, isEdit, editRow, resetForm]);

  const handleSave = async (e) => {
    e.preventDefault();
    const code = capsField(catCode).trim();
    const name = capsField(catName).trim();
    if (!code) {
      setErr('Category code is required.');
      return;
    }
    if (!name) {
      setErr('Category name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      cat_code: code,
      cat_name: name,
    };
    try {
      if (isEdit) {
        await axios.put(apiUrl(apiBase, '/api/cat-mast'), payload, reqOpts);
        onUpdated?.({ cat_code: code, cat_name: name });
      } else {
        await axios.post(apiUrl(apiBase, '/api/cat-mast'), payload, reqOpts);
        onCreated?.({ cat_code: code, cat_name: name });
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
      <div className="sale-bill-modal master-party-modal item-master-modal cat-mast-modal" role="dialog">
        <div className="sale-bill-modal-head item-master-modal__head">
          <h3>{isEdit ? 'Edit category' : 'New category'}</h3>
          <p className="item-master-modal__subtitle">Item Category Master · CATMAST</p>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form ref={formRef} className="item-master-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          <div className="item-master-form cat-mast-form">
            <label className="item-master-field">
              <span className="sale-bill-field__label">Category</span>
              <input
                ref={codeInputRef}
                className="form-input item-master-input"
                value={catCode}
                readOnly={isEdit}
                disabled={saving || isEdit}
                maxLength={6}
                placeholder={isEdit ? '' : 'Enter category code'}
                onChange={(e) => setCatCode(capsField(e.target.value))}
              />
            </label>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">Name</span>
              <input
                className="form-input item-master-input"
                value={catName}
                maxLength={50}
                disabled={saving}
                placeholder="Category name"
                onChange={(e) => setCatName(capsField(e.target.value))}
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
