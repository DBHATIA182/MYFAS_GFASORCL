import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ItemMasterFormModal from '../components/ItemMasterFormModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function normalizeCode(v) {
  const s = String(v ?? '').trim();
  return s === '0' ? '' : s;
}

function mapItemRow(r) {
  return {
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    ITEM_NAME: r.ITEM_NAME ?? r.item_name,
    CAT: r.CAT ?? r.cat,
    GRP_CODE: r.GRP_CODE ?? r.grp_code,
    CAT_CODE: r.CAT_CODE ?? r.cat_code,
    CAT_NAME: r.CAT_NAME ?? r.cat_name,
    HSN_CODE: r.HSN_CODE ?? r.hsn_code,
    HSN_NAME: r.HSN_NAME ?? r.hsn_name,
    HSN_UNIT: r.HSN_UNIT ?? r.hsn_unit,
    TAX_PER: r.TAX_PER ?? r.tax_per,
    S_CODE: normalizeCode(r.S_CODE ?? r.s_code),
    P_CODE: normalizeCode(r.P_CODE ?? r.p_code),
    SAP_CODE_R1: r.SAP_CODE_R1 ?? r.sap_code_r1,
    SAP_CODE_R2: r.SAP_CODE_R2 ?? r.sap_code_r2,
    BARD_ITEM_CODE: r.BARD_ITEM_CODE ?? r.bard_item_code,
    BARD_OP_STOCK: r.BARD_OP_STOCK ?? r.bard_op_stock,
    BARD_OP_RATE: r.BARD_OP_RATE ?? r.bard_op_rate,
    BARD_OP_VALUE: r.BARD_OP_VALUE ?? r.bard_op_value,
    U_ITEM_CODE: r.U_ITEM_CODE ?? r.u_item_code,
    TDG_Q_W: r.TDG_Q_W ?? r.tdg_q_w,
    UNIT_TYPE: r.UNIT_TYPE ?? r.unit_type,
    ITEM_HEAD: r.ITEM_HEAD ?? r.item_head,
    COMMISSION: r.COMMISSION ?? r.commission,
    BROKERAGE: r.BROKERAGE ?? r.brokerage,
    BROK_CAL: r.BROK_CAL ?? r.brok_cal,
    SALE_RATE: r.SALE_RATE ?? r.sale_rate,
    PACKING: r.PACKING ?? r.packing,
    UNIT: r.UNIT ?? r.unit,
    AMT_CAL: r.AMT_CAL ?? r.amt_cal,
  };
}

export default function Slide27ItemMaster({ apiBase, formData, userName, onPrev, onReset }) {
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
        const { data } = await axios.get(`${apiBase}/api/item-master-list`, { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapItemRow) : []);
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
        const { data } = await axios.get(`${apiBase}/api/item-master-user-permissions`, {
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
    () => rows.find((r) => String(r.ITEM_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select an item from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.ITEM_CODE;
    const label = `[${code}] ${selectedRow.ITEM_NAME || ''}`;
    if (!window.confirm(`Delete item ${label} from ITEMMAST?\n\nBlocked if stock entries exist (except opening).`)) {
      return;
    }
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(`${apiBase}/api/item-master`, {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          item_code: code,
        },
        ...reqOpts,
      });
      setSelectedCode('');
      refreshList();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = () => refreshList();

  const handleList = () => {
    setSearchQ('');
    setSelectedCode('');
    executeSearch('', { immediate: true });
  };

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const exportRows = rows.map((r) => ({
      ITEM_CODE: r.ITEM_CODE || '',
      ITEM_NAME: r.ITEM_NAME || '',
      CATEGORY: r.CAT || '',
      ITEM_GROUP_CODE: r.CAT_CODE || '',
      ITEM_GROUP_NAME: r.CAT_NAME || '',
      HSN_CODE: r.HSN_CODE || '',
      GST_PER: Number(r.TAX_PER) || 0,
      SALE_CODE: r.S_CODE || '',
      PURCHASE_CODE: r.P_CODE || '',
      AMT_CAL: r.AMT_CAL || '',
    }));
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    downloadExcelRows(exportRows, 'ItemMaster', `${compName}_ItemMaster`);
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const q = String(searchQ).trim();
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'Item Master List',
      period: q ? `Search: ${q}` : 'All items',
      endDate: q ? `Search: ${q}` : 'All items',
    };
  };

  const buildPdfRows = () =>
    rows.map((r) => ({
      ITEM_CODE: r.ITEM_CODE || '',
      ITEM_NAME: r.ITEM_NAME || '',
      CAT: r.CAT || '',
      CAT_CODE: r.CAT_CODE || '',
      HSN_CODE: r.HSN_CODE || '',
      TAX_PER: r.TAX_PER ?? '',
      S_CODE: r.S_CODE || '',
      P_CODE: r.P_CODE || '',
      AMT_CAL: r.AMT_CAL || '',
    }));

  const handlePdf = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    generatePDF('item-master', buildPdfRows(), buildPdfMeta()).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const shareText = [compName, 'Item Master List', `Rows: ${rows.length}`].join('\n');
    sharePdfWithWhatsApp('item-master', buildPdfRows(), buildPdfMeta(), shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  if (loading) {
    return (
      <div className="slide slide-27-item-master slide-27-item-master--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Item Master</h2>
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
      <div className="slide slide-27-item-master">
        <h2 className="sale-bill-page__title">Item Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-27-item-master account-master-screen item-master-screen">
      <div className="account-master-screen__chrome">
      <div className="account-master-screen__head">
        <div className="account-master-screen__title-row">
          <h2 className="sale-bill-page__title">Item Master</h2>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="item-master" />
        <MasterScreenToolbar
          onPrev={onPrev}
          onReset={onReset}
          onRefresh={handleRefresh}
          onList={handleList}
          onExcel={handleExcel}
          onPdf={handlePdf}
          onWhatsApp={handleWhatsApp}
          perms={perms}
          onAdd={() => setAddOpen(true)}
          onEdit={() => setEditRow(selectedRow)}
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
            placeholder="Item code or name (e.g. DAL ARHAR)…"
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

      <div className="account-master-screen__list-wrap item-master-screen__list-wrap">
        <table className="account-master-table item-master-table">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Item name</th>
              <th>Cat</th>
              <th>Cat code</th>
              <th>HSN</th>
              <th>GST %</th>
              <th>S code</th>
              <th>P code</th>
              <th>AmtCal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No items found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const code = String(r.ITEM_CODE);
                const isSel = selectedCode === code;
                return (
                  <tr
                    key={code}
                    className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                    onClick={() => setSelectedCode(code)}
                    onDoubleClick={() => {
                      if (perms?.canEdit) setEditRow(r);
                    }}
                  >
                    <td>{r.ITEM_CODE}</td>
                    <td>{r.ITEM_NAME}</td>
                    <td>{r.CAT}</td>
                    <td title={r.CAT_NAME}>{r.CAT_CODE}</td>
                    <td>{r.HSN_CODE}</td>
                    <td>{r.TAX_PER}</td>
                    <td>{r.S_CODE}</td>
                    <td>{r.P_CODE}</td>
                    <td>{r.AMT_CAL}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="account-master-screen__hint item-master-screen__hint">
        <span className="item-master-screen__count">
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </span>
        {selectedRow ? (
          <span className="item-master-screen__selection">
            Selected: <strong>[{selectedRow.ITEM_CODE}]</strong> {selectedRow.ITEM_NAME || ''}
          </span>
        ) : null}
        {perms?.canEdit ? <span className="item-master-screen__tip">Double-click a row to edit</span> : null}
      </p>

      <ItemMasterFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onCreated={() => {
          setAddOpen(false);
          refreshList();
        }}
      />

      <ItemMasterFormModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        editRow={editRow}
        onUpdated={() => {
          setEditRow(null);
          refreshList();
        }}
      />
    </div>
  );
}
