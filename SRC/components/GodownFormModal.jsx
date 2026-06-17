import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import MasterPartyPickList from './MasterPartyPickList';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

/** Uppercase while typing — do not trim (spaces must remain, e.g. "GOD NO 1"). */
function capsTyping(v, max) {
  return String(v ?? '')
    .toUpperCase()
    .slice(0, max || 200);
}

/** Trim + uppercase for save only. */
function capsSave(v, max) {
  return capsTyping(String(v ?? '').trim(), max);
}

const emptyForm = () => ({
  GOD_CODE: '',
  GOD_NAME: '',
  GOD_NAME1: '',
  GOD_ADD1: '',
  GOD_ADD2: '',
  GOD_LOCATION: '',
  GOD_PIN_CODE: '',
  GOD_STATE_CODE: '',
  GOD_STATE: '',
  GOD_GST_NO: '',
  GOD_TEL_NO_1: '',
  GOD_TEL_NO_2: '',
  GOD_FSSAI_NO: '',
  GOD_B_TYPE: 'N',
  GOD_CODE_MAIN: '',
});

function stateCodesMatch(a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return parseInt(x, 10) === parseInt(y, 10);
  return x.toUpperCase() === y.toUpperCase();
}

function normalizeGodownForm(row) {
  const base = emptyForm();
  if (!row || typeof row !== 'object') return base;
  const src = { ...row };
  if (!String(src.GOD_STATE ?? '').trim() && String(src.STATE ?? src.state ?? '').trim()) {
    src.GOD_STATE = String(src.STATE ?? src.state ?? '').trim();
  }
  if (!String(src.GOD_STATE_CODE ?? '').trim() && String(src.STATE_CODE ?? src.state_code ?? '').trim()) {
    src.GOD_STATE_CODE = String(src.STATE_CODE ?? src.state_code ?? '').trim();
  }
  return { ...base, ...src };
}

/** VFP DO FORM godown — GODOWN master. */
export default function GodownFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  userName,
  editRow = null,
  godownOptions = [],
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const formRef = useRef(null);
  const codeInputRef = useRef(null);
  const openInitRef = useRef(false);
  const [form, setForm] = useState(emptyForm);
  const [states, setStates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const mainGodownOptions = useMemo(
    () =>
      godownOptions
        .filter((g) => String(g.GOD_CODE) !== String(form.GOD_CODE))
        .map((g) => ({
          value: String(g.GOD_CODE ?? '').trim(),
          label: `${g.GOD_CODE ?? ''} — ${g.GOD_NAME ?? ''}`.trim(),
          CODE: g.GOD_CODE,
          NAME: g.GOD_NAME,
        })),
    [godownOptions, form.GOD_CODE]
  );

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  useEffect(() => {
    if (!open) {
      openInitRef.current = false;
      return;
    }
    if (openInitRef.current) return;
    openInitRef.current = true;
    setErr('');
    if (isEdit && editRow) {
      setForm(normalizeGodownForm(editRow));
      const t = window.setTimeout(() => codeInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    setForm(emptyForm());
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/godown-next-code'), {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        });
        const next = String(data?.next_code ?? data?.NEXT_CODE ?? '').trim();
        if (next) setForm((f) => ({ ...f, GOD_CODE: next }));
      } catch (_) {
        /* optional */
      }
    })();
    const t = window.setTimeout(() => codeInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, isEdit, editRow, apiBase, compCode, compUid]);

  useEffect(() => {
    if (!open || !form.GOD_STATE_CODE || !states.length) return;
    const code = String(form.GOD_STATE_CODE).trim();
    const hit = states.find((s) => stateCodesMatch(s.STATE_CODE ?? s.state_code, code));
    if (!hit) return;
    const name = String(hit.STATE ?? hit.state ?? '').trim();
    if (!name) return;
    setForm((prev) => {
      if (String(prev.GOD_STATE ?? '').trim()) return prev;
      return { ...prev, GOD_STATE: name };
    });
  }, [open, states, form.GOD_STATE_CODE]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-party-states'), {
        params: { comp_uid: compUid, comp_code: compCode },
        ...reqOpts,
      })
      .then(({ data }) => {
        if (!cancelled) setStates(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setStates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, compUid, compCode]);

  const handleSave = async (e) => {
    e.preventDefault();
    const code = capsSave(form.GOD_CODE, 6);
    const name = capsSave(form.GOD_NAME, 80);
    if (!code) {
      setErr('Godown code is required.');
      return;
    }
    if (!name) {
      setErr('Godown name is required.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      user_name: userName,
      god_code: code,
      GOD_CODE: code,
      god_name: name,
      GOD_NAME: name,
      god_name1: capsSave(form.GOD_NAME1, 80),
      god_add1: capsSave(form.GOD_ADD1, 80),
      god_add2: capsSave(form.GOD_ADD2, 80),
      god_location: capsSave(form.GOD_LOCATION, 40),
      god_pin_code: String(form.GOD_PIN_CODE ?? '').trim().slice(0, 10),
      god_state_code: String(form.GOD_STATE_CODE ?? '').trim(),
      god_state: capsSave(form.GOD_STATE, 40),
      god_gst_no: capsSave(form.GOD_GST_NO, 20),
      god_tel_no_1: capsSave(form.GOD_TEL_NO_1, 20),
      god_tel_no_2: capsSave(form.GOD_TEL_NO_2, 20),
      god_fssai_no: capsSave(form.GOD_FSSAI_NO, 20),
      god_b_type: capsSave(form.GOD_B_TYPE, 1) || 'N',
      god_code_main: capsSave(form.GOD_CODE_MAIN, 6),
    };
    try {
      if (isEdit) {
        const { data } = await axios.put(apiUrl(apiBase, '/api/godown'), payload, reqOpts);
        onUpdated?.(data);
      } else {
        const { data } = await axios.post(apiUrl(apiBase, '/api/godown'), payload, reqOpts);
        onCreated?.(data);
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
      <div className="sale-bill-modal master-party-modal item-master-modal godown-modal" role="dialog">
        <div className="sale-bill-modal-head item-master-modal__head">
          <h3>{isEdit ? 'Edit godown' : 'New godown'}</h3>
          <p className="item-master-modal__subtitle">Godown Master · GODOWN</p>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form ref={formRef} className="item-master-modal__body godown-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
          {err ? <p className="deploy-update-msg deploy-update-msg--err item-master-modal__err">{err}</p> : null}
          <div className="item-master-modal__scroll">
          <div className="godown-form">
            <label className="godown-form__field godown-form__field--code">
              <span className="sale-bill-field__label">God.Code</span>
              <input
                ref={codeInputRef}
                className="form-input godown-form__input godown-form__code"
                value={form.GOD_CODE}
                readOnly={isEdit}
                disabled={isEdit}
                maxLength={6}
                onChange={(e) => setField('GOD_CODE', capsTyping(e.target.value, 6))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">God.Name</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_NAME}
                maxLength={80}
                onChange={(e) => setField('GOD_NAME', capsTyping(e.target.value, 80))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Company Name</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_NAME1}
                maxLength={80}
                onChange={(e) => setField('GOD_NAME1', capsTyping(e.target.value, 80))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Address</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_ADD1}
                maxLength={80}
                onChange={(e) => setField('GOD_ADD1', capsTyping(e.target.value, 80))}
              />
              <input
                className="form-input godown-form__input"
                value={form.GOD_ADD2}
                maxLength={80}
                onChange={(e) => setField('GOD_ADD2', capsTyping(e.target.value, 80))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Location / City</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_LOCATION}
                maxLength={40}
                onChange={(e) => setField('GOD_LOCATION', capsTyping(e.target.value, 40))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Pin Code</span>
              <input
                className="form-input godown-form__input godown-form__pin"
                value={form.GOD_PIN_CODE}
                maxLength={10}
                onChange={(e) => setField('GOD_PIN_CODE', e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </label>
            <label className="godown-form__field godown-form__field--state">
              <div className="godown-form__state-head" aria-hidden="true">
                <span className="sale-bill-field__label">State Code</span>
                <span className="sale-bill-field__label">State</span>
              </div>
              <div className="godown-form__state-row">
                <div className="godown-form__state-code-wrap">
                  {states.length ? (
                    <MasterPartyPickList
                      options={states}
                      value={form.GOD_STATE_CODE}
                      onChange={(code) => {
                        const c = String(code ?? '')
                          .trim()
                          .slice(0, 2);
                        const hit = states.find((s) => stateCodesMatch(s.STATE_CODE ?? s.state_code, c));
                        setForm((prev) => ({
                          ...prev,
                          GOD_STATE_CODE: c,
                          GOD_STATE: hit ? String(hit.STATE ?? hit.state ?? '').trim() : prev.GOD_STATE,
                        }));
                      }}
                      title="State"
                      placeholder="Cd"
                      filterPlaceholder="State code or name…"
                      showSearchIcon
                      getValue={(o) => String(o.STATE_CODE ?? o.state_code ?? '').trim()}
                      getLabel={(o) => `${o.STATE_CODE ?? o.state_code ?? ''} — ${o.STATE ?? o.state ?? ''}`}
                      getTriggerLabel={(o) => String(o.STATE_CODE ?? o.state_code ?? form.GOD_STATE_CODE)}
                    />
                  ) : (
                    <input
                      className="form-input godown-form__input godown-form__state-code"
                      value={form.GOD_STATE_CODE}
                      maxLength={2}
                      inputMode="numeric"
                      onChange={(e) =>
                        setField('GOD_STATE_CODE', e.target.value.replace(/\D/g, '').slice(0, 2))
                      }
                    />
                  )}
                </div>
                <input
                  className="form-input godown-form__input godown-form__state-name"
                  value={form.GOD_STATE}
                  maxLength={40}
                  placeholder="State name"
                  onChange={(e) => setField('GOD_STATE', capsTyping(e.target.value, 40))}
                />
              </div>
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Gst No.</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_GST_NO}
                maxLength={20}
                onChange={(e) => setField('GOD_GST_NO', capsTyping(e.target.value, 20))}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Tel.No.</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_TEL_NO_1}
                maxLength={20}
                onChange={(e) => setField('GOD_TEL_NO_1', e.target.value)}
              />
              <input
                className="form-input godown-form__input"
                value={form.GOD_TEL_NO_2}
                maxLength={20}
                onChange={(e) => setField('GOD_TEL_NO_2', e.target.value)}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Fssai No.</span>
              <input
                className="form-input godown-form__input"
                value={form.GOD_FSSAI_NO}
                maxLength={20}
                onChange={(e) => setField('GOD_FSSAI_NO', capsTyping(e.target.value, 20))}
              />
            </label>
            <label className="godown-form__field godown-form__field--btype">
              <span className="sale-bill-field__label">Sale Bill Type</span>
              <input
                className="form-input godown-form__input godown-form__btype"
                value={form.GOD_B_TYPE}
                maxLength={1}
                onChange={(e) => setField('GOD_B_TYPE', capsTyping(e.target.value, 1) || 'N')}
              />
            </label>
            <label className="godown-form__field">
              <span className="sale-bill-field__label">Main Godown</span>
              <MasterPartyPickList
                options={mainGodownOptions}
                value={form.GOD_CODE_MAIN}
                onChange={(v) => setField('GOD_CODE_MAIN', capsTyping(v, 6))}
                title="Main godown"
                placeholder="Code"
                filterPlaceholder="Godown code or name…"
                showSearchIcon
                getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
                getLabel={(o) => o.label || ''}
                getTriggerLabel={(o) => String(o.value ?? o.CODE ?? form.GOD_CODE_MAIN)}
              />
            </label>
          </div>
          </div>
          <div className="item-master-modal__foot">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
