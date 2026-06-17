import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function emptyRow() {
  return { S_DATE: '', _id: `${Date.now()}-${Math.random()}` };
}

function mapRowFromApi(r) {
  const raw = r.S_DATE ?? r.s_date ?? '';
  let sDate = '';
  if (raw) {
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) sDate = s.slice(0, 10);
    else {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        sDate = `${y}-${m}-${day}`;
      }
    }
  }
  return { _id: `${sDate}-${Math.random()}`, S_DATE: sDate };
}

/** VFP DO HOLIDAY — HOLIDAY table (browse S_DATE, save all rows for company). */
export default function Slide41HolidayMaster({ apiBase, formData, userName, onPrev, onReset }) {
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
    const { data } = await axios.get(apiUrl(apiBase, '/api/holiday'), {
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/holiday-user-permissions'), {
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

  const setCell = (idx, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, S_DATE: value } : r)));
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
      const { data } = await axios.put(apiUrl(apiBase, '/api/holiday'), payload, reqOpts);
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
      <div className="slide slide-41-holiday holiday-screen holiday-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Holiday Master</h2>
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
      <div className="slide slide-41-holiday holiday-screen">
        <h2 className="sale-bill-page__title">Holiday Master</h2>
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
    <div className="slide slide-41-holiday holiday-screen account-master-screen item-master-screen">
      <div className="account-master-screen__chrome holiday-screen__chrome">
        <div className="account-master-screen__head holiday-screen__head">
          <div className="holiday-screen__head-bar">
            <h2 className="sale-bill-page__title">Holiday Master</h2>
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
                label="Add date"
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
            helpReportId="holiday-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="holiday-screen__session-line"
          />
        </div>
      </div>

      <div className="holiday-screen__body">
        {err ? <p className="account-master-screen__err">{err}</p> : null}

        <p className="holiday-screen__hint">Holiday dates for this company (VFP: Mholiday — column S_DATE).</p>

        <div className="holiday-screen__grid-wrap">
        <table className="holiday-grid">
          <thead>
            <tr>
              <th>Holiday date (S_DATE)</th>
              <th className="holiday-grid__act-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row._id}>
                <td className="holiday-grid__date-cell">
                  <input
                    className="form-input holiday-grid__input"
                    type="date"
                    value={row.S_DATE || ''}
                    disabled={formDisabled}
                    onChange={(e) => setCell(idx, e.target.value)}
                  />
                </td>
                <td className="holiday-grid__act-cell">
                  <button
                    type="button"
                    className="btn btn-secondary holiday-grid__del"
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
