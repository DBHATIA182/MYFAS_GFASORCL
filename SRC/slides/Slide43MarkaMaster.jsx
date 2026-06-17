import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { downloadExcelRows } from '../utils/excelExport';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapMarkaRow(r) {
  return {
    MARKA: String(r.MARKA ?? r.marka ?? '').trim(),
    MIN_RATE: Number(r.MIN_RATE ?? r.min_rate ?? 0),
    MAX_RATE: Number(r.MAX_RATE ?? r.max_rate ?? 0),
    LAB_RATE: Number(r.LAB_RATE ?? r.lab_rate ?? 0),
  };
}

function formatRate2(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function rateInputVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function parseRateInput(raw) {
  let s = String(raw ?? '').replace(/,/g, '').trim();
  if (s === '' || s === '-') return s;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const dotIdx = s.indexOf('.');
  if (dotIdx >= 0) {
    s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, '');
  }
  if (neg) s = `-${s}`;
  if (!/^-?[\d.]*$/.test(s)) return null;
  const body = neg ? s.slice(1) : s;
  const parts = body.split('.');
  if (parts.length > 2) return null;
  if (parts[0].length > 6) return null;
  if (parts[1] && parts[1].length > 2) return null;
  return s;
}

/** VFP DO FORM MARKA — MARKA, MIN_RATE, MAX_RATE, LAB_RATE (NUMBER 8,2). */
export default function Slide43MarkaMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const formRef = useRef(null);
  const markaInputRef = useRef(null);

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [selectedMarka, setSelectedMarka] = useState('');

  const [mode, setMode] = useState('');
  const [originalMarka, setOriginalMarka] = useState('');
  const [marka, setMarka] = useState('');
  const [minRate, setMinRate] = useState('');
  const [maxRate, setMaxRate] = useState('');
  const [labRate, setLabRate] = useState('');

  const clearForm = useCallback(() => {
    setMarka('');
    setMinRate('');
    setMaxRate('');
    setLabRate('');
    setOriginalMarka('');
  }, []);

  const loadRowToForm = useCallback((row) => {
    if (!row) {
      clearForm();
      return;
    }
    setMarka(row.MARKA || '');
    setMinRate(formatRate2(row.MIN_RATE));
    setMaxRate(formatRate2(row.MAX_RATE));
    setLabRate(formatRate2(row.LAB_RATE));
    setOriginalMarka(row.MARKA || '');
  }, [clearForm]);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/marka-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapMarkaRow) : []);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/marka-user-permissions'), {
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
    () => rows.find((r) => String(r.MARKA) === String(selectedMarka)) || null,
    [rows, selectedMarka]
  );

  const formDisabled = mode === '' || mode === 'del';
  const markaDisabled = formDisabled || mode === 'edit';
  const ratesDisabled = formDisabled || mode === 'del';

  const handleSelectRow = (row) => {
    if (mode === 'new' || mode === 'edit') return;
    const key = String(row.MARKA);
    setSelectedMarka(key);
    setMode('');
    loadRowToForm(row);
  };

  const handleNew = () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    setMode('new');
    setSelectedMarka('');
    clearForm();
    setTimeout(() => markaInputRef.current?.focus(), 50);
  };

  const handleEdit = () => {
    if (!selectedRow) {
      alert('Select a marka from the list first.');
      return;
    }
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setMode('edit');
    loadRowToForm(selectedRow);
    setOriginalMarka(selectedRow.MARKA);
  };

  const handleDeleteMode = () => {
    if (!selectedRow) {
      alert('Select a marka from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    setMode('del');
    loadRowToForm(selectedRow);
  };

  const handleCancelMode = () => {
    setMode('');
    if (selectedRow) loadRowToForm(selectedRow);
    else clearForm();
  };

  const blurRate = (setter, raw) => {
    if (raw === '' || raw == null) {
      setter('');
      return;
    }
    setter(formatRate2(raw));
  };

  const handleSave = async () => {
    const name = String(marka ?? '').trim();
    if (!name) {
      alert('Marka is required.');
      markaInputRef.current?.focus();
      return;
    }

    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      marka: name,
      min_rate: minRate === '' ? 0 : Number(minRate),
      max_rate: maxRate === '' ? 0 : Number(maxRate),
      lab_rate: labRate === '' ? 0 : Number(labRate),
    };

    try {
      if (mode === 'del') {
        if (!window.confirm(`Delete marka "${name}"?`)) {
          setSaving(false);
          return;
        }
        await axios.delete(apiUrl(apiBase, '/api/marka'), { data: payload, ...reqOpts });
        alert('Deleted successfully.');
        setMode('');
        setSelectedMarka('');
        clearForm();
        refreshList();
        return;
      }

      if (mode === 'new') {
        if (!perms?.canAdd) {
          alert('You Can Not Add');
          return;
        }
        await axios.post(apiUrl(apiBase, '/api/marka'), payload, reqOpts);
        alert('Saved successfully.');
        setSelectedMarka(name);
      } else if (mode === 'edit') {
        if (!perms?.canEdit) {
          alert('You Can Not Edit');
          return;
        }
        await axios.put(apiUrl(apiBase, '/api/marka'), {
          ...payload,
          original_marka: originalMarka || name,
        }, reqOpts);
        alert('Saved successfully.');
        setSelectedMarka(name);
      } else {
        alert('Click New, Edit, or Delete first.');
        return;
      }

      setMode('');
      refreshList();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleFormEnter = (e) => {
    focusNextOnEnter(e, formRef, { submitOnLast: false });
  };

  const handleList = () => {
    setSearchQ('');
    setSelectedMarka('');
    setMode('');
    clearForm();
    executeSearch('', { immediate: true });
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const q = String(searchQ).trim();
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'Marka Master',
      period: q ? `Search: ${q}` : 'All marka',
      endDate: q ? `Search: ${q}` : 'All marka',
    };
  };

  const buildPdfRows = () =>
    rows.map((r) => ({
      MARKA: r.MARKA || '',
      MIN_RATE: formatRate2(r.MIN_RATE),
      MAX_RATE: formatRate2(r.MAX_RATE),
      LAB_RATE: formatRate2(r.LAB_RATE),
    }));

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const exportRows = rows.map((r) => ({
      MARKA: r.MARKA || '',
      'MIN.RATE': formatRate2(r.MIN_RATE),
      'MAX.RATE': formatRate2(r.MAX_RATE),
      'LAB.RATE': formatRate2(r.LAB_RATE),
    }));
    downloadExcelRows(exportRows, 'Marka', `${compName}_MarkaMaster`);
  };

  const handlePdf = async () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('marka-master', buildPdfRows(), buildPdfMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleWhatsApp = async () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const shareText = [compName, 'Marka Master', `Rows: ${rows.length}`].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('marka-master', buildPdfRows(), buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div className="slide slide-43-marka marka-screen marka-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Marka Master</h2>
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
      <div className="slide slide-43-marka marka-screen">
        <h2 className="sale-bill-page__title">Marka Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-43-marka marka-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome marka-screen__chrome">
        <div className="account-master-screen__head marka-screen__head">
          <div className="marka-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Marka Master</h2>
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
              <GfasToolbarBtn
                icon="add"
                label="New"
                variant="secondary"
                onClick={handleNew}
                disabled={saving || mode !== ''}
              />
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
            helpReportId="marka-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="marka-screen__session-line"
          />
        </div>
      </div>

      <div className="marka-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err marka-screen__err">{err}</p> : null}
        {mode === 'del' ? (
          <p className="marka-screen__mode-hint">Delete mode — press Save to confirm deletion.</p>
        ) : null}
        <form
          ref={formRef}
          className="marka-screen__form"
          onKeyDownCapture={handleFormEnter}
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="sale-bill-field marka-screen__field marka-screen__field--marka">
            <span className="sale-bill-field__label">Marka</span>
            <span className="marka-screen__marka-row">
              <input
                ref={markaInputRef}
                className="form-input marka-screen__input"
                type="text"
                maxLength={30}
                value={marka}
                disabled={markaDisabled || saving}
                onChange={(e) => setMarka(e.target.value)}
              />
              <GfasToolbarBtn
                icon="list"
                iconOnly
                title="Find in list"
                variant="secondary"
                className="marka-screen__find-btn"
                disabled={saving}
                onClick={() => executeSearch(marka || searchQ, { immediate: true })}
              />
            </span>
          </label>
          <label className="sale-bill-field marka-screen__field">
            <span className="sale-bill-field__label">Min.Rate</span>
            <input
              className="form-input marka-screen__input marka-screen__input--num"
              type="text"
              inputMode="decimal"
              value={rateInputVal(minRate)}
              disabled={ratesDisabled || saving}
              onChange={(e) => {
                const p = parseRateInput(e.target.value);
                if (p !== null) setMinRate(p);
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => blurRate(setMinRate, minRate)}
              placeholder="0.00"
            />
          </label>
          <label className="sale-bill-field marka-screen__field">
            <span className="sale-bill-field__label">Max Rate</span>
            <input
              className="form-input marka-screen__input marka-screen__input--num"
              type="text"
              inputMode="decimal"
              value={rateInputVal(maxRate)}
              disabled={ratesDisabled || saving}
              onChange={(e) => {
                const p = parseRateInput(e.target.value);
                if (p !== null) setMaxRate(p);
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => blurRate(setMaxRate, maxRate)}
              placeholder="0.00"
            />
          </label>
          <label className="sale-bill-field marka-screen__field">
            <span className="sale-bill-field__label">Labour Rate</span>
            <input
              className="form-input marka-screen__input marka-screen__input--num"
              type="text"
              inputMode="decimal"
              value={rateInputVal(labRate)}
              disabled={ratesDisabled || saving}
              onChange={(e) => {
                const p = parseRateInput(e.target.value);
                if (p !== null) setLabRate(p);
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => blurRate(setLabRate, labRate)}
              placeholder="0.00"
            />
          </label>
        </form>

        <div className="marka-screen__filters account-master-screen__filters">
          <label className="sale-bill-field account-master-filter account-master-filter--search">
            <span className="sale-bill-field__label">Search</span>
            <input
              className="form-input account-master-search-input"
              type="search"
              value={searchQ}
              placeholder="Marka name…"
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

        <div className="marka-screen__grid-wrap account-master-screen__list-wrap">
          <table className="account-master-table marka-grid">
            <thead>
              <tr>
                <th>Marka</th>
                <th className="num">Min.Rate</th>
                <th className="num">Max.Rate</th>
                <th className="num">Lab.Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="account-master-table__empty">
                    {listLoading ? 'Loading…' : 'No marka found.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const key = String(r.MARKA);
                  const isSel = String(selectedMarka) === key;
                  return (
                    <tr
                      key={key}
                      className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                      onClick={() => handleSelectRow(r)}
                      onDoubleClick={() => {
                        if (!perms?.canEdit) return;
                        setSelectedMarka(key);
                        setMode('edit');
                        loadRowToForm(r);
                        setOriginalMarka(r.MARKA);
                      }}
                    >
                      <td>{r.MARKA}</td>
                      <td className="num">{formatRate2(r.MIN_RATE)}</td>
                      <td className="num">{formatRate2(r.MAX_RATE)}</td>
                      <td className="num">{formatRate2(r.LAB_RATE)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="marka-screen__hint account-master-screen__hint">
          {rows.length} row{rows.length === 1 ? '' : 's'}
          {listLoading ? ' · loading…' : ''}
          {selectedRow ? ` · selected: ${selectedRow.MARKA}` : ''}
          {mode ? ` · ${mode}` : ''}
        </p>
      </div>
    </div>
  );
}
