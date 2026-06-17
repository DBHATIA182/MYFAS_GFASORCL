import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import GodownMasterEntry from '../components/GodownMasterEntry';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import {
  capsSave,
  emptyGodownForm,
  enrichGodownRowState,
  mapGodownRow,
  normalizeGodownForm,
  stateCodesMatch,
  toGodownExportRow,
  toGodownPdfRow,
} from '../utils/godownMasterUtils';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

/** VFP DO FORM godown — GODOWN master (list + detail entry). */
export default function Slide38GodownMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [perms, setPerms] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [screenMode, setScreenMode] = useState('view');
  const [form, setForm] = useState(emptyGodownForm);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [states, setStates] = useState([]);
  const [stateByCode, setStateByCode] = useState(() => new Map());
  const stateByCodeRef = useRef(new Map());
  const formRef = useRef(null);
  const codeInputRef = useRef(null);
  const viewFormSnapshotRef = useRef(null);

  useEffect(() => {
    stateByCodeRef.current = stateByCode;
  }, [stateByCode]);

  useEffect(() => {
    if (!stateByCode.size) return;
    setRows((prev) => prev.map((r) => enrichGodownRowState(r, stateByCode)));
  }, [stateByCode]);

  useEffect(() => {
    if (!compCode || compUid == null || !perms?.canOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-party-states'), {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        });
        if (cancelled) return;
        const m = new Map();
        const list = Array.isArray(data) ? data : [];
        for (const s of list) {
          const c = String(s.STATE_CODE ?? s.state_code ?? '').trim();
          if (c) m.set(c, String(s.STATE ?? s.state ?? '').trim());
        }
        setStates(list);
        setStateByCode(m);
      } catch {
        if (!cancelled) {
          setStates([]);
          setStateByCode(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, perms?.canOpen]);

  useEffect(() => {
    if (!form.GOD_STATE_CODE || !states.length) return;
    const code = String(form.GOD_STATE_CODE).trim();
    const hit = states.find((s) => stateCodesMatch(s.STATE_CODE ?? s.state_code, code));
    if (!hit) return;
    const name = String(hit.STATE ?? hit.state ?? '').trim();
    if (!name) return;
    setForm((prev) => {
      if (String(prev.GOD_STATE ?? '').trim()) return prev;
      return { ...prev, GOD_STATE: name };
    });
  }, [states, form.GOD_STATE_CODE]);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/godown-list'), { params, ...reqOpts });
        if (isStale()) return;
        const mapped = Array.isArray(data) ? data.map(mapGodownRow) : [];
        setRows(mapped.map((r) => enrichGodownRowState(r, stateByCodeRef.current)));
      } catch (e) {
        if (isStale()) return;
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase, compCode, compUid]
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/godown-user-permissions'), {
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

  useEffect(() => {
    if (loading || !perms?.canOpen) return;
    executeSearch(searchQ, { immediate: true });
  }, [loading, perms?.canOpen, searchQ, executeSearch]);

  const loadDetail = useCallback(
    async (code) => {
      const c = String(code ?? '').trim();
      if (!c) {
        setForm(emptyGodownForm());
        return;
      }
      setDetailLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/godown'), {
          params: { comp_code: compCode, comp_uid: compUid, god_code: c },
          ...reqOpts,
        });
        const normalized = normalizeGodownForm(mapGodownRow(data));
        setForm(normalized);
        viewFormSnapshotRef.current = normalized;
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setForm(emptyGodownForm());
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase, compCode, compUid]
  );

  useEffect(() => {
    if (screenMode === 'new') return;
    if (!selectedCode) {
      setForm(emptyGodownForm());
      viewFormSnapshotRef.current = null;
      return;
    }
    loadDetail(selectedCode);
  }, [selectedCode, loadDetail, screenMode]);

  useEffect(() => {
    if (screenMode === 'new' || selectedCode || !rows.length) return;
    setSelectedCode(String(rows[0].GOD_CODE ?? '').trim());
  }, [rows, selectedCode, screenMode]);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.GOD_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const selectRow = (row) => {
    const code = String(row?.GOD_CODE ?? '').trim();
    if (!code) return;
    setScreenMode('view');
    setSelectedCode(code);
  };

  const startNew = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    setSelectedCode('');
    setScreenMode('new');
    const blank = emptyGodownForm();
    setForm(blank);
    viewFormSnapshotRef.current = null;
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
    window.setTimeout(() => codeInputRef.current?.focus(), 50);
  };

  const startEdit = () => {
    if (!selectedCode) {
      alert('Select a godown from the list first.');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    viewFormSnapshotRef.current = { ...form };
    setScreenMode('edit');
  };

  const cancelEdit = () => {
    if (screenMode === 'new') {
      setScreenMode('view');
      setForm(emptyGodownForm());
      if (rows.length) {
        const first = String(rows[0].GOD_CODE);
        setSelectedCode(first);
      }
      return;
    }
    if (viewFormSnapshotRef.current) {
      setForm(viewFormSnapshotRef.current);
    } else if (selectedCode) {
      void loadDetail(selectedCode);
    }
    setScreenMode('view');
  };

  const handleSave = async () => {
    const code = capsSave(form.GOD_CODE, 6);
    const name = capsSave(form.GOD_NAME, 80);
    if (!code) {
      alert('Godown code is required.');
      return;
    }
    if (!name) {
      alert('Godown name is required.');
      return;
    }
    if (screenMode === 'new' && !perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    if (screenMode === 'edit' && !perms?.canEdit) {
      alert('You Can Not Edit');
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
      god_tel_no_1: String(form.GOD_TEL_NO_1 ?? '').trim(),
      god_tel_no_2: String(form.GOD_TEL_NO_2 ?? '').trim(),
      god_fssai_no: capsSave(form.GOD_FSSAI_NO, 20),
      god_b_type: capsSave(form.GOD_B_TYPE, 1) || 'N',
      god_code_main: capsSave(form.GOD_CODE_MAIN, 6),
    };
    try {
      if (screenMode === 'new') {
        await axios.post(apiUrl(apiBase, '/api/godown'), payload, reqOpts);
      } else {
        await axios.put(apiUrl(apiBase, '/api/godown'), payload, reqOpts);
      }
      setSelectedCode(code);
      setScreenMode('view');
      await refreshList();
      await loadDetail(code);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a godown from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.GOD_CODE;
    const label = `[${code}] ${selectedRow.GOD_NAME || ''}`;
    if (!window.confirm(`Delete godown ${label}?`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(apiUrl(apiBase, '/api/godown'), {
        data: { comp_code: compCode, comp_uid: compUid, user_name: userName, god_code: code },
        ...reqOpts,
      });
      setSelectedCode('');
      setForm(emptyGodownForm());
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
    executeSearch('', { immediate: true });
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const q = String(searchQ).trim();
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'Godown Master',
      period: q ? `Search: ${q}` : 'All godowns',
      endDate: q ? `Search: ${q}` : 'All godowns',
    };
  };

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    downloadExcelRows(rows.map(toGodownExportRow), 'GodownMaster', `${compName}_GodownMaster`);
  };

  const handlePdf = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    generatePDF('godown-master', rows.map(toGodownPdfRow), buildPdfMeta()).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const shareText = [compName, 'Godown Master', `Rows: ${rows.length}`].join('\n');
    sharePdfWithWhatsApp('godown-master', rows.map(toGodownPdfRow), buildPdfMeta(), shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  const handleFormEnterAsTab = useCallback((e) => {
    if (screenMode === 'view') return false;
    return focusNextOnEnter(e, formRef, { submitOnLast: false });
  }, [screenMode]);

  const detailSubtitle = useMemo(() => {
    const parts = [];
    if (form.GOD_CODE) parts.push(`Code #${form.GOD_CODE}`);
    if (form.GOD_NAME1) parts.push(form.GOD_NAME1);
    if (form.GOD_LOCATION) parts.push(form.GOD_LOCATION);
    return parts.join(' · ') || 'Select a godown from the list';
  }, [form.GOD_CODE, form.GOD_NAME1, form.GOD_LOCATION]);

  const statusText =
    screenMode === 'new'
      ? 'New record — enter details and Save'
      : screenMode === 'edit'
        ? 'Edit mode — modify fields and Save'
        : selectedCode
          ? 'View mode — click Edit to modify'
          : 'Select a godown from the list';

  const entryMode = screenMode === 'new' ? 'new' : screenMode === 'edit' ? 'edit' : 'view';
  const showDetail = screenMode === 'new' || selectedCode || detailLoading;

  if (loading) {
    return (
      <div className="slide slide-38-godown slide-38-godown--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Godown Master</h2>
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
      <div className="slide slide-38-godown">
        <h2 className="sale-bill-page__title">Godown Master</h2>
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
    <div className="slide slide-38-godown account-master-screen item-master-screen godown-master-screen">
      <div className="account-master-screen__chrome godown-master-screen__chrome">
        <div className="account-master-screen__head godown-master-screen__head">
          <div className="godown-master-screen__head-bar">
            <h2 className="sale-bill-page__title">Godown Master</h2>
            <div className="godown-master-screen__toolbar-cluster">
              <MasterScreenToolbar
                onPrev={onPrev}
                onReset={onReset}
                onRefresh={refreshList}
                onList={handleList}
                onExcel={handleExcel}
                onPdf={handlePdf}
                onWhatsApp={handleWhatsApp}
                perms={perms}
                onAdd={() => void startNew()}
                onEdit={startEdit}
                onDelete={() => void handleDelete()}
                listLoading={listLoading}
                hasRows={rows.length > 0}
                selectedRow={selectedRow}
                deleting={deleting}
                listDisabled={listLoading}
              />
              <SessionToolbarChrome
                helpReportId="godown-master"
                helpLabel="Help"
                helpCompanyName={String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim()}
              />
            </div>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            className="godown-master-screen__session-line"
          />
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <div className="godown-master-screen__workspace">
        <aside className="godown-master-screen__sidebar" aria-label="Godown list">
          <input
            className="form-input godown-master-screen__sidebar-search"
            type="search"
            value={searchQ}
            placeholder="Search…"
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
          <ul className="godown-master-screen__list" role="listbox">
            {rows.length === 0 ? (
              <li className="godown-master-screen__list-empty">
                {listLoading ? 'Loading…' : 'No godowns found.'}
              </li>
            ) : (
              rows.map((r, idx) => {
                const codeKey = String(r.GOD_CODE);
                const isSel = String(selectedCode) === codeKey && screenMode !== 'new';
                return (
                  <li key={codeKey} role="option" aria-selected={isSel}>
                    <button
                      type="button"
                      className={
                        isSel
                          ? 'godown-master-screen__list-item is-selected'
                          : 'godown-master-screen__list-item'
                      }
                      onClick={() => selectRow(r)}
                      onDoubleClick={() => {
                        selectRow(r);
                        startEdit();
                      }}
                    >
                      <span className="godown-master-screen__list-idx">{idx + 1}</span>
                      <span className="godown-master-screen__list-body">
                        <strong>{r.GOD_NAME || codeKey}</strong>
                        <span>{r.GOD_LOCATION || '—'}</span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <main className="godown-master-screen__detail" aria-label="Godown details">
          {!showDetail ? (
            <div className="godown-master-screen__detail-empty">
              <p>Select a godown from the list or click Add to create one.</p>
            </div>
          ) : (
            <>
              <header className="godown-master-screen__detail-head">
                <div className="godown-master-screen__detail-head-text">
                  <h3 className="godown-master-screen__detail-title">
                    {screenMode === 'new' ? 'New Godown' : form.GOD_NAME || 'Godown'}
                  </h3>
                  <p className="godown-master-screen__detail-sub">{detailSubtitle}</p>
                </div>
                <div className="godown-master-screen__detail-actions">
                  {screenMode === 'view' && selectedCode && perms?.canEdit ? (
                    <button type="button" className="btn btn-link godown-master-screen__view-link" onClick={startEdit}>
                      Edit
                    </button>
                  ) : null}
                  {screenMode === 'edit' || screenMode === 'new' ? (
                    <>
                      <button type="button" className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  ) : null}
                </div>
              </header>

              <div className="godown-master-screen__detail-scroll">
                {detailLoading && screenMode !== 'new' ? (
                  <p className="godown-master-screen__detail-loading">Loading…</p>
                ) : (
                  <GodownMasterEntry
                    mode={entryMode}
                    form={form}
                    setForm={setForm}
                    states={states}
                    godownOptions={rows}
                    formRef={formRef}
                    codeInputRef={codeInputRef}
                    onKeyDownCapture={handleFormEnterAsTab}
                  />
                )}
              </div>

              <footer className="godown-master-screen__detail-foot">
                <span>
                  {rows.length} record{rows.length === 1 ? '' : 's'}
                </span>
                <span>{statusText}</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
