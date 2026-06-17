import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import UserMasterFormModal from '../components/UserMasterFormModal';
import UserMasterAdminGate from '../components/UserMasterAdminGate';
import UserModuleAccessMatrix, { modulesStateFromUserRow } from '../components/UserModuleAccessMatrix';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';
import {
  loadUserMasterAdminToken,
  saveUserMasterAdminToken,
  userMasterRequestOpts,
} from '../utils/userMasterAdminSession';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapUserListRow(r) {
  return {
    USER_NO: Number(r.USER_NO ?? r.user_no ?? 0) || 0,
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    SUPERVISOR: String(r.SUPERVISOR ?? r.supervisor ?? '').trim(),
    COMP_CODE: String(r.COMP_CODE ?? r.comp_code ?? '').trim(),
  };
}

/** VFP DO FORM USER → hub USERS table. */
export default function Slide32UserMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compCode = String(formData.comp_code ?? formData.COMP_CODE ?? '1').trim() || '1';

  const [adminToken, setAdminToken] = useState(() => loadUserMasterAdminToken(compCode));
  const [adminVerified, setAdminVerified] = useState(() => Boolean(loadUserMasterAdminToken(compCode)));
  const adminReqOpts = useMemo(
    () => userMasterRequestOpts(compCode, adminToken, reqOpts),
    [compCode, adminToken]
  );

  const [perms, setPerms] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedNo, setSelectedNo] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const lastRowTapRef = useRef({ at: 0, key: '' });

  const handleAdminVerified = (token) => {
    saveUserMasterAdminToken(compCode, token);
    setAdminToken(token);
    setAdminVerified(true);
  };

  const handleAdminCancel = () => {
    saveUserMasterAdminToken(compCode, '');
    setAdminToken('');
    setAdminVerified(false);
    onPrev();
  };

  const onSearch = useCallback(
    async (q, { isStale }) => {
      setListLoading(true);
      setErr('');
      try {
        const params = {};
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/user-master-list'), {
          params,
          ...adminReqOpts,
        });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapUserListRow) : []);
      } catch (e) {
        if (isStale()) return;
        const status = e?.response?.status;
        const msg = e?.response?.data?.error || e.message || 'Load failed';
        if (status === 403 && String(msg).toLowerCase().includes('administrator')) {
          saveUserMasterAdminToken(compCode, '');
          setAdminToken('');
          setAdminVerified(false);
        }
        setErr(msg);
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase, adminReqOpts, compCode]
  );

  const { executeSearch, refreshList } = useDebouncedMasterSearch({
    enabled: !loading && !!perms?.canOpen && adminVerified,
    onSearch,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [permRes, compRes] = await Promise.all([
          axios.get(apiUrl(apiBase, '/api/user-master-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/companies'), {
            params: { user_name: userName || '' },
            ...reqOpts,
          }),
        ]);
        if (!cancelled) {
          setPerms(permRes.data);
          setCompanies(Array.isArray(compRes.data) ? compRes.data : []);
        }
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

  useEffect(() => {
    if (!selectedNo || !adminVerified) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/user-master-detail'), {
          params: { user_no: selectedNo },
          ...adminReqOpts,
        });
        if (!cancelled) setSelectedDetail(data);
      } catch {
        if (!cancelled) setSelectedDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, selectedNo, adminVerified, adminReqOpts]);

  const selectedModules = useMemo(
    () => (selectedDetail ? modulesStateFromUserRow(selectedDetail) : null),
    [selectedDetail]
  );

  const openEdit = async (row) => {
    if (!row?.USER_NO) return;
    if (!perms?.canOpen) {
      alert('Access denied.');
      return;
    }
    setErr('');
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/user-master-detail'), {
        params: { user_no: row.USER_NO },
        ...adminReqOpts,
      });
      setEditRow(data);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Load failed';
      setErr(msg);
      alert(msg);
    }
  };

  const handleRowClick = (row) => {
    setSelectedNo(String(row.USER_NO));
  };

  const handleRowDoubleActivate = (row) => {
    handleRowClick(row);
    void openEdit(row);
  };

  const handleRowTouchEnd = (row) => {
    const key = String(row.USER_NO);
    const now = Date.now();
    if (lastRowTapRef.current.key === key && now - lastRowTapRef.current.at < 450) {
      handleRowDoubleActivate(row);
      lastRowTapRef.current = { at: 0, key: '' };
      return;
    }
    lastRowTapRef.current = { at: now, key };
    handleRowClick(row);
  };

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a user from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const label = `[${selectedRow.USER_NO}] ${selectedRow.USER_NAME}`;
    if (!window.confirm(`Delete user ${label}?`)) return;
    setDeleting(true);
    setErr('');
    try {
      const { data } = await axios.delete(apiUrl(apiBase, '/api/user-master'), {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          actor_name: userName,
          user_no: selectedRow.USER_NO,
          USER_NO: selectedRow.USER_NO,
        },
        ...adminReqOpts,
      });
      alert(data?.message || `User [${selectedRow.USER_NO}] ${selectedRow.USER_NAME} deleted.`);
      setSelectedNo('');
      refreshList();
    } catch (e) {
      const errMsg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(errMsg);
      alert(errMsg);
    } finally {
      setDeleting(false);
    }
  };

  const handleList = () => {
    setSearchQ('');
    setSelectedNo('');
    executeSearch('', { immediate: true });
  };

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const exportRows = rows.map((r) => ({
      USER_NO: r.USER_NO,
      USER_NAME: r.USER_NAME,
      SUPERVISOR: r.SUPERVISOR,
      COMPANY: r.COMP_CODE,
    }));
    downloadExcelRows(exportRows, 'Users', `${compName}_UserMaster`);
  };

  if (loading) {
    return (
      <div className="slide slide-32-user-master slide-32-user-master--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">User Master</h2>
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
      <div className="slide slide-32-user-master">
        <h2 className="sale-bill-page__title">User Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">
          {err || 'Access denied — Master module rights (F4) or Supervisor required.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  if (!adminVerified) {
    return (
      <UserMasterAdminGate
        apiBase={apiBase}
        compCode={compCode}
        onVerified={handleAdminVerified}
        onCancel={handleAdminCancel}
      />
    );
  }

  return (
    <div className="slide slide-32-user-master account-master-screen item-master-screen user-master-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">User Master</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="user-master" />
          {perms?.isSupervisor ? (
            <p className="user-master-screen__badge">Supervisor access</p>
          ) : null}
          <MasterScreenToolbar
            onPrev={onPrev}
            onReset={onReset}
            onRefresh={refreshList}
            onList={handleList}
            onExcel={handleExcel}
            perms={perms}
            onAdd={() => setAddOpen(true)}
            onEdit={() => selectedRow && void openEdit(selectedRow)}
            onDelete={() => void handleDelete()}
            listLoading={listLoading}
            hasRows={rows.length > 0}
            selectedRow={selectedRow}
            deleting={deleting}
            listDisabled={listLoading}
          />
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <p className="user-master-screen__mobile-hint">Tap a user to select · double-tap to edit</p>

      <div className="user-master-screen__shell">
        <div className="user-master-screen__view-tabs" role="tablist" aria-label="User Master screens">
          <span className="user-master-screen__view-tab is-active" role="tab" aria-selected="true">
            Screen 1 — User list
          </span>
          <span
            className={`user-master-screen__view-tab${editRow != null || addOpen ? ' is-active' : ''}`}
            role="tab"
            aria-selected={editRow != null || addOpen}
          >
            Screen 2 — Edit dialog
          </span>
        </div>

        <div className="user-master-screen__main-panels">
          <section className="user-master-panel user-master-panel--users" aria-label="Users">
            <header className="user-master-panel__head">
              <h3 className="user-master-panel__title">Users</h3>
              <p className="user-master-panel__summary">
                {rows.length} user{rows.length === 1 ? '' : 's'}
                {selectedRow ? ` · selected [${selectedRow.USER_NO}] ${selectedRow.USER_NAME}` : ''}
                {listLoading ? ' · searching…' : ''}
              </p>
            </header>

            <div className="user-master-panel__search">
              <label className="sale-bill-field account-master-filter account-master-filter--search">
                <span className="sale-bill-field__label">Search</span>
                <input
                  className="form-input account-master-search-input"
                  type="search"
                  value={searchQ}
                  placeholder="User no or name…"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const v = String(e.target.value ?? '').toUpperCase();
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

            <div className="account-master-screen__list-wrap user-master-screen__list-wrap">
              <table className="account-master-table user-master-table">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>User name</th>
                    <th>Sup</th>
                    <th>Company</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="account-master-table__empty">
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
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            handleRowDoubleActivate(r);
                          }}
                          onTouchEnd={() => handleRowTouchEnd(r)}
                        >
                          <td>{r.USER_NO}</td>
                          <td>{r.USER_NAME}</td>
                          <td>{r.SUPERVISOR || '—'}</td>
                          <td>{r.COMP_CODE || '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <p className="user-master-panel__foot-hint">Double-click to edit</p>
          </section>

          <aside className="user-master-panel user-master-panel--access" aria-label="Module access">
            <h3 className="user-master-panel__title">Module access</h3>
            {detailLoading ? (
              <p className="user-master-screen__access-hint">Loading rights…</p>
            ) : selectedRow && selectedModules ? (
              <>
                <p className="user-master-screen__access-badge">
                  Showing: [{selectedRow.USER_NO}] {selectedRow.USER_NAME}
                  {selectedRow.SUPERVISOR === 'Y' ? ' · Supervisor' : ''}
                </p>
                <div className="user-master-screen__access-matrix">
                  <UserModuleAccessMatrix modules={selectedModules} readOnly disabled />
                </div>
              </>
            ) : (
              <p className="user-master-screen__access-hint">Select a user to view all module rights.</p>
            )}
          </aside>
        </div>
      </div>

      <UserMasterFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compUid={compUid}
        compCode={compCode}
        adminReqOpts={adminReqOpts}
        userName={userName}
        companies={companies}
        onCreated={(saved) => {
          setAddOpen(false);
          const no = saved?.user_no ?? saved?.USER_NO;
          if (no) setSelectedNo(String(no));
          refreshList();
        }}
      />

      <UserMasterFormModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compUid={compUid}
        compCode={compCode}
        adminReqOpts={adminReqOpts}
        userName={userName}
        companies={companies}
        editRow={editRow}
        onUpdated={(saved) => {
          setEditRow(null);
          const no = saved?.user_no ?? saved?.USER_NO;
          if (no) setSelectedNo(String(no));
          refreshList();
        }}
      />
    </div>
  );
}
