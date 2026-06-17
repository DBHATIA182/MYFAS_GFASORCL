import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

/** VFP gst_profile.scx — APW must be NEWFAS_EINV. */
export default function GstProfilePasswordGate({ apiBase, compCode, userName, onVerified, onCancel }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setChecking(true);
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/gst-profile-verify-password'),
        {
          comp_code: compCode,
          user_name: userName || '',
          password: password.trim(),
        },
        {
          ...reqOpts,
          headers: { 'X-Comp-Code': String(compCode ?? '1').trim() },
        }
      );
      if (data?.token) onVerified(data.token);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Invalid Passowrd';
      setErr(msg);
      alert(msg);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="slide slide-78-gstprof gstprof-screen gstprof-password-gate user-master-admin-gate">
      <div className="user-master-admin-gate__card">
        <h2 className="sale-bill-page__title">Gst Profile Setting</h2>
        <p className="user-master-admin-gate__lead">
          Administrator password required (VFP <code>DO FORM gst_profile</code> · <code>NEWFAS_EINV</code>).
        </p>
        <form
          ref={formRef}
          className="user-master-admin-gate__form"
          onSubmit={handleSubmit}
          onKeyDownCapture={(e) => focusNextOnEnter(e, formRef, { submitOnLast: true })}
        >
          <label className="sale-bill-field" htmlFor="gst-profile-access-pw">
            <span className="sale-bill-field__label">Password</span>
            <input
              ref={inputRef}
              id="gst-profile-access-pw"
              type="password"
              className="form-input user-master-login-input"
              value={password}
              autoComplete="off"
              maxLength={30}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {err ? <p className="form-api-error">{err}</p> : null}
          <div className="user-master-admin-gate__actions">
            <button type="submit" className="btn btn-primary" disabled={checking || !password.trim()}>
              {checking ? 'Checking…' : 'OK'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
