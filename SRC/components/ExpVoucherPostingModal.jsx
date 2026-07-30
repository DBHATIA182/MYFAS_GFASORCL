import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toOracleDateFromAny } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

const TABS = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'bills', label: 'Bills' },
];

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SectionEmpty({ text }) {
  return <p className="pb-posting-modal__empty">{text}</p>;
}

function LedgerTable({ rows }) {
  if (!rows.length) return <SectionEmpty text="No LEDGER rows for this voucher." />;
  let totDr = 0;
  let totCr = 0;
  for (const r of rows) {
    totDr += Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    totCr += Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
  }
  return (
    <table className="pb-posting-modal__table">
      <thead>
        <tr>
          <th>Trn</th>
          <th>Code</th>
          <th>Name</th>
          <th className="pb-num">Dr</th>
          <th className="pb-num">Cr</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`ld-${i}-${r.TRN_NO ?? r.trn_no}-${r.CODE ?? r.code}`}>
            <td className="pb-num">{r.TRN_NO ?? r.trn_no ?? ''}</td>
            <td>{r.CODE ?? r.code}</td>
            <td className="pb-posting-modal__name">{r.NAME ?? r.name ?? r.ac_name}</td>
            <td className="pb-num">{r.DR_AMT ?? r.dr_amt ? fmtAmt(r.DR_AMT ?? r.dr_amt) : ''}</td>
            <td className="pb-num">{r.CR_AMT ?? r.cr_amt ? fmtAmt(r.CR_AMT ?? r.cr_amt) : ''}</td>
            <td className="pb-posting-modal__detail">{r.DETAIL ?? r.detail}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="pb-posting-modal__grand">
          <td colSpan={3}>Grand Total</td>
          <td className="pb-num">{fmtAmt(totDr)}</td>
          <td className="pb-num">{fmtAmt(totCr)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

function BillsTable({ rows }) {
  if (!rows.length) return <SectionEmpty text="No BILLS rows for this voucher." />;
  return (
    <table className="pb-posting-modal__table">
      <thead>
        <tr>
          <th>Trn</th>
          <th>Code</th>
          <th>Bill No</th>
          <th className="pb-num">Dr</th>
          <th className="pb-num">Cr</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`bl-${i}-${r.TRN_NO ?? r.trn_no}-${r.CODE ?? r.code}`}>
            <td className="pb-num">{r.TRN_NO ?? r.trn_no ?? ''}</td>
            <td>{r.CODE ?? r.code}</td>
            <td>{r.BILL_NO ?? r.bill_no}</td>
            <td className="pb-num">{r.DR_AMT ?? r.dr_amt ? fmtAmt(r.DR_AMT ?? r.dr_amt) : ''}</td>
            <td className="pb-num">{r.CR_AMT ?? r.cr_amt ? fmtAmt(r.CR_AMT ?? r.cr_amt) : ''}</td>
            <td className="pb-posting-modal__detail">{r.DETAIL ?? r.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** LEDGER / BILLS postings for EV expenses voucher. */
export default function ExpVoucherPostingModal({ open, apiBase, apiParams, rDate, rNo, onClose }) {
  const [tab, setTab] = useState('ledger');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const apiRoot = apiBase == null ? '' : String(apiBase);

  const load = useCallback(async () => {
    if (!apiParams?.comp_code || !rNo) return;
    setLoading(true);
    setError('');
    try {
      const { data: out } = await axios.get(`${apiRoot}/api/exp-voucher/posting`, {
        params: {
          ...apiParams,
          r_date: toOracleDateFromAny(rDate),
          r_no: Number(rNo) || 0,
        },
        ...reqOpts,
      });
      setData(out);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load posting.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiParams, apiRoot, rDate, rNo]);

  useEffect(() => {
    if (!open) return undefined;
    setTab('ledger');
    void load();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, load, onClose]);

  if (!open) return null;

  const ledger = data?.ledger || [];
  const bills = data?.bills || [];
  const okPost =
    ledger.length > 0 && bills.length > 0
      ? 'Posting found in LEDGER and BILLS.'
      : ledger.length > 0
        ? 'LEDGER found — check BILLS tab.'
        : 'No posting rows yet — save the voucher first.';

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="dialog" aria-modal="true" aria-label="Expenses voucher posting">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel ev-posting-modal pb-posting-modal">
        <div className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">
            Posting — EV {rNo} · {toOracleDateFromAny(rDate) || rDate || ''}
          </h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="pb-posting-modal__summary">
          <span>
            Ledger <strong>{ledger.length}</strong>
          </span>
          <span>
            Bills <strong>{bills.length}</strong>
          </span>
          <span className="pb-posting-modal__ok">{okPost}</span>
        </div>

        <div className="pb-posting-modal__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pb-posting-modal__tab${tab === t.id ? ' pb-posting-modal__tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} ({t.id === 'ledger' ? ledger.length : bills.length})
            </button>
          ))}
          <button type="button" className="pb-posting-modal__refresh" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>

        {error ? <p className="voucher-entry-form__status voucher-entry-form__status--err">{error}</p> : null}
        {loading ? <p className="voucher-entry-form__status">Loading posting…</p> : null}

        <div className="voucher-help-modal__body pb-posting-modal__body">
          {!loading && tab === 'ledger' ? <LedgerTable rows={ledger} /> : null}
          {!loading && tab === 'bills' ? <BillsTable rows={bills} /> : null}
        </div>

        <div className="pb-posting-modal__foot">
          <button type="button" className="gfas-toolbar-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
