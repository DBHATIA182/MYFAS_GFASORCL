import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import {
  SALE_FORM_GST_GRID_COLUMNS,
  SALE_FORM_GST_HIDE_RESTRICTED,
  SALE_FORM_GST_MODE,
} from '../data/saleFormGstConfig';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapRowsFromApi(data) {
  const list = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  return list.map((r) => ({
    F_NAME: String(r.F_NAME ?? r.f_name ?? '').trim(),
    ADD_YN: String(r.ADD_YN ?? r.add_yn ?? 'Y').trim().toUpperCase().slice(0, 1),
    EDIT_YN: String(r.EDIT_YN ?? r.edit_yn ?? 'Y').trim().toUpperCase().slice(0, 1),
    S_NO: Number(r.S_NO ?? r.s_no ?? 0) || 0,
    HIDE_COL: String(r.HIDE_COL ?? r.hide_col ?? 'N').trim().toUpperCase().slice(0, 1),
  }));
}

function normalizeYnInput(raw, fallback = 'N') {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'Y' || s === 'N') return s;
  return fallback;
}

function cellId(rowIdx, key) {
  return `saleformgst-${rowIdx}-${key}`;
}

/** VFP DO FORM saleform_Gst WITH 'SALE' — SALEFORM_GST field layout for Sale Invoice. */
export default function Slide84SetSaleExp({ apiBase, formData, userName, onPrev, onReset }) {
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const formName = SALE_FORM_GST_MODE;

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);

  const canEditRows = Boolean(perms?.canEdit || perms?.canAdd);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/sale-form-gst'), {
      params: { comp_uid: compUid, form_name: formName },
      ...reqOpts,
    });
    setRows(mapRowsFromApi(data));
  }, [apiBase, compUid, formName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/sale-form-gst-user-permissions'), {
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

  const setRowField = (index, key, value) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (key === 'HIDE_COL') {
          const hide = normalizeYnInput(value, 'N');
          const fname = String(row.F_NAME ?? '').toUpperCase();
          if (SALE_FORM_GST_HIDE_RESTRICTED.includes(fname) && hide === 'Y') {
            alert('You can not hide this column. Restricted col.');
            return { ...row, HIDE_COL: 'N' };
          }
          return { ...row, HIDE_COL: hide };
        }
        if (key === 'ADD_YN' || key === 'EDIT_YN') {
          return { ...row, [key]: normalizeYnInput(value, 'Y') };
        }
        if (key === 'S_NO') {
          const n = Number(String(value ?? '').replace(/,/g, '').trim());
          return { ...row, S_NO: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 };
        }
        return { ...row, [key]: value };
      })
    );
  };

  const handleSave = async () => {
    if (!perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    if (!rows.length) {
      alert('No data loaded. Use Get Data first.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.put(
        apiUrl(apiBase, '/api/sale-form-gst'),
        {
          comp_uid: compUid,
          user_name: userName,
          form_name: formName,
          rows,
        },
        reqOpts
      );
      alert(data?.message || 'DONE');
      if (Array.isArray(data?.rows)) setRows(mapRowsFromApi(data));
      else await loadRows();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = saving || !canEditRows;

  if (loading) {
    return (
      <div className="slide slide-84-sale-form-gst sale-form-gst-screen">
        <p className="loading-msg">Loading Set Sale Exp…</p>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-84-sale-form-gst sale-form-gst-screen">
        <h2 className="sale-bill-page__title">Set Sale Exp.</h2>
        <p className="form-error">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-84-sale-form-gst sale-form-gst-screen account-master-screen">
      <div className="account-master-screen__head">
        <div className="sale-form-gst-screen__head-bar">
          <h2 className="sale-bill-page__title">Set Sale Exp.</h2>
          <MasterScreenToolbar onPrev={onPrev} onReset={onReset} onRefresh={loadRows} listLoading={saving}>
            <GfasToolbarBtn label="Get Data" onClick={loadRows} disabled={saving} />
            {canEditRows ? (
              <GfasToolbarBtn
                label={saving ? 'Saving…' : 'Proceed'}
                variant="primary"
                onClick={handleSave}
                disabled={saving || rows.length === 0}
              />
            ) : null}
          </MasterScreenToolbar>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="set-sale-exp" />
      </div>

      <p className="sale-form-gst-screen__hint">
        VFP <code>DO FORM saleform_Gst WITH &apos;SALE&apos;</code> — configures <strong>SALEFORM_GST</strong> for
        the Sale Invoice form (Add / Edit / Sr.No. / Hide per field).
      </p>

      {err ? <p className="form-error">{err}</p> : null}

      {rows.length === 0 ? (
        <p className="loading-msg">No SALEFORM_GST rows for SALE. Click Get Data after seeding the table in Oracle.</p>
      ) : (
        <div className="sale-form-gst-screen__table-wrap">
          <table className="report-table sale-form-gst-screen__table">
            <thead>
              <tr>
                {SALE_FORM_GST_GRID_COLUMNS.map((col) => (
                  <th key={col.key} scope="col">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.F_NAME || index}>
                  {SALE_FORM_GST_GRID_COLUMNS.map((col) => {
                    const id = cellId(index, col.key);
                    if (col.readOnly) {
                      return (
                        <td key={col.key} className="sale-form-gst-screen__field-name">
                          {row.F_NAME}
                        </td>
                      );
                    }
                    if (col.yn) {
                      return (
                        <td key={col.key}>
                          <select
                            id={id}
                            className="inttrf-input sale-form-gst-screen__yn"
                            value={row[col.key] ?? (col.key === 'HIDE_COL' ? 'N' : 'Y')}
                            disabled={formDisabled}
                            onChange={(e) => setRowField(index, col.key, e.target.value)}
                          >
                            <option value="Y">Y</option>
                            <option value="N">N</option>
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key}>
                        <input
                          id={id}
                          type="number"
                          min={0}
                          step={1}
                          className="inttrf-input sale-form-gst-screen__sno"
                          value={row.S_NO ?? 0}
                          disabled={formDisabled}
                          onChange={(e) => setRowField(index, 'S_NO', e.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
