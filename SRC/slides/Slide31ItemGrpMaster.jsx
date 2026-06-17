import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ItemGrpFormModal from '../components/ItemGrpFormModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapGrpRow(r) {
  return {
    GRP_CODE: String(r.GRP_CODE ?? r.grp_code ?? '').trim(),
    GRP_NAME: r.GRP_NAME ?? r.grp_name ?? '',
  };
}

/** VFP DO FORM CAT → Oracle ITEM_GRP (Category on Item Master). */
export default function Slide31ItemGrpMaster({ apiBase, formData, userName, onPrev, onReset }) {
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/item-grp-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapGrpRow) : []);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/item-grp-user-permissions'), {
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
    () => rows.find((r) => String(r.GRP_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a group from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.GRP_CODE;
    const label = `[${code}] ${selectedRow.GRP_NAME || ''}`;
    if (!window.confirm(`Delete item group ${label}?`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(apiUrl(apiBase, '/api/item-grp'), {
        data: { comp_code: compCode, comp_uid: compUid, user_name: userName, grp_code: code },
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
      reportTitle: 'Item Group Master',
      period: q ? `Search: ${q}` : 'All groups',
      endDate: q ? `Search: ${q}` : 'All groups',
    };
  };

  const buildPdfRows = () =>
    rows.map((r) => ({
      GRP_CODE: r.GRP_CODE || '',
      GRP_NAME: r.GRP_NAME || '',
    }));

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const exportRows = rows.map((r) => ({
      GROUP: r.GRP_CODE,
      NAME: r.GRP_NAME || '',
    }));
    downloadExcelRows(exportRows, 'ItemGroups', `${compName}_ItemGroupMaster`);
  };

  const handlePdf = async () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('item-grp', buildPdfRows(), buildPdfMeta());
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
    const shareText = [compName, 'Item Group Master', `Rows: ${rows.length}`].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('item-grp', buildPdfRows(), buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div className="slide slide-31-item-grp slide-31-item-grp--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Item Group Master</h2>
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
      <div className="slide slide-31-item-grp">
        <h2 className="sale-bill-page__title">Item Group Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-31-item-grp account-master-screen item-master-screen item-grp-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">Item Group Master</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="item-master" />
          <p className="item-master-screen__tip">
            VFP CAT.scx → ITEM_GRP. Used as Category on Item Master (GRP_CODE / GRP_NAME).
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
            placeholder="Group code or name…"
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
        <table className="account-master-table item-grp-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No groups found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const codeKey = String(r.GRP_CODE);
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
                    <td>{r.GRP_CODE}</td>
                    <td>{r.GRP_NAME}</td>
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
        {selectedRow ? ` · selected [${selectedRow.GRP_CODE}]` : ''}
        {' · double-click to edit'}
      </p>

      <ItemGrpFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onCreated={(saved) => {
          setAddOpen(false);
          if (saved?.grp_code) setSelectedCode(String(saved.grp_code));
          refreshList();
        }}
      />

      <ItemGrpFormModal
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
          if (saved?.grp_code) setSelectedCode(String(saved.grp_code));
          refreshList();
        }}
      />
    </div>
  );
}
