import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function emptyRow() {
  return {
    DANE: '',
    BAGS: '',
    KATTA: '',
    HKATTA: '',
    DEF_VALUE: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function mapRowFromApi(r) {
  return {
    _id: `${r.DANE}-${Math.random()}`,
    DANE: String(r.DANE ?? r.dane ?? '').trim().slice(0, 1),
    BAGS: formatDaneQtyDisplay(r.BAGS ?? r.bags ?? ''),
    KATTA: formatDaneQtyDisplay(r.KATTA ?? r.katta ?? ''),
    HKATTA: formatDaneQtyDisplay(r.HKATTA ?? r.hkatta ?? ''),
    DEF_VALUE: String(r.DEF_VALUE ?? r.def_value ?? '').trim().slice(0, 1),
  };
}

/** Oracle NUMBER(5,3): 2 digits before decimal, 3 after (max 99.999). */
const DANE_QTY_MAX = 99.999;
const DANE_QTY_MIN = -99.999;

/** Display like VFP: 0.100, 0.050 (3 decimal places). */
function formatDaneQtyDisplay(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '.' || s === '-.') return s;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return s;
  const clamped = Math.max(DANE_QTY_MIN, Math.min(DANE_QTY_MAX, n));
  return (Math.round(clamped * 1000) / 1000).toFixed(3);
}

/** Show stored text while typing; format only on blur (fixes .05 and 0.000 edits). */
function qtyInputVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

/** Allow .05, 0.05, 0., 0.100 — NUMBER(5,3). */
function parseDaneQtyInput(raw) {
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
  if (parts[0].length > 2) return null;
  if (parts[1] && parts[1].length > 3) return null;
  return s;
}

const DANE_GRID_FIELDS = ['DANE', 'BAGS', 'KATTA', 'HKATTA', 'DEF_VALUE'];

function daneCellId(rowIdx, field) {
  return `dane-${rowIdx}-${field}`;
}

function focusDaneCell(rowIdx, field) {
  const el = document.getElementById(daneCellId(rowIdx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO DANE — browse DANE, BAGS, KATTA, HKATTA, DEF_VALUE; save all rows for company. */
export default function Slide42DaneMaster({ apiBase, formData, userName, onPrev, onReset }) {
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
    const { data } = await axios.get(apiUrl(apiBase, '/api/dane'), {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    const list = Array.isArray(data) ? data.map(mapRowFromApi) : [];
    setRows(list.length ? list : [emptyRow()]);
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/dane-user-permissions'), {
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

  const setQtyCell = (idx, key, raw) => {
    const parsed = parseDaneQtyInput(raw);
    if (parsed === null) return;
    setCell(idx, key, parsed);
  };

  const blurQtyCell = (idx, key) => {
    setRows((prev) => {
      const raw = prev[idx]?.[key];
      if (raw === '' || raw == null) return prev;
      const formatted = formatDaneQtyDisplay(raw);
      if (formatted === raw) return prev;
      return prev.map((r, i) => (i === idx ? { ...r, [key]: formatted } : r));
    });
  };

  const handleGridKeyDown = (e, rowIdx, field) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (field === 'BAGS' || field === 'KATTA' || field === 'HKATTA') {
      blurQtyCell(rowIdx, field);
    }
    const col = DANE_GRID_FIELDS.indexOf(field);
    if (col < 0) return;
    const nextField = DANE_GRID_FIELDS[col + 1];
    if (nextField) {
      setTimeout(() => focusDaneCell(rowIdx, nextField), 0);
      return;
    }
    if (rowIdx < rows.length - 1) {
      setTimeout(() => focusDaneCell(rowIdx + 1, 'DANE'), 10);
      return;
    }
    const newRowIdx = rowIdx + 1;
    handleAddRow();
    setTimeout(() => focusDaneCell(newRowIdx, 'DANE'), 50);
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
      const { data } = await axios.put(apiUrl(apiBase, '/api/dane'), payload, reqOpts);
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
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  if (loading) {
    return (
      <div className="slide slide-42-dane dane-screen dane-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Dane Master</h2>
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
      <div className="slide slide-42-dane dane-screen">
        <h2 className="sale-bill-page__title">Dane Master</h2>
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
    <div className="slide slide-42-dane dane-screen account-master-screen item-master-screen">
      <div className="account-master-screen__chrome dane-screen__chrome">
        <div className="account-master-screen__head dane-screen__head">
          <div className="dane-screen__head-bar">
            <h2 className="sale-bill-page__title">Dane Master</h2>
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={loadRows}
              perms={perms}
              listLoading={saving}
              hasRows={rows.length > 0}
            >
              <GfasToolbarBtn
                icon="add"
                label="Add row"
                variant="secondary"
                onClick={handleAddRow}
                disabled={saving || formDisabled}
              />
              <GfasToolbarBtn
                label={saving ? 'Saving…' : 'Save'}
                variant="primary"
                onClick={handleSave}
                disabled={saving}
              />
            </MasterScreenToolbar>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="dane-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="dane-screen__session-line"
          />
        </div>
      </div>

      <div className="dane-screen__body">
        {err ? <p className="account-master-screen__err">{err}</p> : null}

        <p className="dane-screen__hint">
          Bags, Katta, Hkatta: type .05 or 0.050 (Enter = next field). NUMBER(5,3), max 99.999.
        </p>

        <div className="dane-screen__grid-wrap">
          <table className="dane-grid">
            <thead>
              <tr>
                <th>Dane</th>
                <th>Bags</th>
                <th>Katta</th>
                <th>Hkatta</th>
                <th>Def_value</th>
                <th className="dane-grid__act-col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row._id}>
                  <td className="dane-grid__code-cell">
                    <input
                      id={daneCellId(idx, 'DANE')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      maxLength={1}
                      value={row.DANE}
                      disabled={formDisabled}
                      onChange={(e) => setCell(idx, 'DANE', e.target.value.slice(0, 1))}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'DANE')}
                    />
                  </td>
                  <td className="dane-grid__num-cell">
                    <input
                      id={daneCellId(idx, 'BAGS')}
                      className="form-input dane-grid__input"
                      type="text"
                      inputMode="decimal"
                      value={qtyInputVal(row.BAGS)}
                      disabled={formDisabled}
                      onChange={(e) => setQtyCell(idx, 'BAGS', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => blurQtyCell(idx, 'BAGS')}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'BAGS')}
                      title="NUMBER(5,3) — e.g. .05 or 0.050"
                      placeholder="0.000"
                    />
                  </td>
                  <td className="dane-grid__num-cell">
                    <input
                      id={daneCellId(idx, 'KATTA')}
                      className="form-input dane-grid__input"
                      type="text"
                      inputMode="decimal"
                      value={qtyInputVal(row.KATTA)}
                      disabled={formDisabled}
                      onChange={(e) => setQtyCell(idx, 'KATTA', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => blurQtyCell(idx, 'KATTA')}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'KATTA')}
                      title="NUMBER(5,3) — e.g. .05 or 0.050"
                      placeholder="0.000"
                    />
                  </td>
                  <td className="dane-grid__num-cell">
                    <input
                      id={daneCellId(idx, 'HKATTA')}
                      className="form-input dane-grid__input"
                      type="text"
                      inputMode="decimal"
                      value={qtyInputVal(row.HKATTA)}
                      disabled={formDisabled}
                      onChange={(e) => setQtyCell(idx, 'HKATTA', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => blurQtyCell(idx, 'HKATTA')}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'HKATTA')}
                      title="NUMBER(5,3) — e.g. .05 or 0.050"
                      placeholder="0.000"
                    />
                  </td>
                  <td className="dane-grid__code-cell">
                    <input
                      id={daneCellId(idx, 'DEF_VALUE')}
                      className="form-input dane-grid__input dane-grid__input--code"
                      type="text"
                      maxLength={1}
                      value={row.DEF_VALUE}
                      disabled={formDisabled}
                      onChange={(e) => setCell(idx, 'DEF_VALUE', e.target.value.slice(0, 1))}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'DEF_VALUE')}
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
