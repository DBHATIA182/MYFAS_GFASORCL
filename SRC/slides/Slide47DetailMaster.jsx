import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { downloadExcelRows } from '../utils/excelExport';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';
import {
  buildPurExpAccountNameMap,
  purExpLegacyMasterCode,
  resolvePurExpAccountName,
} from '../utils/purExpAccountCode';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapListRow(r) {
  return {
    S_NO: Number(r.S_NO ?? r.s_no ?? 0) || 0,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
    DETAIL_PREVIEW: String(r.DETAIL_PREVIEW ?? r.detail_preview ?? '').trim(),
    LINE_CNT: Number(r.LINE_CNT ?? r.line_cnt ?? 0) || 0,
  };
}

function emptyLine(trnNo = 1) {
  return {
    TRN_NO: trnNo,
    DETAIL: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function mapLinesFromApi(lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return [emptyLine(1)];
  return list.map((l, i) => ({
    _id: `${l.TRN_NO ?? l.trn_no ?? i}-${Math.random()}`,
    TRN_NO: Number(l.TRN_NO ?? l.trn_no ?? i + 1) || i + 1,
    DETAIL: String(l.DETAIL ?? l.detail ?? '').trim(),
  }));
}

function lineCellId(idx, field) {
  return `detail-mast-${idx}-${field}`;
}

function focusLineCell(idx, field) {
  const el = document.getElementById(lineCellId(idx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO FORM DETAIL — DETAIL_MASTER: S_NO, CODE, TRN_NO, DETAIL. */
export default function Slide47DetailMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const formRef = useRef(null);
  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [selectedSNo, setSelectedSNo] = useState(0);
  const [accounts, setAccounts] = useState([]);

  const [mode, setMode] = useState('');
  const [sNo, setSNo] = useState('');
  const [code, setCode] = useState('');
  const [acName, setAcName] = useState('');
  const [lines, setLines] = useState([emptyLine(1)]);
  const [selectedLineIdx, setSelectedLineIdx] = useState(0);

  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        value: String(a.CODE ?? a.code ?? '').trim(),
        label: String(a.NAME ?? a.name ?? '').trim(),
        CODE: a.CODE ?? a.code,
        NAME: a.NAME ?? a.name,
      })),
    [accounts]
  );

  const accountNameByCode = useMemo(() => buildPurExpAccountNameMap(accounts), [accounts]);

  const selectedRow = useMemo(
    () => rows.find((r) => Number(r.S_NO) === Number(selectedSNo)) || null,
    [rows, selectedSNo]
  );

  const formDisabled = mode === '' || mode === 'del';
  const codeDisabled = formDisabled || mode === 'edit';
  const linesDisabled = formDisabled || mode === 'del';

  const clearForm = useCallback(() => {
    setSNo('');
    setCode('');
    setAcName('');
    setLines([emptyLine(1)]);
    setSelectedLineIdx(0);
  }, []);

  const loadRecordToForm = useCallback(async (sno) => {
    const sn = Number(sno) || 0;
    if (!sn) {
      clearForm();
      return;
    }
    const { data } = await axios.get(apiUrl(apiBase, '/api/detail-mast'), {
      params: { comp_code: compCode, comp_uid: compUid, s_no: sn },
      ...reqOpts,
    });
    setSNo(String(data.S_NO ?? data.s_no ?? sn));
    const c = String(data.CODE ?? data.code ?? '').trim();
    setCode(c);
    setAcName(
      resolvePurExpAccountName(c, accountNameByCode) || String(data.AC_NAME ?? data.ac_name ?? '').trim()
    );
    setLines(mapLinesFromApi(data.lines));
    setSelectedLineIdx(0);
  }, [apiBase, compCode, compUid, accountNameByCode, clearForm]);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/detail-mast-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapListRow) : []);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/detail-mast-user-permissions'), {
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
    if (!perms?.canOpen || loading) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-accounts'), {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      })
      .then(({ data }) => {
        if (!cancelled) setAccounts(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, perms?.canOpen, loading]);

  useEffect(() => {
    if (!accountNameByCode.size || !code) return;
    const name = resolvePurExpAccountName(code, accountNameByCode);
    if (name) setAcName(name);
  }, [accountNameByCode, code]);

  const setCodeCell = (raw) => {
    const c = purExpLegacyMasterCode(raw) || String(raw ?? '').trim().toUpperCase().slice(0, 6);
    setCode(c);
    setAcName(c ? resolvePurExpAccountName(c, accountNameByCode) : '');
  };

  const setLineCell = (idx, key, value) => {
    setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleAddLine = () => {
    setLines((prev) => {
      const maxTrn = prev.reduce((m, r) => Math.max(m, Number(r.TRN_NO) || 0), 0);
      const next = [...prev, emptyLine(maxTrn + 1)];
      setSelectedLineIdx(next.length - 1);
      return next;
    });
  };

  const handleRemoveLine = (idx) => {
    setLines((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const kept = next.length ? next : [emptyLine(1)];
      setSelectedLineIdx((sel) => {
        if (sel === idx) return Math.max(0, Math.min(idx, kept.length - 1));
        if (sel > idx) return sel - 1;
        return sel;
      });
      return kept;
    });
  };

  const handleDeleteSelectedLine = () => {
    if (linesDisabled || saving) return;
    if (lines.length <= 1) {
      alert('At least one detail line is required.');
      return;
    }
    handleRemoveLine(selectedLineIdx);
  };

  const handleSelectRow = async (row) => {
    if (mode === 'new' || mode === 'edit') return;
    const sn = Number(row.S_NO) || 0;
    setSelectedSNo(sn);
    setMode('');
    try {
      await loadRecordToForm(sn);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const handleNew = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/detail-mast-next-sno'), {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      });
      const next = Number(data?.next_sno ?? data?.NEXT_SNO ?? 0) || 0;
      setMode('new');
      setSelectedSNo(0);
      setSNo(String(next));
      setCode('');
      setAcName('');
      setLines([emptyLine(1)]);
      setSelectedLineIdx(0);
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Could not get next S_No');
    }
  };

  const handleEdit = async () => {
    if (!selectedRow) {
      alert('Select a record from the list first.');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setMode('edit');
    try {
      await loadRecordToForm(selectedRow.S_NO);
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const handleDeleteMode = async () => {
    if (!selectedRow) {
      alert('Select a record from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    setMode('del');
    try {
      await loadRecordToForm(selectedRow.S_NO);
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'Load failed');
    }
  };

  const handleCancelMode = () => {
    setMode('');
    if (selectedRow) loadRecordToForm(selectedRow.S_NO).catch(() => clearForm());
    else clearForm();
  };

  const handleSave = async () => {
    const sn = Number(sNo) || 0;
    const c = String(code ?? '').trim();
    if (!sn) {
      alert('S_No is required.');
      return;
    }
    if (!c) {
      alert('A/c Code is required.');
      return;
    }
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      s_no: sn,
      code: c,
      lines: lines.map(({ _id, ...l }) => l),
    };

    setSaving(true);
    setErr('');
    try {
      if (mode === 'del') {
        if (!window.confirm(`Delete detail record S_No ${sn}?`)) {
          setSaving(false);
          return;
        }
        await axios.delete(apiUrl(apiBase, '/api/detail-mast'), { data: payload, ...reqOpts });
        alert('Entry deleted.');
        setMode('');
        setSelectedSNo(0);
        clearForm();
        refreshList();
        return;
      }

      if (mode === 'new') {
        if (!perms?.canAdd) {
          alert('You Can Not Add');
          return;
        }
        const { data } = await axios.post(apiUrl(apiBase, '/api/detail-mast'), payload, reqOpts);
        alert(data?.message || 'Saved successfully.');
        setSelectedSNo(Number(data.S_NO ?? data.s_no ?? sn));
      } else if (mode === 'edit') {
        if (!perms?.canEdit) {
          alert('You Can Not Edit');
          return;
        }
        const { data } = await axios.put(apiUrl(apiBase, '/api/detail-mast'), payload, reqOpts);
        alert(data?.message || 'Saved successfully.');
        setSelectedSNo(sn);
      } else {
        alert('Click New, Edit, or Delete first.');
        return;
      }

      setMode('');
      refreshList();
      await loadRecordToForm(sn);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleList = () => {
    setSearchQ('');
    setSelectedSNo(0);
    setMode('');
    clearForm();
    executeSearch('', { immediate: true });
  };

  const buildPdfMeta = () => ({
    companyName: compName || 'Company',
    year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
    reportTitle: 'Detail Master',
    period: searchQ ? `Search: ${searchQ}` : 'All detail records',
    endDate: searchQ ? `Search: ${searchQ}` : 'All detail records',
  });

  const buildPdfRows = () =>
    rows.map((r) => ({
      S_NO: r.S_NO,
      CODE: r.CODE,
      AC_NAME: r.AC_NAME,
      DETAIL: r.DETAIL_PREVIEW,
      LINES: r.LINE_CNT,
    }));

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    downloadExcelRows(buildPdfRows(), 'DetailMaster', `${compName || 'Company'}_DetailMaster`);
  };

  const handlePdf = async () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('detail-mast-master', buildPdfRows(), buildPdfMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleWhatsApp = async () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const shareText = [compName || 'Company', 'Detail Master'].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('detail-mast-master', buildPdfRows(), buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleLineKeyDown = (e, idx, field) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (field === 'DETAIL' && idx < lines.length - 1) {
      setTimeout(() => focusLineCell(idx + 1, 'DETAIL'), 0);
    } else if (field === 'DETAIL') {
      handleAddLine();
      setTimeout(() => focusLineCell(idx + 1, 'DETAIL'), 50);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-47-detail-mast detail-mast-screen detail-mast-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Detail Master</h2>
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
      <div className="slide slide-47-detail-mast detail-mast-screen">
        <h2 className="sale-bill-page__title">Detail Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-47-detail-mast detail-mast-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome detail-mast-screen__chrome">
        <div className="account-master-screen__head detail-mast-screen__head">
          <div className="detail-mast-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Detail Master</h2>
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={refreshList}
              onList={handleList}
              onExcel={handleExcel}
              onPdf={handlePdf}
              onWhatsApp={handleWhatsApp}
              perms={perms}
              listLoading={listLoading || saving}
              hasRows={rows.length > 0}
            >
              <GfasToolbarBtn icon="add" label="New" variant="secondary" onClick={handleNew} disabled={saving || mode !== ''} />
              <GfasToolbarBtn
                icon="edit"
                label="Edit"
                variant="secondary"
                onClick={handleEdit}
                disabled={saving || !selectedRow || mode !== ''}
              />
              <GfasToolbarBtn
                icon="delete"
                label="Delete"
                variant="danger"
                onClick={handleDeleteMode}
                disabled={saving || !selectedRow || mode !== ''}
              />
              <GfasToolbarBtn
                label={saving ? 'Saving…' : 'Save'}
                variant="primary"
                onClick={handleSave}
                disabled={saving || (mode !== 'new' && mode !== 'edit' && mode !== 'del')}
              />
              {mode ? (
                <GfasToolbarBtn label="Cancel" variant="secondary" onClick={handleCancelMode} disabled={saving} />
              ) : null}
            </MasterScreenToolbar>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="detail-mast-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="detail-mast-screen__session-line"
          />
        </div>
      </div>

      <div className="detail-mast-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err detail-mast-screen__err">{err}</p> : null}
        {mode === 'del' ? (
          <p className="detail-mast-screen__mode-hint">Delete mode — press Save to confirm deletion.</p>
        ) : null}

        <form
          ref={formRef}
          className="detail-mast-screen__form"
          onKeyDownCapture={(e) => focusNextOnEnter(e, formRef, { submitOnLast: false })}
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sale-bill-field detail-mast-screen__field detail-mast-screen__field--sno">
            <span className="sale-bill-field__label">S_No</span>
            <input className="form-input" type="text" value={sNo} readOnly disabled />
          </label>
          <label className="sale-bill-field detail-mast-screen__field detail-mast-screen__field--code">
            <span className="sale-bill-field__label">A/c Code</span>
            <div className="detail-mast-screen__code-wrap">
              <MasterPartyPickList
                options={accountOptions}
                value={code}
                onChange={setCodeCell}
                disabled={codeDisabled || saving}
                title="Account code"
                placeholder="Code"
                filterPlaceholder="Code or name…"
                showSearchIcon
                panelVariant="dropdown"
                getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
                getLabel={(o) => `${o.value ?? o.CODE ?? ''} — ${o.label ?? o.NAME ?? ''}`}
                getTriggerLabel={(o) => String(o.value ?? o.CODE ?? code ?? '')}
              />
            </div>
          </label>
          <label className="sale-bill-field detail-mast-screen__field detail-mast-screen__field--name">
            <span className="sale-bill-field__label">Name</span>
            <input className="form-input" type="text" value={acName || '—'} readOnly disabled />
          </label>
        </form>

        <div className="detail-mast-screen__grid-head">
          <span className="detail-mast-screen__grid-title">Detail lines</span>
          {mode === 'new' || mode === 'edit' ? (
            <div className="detail-mast-screen__grid-actions">
              <GfasToolbarBtn icon="add" label="Add row" variant="secondary" onClick={handleAddLine} disabled={saving} />
              <GfasToolbarBtn
                icon="delete"
                label="Delete row"
                variant="danger"
                onClick={handleDeleteSelectedLine}
                disabled={saving || lines.length <= 1}
              />
            </div>
          ) : null}
        </div>

        <div className="detail-mast-screen__grid-wrap">
          <table className="detail-mast-grid dane-grid">
            <thead>
              <tr>
                <th className="detail-mast-grid__trn-col">Trn_No</th>
                <th>Detail</th>
                {mode === 'new' || mode === 'edit' ? <th className="dane-grid__act-col">Del</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr
                  key={line._id}
                  className={
                    mode === 'new' || mode === 'edit'
                      ? selectedLineIdx === idx
                        ? 'detail-mast-grid__row is-selected'
                        : 'detail-mast-grid__row'
                      : undefined
                  }
                  onClick={() => {
                    if (mode === 'new' || mode === 'edit') setSelectedLineIdx(idx);
                  }}
                >
                  <td className="detail-mast-grid__trn-cell">
                    <input
                      id={lineCellId(idx, 'TRN_NO')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={line.TRN_NO}
                      disabled={linesDisabled || saving}
                      onFocus={() => setSelectedLineIdx(idx)}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(/\D/g, ''));
                        if (!Number.isFinite(n) || n < 0) return;
                        setLineCell(idx, 'TRN_NO', n || '');
                      }}
                    />
                  </td>
                  <td>
                    <input
                      id={lineCellId(idx, 'DETAIL')}
                      className="form-input dane-grid__input"
                      type="text"
                      maxLength={150}
                      value={line.DETAIL}
                      disabled={linesDisabled || saving}
                      onFocus={() => setSelectedLineIdx(idx)}
                      onChange={(e) => setLineCell(idx, 'DETAIL', e.target.value)}
                      onKeyDown={(e) => handleLineKeyDown(e, idx, 'DETAIL')}
                    />
                  </td>
                  {mode === 'new' || mode === 'edit' ? (
                    <td className="dane-grid__act-cell">
                      <button
                        type="button"
                        className="btn btn-secondary dane-grid__del"
                        disabled={linesDisabled || saving || lines.length <= 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveLine(idx);
                        }}
                        title="Delete row"
                      >
                        ×
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="detail-mast-screen__filters account-master-screen__filters">
          <label className="sale-bill-field account-master-filter account-master-filter--search">
            <span className="sale-bill-field__label">Search</span>
            <input
              className="form-input account-master-search-input"
              type="search"
              value={searchQ}
              placeholder="S_No, A/c, name, detail…"
              onChange={(e) => {
                const v = e.target.value;
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
        </div>

        <div className="detail-mast-screen__list-wrap account-master-screen__list-wrap">
          <table className="account-master-table detail-mast-list-grid">
            <thead>
              <tr>
                <th className="num">S_No</th>
                <th>A/c</th>
                <th>Name</th>
                <th>Detail</th>
                <th className="num">Lines</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="account-master-table__empty">
                    {listLoading ? 'Loading…' : 'No detail records found.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isSel = Number(selectedSNo) === Number(r.S_NO);
                  return (
                    <tr
                      key={r.S_NO}
                      className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                      onClick={() => handleSelectRow(r)}
                      onDoubleClick={async () => {
                        if (!perms?.canEdit) return;
                        setSelectedSNo(r.S_NO);
                        setMode('edit');
                        try {
                          await loadRecordToForm(r.S_NO);
                        } catch (e) {
                          alert(e?.response?.data?.error || e.message || 'Load failed');
                        }
                      }}
                    >
                      <td className="num">{r.S_NO}</td>
                      <td>{r.CODE || '—'}</td>
                      <td>{r.AC_NAME || '—'}</td>
                      <td className="detail-mast-list-grid__detail">{r.DETAIL_PREVIEW || '—'}</td>
                      <td className="num">{r.LINE_CNT || 0}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="detail-mast-screen__hint account-master-screen__hint">
          {rows.length} record{rows.length === 1 ? '' : 's'}
          {listLoading ? ' · loading…' : ''}
          {selectedRow ? ` · selected S_No ${selectedRow.S_NO}` : ''}
          {mode ? ` · ${mode}` : ''}
        </p>
      </div>
    </div>
  );
}
