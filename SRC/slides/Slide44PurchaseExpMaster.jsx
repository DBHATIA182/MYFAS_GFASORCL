import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { GfasToolbarBtn, MasterScreenToolbar } from '../components/GfasToolbar';
import { downloadExcelRows } from '../utils/excelExport';
import { apiUrl } from '../utils/resolveApiBase';
import {
  buildPurExpAccountNameMap,
  purExpLegacyMasterCode,
  resolvePurExpAccountName,
} from '../utils/purExpAccountCode';

const reqOpts = { withCredentials: true, timeout: 120000 };

const CAL_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Q', label: 'Q — Qty' },
  { value: 'A', label: 'A — Amount' },
  { value: 'W', label: 'W — Weight' },
];

const GRID_FIELDS = ['EXP_NAME', 'EXP_RATE', 'CAL', 'CODE'];

function emptyRow() {
  return {
    EXP_NAME: '',
    EXP_RATE: '',
    CAL: '',
    CODE: '',
    _id: `${Date.now()}-${Math.random()}`,
  };
}

function formatRate2(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function rateInputVal(v) {
  if (v == null || v === '') return '';
  return String(v);
}

function parseRateInput(raw) {
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
  if (parts[0].length > 6) return null;
  if (parts[1] && parts[1].length > 2) return null;
  return s;
}

function mapRowFromApi(r) {
  return {
    _id: `${r.EXP_NAME}-${Math.random()}`,
    EXP_NAME: String(r.EXP_NAME ?? r.exp_name ?? '').trim(),
    EXP_RATE: formatRate2(r.EXP_RATE ?? r.exp_rate ?? ''),
    CAL: String(r.CAL ?? r.cal ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 1),
    CODE: String(r.CODE ?? r.code ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 6),
    AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
  };
}

function cellId(rowIdx, field) {
  return `purexp-${rowIdx}-${field}`;
}

function focusCell(rowIdx, field) {
  const el = document.getElementById(cellId(rowIdx, field));
  if (el && typeof el.focus === 'function') {
    el.focus();
    if (typeof el.select === 'function') el.select();
  }
}

/** VFP DO FORM PUREXP (Tdsnat) — EXP_NAME, EXP_RATE, CAL Q/A/W, CODE. */
export default function Slide44PurchaseExpMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);

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

  const accountNameByCode = useMemo(
    () => buildPurExpAccountNameMap(accounts),
    [accounts]
  );

  const canEditRows = Boolean(perms?.canEdit || perms?.canAdd);

  const loadRows = useCallback(async () => {
    setErr('');
    const { data } = await axios.get(apiUrl(apiBase, '/api/pur-exp'), {
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
        const { data } = await axios.get(apiUrl(apiBase, '/api/pur-exp-user-permissions'), {
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

  useEffect(() => {
    if (!perms?.canOpen || loading) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-accounts'), {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      })
      .then(({ data }) => {
        if (cancelled) return;
        const accts = Array.isArray(data) ? data : [];
        setAccounts(accts);
        const nameMap = buildPurExpAccountNameMap(accts);
        if (!nameMap.size) return;
        setRows((prev) => {
          let changed = false;
          const next = prev.map((r) => {
            const ac =
              resolvePurExpAccountName(r.CODE, nameMap) || String(r.AC_NAME ?? '').trim();
            if (ac !== r.AC_NAME) {
              changed = true;
              return { ...r, AC_NAME: ac };
            }
            return r;
          });
          return changed ? next : prev;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, perms?.canOpen, loading]);

  const setCell = (idx, key, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const setCodeCell = (idx, rawCode) => {
    const code = purExpLegacyMasterCode(rawCode) || String(rawCode ?? '').trim().toUpperCase().slice(0, 6);
    const acName = code ? resolvePurExpAccountName(code, accountNameByCode) : '';
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, CODE: code, AC_NAME: acName } : r))
    );
  };

  const setRateCell = (idx, raw) => {
    const parsed = parseRateInput(raw);
    if (parsed === null) return;
    setCell(idx, 'EXP_RATE', parsed);
  };

  const blurRateCell = (idx) => {
    setRows((prev) => {
      const raw = prev[idx]?.EXP_RATE;
      if (raw === '' || raw == null) return prev;
      const formatted = formatRate2(raw);
      if (formatted === raw) return prev;
      return prev.map((r, i) => (i === idx ? { ...r, EXP_RATE: formatted } : r));
    });
  };

  const handleGridKeyDown = (e, rowIdx, field) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (field === 'EXP_RATE') blurRateCell(rowIdx);
    const col = GRID_FIELDS.indexOf(field);
    if (col < 0) return;
    const nextField = GRID_FIELDS[col + 1];
    if (nextField) {
      setTimeout(() => focusCell(rowIdx, nextField), 0);
      return;
    }
    if (rowIdx < rows.length - 1) {
      setTimeout(() => focusCell(rowIdx + 1, 'EXP_NAME'), 10);
      return;
    }
    const newRowIdx = rowIdx + 1;
    handleAddRow();
    setTimeout(() => focusCell(newRowIdx, 'EXP_NAME'), 50);
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
    if (!canEditRows) {
      alert(perms?.canEdit === false ? 'You Can Not Edit' : 'You Can Not Add');
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
        rows: rows.map(({ _id, AC_NAME, ...r }) => r),
      };
      const { data } = await axios.put(apiUrl(apiBase, '/api/pur-exp'), payload, reqOpts);
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

  const buildPdfMeta = () => ({
    companyName: compName || 'Company',
    year: String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—',
    reportTitle: 'Purchase Exp Master',
    period: 'All purchase expenses',
    endDate: 'All purchase expenses',
  });

  const buildPdfRows = () =>
    rows
      .filter((r) => String(r.EXP_NAME).trim())
      .map((r) => ({
        EXP_NAME: r.EXP_NAME,
        EXP_RATE: formatRate2(r.EXP_RATE),
        CAL: r.CAL || '',
        CODE: r.CODE || '',
        AC_NAME: r.AC_NAME || '',
      }));

  const handleExcel = () => {
    const exportRows = buildPdfRows();
    if (!exportRows.length) {
      alert('No rows to export.');
      return;
    }
    downloadExcelRows(
      exportRows.map((r) => ({
        'EXP NAME': r.EXP_NAME,
        'EXP RATE': r.EXP_RATE,
        'CAL Q/A/W': r.CAL,
        CODE: r.CODE,
        'A/C NAME': r.AC_NAME,
      })),
      'PurchaseExp',
      `${compName || 'Company'}_PurchaseExpMaster`
    );
  };

  const handlePdf = async () => {
    if (!buildPdfRows().length) {
      alert('No rows to export.');
      return;
    }
    try {
      const { generatePDF } = await import('../utils/pdfgenerator');
      await generatePDF('pur-exp-master', buildPdfRows(), buildPdfMeta());
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const handleWhatsApp = async () => {
    const exportRows = buildPdfRows();
    if (!exportRows.length) {
      alert('No rows to share.');
      return;
    }
    const shareText = [compName || 'Company', 'Purchase Exp Master', `Rows: ${exportRows.length}`].join('\n');
    try {
      const { sharePdfWithWhatsApp } = await import('../utils/pdfgenerator');
      await sharePdfWithWhatsApp('pur-exp-master', exportRows, buildPdfMeta(), shareText);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const formDisabled = saving || !canEditRows;

  if (loading) {
    return (
      <div className="slide slide-44-pur-exp pur-exp-screen pur-exp-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Purchase Exp Master</h2>
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
      <div className="slide slide-44-pur-exp pur-exp-screen">
        <h2 className="sale-bill-page__title">Purchase Exp Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-44-pur-exp pur-exp-screen account-master-screen item-master-screen cost-mast-screen">
      <div className="account-master-screen__chrome pur-exp-screen__chrome">
        <div className="account-master-screen__head pur-exp-screen__head">
          <div className="pur-exp-screen__head-bar cost-mast-screen__head-bar">
            <h2 className="sale-bill-page__title">Purchase Exp Master</h2>
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
              hasRows={rows.some((r) => String(r.EXP_NAME).trim())}
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
            helpReportId="pur-exp-master"
            helpLabel="Help"
            helpCompanyName={compName}
            className="pur-exp-screen__session-line"
          />
        </div>
      </div>

      <div className="pur-exp-screen__body">
        {err ? <p className="deploy-update-msg deploy-update-msg--err pur-exp-screen__err">{err}</p> : null}

        <p className="pur-exp-screen__hint">
          CAL: Q = Qty, A = Amount, W = Weight. Code: use search (🔍) to pick A/c. Save replaces all rows for this company.
        </p>

        <div className="pur-exp-screen__row-actions">
          <GfasToolbarBtn
            icon="add"
            label="Add row"
            variant="primary"
            onClick={handleAddRow}
            disabled={saving || formDisabled}
          />
          <GfasToolbarBtn
            label={saving ? 'Saving…' : 'Save'}
            variant="primary"
            onClick={handleSave}
            disabled={saving || formDisabled}
          />
        </div>

        <div className="pur-exp-screen__grid-wrap">
          <table className="pur-exp-grid dane-grid">
            <thead>
              <tr>
                <th>Exp_name</th>
                <th className="num">Exp_rate</th>
                <th>CAL Q/A/W</th>
                <th>Code</th>
                <th className="pur-exp-grid__name-col">A/c name</th>
                <th className="dane-grid__act-col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row._id}>
                  <td>
                    <input
                      id={cellId(idx, 'EXP_NAME')}
                      className="form-input dane-grid__input"
                      type="text"
                      maxLength={40}
                      value={row.EXP_NAME}
                      disabled={formDisabled}
                      onChange={(e) =>
                        setCell(idx, 'EXP_NAME', e.target.value.toUpperCase())
                      }
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'EXP_NAME')}
                    />
                  </td>
                  <td className="dane-grid__num-cell">
                    <input
                      id={cellId(idx, 'EXP_RATE')}
                      className="form-input dane-grid__input"
                      type="text"
                      inputMode="decimal"
                      value={rateInputVal(row.EXP_RATE)}
                      disabled={formDisabled}
                      onChange={(e) => setRateCell(idx, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => blurRateCell(idx)}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'EXP_RATE')}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="pur-exp-grid__cal-cell">
                    <select
                      id={cellId(idx, 'CAL')}
                      className="form-input dane-grid__input pur-exp-grid__cal-select"
                      value={row.CAL || ''}
                      disabled={formDisabled}
                      onChange={(e) => setCell(idx, 'CAL', e.target.value)}
                      onKeyDown={(e) => handleGridKeyDown(e, idx, 'CAL')}
                    >
                      {CAL_OPTIONS.map((o) => (
                        <option key={o.value || '_'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="pur-exp-grid__code-cell dane-grid__code-cell">
                    <div className="pur-exp-grid__code-wrap" id={cellId(idx, 'CODE')}>
                      <MasterPartyPickList
                        options={accountOptions}
                        value={row.CODE}
                        onChange={(v) => setCodeCell(idx, v)}
                        disabled={formDisabled}
                        title="Account code"
                        placeholder="Code"
                        filterPlaceholder="Code or name…"
                        showSearchIcon
                        panelVariant="dropdown"
                        getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
                        getLabel={(o) => `${o.value ?? o.CODE ?? ''} — ${o.label ?? o.NAME ?? ''}`}
                        getTriggerLabel={(o) => String(o.value ?? o.CODE ?? row.CODE ?? '')}
                        onAfterSelect={() => {
                          if (idx < rows.length - 1) {
                            setTimeout(() => focusCell(idx + 1, 'EXP_NAME'), 50);
                          } else {
                            handleAddRow();
                            setTimeout(() => focusCell(idx + 1, 'EXP_NAME'), 80);
                          }
                        }}
                      />
                    </div>
                  </td>
                  <td className="pur-exp-grid__name-cell">{row.AC_NAME || '—'}</td>
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
