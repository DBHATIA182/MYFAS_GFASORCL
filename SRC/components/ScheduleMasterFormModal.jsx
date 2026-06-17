import React, { useCallback, useEffect, useRef, useState } from 'react';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { createPortal } from 'react-dom';
import axios from 'axios';
import MasterPartyPickList from './MasterPartyPickList';

const reqOpts = { withCredentials: true, timeout: 120000 };

function schedLabel(s) {
  const no = s.NO ?? s.no ?? '';
  const nm = s.NAME ?? s.name ?? '';
  const noNum = Number(no);
  const noDisp = Number.isFinite(noNum) ? noNum.toFixed(2) : String(no);
  return nm ? `${nm} (${noDisp})` : noDisp;
}

function formatSchedNo(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '').trim();
  return (Math.round(n * 100) / 100).toFixed(2);
}

function formatMainNo(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '').trim();
  return String(Math.trunc(n));
}

export default function ScheduleMasterFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  editRow,
  mode = 'main',
  parentGroup = null,
  scheduleOptions = [],
  onCreated,
  onUpdated,
}) {
  const isSub = mode === 'sub';
  const isEdit = editRow != null;
  const parentNo = parentGroup ? Number(parentGroup.NO ?? parentGroup.no) : null;

  const [schedNo, setSchedNo] = useState('');
  const [name, setName] = useState('');
  const [range, setRange] = useState('');
  const [normBal, setNormBal] = useState('');
  const [corrNo, setCorrNo] = useState('');
  const formRef = useRef(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  const resetForm = useCallback(() => {
    setSchedNo('');
    setName('');
    setRange('');
    setNormBal('');
    setCorrNo('');
    setErr('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (isEdit && editRow) {
      setSchedNo(formatSchedNo(editRow.NO ?? editRow.no));
      setName(String(editRow.NAME ?? editRow.name ?? ''));
      setRange(String(editRow.RANGE ?? editRow.range ?? '').trim().toUpperCase());
      setNormBal(String(editRow.NORM_BAL ?? editRow.norm_bal ?? '').trim().toUpperCase());
      const c = editRow.CORR_NO ?? editRow.corr_no;
      setCorrNo(c === '' || c == null || Number(c) === 0 ? '' : formatSchedNo(c));
      return;
    }
    let cancelled = false;
    (async () => {
      setCodeLoading(true);
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        if (isSub && parentNo) params.parent_no = parentNo;
        const { data } = await axios.get(`${apiBase}/api/schedule-master-next-no`, { params, ...reqOpts });
        if (!cancelled) setSchedNo(formatSchedNo(data?.next_no ?? data?.NEXT_NO ?? ''));
      } catch {
        if (!cancelled) setSchedNo('');
      } finally {
        if (!cancelled) setCodeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, editRow, isSub, parentNo, apiBase, compCode, compUid, resetForm]);

  const handleSave = async (e) => {
    e.preventDefault();
    const noNum = Number(String(schedNo).trim());
    if (!Number.isFinite(noNum) || noNum === 0) {
      setErr('Schedule number is required.');
      return;
    }
    if (!String(name).trim()) {
      setErr('Schedule name is required.');
      return;
    }
    if (isSub && parentNo) {
      if (noNum <= parentNo || noNum >= parentNo + 1) {
        setErr(`Sub-schedule must be between ${parentNo.toFixed(2)} and ${(parentNo + 1).toFixed(2)} (e.g. 8.10, 8.50).`);
        return;
      }
    } else if (!isSub && Math.abs(noNum - Math.trunc(noNum)) > 1e-6) {
      setErr('Main schedule must be a whole number (e.g. 8, 12).');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      no: noNum,
      name: String(name).trim(),
      range: isSub ? String(range).trim().toUpperCase() : '',
      norm_bal: isSub ? String(normBal).trim().toUpperCase() : '',
      corr_no: isSub && corrNo !== '' ? Number(corrNo) : 0,
    };
    if (isSub && parentNo) payload.parent_no = parentNo;
    try {
      if (isEdit) {
        const { data } = await axios.put(`${apiBase}/api/schedule-master`, payload, reqOpts);
        alert('Schedule updated successfully.');
        onUpdated?.(data);
      } else {
        const { data } = await axios.post(`${apiBase}/api/schedule-master`, payload, reqOpts);
        alert('Schedule saved successfully.');
        onCreated?.(data);
      }
      onClose?.();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      if (ex?.response?.status === 403 || ex?.response?.status === 409) alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const corrOptions = (scheduleOptions || []).filter((s) => {
    const n = Number(s.NO ?? s.no);
    return Number.isFinite(n) && formatSchedNo(n) !== formatSchedNo(schedNo);
  });

  const title = isEdit
    ? isSub
      ? 'Edit sub-schedule'
      : 'Edit main schedule'
    : isSub
      ? 'New sub-schedule'
      : 'New main schedule';

  const parentSubtitle =
    isSub && parentGroup
      ? `Main group: ${formatMainNo(parentNo)} — ${parentGroup.NAME || parentGroup.name || ''}`
      : null;

  return createPortal(
    <div
      className="schedule-master-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="schedule-master-modal" role="dialog" aria-labelledby="schedule-master-modal-title">
        <header className="schedule-master-modal__head">
          <div className="schedule-master-modal__head-text">
            <h3 id="schedule-master-modal-title">{title}</h3>
            {parentSubtitle ? <p className="schedule-master-modal__subtitle">{parentSubtitle}</p> : null}
          </div>
          <button type="button" className="schedule-master-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <form ref={formRef} className="schedule-master-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
          {err ? <p className="deploy-update-msg deploy-update-msg--err schedule-master-modal__err">{err}</p> : null}
          <div className="schedule-master-form">
            <div className="schedule-master-form__row schedule-master-form__row--2col">
              <label className="schedule-master-form__field">
                <span className="schedule-master-form__label">{isSub ? 'Sub group no.' : 'Schedule no.'}</span>
                <input
                  className="schedule-master-form__input form-input"
                  type="number"
                  step={isSub ? '0.01' : '1'}
                  value={schedNo}
                  readOnly={isEdit}
                  disabled={saving || isEdit || codeLoading}
                  onChange={(e) => setSchedNo(e.target.value)}
                />
              </label>
              <label className="schedule-master-form__field schedule-master-form__field--wide">
                <span className="schedule-master-form__label">Name</span>
                <input
                  className="schedule-master-form__input form-input"
                  value={name}
                  maxLength={50}
                  disabled={saving}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            {isSub ? (
              <>
                <div className="schedule-master-form__row schedule-master-form__row--3col">
                  <label className="schedule-master-form__field">
                    <span className="schedule-master-form__label">Range</span>
                    <input
                      className="schedule-master-form__input form-input"
                      value={range}
                      maxLength={1}
                      disabled={saving}
                      placeholder="e.g. C"
                      onChange={(e) => setRange(e.target.value.toUpperCase().slice(0, 1))}
                    />
                    <p className="schedule-master-form__hint">Account code range for this sub-schedule</p>
                  </label>
                  <label className="schedule-master-form__field">
                    <span className="schedule-master-form__label">Normal balance</span>
                    <select
                      className="schedule-master-form__input form-input"
                      value={normBal}
                      disabled={saving}
                      onChange={(e) => setNormBal(e.target.value)}
                    >
                      <option value="">— none —</option>
                      <option value="D">D — Debit</option>
                      <option value="C">C — Credit</option>
                    </select>
                  </label>
                </div>
                <label className="schedule-master-form__field schedule-master-form__field--corr">
                  <span className="schedule-master-form__label">Corresponding schedule</span>
                  <MasterPartyPickList
                    options={corrOptions}
                    value={corrNo}
                    disabled={saving}
                    title="Corresponding schedule"
                    placeholder="None"
                    filterPlaceholder="Search schedule…"
                    getValue={(s) => formatSchedNo(s.NO ?? s.no)}
                    getLabel={schedLabel}
                    onChange={(v) => setCorrNo(v)}
                    showSearchIcon
                    showAllWhenEmpty
                  />
                  <p className="schedule-master-form__hint">Links this sub to another schedule for contra entries</p>
                </label>
              </>
            ) : null}
          </div>
          <footer className="schedule-master-modal__foot">
            <button
              type="button"
              className="btn schedule-master-modal__btn-cancel"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn schedule-master-modal__btn-save" disabled={saving || codeLoading}>
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Save'}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}
