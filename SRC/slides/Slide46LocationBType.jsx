import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { downloadExcelRows } from '../utils/excelExport';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const GRID_FIELDS = ['B_TYPE', 'BILL_INIT', 'FIN_YEAR'];

function emptyRow() {
  return {
    B_TYPE: '',
    BILL_INIT: '',
    FIN_YEAR: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function mapRowFromApi(r) {
  return {
    _id: `${r.B_TYPE}-${Math.random()}`,
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 1),
    BILL_INIT: String(r.BILL_INIT ?? r.bill_init ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 6),
    FIN_YEAR: String(r.FIN_YEAR ?? r.fin_year ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 1),
  };
}

function cellId(rowIdx, field) {
  return `locbtype-${rowIdx}-${field}`;
}

function focusCell(rowIdx, field) {
  const el = document.getElementById(cellId(rowIdx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO LOC_B_TYPE — LOC_B_TYPE: B_TYPE, BILL_INIT, FIN_YEAR. */
export default function Slide46LocationBType({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([emptyRow()]);

  const canEditRows = Boolean(perms?.canEdit || perms?.canAdd);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/loc-b-type'), {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    const list = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
    const mapped = list.map(mapRowFromApi);
    setRows(mapped.length ? mapped : [emptyRow()]);
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/loc-b-type-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data);
        if (data?.canOpen) await loadRows();
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName, compCode, loadRows]);

  const setCell = (idx, key, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleGridKeyDown = (e, rowIdx, field) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const col = GRID_FIELDS.indexOf(field);
    if (col < 0) return;
    const nextField = GRID_FIELDS[col + 1];
    if (nextField) {
      setTimeout(() => focusCell(rowIdx, nextField), 0);
      return;
    }
    if (rowIdx < rows.length - 1) {
      setTimeout(() => focusCell(rowIdx + 1, 'B_TYPE'), 10);
      return;
    }
    const newRowIdx = rowIdx + 1;
    handleAddRow();
    setTimeout(() => focusCell(newRowIdx, 'B_TYPE'), 50);
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const handleRemoveRow = (idx) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyRow()];
    });
  };

  const handleSave = async () => {
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const payload = {
        comp_code: compCode,
        comp_uid: compUid,
        comp_year: compYear,
        user_name: userName,
        actor_name: userName,
        rows: rows.map(({ _id, ...r }) => r),
      };
      const { data } = await axios.put(apiUrl(apiBase, '/api/loc-b-type'), payload, reqOpts);
      alert(data?.message || 'DONE');
      const saved = Array.isArray(data?.rows) ? data.rows.map(mapRowFromApi) : [];
      setRows(saved.length ? saved : [emptyRow()]);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const buildExportRows = () =>
    rows
      .filter((r) => String(r.B_TYPE).trim())
      .map((r) => ({
        'B TYPE': r.B_TYPE,
        'BILL INIT': r.BILL_INIT,
        'FIN YEAR': r.FIN_YEAR,
      }));

  const buildPdfMeta = () => ({
    companyName: compName || 'Company',
    year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
    reportTitle: 'Location Wise BType',
    period: `${rows.filter((r) => r.B_TYPE).length} row(s)`,
    endDate: `${rows.filter((r) => r.B_TYPE).length} row(s)`,
  });

  const handleExcel = () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) {
      alert('No rows to export.');
      return;
    }
    downloadExcelRows(exportRows, 'LocBType', `${compName || 'Company'}_LocationWiseBType`);
  };

  const handlePdf = async () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('loc-btype-master', exportRows, buildPdfMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleWhatsApp = async () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) {
      alert('No rows to share.');
      return;
    }
    const shareText = [compName || 'Company', 'Location Wise BType'].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('loc-btype-master', exportRows, buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const formDisabled = saving || !canEditRows;

  if (loading) {
    return (
      <div className="slide slide-46-loc-btype loc-btype-screen loc-btype-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Location Wise BType</h2>
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
      <div className="slide slide-46-loc-btype loc-btype-screen">
        <h2 className="sale-bill-page__title">Location Wise BType</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-46-loc-btype loc-btype-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome loc-btype-screen__chrome">
        <div className="account-master-screen__head loc-btype-screen__head">
          <div className="loc-btype-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Location Wise BType</h2>
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={loadRows}
              onList={loadRows}
              onExcel={handleExcel}
              onPdf={handlePdf}
              onWhatsApp={handleWhatsApp}
              perms={perms}
              listLoading={saving}
              hasRows={rows.some((r) => String(r.B_TYPE).trim())}
            >
              {canEditRows ? (
                <>
                  <GfasToolbarBtn
                    icon="add"
                    label="Add row"
                    variant="secondary"
                    onClick={handleAddRow}
                    disabled={saving}
                  />
                  <GfasToolbarBtn
                    label={saving ? 'Saving…' : 'Save'}
                    variant="primary"
                    onClick={handleSave}
                    disabled={saving}
                  />
                </>
              ) : null}
            </MasterScreenToolbar>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="loc-btype-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="loc-btype-screen__session-line"
          />
        </div>
      </div>

      <div className="loc-btype-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err loc-btype-screen__err">{err}</p> : null}

        <p className="loc-btype-screen__hint">
          B_Type (1 char), Bill_Init (6 chars), Fin_Year (1 char). Save replaces all rows for this company (VFP: DO
          LOC_B_TYPE).
        </p>

        <div className="loc-btype-screen__row-actions">
          {canEditRows ? (
            <>
              <GfasToolbarBtn icon="add" label="Add row" variant="secondary" onClick={handleAddRow} disabled={saving} />
              <GfasToolbarBtn
                label={saving ? 'Saving…' : 'Save'}
                variant="primary"
                onClick={handleSave}
                disabled={saving}
              />
            </>
          ) : null}
        </div>

        <div className="loc-btype-screen__grid-wrap">
          <table className="loc-btype-grid dane-grid">
            <thead>
              <tr>
                <th className="loc-btype-grid__btype-col">B_Type</th>
                <th>Bill_Init</th>
                <th className="loc-btype-grid__fin-col">Fin_Year</th>
                <th className="dane-grid__act-col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row._id}>
                  <td className="dane-grid__code-cell">
                    <input
                      id={cellId(idx, 'B_TYPE')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      maxLength={1}
                      value={row.B_TYPE}
                      disabled={formDisabled}
                      onChange={(e) =>
                        setCell(idx, 'B_TYPE', e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 1))
                      }
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'B_TYPE')}
                    />
                  </td>
                  <td>
                    <input
                      id={cellId(idx, 'BILL_INIT')}
                      className="form-input dane-grid__input"
                      type="text"
                      maxLength={6}
                      value={row.BILL_INIT}
                      disabled={formDisabled}
                      onChange={(e) =>
                        setCell(idx, 'BILL_INIT', e.target.value.toUpperCase().slice(0, 6))
                      }
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'BILL_INIT')}
                    />
                  </td>
                  <td className="loc-btype-grid__fin-cell">
                    <input
                      id={cellId(idx, 'FIN_YEAR')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      maxLength={1}
                      value={row.FIN_YEAR}
                      disabled={formDisabled}
                      onChange={(e) =>
                        setCell(idx, 'FIN_YEAR', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1))
                      }
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'FIN_YEAR')}
                    />
                  </td>
                  <td className="dane-grid__act-cell">
                    <button
                      type="button"
                      className="btn btn-secondary dane-grid__del"
                      disabled={formDisabled || rows.length <= 1}
                      onClick={() => handleRemoveRow(idx)}
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
