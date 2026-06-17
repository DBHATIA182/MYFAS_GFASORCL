import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { downloadExcelRows } from '../utils/excelExport';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };
const SALE_COND_ROWS = 7;

function emptyFixedRows() {
  return Array.from({ length: SALE_COND_ROWS }, (_, i) => ({
    NO: i + 1,
    COND: '',
  }));
}

function mapRowsFromApi(data) {
  const list = Array.isArray(data?.rows)
    ? data.rows
    : Array.isArray(data)
      ? data
      : [];
  const byNo = new Map();
  for (const r of list) {
    const no = Number(r.NO ?? r.no ?? 0);
    if (no >= 1 && no <= SALE_COND_ROWS) {
      byNo.set(no, String(r.COND ?? r.cond ?? '').trim());
    }
  }
  return Array.from({ length: SALE_COND_ROWS }, (_, i) => {
    const no = i + 1;
    return { NO: no, COND: byNo.get(no) ?? '' };
  });
}

function cellId(no) {
  return `salecond-${no}`;
}

function focusCell(no) {
  const el = document.getElementById(cellId(no));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO SALECOND — SALE_COND COND1..COND7; browse 7 rows, no append/delete. */
export default function Slide45SaleBillCondition({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState(emptyFixedRows);

  const canEditRows = Boolean(perms?.canEdit || perms?.canAdd);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/sale-cond'), {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    setRows(mapRowsFromApi(data));
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/sale-cond-user-permissions'), {
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

  const setCond = (no, value) => {
    setRows((prev) =>
      prev.map((r) => (r.NO === no ? { ...r, COND: String(value ?? '').slice(0, 150) } : r))
    );
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
        rows: rows.map((r) => ({ NO: r.NO, COND: r.COND })),
      };
      const { data } = await axios.put(apiUrl(apiBase, '/api/sale-cond'), payload, reqOpts);
      alert(data?.message || 'DONE');
      if (Array.isArray(data?.rows)) setRows(mapRowsFromApi(data));
      else await loadRows();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const buildExportRows = () =>
    rows.map((r) => ({
      NO: r.NO,
      COND: r.COND,
      Condition: r.COND,
    }));

  const buildPdfMeta = () => ({
    companyName: compName || 'Company',
    year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
    reportTitle: 'Sale Bill Condition',
    period: '7 conditions',
    endDate: '7 conditions',
  });

  const handleExcel = () => {
    downloadExcelRows(
      buildExportRows(),
      'SaleBillCondition',
      `${compName || 'Company'}_SaleBillCondition`
    );
  };

  const handlePdf = async () => {
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('sale-cond-master', buildExportRows(), buildPdfMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleWhatsApp = async () => {
    const exportRows = buildExportRows();
    const shareText = [compName || 'Company', 'Sale Bill Condition'].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('sale-cond-master', exportRows, buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleGridKeyDown = (e, no) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (no < SALE_COND_ROWS) setTimeout(() => focusCell(no + 1), 0);
  };

  const formDisabled = saving || !canEditRows;

  if (loading) {
    return (
      <div className="slide slide-45-sale-cond sale-cond-screen sale-cond-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Sale Bill Condition</h2>
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
      <div className="slide slide-45-sale-cond sale-cond-screen">
        <h2 className="sale-bill-page__title">Sale Bill Condition</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-45-sale-cond sale-cond-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome sale-cond-screen__chrome">
        <div className="account-master-screen__head sale-cond-screen__head">
          <div className="sale-cond-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Sale Bill Condition</h2>
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
              hasRows={rows.some((r) => String(r.COND).trim())}
            >
              {canEditRows ? (
                <GfasToolbarBtn
                  label={saving ? 'Saving…' : 'Save'}
                  variant="primary"
                  onClick={handleSave}
                  disabled={saving}
                />
              ) : null}
            </MasterScreenToolbar>
          </div>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="sale-cond-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="sale-cond-screen__session-line"
          />
        </div>
      </div>

      <div className="sale-cond-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err sale-cond-screen__err">{err}</p> : null}

        <p className="sale-cond-screen__hint">
          Seven sale bill conditions (VFP: DO SALECOND). Edit text and Save — no add or delete rows.
        </p>

        <div className="sale-cond-screen__grid-wrap">
          <table className="sale-cond-grid dane-grid">
            <thead>
              <tr>
                <th className="sale-cond-grid__no-col">#</th>
                <th className="sale-cond-grid__cond-col">Cond</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.NO}>
                  <td className="sale-cond-grid__no-cell">{row.NO}</td>
                  <td className="sale-cond-grid__cond-cell">
                    <input
                      id={cellId(row.NO)}
                      type="text"
                      className="form-input dane-grid__input sale-cond-grid__cond-input"
                      maxLength={150}
                      value={row.COND}
                      disabled={formDisabled}
                      onChange={(e) => setCond(row.NO, e.target.value)}
                      onKeyDown={(e) => handleGridKeyDown(e, row.NO)}
                    />
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
