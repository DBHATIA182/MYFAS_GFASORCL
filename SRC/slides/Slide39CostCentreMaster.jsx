import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import CostMastFormModal from '../components/CostMastFormModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapCostRow(r) {
  return {
    COST_CODE: String(r.COST_CODE ?? r.cost_code ?? '').trim(),
    COST_NAME: r.COST_NAME ?? r.cost_name ?? '',
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    AC_NAME: r.AC_NAME ?? r.ac_name ?? '',
  };
}

export default function Slide39CostCentreMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/cost-mast-list'), { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapCostRow) : []);
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/cost-mast-user-permissions'), {
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

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.COST_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a cost centre from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.COST_CODE;
    const label = `[${code}] ${selectedRow.COST_NAME || ''}`;
    if (!window.confirm(`Delete cost centre ${label}?`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(apiUrl(apiBase, '/api/cost-mast'), {
        data: { comp_code: compCode, comp_uid: compUid, user_name: userName, cost_code: code },
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
      reportTitle: 'Cost Centre Master',
      period: q ? `Search: ${q}` : 'All cost centres',
      endDate: q ? `Search: ${q}` : 'All cost centres',
    };
  };

  const buildPdfRows = () =>
    rows.map((r) => ({
      COST_CODE: r.COST_CODE || '',
      COST_NAME: r.COST_NAME || '',
      CODE: r.CODE || '',
      AC_NAME: r.AC_NAME || '',
    }));

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const exportRows = rows.map((r) => ({
      'COST CODE': r.COST_CODE,
      'COST NAME': r.COST_NAME || '',
      'A/C CODE': r.CODE || '',
      'A/C NAME': r.AC_NAME || '',
    }));
    downloadExcelRows(exportRows, 'CostCentres', `${compName}_CostCentreMaster`);
  };

  const handlePdf = async () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('cost-mast', buildPdfRows(), buildPdfMeta());
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
    const shareText = [compName, 'Cost Centre Master', `Rows: ${rows.length}`].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('cost-mast', buildPdfRows(), buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div className="slide slide-39-cost-mast slide-39-cost-mast--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Cost Centre Master</h2>
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
      <div className="slide slide-39-cost-mast">
        <h2 className="sale-bill-page__title">Cost Centre Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  return (
    <div className="slide slide-39-cost-mast account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome cost-mast-screen__chrome">
        <div className="account-master-screen__head cost-mast-screen__head">
          <div className="cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Cost Centre Master</h2>
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
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="item-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="cost-mast-screen__session-line"
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
            placeholder="Cost code, name, or account…"
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
        <table className="account-master-table cost-mast-table">
          <thead>
            <tr>
              <th>Cost code</th>
              <th>Name</th>
              <th>A/c code</th>
              <th>A/c name</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No cost centres found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const codeKey = String(r.COST_CODE);
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
                    <td>{r.COST_CODE}</td>
                    <td>{r.COST_NAME}</td>
                    <td>{r.CODE || '—'}</td>
                    <td>{r.AC_NAME || '—'}</td>
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
        {selectedRow ? ` · selected [${selectedRow.COST_CODE}]` : ''}
        {' · double-click to edit'}
      </p>

      <CostMastFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        accountOptions={accountOptions}
        onCreated={(saved) => {
          setAddOpen(false);
          if (saved?.cost_code) setSelectedCode(String(saved.cost_code));
          refreshList();
        }}
      />

      <CostMastFormModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        accountOptions={accountOptions}
        editRow={editRow}
        onUpdated={(saved) => {
          setEditRow(null);
          if (saved?.cost_code) setSelectedCode(String(saved.cost_code));
          refreshList();
        }}
      />
    </div>
  );
}
