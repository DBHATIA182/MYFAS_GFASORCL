import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { downloadExcelRows } from '../utils/excelExport';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const GRID_FIELDS = ['STATE_CODE', 'STATE'];

function emptyRow() {
  return {
    STATE_CODE: '',
    STATE: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function mapRowFromApi(r) {
  return {
    _id: `${r.STATE_CODE ?? r.state_code ?? ''}-${Math.random()}`,
    STATE_CODE: String(r.STATE_CODE ?? r.state_code ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 2),
    STATE: String(r.STATE ?? r.state ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 30),
  };
}

function cellId(rowIdx, field) {
  return `gststate-${rowIdx}-${field}`;
}

function focusCell(rowIdx, field) {
  const el = document.getElementById(cellId(rowIdx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO GST_STATE — GST_STATE: STATE_CODE, STATE; browse grid, save replaces all rows. */
export default function Slide48GstStateMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([emptyRow()]);
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);

  const canEditRows = Boolean(perms?.canEdit || perms?.canAdd);
  const formDisabled = saving || !canEditRows;

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/gst-state'), {
      params: { comp_uid: compUid },
      ...reqOpts,
    });
    const list = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
    const mapped = list.map(mapRowFromApi);
    setRows(mapped.length ? mapped : [emptyRow()]);
    setSelectedRowIdx(0);
  }, [apiBase, compUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/gst-state-user-permissions'), {
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
  }, [apiBase, compUid, userName, loadRows]);

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
      setTimeout(() => focusCell(rowIdx + 1, 'STATE_CODE'), 10);
      return;
    }
    const newRowIdx = rowIdx + 1;
    handleAddRow();
    setTimeout(() => focusCell(newRowIdx, 'STATE_CODE'), 50);
  };

  const handleAddRow = () => {
    setRows((prev) => {
      const next = [...prev, emptyRow()];
      setSelectedRowIdx(next.length - 1);
      return next;
    });
  };

  const handleRemoveRow = (idx) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const kept = next.length ? next : [emptyRow()];
      setSelectedRowIdx((sel) => {
        if (sel === idx) return Math.max(0, Math.min(idx, kept.length - 1));
        if (sel > idx) return sel - 1;
        return sel;
      });
      return kept;
    });
  };

  const handleDeleteSelectedRow = () => {
    if (formDisabled) return;
    if (rows.length <= 1) {
      alert('At least one row is required in the grid.');
      return;
    }
    handleRemoveRow(selectedRowIdx);
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
        comp_uid: compUid,
        user_name: userName,
        actor_name: userName,
        rows: rows.map(({ _id, ...r }) => r),
      };
      const { data } = await axios.put(apiUrl(apiBase, '/api/gst-state'), payload, reqOpts);
      alert(data?.message || 'DONE');
      const saved = Array.isArray(data?.rows) ? data.rows.map(mapRowFromApi) : [];
      setRows(saved.length ? saved : [emptyRow()]);
      setSelectedRowIdx(0);
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
      .filter((r) => String(r.STATE_CODE).trim())
      .map((r) => ({
        'STATE CODE': r.STATE_CODE,
        STATE: r.STATE,
      }));

  const buildPdfMeta = () => ({
    companyName: compName || 'Company',
    year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
    reportTitle: 'GST State Master',
    period: `${rows.filter((r) => r.STATE_CODE).length} state(s)`,
    endDate: `${rows.filter((r) => r.STATE_CODE).length} state(s)`,
  });

  const handleExcel = () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) {
      alert('No rows to export.');
      return;
    }
    downloadExcelRows(exportRows, 'GstState', `${compName || 'Company'}_GstStateMaster`);
  };

  const handlePdf = async () => {
    const exportRows = buildExportRows();
    if (!exportRows.length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('gst-state-master', exportRows, buildPdfMeta());
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
    const shareText = [compName || 'Company', 'GST State Master'].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('gst-state-master', exportRows, buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  if (loading) {
    return (
      <div className="slide slide-48-gst-state gst-state-screen gst-state-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">GST State Master</h2>
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
      <div className="slide slide-48-gst-state gst-state-screen">
        <h2 className="sale-bill-page__title">GST State Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-48-gst-state gst-state-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome gst-state-screen__chrome">
        <div className="account-master-screen__head gst-state-screen__head">
          <div className="gst-state-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">GST State Master</h2>
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
              hasRows={rows.some((r) => String(r.STATE_CODE).trim())}
            >
              {canEditRows ? (
                <>
                  <GfasToolbarBtn icon="add" label="Add row" variant="secondary" onClick={handleAddRow} disabled={saving} />
                  <GfasToolbarBtn
                    icon="delete"
                    label="Delete row"
                    variant="danger"
                    onClick={handleDeleteSelectedRow}
                    disabled={saving || rows.length <= 1}
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
            helpReportId="gst-state-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="gst-state-screen__session-line"
          />
        </div>
      </div>

      <div className="gst-state-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err gst-state-screen__err">{err}</p> : null}

        <p className="gst-state-screen__hint">
          State_Code (2 chars) and State (30 chars). Save replaces all GST state rows (VFP: DO GST_STATE).
        </p>

        <div className="gst-state-screen__grid-wrap">
          <table className="gst-state-grid dane-grid">
            <thead>
              <tr>
                <th className="gst-state-grid__code-col">State_Code</th>
                <th>State</th>
                <th className="dane-grid__act-col">Del</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row._id}
                  className={selectedRowIdx === idx ? 'gst-state-grid__row is-selected' : 'gst-state-grid__row'}
                  onClick={() => {
                    if (!formDisabled) setSelectedRowIdx(idx);
                  }}
                >
                  <td className="dane-grid__code-cell">
                    <input
                      id={cellId(idx, 'STATE_CODE')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      maxLength={2}
                      value={row.STATE_CODE}
                      disabled={formDisabled}
                      onFocus={() => setSelectedRowIdx(idx)}
                      onChange={(e) =>
                        setCell(idx, 'STATE_CODE', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2))
                      }
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'STATE_CODE')}
                    />
                  </td>
                  <td>
                    <input
                      id={cellId(idx, 'STATE')}
                      className="form-input dane-grid__input"
                      type="text"
                      maxLength={30}
                      value={row.STATE}
                      disabled={formDisabled}
                      onFocus={() => setSelectedRowIdx(idx)}
                      onChange={(e) => setCell(idx, 'STATE', e.target.value.toUpperCase().slice(0, 30))}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'STATE')}
                    />
                  </td>
                  <td className="dane-grid__act-cell">
                    <button
                      type="button"
                      className="btn btn-secondary dane-grid__del"
                      disabled={formDisabled || rows.length <= 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveRow(idx);
                      }}
                      title="Delete row"
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
