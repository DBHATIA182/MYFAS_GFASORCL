import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { USER_RIGHTS_MODULES } from '../data/userMasterModules';
import { mapRowModuleRights, rightsBitsFromString, buildModuleRightsPayload } from '../utils/userRightsBits';
import UserModuleAccessMatrix from './UserModuleAccessMatrix';
import { toInputDateString } from '../utils/dateFormat';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
/** VFP USERS — login name and PW are 10 characters (hub / PASSWORD.scx). */
const USER_MASTER_NAME_MAX = 10;
const USER_MASTER_PW_MAX = 10;

function toUserMasterUpper(s, maxLen = USER_MASTER_NAME_MAX) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

/** USERS.PW — VARCHAR2(10), same as login (uppercase, max 10). */
function toUserMasterPassword(s) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .slice(0, USER_MASTER_PW_MAX);
}

function normalizeYnField(v) {
  return String(v ?? '').trim().toUpperCase() === 'Y' ? 'Y' : 'N';
}

function emptyModules() {
  const m = {};
  for (const mod of USER_RIGHTS_MODULES) {
    m[mod.key] = { access: false, add: false, edit: false, delete: false };
  }
  return m;
}

function allModulesChecked() {
  const m = {};
  for (const mod of USER_RIGHTS_MODULES) {
    m[mod.key] = { access: true, add: true, edit: true, delete: true };
  }
  return m;
}

function modulesFromRow(row) {
  const m = emptyModules();
  if (!row) return m;
  const mapped = mapRowModuleRights(row);
  for (const mod of USER_RIGHTS_MODULES) {
    m[mod.key] = rightsBitsFromString(mapped[mod.key]);
  }
  return m;
}

/** VFP DO FORM USER → USERS table (hub). */
export default function UserMasterFormModal({
  open,
  onClose,
  apiBase,
  compUid,
  compCode: compCodeProp,
  adminReqOpts,
  userName,
  companies = [],
  editRow = null,
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const reqOptsLocal = adminReqOpts || reqOpts;
  const formRef = useRef(null);
  const [userNo, setUserNo] = useState('');
  const [userLoginName, setUserLoginName] = useState('');
  const [supervisor, setSupervisor] = useState('N');
  const [compCode, setCompCode] = useState('');
  const [freezeDays, setFreezeDays] = useState('');
  const [freezeDate, setFreezeDate] = useState('');
  const [rcNo, setRcNo] = useState('');
  const [srcNo, setSrcNo] = useState('');
  const [ercNo, setErcNo] = useState('');
  const [trialAccess, setTrialAccess] = useState('N');
  const [bsAccess, setBsAccess] = useState('N');
  const [newPassword, setNewPassword] = useState('');
  const [resetPasswordYn, setResetPasswordYn] = useState('N');
  const [modules, setModules] = useState(emptyModules);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleFormEnterAsTab = useCallback((e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: true });
  }, []);

  const handleModuleChange = (key, bits) => {
    setModules((prev) => ({ ...prev, [key]: bits }));
  };

  const handleSelectAllModules = () => {
    setModules(allModulesChecked());
  };

  const resetForm = useCallback(() => {
    setUserNo('');
    setUserLoginName('');
    setSupervisor('N');
    setCompCode('');
    setFreezeDays('');
    setFreezeDate('');
    setRcNo('');
    setSrcNo('');
    setErcNo('');
    setTrialAccess('N');
    setBsAccess('N');
    setNewPassword('');
    setResetPasswordYn('N');
    setModules(emptyModules());
    setErr('');
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    if (!isEdit || !editRow) {
      let cancelled = false;
      (async () => {
        try {
          const { data } = await axios.get(apiUrl(apiBase, '/api/user-master-next-no'), reqOptsLocal);
          if (!cancelled) setUserNo(String(data?.next_no ?? data?.NEXT_NO ?? ''));
        } catch (_) {
          /* optional */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const no = editRow.USER_NO ?? editRow.user_no;
    setUserNo(String(no ?? ''));
    setUserLoginName(String(editRow.USER_NAME ?? editRow.user_name ?? '').toUpperCase());
    setSupervisor(String(editRow.SUPERVISOR ?? editRow.supervisor ?? 'N').toUpperCase() === 'Y' ? 'Y' : 'N');
    setCompCode(String(editRow.COMP_CODE ?? editRow.comp_code ?? '').toUpperCase());
    setFreezeDays(String(editRow.F_DAYS ?? editRow.f_days ?? ''));
    setFreezeDate(toInputDateString(editRow.F_DATE ?? editRow.f_date) || '');
    setRcNo(String(editRow.R_C_NO ?? editRow.r_c_no ?? ''));
    setSrcNo(String(editRow.S_R_C_NO ?? editRow.s_r_c_no ?? ''));
    setErcNo(String(editRow.E_R_C_NO ?? editRow.e_r_c_no ?? ''));
    setTrialAccess(normalizeYnField(editRow.TRIAL_ACCESS ?? editRow.trial_access));
    setBsAccess(normalizeYnField(editRow.BS_ACCESS ?? editRow.bs_access));
    setResetPasswordYn('N');
    setModules(modulesFromRow(editRow));
  }, [open, isEdit, editRow, resetForm, apiBase]);

  const handleSave = async (e) => {
    e.preventDefault();
    const name = toUserMasterUpper(userLoginName, USER_MASTER_NAME_MAX);
    const pw = toUserMasterPassword(newPassword);
    const resetPw = resetPasswordYn === 'Y';
    if (!name) {
      setErr('User name is required.');
      return;
    }
    const no = Number(userNo) || 0;
    if (!no) {
      setErr('User number is required.');
      return;
    }
    if (!isEdit && !pw) {
      setErr('Initial password is required.');
      alert('Initial password is required.');
      return;
    }
    if (pw.length > USER_MASTER_PW_MAX) {
      setErr(`Password must be at most ${USER_MASTER_PW_MAX} characters.`);
      alert(`Password must be at most ${USER_MASTER_PW_MAX} characters.`);
      return;
    }
    if (isEdit && resetPw && pw) {
      setErr('Set Reset password to N before entering a new password, or leave password blank when resetting.');
      alert('Use Reset password Y to clear only, or N with a new password (max 10 characters).');
      return;
    }

    setSaving(true);
    setErr('');
    const modPayload = buildModuleRightsPayload(modules);
    const payload = {
      comp_code: compCodeProp || compCode,
      COMP_CODE: compCodeProp || compCode,
      comp_uid: compUid,
      user_name: userName,
      actor_name: userName,
      record_user_name: name,
      user_no: no,
      USER_NO: no,
      USER_NAME: name,
      supervisor,
      SUPERVISOR: supervisor,
      comp_code: compCode,
      COMP_CODE: compCode,
      f_days: freezeDays,
      F_DAYS: freezeDays,
      f_date: freezeDate,
      F_DATE: freezeDate,
      r_c_no: rcNo,
      R_C_NO: rcNo,
      s_r_c_no: srcNo,
      S_R_C_NO: srcNo,
      e_r_c_no: ercNo,
      E_R_C_NO: ercNo,
      trial_access: trialAccess,
      TRIAL_ACCESS: trialAccess,
      bs_access: bsAccess,
      BS_ACCESS: bsAccess,
      reset_password: resetPw,
      RESET_PASSWORD: resetPw ? 'Y' : 'N',
      pw,
      PW: pw,
      ...modPayload,
    };

    try {
      if (isEdit) {
        const { data } = await axios.put(apiUrl(apiBase, '/api/user-master'), payload, reqOptsLocal);
        const msg =
          data?.message ||
          `User [${data?.USER_NO ?? no}] ${data?.USER_NAME ?? name} updated successfully.`;
        alert(msg);
        onUpdated?.(data);
      } else {
        const { data } = await axios.post(apiUrl(apiBase, '/api/user-master'), payload, reqOptsLocal);
        const msg =
          data?.message ||
          `User [${data?.USER_NO ?? no}] ${data?.USER_NAME ?? name} created successfully.`;
        alert(msg);
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
      className="sale-bill-modal-backdrop master-party-modal-backdrop user-master-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="sale-bill-modal master-party-modal user-master-form-modal user-master-form-modal--vfp-layout"
        role="dialog"
        aria-labelledby="user-master-form-title"
      >
        <div className="sale-bill-modal-head item-master-modal__head">
          <h3 id="user-master-form-title">{isEdit ? 'Edit user' : 'New user'}</h3>
          <p className="item-master-modal__subtitle">User Master · VFP USER.scx (USERS)</p>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form
          ref={formRef}
          className="user-master-form-modal__form"
          onSubmit={handleSave}
          onKeyDownCapture={handleFormEnterAsTab}
        >
          <div className="user-master-form-modal__body">
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

          <div className="user-master-form-modal__layout">
            <section className="user-master-form-modal__rights-panel" aria-labelledby="user-master-rights-heading">
              <div className="user-master-form-modal__rights-head">
                <h4 id="user-master-rights-heading" className="user-master-form-modal__section-title">
                  Module access (F1–F13)
                </h4>
                <button
                  type="button"
                  className="btn btn-secondary user-master-select-all-btn"
                  disabled={saving}
                  onClick={handleSelectAllModules}
                >
                  Select all
                </button>
              </div>
              <UserModuleAccessMatrix modules={modules} disabled={saving} onChange={handleModuleChange} />
            </section>

            <section className="user-master-form-modal__details-panel">
              <div className="user-master-form-modal__details-scroll">
              <p className="user-master-form-modal__section-title">User &amp; settings</p>
              <div className="user-master-form-modal__grid user-master-form-modal__grid--identity">
            <label className="item-master-field">
              <span className="sale-bill-field__label">User no</span>
              <input
                className="form-input"
                value={userNo}
                readOnly={isEdit}
                disabled={saving || isEdit}
                onChange={(e) => setUserNo(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="item-master-field">
              <span className="sale-bill-field__label">User name (login)</span>
              <input
                className="form-input account-master-search-input user-master-login-input"
                value={userLoginName}
                disabled={saving}
                maxLength={USER_MASTER_NAME_MAX}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setUserLoginName(toUserMasterUpper(e.target.value, USER_MASTER_NAME_MAX))}
              />
            </label>
            <label className="item-master-field">
              <span className="sale-bill-field__label">Supervisor Y/N</span>
              <select className="form-input" value={supervisor} disabled={saving} onChange={(e) => setSupervisor(e.target.value)}>
                <option value="N">N</option>
                <option value="Y">Y</option>
              </select>
            </label>
            <label className="item-master-field">
              <span className="sale-bill-field__label">Company for user</span>
              <input
                className="form-input"
                list="user-master-comp-list"
                value={compCode}
                disabled={saving}
                onChange={(e) => setCompCode(String(e.target.value).toUpperCase())}
              />
              <datalist id="user-master-comp-list">
                {companies.map((c) => {
                  const code = String(c.comp_code ?? c.COMP_CODE ?? '').trim();
                  const name = String(c.comp_name ?? c.COMP_NAME ?? '').trim();
                  return <option key={code} value={code}>{name ? `${code} — ${name}` : code}</option>;
                })}
              </datalist>
            </label>
          </div>

            <div className="user-master-form-modal__settings">
            <div className="user-master-form-modal__grid user-master-form-modal__grid--settings">
              <label className="item-master-field">
                <span className="sale-bill-field__label">Freeze days</span>
                <input className="form-input" value={freezeDays} disabled={saving} onChange={(e) => setFreezeDays(e.target.value)} />
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">Freeze entries date</span>
                <input
                  className="form-input"
                  type="date"
                  value={freezeDate}
                  disabled={saving}
                  onChange={(e) => setFreezeDate(e.target.value)}
                />
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">Receipt counter no</span>
                <input className="form-input" value={rcNo} disabled={saving} onChange={(e) => setRcNo(e.target.value)} />
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">Starting receipt no</span>
                <input className="form-input" value={srcNo} disabled={saving} onChange={(e) => setSrcNo(e.target.value)} />
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">Ending receipt no</span>
                <input className="form-input" value={ercNo} disabled={saving} onChange={(e) => setErcNo(e.target.value)} />
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">Trial balance access</span>
                <select className="form-input" value={trialAccess} disabled={saving} onChange={(e) => setTrialAccess(e.target.value)}>
                  <option value="N">N</option>
                  <option value="Y">Y</option>
                </select>
              </label>
              <label className="item-master-field">
                <span className="sale-bill-field__label">P&amp;L / B.Sheet access</span>
                <select className="form-input" value={bsAccess} disabled={saving} onChange={(e) => setBsAccess(e.target.value)}>
                  <option value="N">N</option>
                  <option value="Y">Y</option>
                </select>
              </label>
              {isEdit ? (
                <label className="item-master-field user-master-pw-field">
                  <span className="sale-bill-field__label">Reset password</span>
                  <select
                    className="form-input"
                    value={resetPasswordYn}
                    disabled={saving}
                    onChange={(e) => {
                      const v = e.target.value;
                      setResetPasswordYn(v);
                      if (v === 'Y') setNewPassword('');
                    }}
                  >
                    <option value="N">N</option>
                    <option value="Y">Y</option>
                  </select>
                </label>
              ) : null}
              <label className="item-master-field user-master-pw-field">
                <span className="sale-bill-field__label">
                  {isEdit ? 'New password' : 'Initial password'}
                </span>
                <input
                  className="form-input user-master-password-input user-master-login-input"
                  type="password"
                  autoComplete="new-password"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={USER_MASTER_PW_MAX}
                  value={newPassword}
                  disabled={saving || (isEdit && resetPasswordYn === 'Y')}
                  title={`Max ${USER_MASTER_PW_MAX} characters (VARCHAR2(10))`}
                  onChange={(e) => setNewPassword(toUserMasterPassword(e.target.value))}
                />
              </label>
            </div>
          </div>
              </div>
            </section>
          </div>
          </div>

          <div className="item-master-modal__foot user-master-form-modal__foot">
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
