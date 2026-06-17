import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

const TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'B', label: 'B' },
  { value: 'N', label: 'N' },
];

function emptyRow() {
  return {
    _id: `${Date.now()}-${Math.random()}`,
    DATE1: '',
    DATE2: '',
    DATE3: '',
    DAY1: '',
    DAY2: '',
    TYPE: '',
    ORATE: '',
    NRATE: '',
    GDAYS: '',
    EDAYS: '',
  };
}

function mapRowFromApi(r) {
  return {
    _id: `${r.DAY1}-${r.DAY2}-${r.TYPE}-${Math.random()}`,
    DATE1: r.DATE1 ?? r.date1 ?? '',
    DATE2: r.DATE2 ?? r.date2 ?? '',
    DATE3: r.DATE3 ?? r.date3 ?? '',
    DAY1: r.DAY1 ?? r.day1 ?? '',
    DAY2: r.DAY2 ?? r.day2 ?? '',
    TYPE: String(r.TYPE ?? r.type ?? '').trim().toUpperCase(),
    ORATE: r.ORATE ?? r.orate ?? '',
    NRATE: r.NRATE ?? r.nrate ?? '',
    GDAYS: r.GDAYS ?? r.gdays ?? '',
    EDAYS: r.EDAYS ?? r.edays ?? '',
  };
}

function numInputVal(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function rowHasData(row) {
  const type = String(row.TYPE ?? '').trim();
  const d1 = Number(row.DAY1) || 0;
  const d2 = Number(row.DAY2) || 0;
  if (type || d1 || d2) return true;
  if (row.DATE1 || row.DATE2 || row.DATE3) return true;
  const nums = [row.ORATE, row.NRATE, row.GDAYS, row.EDAYS].map((x) => Number(x) || 0);
  return nums.some((n) => n !== 0);
}

/** VFP DO CUSTINT — NEWINT interest slabs (browse + save all rows for company). */
export default function Slide40CustomerInterest({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = Number(formData.comp_code ?? formData.COMP_CODE ?? 0) || 0;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/customer-interest'), {
      params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear },
      ...reqOpts,
    });
    const list = Array.isArray(data) ? data.map(mapRowFromApi) : [];
    setRows(list.length ? list : [emptyRow()]);
  }, [apiBase, compCode, compUid, compYear]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/customer-interest-user-permissions'), {
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
    const payloadRows = rows.filter(rowHasData);
    if (!payloadRows.length) {
      alert('Enter at least one interest row before saving.');
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
        rows: payloadRows.map(({ _id, ...r }) => r),
      };
      const { data } = await axios.put(apiUrl(apiBase, '/api/customer-interest'), payload, reqOpts);
      alert(data?.message || 'Saved successfully.');
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

  const formDisabled = saving || !perms?.canEdit;

  if (loading) {
    return (
      <div className="slide slide-40-cust-int cust-int-screen cust-int-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Customer Interest</h2>
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
      <div className="slide slide-40-cust-int cust-int-screen">
        <h2 className="sale-bill-page__title">Customer Interest</h2>
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
    <div className="slide slide-40-cust-int cust-int-screen account-master-screen item-master-screen">
      <div className="account-master-screen__chrome cust-int-screen__chrome">
        <div className="account-master-screen__head cust-int-screen__head">
          <div className="cust-int-screen__head-bar">
            <h2 className="sale-bill-page__title">Customer Interest</h2>
            <div className="cust-int-screen__toolbar-row">
              <MasterScreenToolbar
                onPrev={onPrev}
                onReset={onReset}
                onRefresh={loadRows}
                perms={perms}
                listLoading={saving}
                hasRows={rows.length > 0}
              />
              <div className="cust-int-screen__actions">
                <button type="button" className="btn btn-secondary" disabled={saving || formDisabled} onClick={handleAddRow}>
                  Add row
                </button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="customer-interest"
            helpLabel="Help"
            helpCompanyName={compName}
            className="cust-int-screen__session-line"
          />
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <div className="cust-int-screen__grid-wrap">
        <table className="cust-int-grid">
          <thead>
            <tr>
              <th>Date1</th>
              <th>Date2</th>
              <th>Date3</th>
              <th>Day1</th>
              <th>Day2</th>
              <th>Type</th>
              <th>Orate</th>
              <th>Nrate</th>
              <th>Gdays</th>
              <th>Edays</th>
              <th className="cust-int-grid__act-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row._id}>
                <td>
                  <input
                    className="form-input cust-int-grid__input cust-int-grid__date"
                    type="date"
                    lang="en-GB"
                    value={String(row.DATE1 ?? '').slice(0, 10)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DATE1', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="form-input cust-int-grid__input cust-int-grid__date"
                    type="date"
                    lang="en-GB"
                    value={String(row.DATE2 ?? '').slice(0, 10)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DATE2', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="form-input cust-int-grid__input cust-int-grid__date"
                    type="date"
                    lang="en-GB"
                    value={String(row.DATE3 ?? '').slice(0, 10)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DATE3', e.target.value)}
                  />
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.DAY1)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DAY1', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.DAY2)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DAY2', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="cust-int-grid__type-cell">
                  <select
                    className="form-input cust-int-grid__input cust-int-grid__type"
                    value={row.TYPE || ''}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'TYPE', e.target.value)}
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value || '_blank'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="decimal"
                    value={numInputVal(row.ORATE)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'ORATE', e.target.value)}
                  />
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="decimal"
                    value={numInputVal(row.NRATE)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'NRATE', e.target.value)}
                  />
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.GDAYS)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'GDAYS', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="cust-int-grid__num-cell">
                  <input
                    className="form-input cust-int-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.EDAYS)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'EDAYS', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="cust-int-grid__act-cell">
                  <button
                    type="button"
                    className="btn btn-secondary cust-int-grid__del"
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

      <p className="account-master-screen__hint cust-int-screen__hint">
        {rows.filter(rowHasData).length} row{rows.filter(rowHasData).length === 1 ? '' : 's'} · VFP: DO CUSTINT / NEWINT
        {formDisabled ? ' · view only' : ' · edit grid and Save replaces all rows for this company'}
      </p>
    </div>
  );
}
