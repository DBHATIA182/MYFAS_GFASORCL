import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function emptyRow() {
  return { DAYS1: '', DAYS2: '', RENT1: '', RENT2: '', RENT3: '', _id: `${Date.now()}-${Math.random()}` };
}

function mapRowFromApi(r) {
  return {
    _id: `${r.DAYS1}-${r.DAYS2}-${Math.random()}`,
    DAYS1: r.DAYS1 ?? r.days1 ?? '',
    DAYS2: r.DAYS2 ?? r.days2 ?? '',
    RENT1: r.RENT1 ?? r.rent1 ?? '',
    RENT2: r.RENT2 ?? r.rent2 ?? '',
    RENT3: r.RENT3 ?? r.rent3 ?? '',
  };
}

function numInputVal(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

/** VFP DO GODRENT — GODRENT grid (Days1, Days2, Rent1–3). */
export default function Slide37GodownRentMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = Number(formData.comp_code ?? formData.COMP_CODE ?? 0) || 0;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/godrent'), {
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/godrent-user-permissions'), {
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
      const { data } = await axios.put(apiUrl(apiBase, '/api/godrent'), payload, reqOpts);
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
      <div className="slide slide-37-godown-rent godown-rent-screen godown-rent-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Godown Rent</h2>
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
      <div className="slide slide-37-godown-rent godown-rent-screen">
        <h2 className="sale-bill-page__title">Godown Rent</h2>
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
    <div className="slide slide-37-godown-rent godown-rent-screen account-master-screen item-master-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">Godown Rent</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="godown-rent-master" />
          <div className="godown-rent-screen__toolbar-row">
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={loadRows}
              perms={perms}
              listLoading={saving}
              hasRows={rows.length > 0}
            />
            <div className="godown-rent-screen__actions">
              <button type="button" className="btn btn-secondary" disabled={saving || formDisabled} onClick={handleAddRow}>
                Add row
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {err ? <p className="account-master-screen__err">{err}</p> : null}

      <div className="godown-rent-screen__grid-wrap">
        <table className="godown-rent-grid">
          <thead>
            <tr>
              <th className="godown-rent-grid__num-col">Days1</th>
              <th className="godown-rent-grid__num-col">Days2</th>
              <th className="godown-rent-grid__num-col">Rent1</th>
              <th className="godown-rent-grid__num-col">Rent2</th>
              <th className="godown-rent-grid__num-col">Rent3</th>
              <th className="godown-rent-grid__act-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row._id}>
                <td className="godown-rent-grid__num-cell">
                  <input
                    className="form-input godown-rent-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.DAYS1)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DAYS1', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="godown-rent-grid__num-cell">
                  <input
                    className="form-input godown-rent-grid__input"
                    type="text"
                    inputMode="numeric"
                    value={numInputVal(row.DAYS2)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'DAYS2', e.target.value.replace(/\D/g, ''))}
                  />
                </td>
                <td className="godown-rent-grid__num-cell">
                  <input
                    className="form-input godown-rent-grid__input"
                    type="text"
                    inputMode="decimal"
                    value={numInputVal(row.RENT1)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'RENT1', e.target.value)}
                  />
                </td>
                <td className="godown-rent-grid__num-cell">
                  <input
                    className="form-input godown-rent-grid__input"
                    type="text"
                    inputMode="decimal"
                    value={numInputVal(row.RENT2)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'RENT2', e.target.value)}
                  />
                </td>
                <td className="godown-rent-grid__num-cell">
                  <input
                    className="form-input godown-rent-grid__input"
                    type="text"
                    inputMode="decimal"
                    value={numInputVal(row.RENT3)}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, 'RENT3', e.target.value)}
                  />
                </td>
                <td className="godown-rent-grid__act-cell">
                  <button
                    type="button"
                    className="btn btn-secondary godown-rent-grid__del"
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
  );
}
