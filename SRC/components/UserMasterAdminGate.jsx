import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

/** VFP user.scx — COMPANY.COMP_P_D administrator password before User Master. */
export default function UserMasterAdminGate({ apiBase, compCode, onVerified, onCancel }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setChecking(true);
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/user-master-verify-admin-password'),
        {
          comp_code: compCode,
          password: password.trim(),
          apw: password.trim(),
        },
        {
          ...reqOpts,
          headers: {
            'X-Comp-Code': String(compCode ?? '1').trim(),
          },
        }
      );
      if (data?.token) onVerified(data.token);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Invalid Passowrd';
      setErr(msg);
      if (String(msg).toLowerCase().includes('invalid')) {
        alert('Invalid Passowrd');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="slide slide-32-user-master user-master-admin-gate">
      <div className="user-master-admin-gate__card">
        <h2 className="sale-bill-page__title">User Master</h2>
        <p className="user-master-admin-gate__lead">Administrator password required (VFP user.scx · COMPANY.COMP_P_D).</p>
        <form className="user-master-admin-gate__form" onSubmit={handleSubmit}>
          <label className="sale-bill-field" htmlFor="user-master-admin-pw">
            <span className="sale-bill-field__label">Administrator password</span>
            <input
              ref={inputRef}
              id="user-master-admin-pw"
              type="password"
              className="form-input user-master-login-input"
              value={password}
              autoComplete="off"
              maxLength={20}
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
