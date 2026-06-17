import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const USER_NAME_MAX = 10;
const USER_PW_MAX = 10;

function toHubUpper(s, maxLen = USER_NAME_MAX) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

function mapUserListRow(r) {
  return {
    USER_NO: Number(r.USER_NO ?? r.user_no ?? 0) || 0,
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    SUPERVISOR: String(r.SUPERVISOR ?? r.supervisor ?? '').trim(),
    COMP_CODE: String(r.COMP_CODE ?? r.comp_code ?? '').trim(),
  };
}

/** VFP DO FORM PASSWORD (password.scx) — change USERS.PW on hub table. */
export default function Slide35UserPassword({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [perms, setPerms] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedNo, setSelectedNo] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      setListLoading(true);
      setErr('');
      try {
        const params = {};
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/user-master-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapUserListRow) : []);
      } catch (e) {
        if (isStale()) return;
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase]
  );

  const { executeSearch, refreshList } = useDebouncedMasterSearch({
    enabled: !loading && !!perms?.canOpen,
    onSearch,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/user-password-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName]);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.USER_NO) === String(selectedNo)) || null,
    [rows, selectedNo]
  );

  const clearPasswordFields = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleRowClick = (r) => {
    setSelectedNo(String(r.USER_NO));
    clearPasswordFields();
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!selectedRow) {
      alert('Select a user from the list first.');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    const oldPw = toHubUpper(oldPassword, USER_PW_MAX);
    const pw = toHubUpper(newPassword, USER_PW_MAX);
    const confirm = toHubUpper(confirmPassword, USER_PW_MAX);
    if (!oldPw) {
      setErr('Enter old password.');
      alert('Enter old password.');
      return;
    }
    if (!pw) {
      setErr('Enter new password.');
      alert('Enter new password.');
      return;
    }
    if (pw === oldPw) {
      setErr('New password must be different from old password.');
      alert('New password must be different from old password.');
      return;
    }
    if (pw !== confirm) {
      setErr('Password and confirm password do not match.');
      alert('Password and confirm password do not match.');
      return;
    }

    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.put(apiUrl(apiBase, '/api/user-password'), {
        comp_uid: compUid,
        user_name: userName,
        actor_name: userName,
        user_no: selectedRow.USER_NO,
        USER_NO: selectedRow.USER_NO,
        USER_NAME: selectedRow.USER_NAME,
        record_user_name: selectedRow.USER_NAME,
        old_pw: oldPw,
        OLD_PW: oldPw,
        old_password: oldPw,
        pw,
        PW: pw,
        confirm_pw: confirm,
        CONFIRM_PW: confirm,
      }, reqOpts);
      const msg =
        data?.message ||
        `Password updated for [${selectedRow.USER_NO}] ${selectedRow.USER_NAME}.`;
      alert(msg);
      clearPasswordFields();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Update failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-35-user-password slide-35-user-password--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">User Password</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-35-user-password">
        <h2 className="sale-bill-page__title">User Password</h2>
        <p className="deploy-update-msg deploy-update-msg--err">
          {err || 'Access denied — Master module rights (F4) or Supervisor required.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-35-user-password account-master-screen item-master-screen user-password-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">User Password</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="user-password" />
          <p className="user-password-screen__tip" aria-hidden="true">
            VFP DO FORM PASSWORD · GRAINFAS.USERS (PW)
          </p>
          <MasterScreenToolbar
            onPrev={onPrev}
            onReset={onReset}
            onRefresh={refreshList}
            perms={{ ...perms, canAdd: false, canDelete: false }}
            listLoading={listLoading}
            hasRows={rows.length > 0}
            listDisabled={listLoading}
          />
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <div className="user-password-screen__body">
        <section className="user-password-screen__users" aria-label="Select user">
          <h3 className="user-password-screen__section-title">Select user</h3>
          <div className="user-password-screen__search">
            <label className="sale-bill-field account-master-filter account-master-filter--search">
              <span className="sale-bill-field__label">Search</span>
              <input
                className="form-input account-master-search-input user-master-login-input"
                type="search"
                value={searchQ}
                placeholder="User no or name…"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  const v = toHubUpper(e.target.value, USER_NAME_MAX);
                  setSearchQ(v);
                  executeSearch(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    executeSearch(searchQ, { immediate: true });
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary account-master-filter-btn"
              onClick={() => executeSearch(searchQ, { immediate: true })}
            >
              Find
            </button>
          </div>
          <div className="account-master-screen__list-wrap user-password-screen__list-wrap">
            <table className="account-master-table user-password-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>User name</th>
                  <th>Company</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="account-master-table__empty">
                      {listLoading ? 'Loading…' : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const key = String(r.USER_NO);
                    const isSel = String(selectedNo) === key;
                    return (
                      <tr
                        key={key}
                        className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                        onClick={() => handleRowClick(r)}
                      >
                        <td>{r.USER_NO}</td>
                        <td>{r.USER_NAME}</td>
                        <td>{r.COMP_CODE || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="user-password-screen__form-panel" aria-label="Change password">
          <h3 className="user-password-screen__section-title">Change password</h3>
          {selectedRow ? (
            <p className="user-password-screen__selected">
              User: <strong>[{selectedRow.USER_NO}] {selectedRow.USER_NAME}</strong>
            </p>
          ) : (
            <p className="user-password-screen__hint">Select a user, then enter old, new, and confirm password (uppercase).</p>
          )}
          <form className="user-password-screen__form" onSubmit={handleUpdatePassword}>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">Old password</span>
              <input
                className="form-input user-master-login-input"
                type="password"
                autoComplete="current-password"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={USER_PW_MAX}
                value={oldPassword}
                disabled={saving || !selectedRow || !perms?.canEdit}
                onChange={(e) => setOldPassword(toHubUpper(e.target.value, USER_PW_MAX))}
              />
            </label>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">New password</span>
              <input
                className="form-input user-master-login-input"
                type="password"
                autoComplete="new-password"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={USER_PW_MAX}
                value={newPassword}
                disabled={saving || !selectedRow || !perms?.canEdit}
                onChange={(e) => setNewPassword(toHubUpper(e.target.value, USER_PW_MAX))}
              />
            </label>
            <label className="item-master-field item-master-field--full">
              <span className="sale-bill-field__label">Confirm password</span>
              <input
                className="form-input user-master-login-input"
                type="password"
                autoComplete="new-password"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={USER_PW_MAX}
                value={confirmPassword}
                disabled={saving || !selectedRow || !perms?.canEdit}
                onChange={(e) => setConfirmPassword(toHubUpper(e.target.value, USER_PW_MAX))}
              />
            </label>
            <p className="user-password-screen__note">Password is stored in uppercase (max {USER_PW_MAX} characters).</p>
            <div className="user-password-screen__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => clearPasswordFields()}
              >
                Clear
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !selectedRow || !perms?.canEdit}
              >
                {saving ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
