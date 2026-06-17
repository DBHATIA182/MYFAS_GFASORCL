import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import CatMastFormModal from '../components/CatMastFormModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapCatRow(r) {
  return {
    CAT_CODE: String(r.CAT_CODE ?? r.cat_code ?? '').trim(),
    CAT_NAME: r.CAT_NAME ?? r.cat_name ?? '',
  };
}

export default function Slide30CatMastMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/cat-mast-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapCatRow) : []);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/cat-mast-user-permissions'), {
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
    () => rows.find((r) => String(r.CAT_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a category from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.CAT_CODE;
    const label = `[${code}] ${selectedRow.CAT_NAME || ''}`;
    if (!window.confirm(`Delete category ${label}?`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(apiUrl(apiBase, '/api/cat-mast'), {
        data: { comp_code: compCode, comp_uid: compUid, user_name: userName, cat_code: code },
        ...reqOpts,
      });
      setSelectedCode('');
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
    setSelectedCode('');
    executeSearch('', { immediate: true });
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const q = String(searchQ).trim();
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'Item Category Master',
      period: q ? `Search: ${q}` : 'All categories',
      endDate: q ? `Search: ${q}` : 'All categories',
    };
  };

  const buildPdfRows = () =>
    rows.map((r) => ({
      CAT_CODE: r.CAT_CODE || '',
      CAT_NAME: r.CAT_NAME || '',
    }));

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const exportRows = rows.map((r) => ({
      CATEGORY: r.CAT_CODE,
      NAME: r.CAT_NAME || '',
    }));
    downloadExcelRows(exportRows, 'ItemCategories', `${compName}_ItemCategoryMaster`);
  };

  const handlePdf = async () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('cat-mast', buildPdfRows(), buildPdfMeta());
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
    const shareText = [compName, 'Item Category Master', `Rows: ${rows.length}`].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('cat-mast', buildPdfRows(), buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div className="slide slide-30-cat-mast slide-30-cat-mast--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Item Category Master</h2>
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
      <div className="slide slide-30-cat-mast">
        <h2 className="sale-bill-page__title">Item Category Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-30-cat-mast account-master-screen item-master-screen cat-mast-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">Item Category Master</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="item-master" />
          <p className="item-master-screen__tip">
            CATMAST — enter category code (used as Item Group in Item Master).
          </p>
          <MasterScreenToolbar
            onPrev={onPrev}
            onReset={onReset}
            onRefresh={refreshList}
            onList={handleList}
            onExcel={handleExcel}
            onPdf={handlePdf}
            onWhatsApp={handleWhatsApp}
            perms={perms}
            onAdd={() => setAddOpen(true)}
            onEdit={() => selectedRow && setEditRow(selectedRow)}
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

      <div className="account-master-screen__filters">
        <label className="sale-bill-field account-master-filter account-master-filter--search">
          <span className="sale-bill-field__label">Search</span>
          <input
            className="form-input account-master-search-input"
            type="search"
            value={searchQ}
            placeholder="Category code or name (e.g. MASOOR)…"
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

      <div className="account-master-screen__list-wrap">
        <table className="account-master-table cat-mast-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No categories found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const codeKey = String(r.CAT_CODE);
                const isSel = String(selectedCode) === codeKey;
                return (
                  <tr
                    key={codeKey}
                    className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                    onClick={() => setSelectedCode(codeKey)}
                    onDoubleClick={() => {
                      if (perms?.canEdit) setEditRow(r);
                    }}
                  >
                    <td>{r.CAT_CODE}</td>
                    <td>{r.CAT_NAME}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="account-master-screen__hint">
        {rows.length} row{rows.length === 1 ? '' : 's'}
        {listLoading ? ' · searching…' : ''}
        {selectedRow ? ` · selected [${selectedRow.CAT_CODE}]` : ''}
        {' · double-click to edit'}
      </p>

      <CatMastFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onCreated={(saved) => {
          setAddOpen(false);
          if (saved?.cat_code) setSelectedCode(String(saved.cat_code));
          refreshList();
        }}
      />

      <CatMastFormModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        editRow={editRow}
        onUpdated={(saved) => {
          setEditRow(null);
          if (saved?.cat_code) setSelectedCode(String(saved.cat_code));
          refreshList();
        }}
      />
    </div>
  );
}
