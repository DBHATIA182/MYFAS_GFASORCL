import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { MasterScreenToolbar } from '../components/GfasToolbar';
import {
  BIKRI_EXP_AMOUNT_ROWS,
  BIKRI_EXP_CAT_ORDER,
  BIKRI_EXP_GRID_ROWS,
  BIKRI_EXP_SPECIAL_ROWS,
} from '../data/bikriExpConfig';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 120000 };

function emptyRecord(expCat = '') {
  const r = { EXP_CAT: expCat, GODRENT: 'N', account_names: {} };
  const nums = [
    'ARHAT_B', 'ARHAT_K', 'ARHAT_H', 'ARHAT_A', 'LABOUR_B', 'LABOUR_K', 'LABOUR_H', 'LABOUR_A',
    'DALA_B', 'DALA_K', 'DALA_H', 'DALA_A', 'DALALI_B', 'DALALI_K', 'DALALI_H', 'DALALI_A',
    'POSTAGE_B', 'POSTAGE_K', 'POSTAGE_H', 'POSTAGE_A', 'SUTLI_B', 'SUTLI_K', 'SUTLI_H', 'SUTLI_A',
    'DHARMADA', 'GAUSHALA', 'INSURANCE', 'MUDAT', 'AVG_DAYS',
    'TL_RATE_B', 'TL_RATE_K', 'TL_RATE_H', 'TL_AMT_A', 'TB_RATE_B', 'TB_RATE_K', 'TB_RATE_H', 'TB_AMT_A',
    'ST_PER', 'ST_AMT', 'SE_PER', 'SE_AMT',
  ];
  const cds = [
    'ARHAT_CD', 'LABOUR_CD', 'DALA_CD', 'DALALI_CD', 'POSTAGE_CD', 'SUTLI_CD',
    'DHAR_CD', 'GAU_CD', 'INS_CD', 'MUDAT_CD', 'GODRENT_CD', 'GOD_RENT_CODE', 'TL_CODE', 'TB_CODE', 'ST_CODE', 'SE_CODE',
  ];
  for (const k of nums) r[k] = null;
  for (const k of cds) r[k] = '';
  return r;
}

function mapRecordFromApi(data) {
  if (!data) return emptyRecord();
  return { ...emptyRecord(data.EXP_CAT ?? data.exp_cat), ...data, account_names: data.account_names || {} };
}

function numVal(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function setNumField(rec, key, raw) {
  const t = String(raw ?? '').trim();
  if (t === '') return { ...rec, [key]: null };
  const n = Number(t.replace(/,/g, ''));
  return { ...rec, [key]: Number.isFinite(n) ? n : null };
}

/** VFP DO FORM BIKEXP — BIKEXP by COMP_CODE + COMP_YEAR + EXP_CAT. */
export default function Slide33BikriExpMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = Number(formData.comp_code ?? formData.COMP_CODE ?? 0) || 0;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState([]);
  const [expCat, setExpCat] = useState('');
  const [record, setRecord] = useState(emptyRecord());
  const [isNew, setIsNew] = useState(false);
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

  const accountNameMap = useMemo(() => {
    const m = { ...(record.account_names || {}) };
    for (const o of accountOptions) {
      if (o.value) m[o.value] = o.label || m[o.value];
    }
    return m;
  }, [record.account_names, accountOptions]);

  const loadCategories = useCallback(async () => {
    const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-exp-categories'), {
      params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear },
      ...reqOpts,
    });
    setCategories(Array.isArray(data) ? data : []);
  }, [apiBase, compCode, compUid, compYear]);

  const loadRecord = useCallback(
    async (cat) => {
      const c = String(cat ?? '').trim().toUpperCase();
      if (!c) {
        setRecord(emptyRecord());
        setIsNew(false);
        return;
      }
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-exp'), {
          params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear, exp_cat: c },
          ...reqOpts,
        });
        setRecord(mapRecordFromApi(data));
        setIsNew(false);
        setErr('');
      } catch (ex) {
        if (ex?.response?.status === 404) {
          setRecord({ ...emptyRecord(c), EXP_CAT: c });
          setIsNew(true);
          setErr(
            `No Bikri Exp record for company ${compCode}, year ${compYear}, category ${c}. Use New to create, or pick another Exp.Cat.`
          );
          return;
        }
        setErr(ex?.response?.data?.error || ex.message || 'Load failed');
      }
    },
    [apiBase, compCode, compUid, compYear]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-exp-user-permissions'), {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (cancelled) return;
        setPerms(data);
        await loadCategories();
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName, loadCategories]);

  useEffect(() => {
    if (!perms?.canOpen || loading) return;
    let cancelled = false;
    axios
      .get(apiUrl(apiBase, '/api/master-accounts'), {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      })
      .then(({ data }) => {
        if (!cancelled) setAccounts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        /* account pickers still work with codes only */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, perms?.canOpen, loading]);

  useEffect(() => {
    if (!expCat || loading) return;
    loadRecord(expCat);
  }, [expCat, loading, loadRecord]);

  useEffect(() => {
    if (loading || !categories.length) return;
    if (!expCat && categories.length) {
      setExpCat(categories[0]);
    }
  }, [loading, categories, expCat]);

  const setField = (key, value) => {
    setRecord((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'GOD_RENT_CODE' || key === 'GODRENT_CD') {
        const code = String(value ?? '').trim().toUpperCase();
        next.GOD_RENT_CODE = code;
        next.GODRENT_CD = code;
      }
      return next;
    });
  };

  const handleExpCatChange = (c) => {
    const v = String(c ?? '').trim().toUpperCase().slice(0, 1);
    setExpCat(v);
  };

  const handleNew = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/bikri-exp-next-cat'), {
        params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear },
        ...reqOpts,
      });
      const next = String(data?.next_cat ?? data?.NEXT_CAT ?? '').trim().toUpperCase();
      if (!next) {
        alert('All expense categories (A–Z) already exist for this year.');
        return;
      }
      setExpCat(next);
      setRecord(emptyRecord(next));
      setIsNew(true);
    } catch (ex) {
      alert(ex?.response?.data?.error || ex.message || 'Could not get next category');
    }
  };

  const buildPayload = () => {
    const { account_names: _an, ok: _ok, message: _msg, ...rec } = record;
    return {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      actor_name: userName,
      exp_cat: record.EXP_CAT || expCat,
      EXP_CAT: record.EXP_CAT || expCat,
      ...rec,
    };
  };

  const handleSave = async () => {
    const cat = String(record.EXP_CAT || expCat || '').trim().toUpperCase();
    if (!cat) {
      alert('Select or enter Exp.Cat.');
      return;
    }
    if (isNew && !perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    if (!isNew && !perms?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const payload = buildPayload();
      const { data } = isNew
        ? await axios.post(apiUrl(apiBase, '/api/bikri-exp'), payload, reqOpts)
        : await axios.put(apiUrl(apiBase, '/api/bikri-exp'), payload, reqOpts);
      alert(data?.message || 'Saved successfully.');
      setIsNew(false);
      setExpCat(cat);
      await loadCategories();
      await loadRecord(cat);
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const cat = String(record.EXP_CAT || expCat || '').trim().toUpperCase();
    if (!cat) {
      alert('Select Exp.Cat. first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete Bikri Exp category [${cat}]?`)) return;
    setDeleting(true);
    setErr('');
    try {
      const { data } = await axios.delete(apiUrl(apiBase, '/api/bikri-exp'), {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          comp_year: compYear,
          user_name: userName,
          exp_cat: cat,
        },
        ...reqOpts,
      });
      alert(data?.message || 'Deleted.');
      setExpCat('');
      setRecord(emptyRecord());
      setIsNew(false);
      await loadCategories();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  const renderCodeCell = (cdKey) => {
    const code = String(record[cdKey] ?? '').trim();
    const name = code ? accountNameMap[code] || '' : '';
    const disabled = saving || deleting || (!perms?.canEdit && !isNew) || (!perms?.canAdd && isNew);
    return (
      <>
        <MasterPartyPickList
          options={accountOptions}
          value={code}
          onChange={(v) => setField(cdKey, String(v ?? '').trim().toUpperCase())}
          disabled={disabled}
          title="Account"
          placeholder="Code"
          filterPlaceholder="Code or name…"
          showSearchIcon
          getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
          getLabel={(o) => `${o.value ?? o.CODE ?? ''} — ${o.label ?? o.NAME ?? ''}`}
          getTriggerLabel={(o) => String(o.value ?? o.CODE ?? code)}
        />
        <span className="bikri-exp-grid__ac-name" title={name}>
          {name || '—'}
        </span>
      </>
    );
  };

  const renderNumInput = (key, disabled) => (
    <input
      className="form-input bikri-exp-grid__num"
      type="text"
      inputMode="decimal"
      value={numVal(record[key])}
      disabled={disabled}
      onChange={(e) => setRecord((prev) => setNumField(prev, key, e.target.value))}
    />
  );

  const formDisabled =
    saving || deleting || (!perms?.canEdit && !isNew) || (!perms?.canAdd && isNew);

  if (loading) {
    return (
      <div className="slide slide-36-bikri-exp bikri-exp-screen bikri-exp-screen--loading item-master-screen">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Bikri Exp</h2>
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
      <div className="slide slide-36-bikri-exp bikri-exp-screen">
        <h2 className="sale-bill-page__title">Bikri Exp</h2>
        <p className="deploy-update-msg deploy-update-msg--err">
          {err || 'Access denied — Master module rights (F4) or Supervisor required.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  const catOptions = [
    ...new Set([...BIKRI_EXP_CAT_ORDER, ...categories, expCat].filter(Boolean)),
  ].sort();

  return (
    <div className="slide slide-36-bikri-exp bikri-exp-screen account-master-screen item-master-screen">
      <div className="account-master-screen__chrome">
        <div className="account-master-screen__head">
          <div className="account-master-screen__title-row">
            <h2 className="sale-bill-page__title">Bikri Exp</h2>
          </div>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="bikri-exp" />
          <div className="bikri-exp-screen__toolbar-row">
            <MasterScreenToolbar
              onPrev={onPrev}
              onReset={onReset}
              onRefresh={() => loadRecord(expCat)}
              perms={perms}
              listLoading={saving || deleting}
              hasRows={!!expCat}
              listDisabled={!expCat}
            />
            <div className="bikri-exp-screen__actions">
              <button type="button" className="btn btn-secondary" disabled={saving || !perms?.canAdd} onClick={handleNew}>
                New
              </button>
              <button type="button" className="btn btn-primary" disabled={saving || !expCat} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={deleting || !expCat || isNew}
                onClick={handleDelete}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
          <div className="bikri-exp-screen__filter">
            <label className="sale-bill-field account-master-filter">
              <span className="sale-bill-field__label">Exp.Cat.</span>
              <select
                className="form-input"
                value={expCat}
                disabled={saving}
                onChange={(e) => handleExpCatChange(e.target.value)}
              >
                <option value="">— select —</option>
                {catOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {isNew ? <span className="bikri-exp-screen__badge">New record</span> : null}
          </div>
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <div className="bikri-exp-screen__grid-wrap">
        <table className="bikri-exp-grid">
          <thead>
            <tr>
              <th className="bikri-exp-grid__label-col">Expense</th>
              <th className="bikri-exp-grid__num-col">Bags</th>
              <th className="bikri-exp-grid__num-col">Katta</th>
              <th className="bikri-exp-grid__num-col">Hkatta</th>
              <th className="bikri-exp-grid__num-col">Amount</th>
              <th className="bikri-exp-grid__code-col">A/c Code</th>
              <th className="bikri-exp-grid__name-col">Account name</th>
            </tr>
          </thead>
          <tbody>
            {BIKRI_EXP_GRID_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className="bikri-exp-grid__num-cell">{renderNumInput(row.b, formDisabled)}</td>
                <td className="bikri-exp-grid__num-cell">{renderNumInput(row.k, formDisabled)}</td>
                <td className="bikri-exp-grid__num-cell">{renderNumInput(row.h, formDisabled)}</td>
                <td className="bikri-exp-grid__num-cell">{renderNumInput(row.a, formDisabled)}</td>
                <td className="bikri-exp-grid__code-cell">{renderCodeCell(row.cd)}</td>
                <td className="bikri-exp-grid__name-cell">
                  {accountNameMap[record[row.cd]] || '—'}
                </td>
              </tr>
            ))}
            {BIKRI_EXP_AMOUNT_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td colSpan={3} />
                <td className="bikri-exp-grid__num-cell">{renderNumInput(row.a, formDisabled)}</td>
                <td className="bikri-exp-grid__code-cell">{renderCodeCell(row.cd)}</td>
                <td className="bikri-exp-grid__name-cell">
                  {accountNameMap[record[row.cd]] || '—'}
                </td>
              </tr>
            ))}
            {BIKRI_EXP_SPECIAL_ROWS.map((row) => {
              if (row.yn) {
                return (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td colSpan={3}>
                      <select
                        className="form-input"
                        value={record.GODRENT || 'N'}
                        disabled={formDisabled}
                        onChange={(e) => setField('GODRENT', e.target.value)}
                      >
                        <option value="N">N</option>
                        <option value="Y">Y</option>
                      </select>
                    </td>
                    <td />
                    <td className="bikri-exp-grid__code-cell">{renderCodeCell(row.cd)}</td>
                    <td className="bikri-exp-grid__name-cell">
                      {accountNameMap[record[row.cd]] || accountNameMap[record[row.altCd]] || '—'}
                    </td>
                  </tr>
                );
              }
              if (row.key === 'avg_days') {
                return (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td className="bikri-exp-grid__num-cell">{renderNumInput(row.a, formDisabled)}</td>
                    <td colSpan={5} />
                  </tr>
                );
              }
              const hasBkh = row.b && row.k && row.h;
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {hasBkh ? (
                    <>
                      <td className="bikri-exp-grid__num-cell">{renderNumInput(row.b, formDisabled)}</td>
                      <td className="bikri-exp-grid__num-cell">{renderNumInput(row.k, formDisabled)}</td>
                      <td className="bikri-exp-grid__num-cell">{renderNumInput(row.h, formDisabled)}</td>
                    </>
                  ) : (
                    <td colSpan={3} />
                  )}
                  <td className="bikri-exp-grid__num-cell">
                    {renderNumInput(row.a, formDisabled)}
                    {row.amt ? (
                      <div className="bikri-exp-grid__sub-amt">
                        <span className="sale-bill-field__label">Amt</span>
                        {renderNumInput(row.amt, formDisabled)}
                      </div>
                    ) : null}
                  </td>
                  <td className="bikri-exp-grid__code-cell">{row.cd ? renderCodeCell(row.cd) : null}</td>
                  <td className="bikri-exp-grid__name-cell">
                    {row.cd ? accountNameMap[record[row.cd]] || '—' : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
