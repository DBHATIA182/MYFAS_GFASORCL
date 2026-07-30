import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { toOracleDateFromAny } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

const TABS_PU = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'lotstock', label: 'Lotstock' },
  { id: 'bills', label: 'Bills' },
];

const TABS_PB = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'bardstock', label: 'Bardstock' },
  { id: 'bills', label: 'Bills' },
];

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWgt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '0.000' : '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function SectionEmpty({ text }) {
  return <p className="pb-posting-modal__empty">{text}</p>;
}

function LedgerTable({ rows, totDr = 0, totCr = 0 }) {
  if (!rows.length) return <SectionEmpty text="No LEDGER rows for this voucher." />;
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
          <th>Dc</th>
          <th className="pb-num">Item</th>
          <th className="pb-num">Qty</th>
          <th className="pb-num">Wgt</th>
          <th className="pb-num">Rate</th>
          <th>E</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`ld-${i}-${r.trn_no}-${r.code}`}>
            <td className="pb-num">{r.trn_no || ''}</td>
            <td>{r.code}</td>
            <td className="pb-posting-modal__name">{r.ac_name}</td>
            <td className="pb-num">{r.dr_amt ? fmtAmt(r.dr_amt) : ''}</td>
            <td className="pb-num">{r.cr_amt ? fmtAmt(r.cr_amt) : ''}</td>
            <td className="pb-posting-modal__detail">{r.detail}</td>
            <td>{r.dc_code}</td>
            <td className="pb-num">{r.item_code || ''}</td>
            <td className="pb-num">{r.qnty ? fmtWgt(r.qnty) : ''}</td>
            <td className="pb-num">{r.weight ? fmtWgt(r.weight) : ''}</td>
            <td className="pb-num">{r.rate ? fmtAmt(r.rate) : ''}</td>
            <td>{r.e_type}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="pb-posting-modal__grand">
          <td colSpan={3}>Grand Total</td>
          <td className="pb-num">{fmtAmt(totDr)}</td>
          <td className="pb-num">{fmtAmt(totCr)}</td>
          <td colSpan={7} />
        </tr>
      </tfoot>
    </table>
  );
}

function LotstockTable({ rows, emptyText = 'No LOTSTOCK rows (Stock may be N, or not posted).' }) {
  if (!rows.length) return <SectionEmpty text={emptyText} />;
  return (
    <table className="pb-posting-modal__table">
      <thead>
        <tr>
          <th>E</th>
          <th className="pb-num">Item</th>
          <th>Name</th>
          <th>St</th>
          <th className="pb-num">Qty</th>
          <th className="pb-num">Wgt</th>
          <th className="pb-num">Rate</th>
          <th className="pb-num">Amount</th>
          <th className="pb-num">Lot</th>
          <th className="pb-num">B.No</th>
          <th>God</th>
          <th>Sup</th>
          <th>MSup</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`ls-${i}-${r.item_code}-${r.lot}-${r.b_no}`}>
            <td>{r.e_type}</td>
            <td className="pb-num">{r.item_code || ''}</td>
            <td className="pb-posting-modal__name">{r.item_name}</td>
            <td>{r.status}</td>
            <td className="pb-num">{fmtWgt(r.qnty)}</td>
            <td className="pb-num">{fmtWgt(r.weight)}</td>
            <td className="pb-num">{fmtAmt(r.rate)}</td>
            <td className="pb-num">{fmtAmt(r.amount)}</td>
            <td className="pb-num">{r.lot || ''}</td>
            <td className="pb-num">{r.b_no || ''}</td>
            <td>{r.god_code}</td>
            <td>{r.sup_code}</td>
            <td>{r.msup_code || r.msup_name}</td>
            <td className="pb-posting-modal__detail">{r.remarks}</td>
          </tr>
        ))}
      </tbody>
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
          <th>Name</th>
          <th>Bill Dt</th>
          <th>Bill No</th>
          <th className="pb-num">Dr</th>
          <th className="pb-num">Cr</th>
          <th>Detail</th>
          <th className="pb-num">Days</th>
          <th>B.Type</th>
          <th>Bk</th>
          <th>V.Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`bl-${i}-${r.trn_no}-${r.code}`}>
            <td className="pb-num">{r.trn_no || ''}</td>
            <td>{r.code}</td>
            <td className="pb-posting-modal__name">{r.ac_name}</td>
            <td>{r.bill_date}</td>
            <td>{r.bill_no}</td>
            <td className="pb-num">{r.dr_amt ? fmtAmt(r.dr_amt) : ''}</td>
            <td className="pb-num">{r.cr_amt ? fmtAmt(r.cr_amt) : ''}</td>
            <td className="pb-posting-modal__detail">{r.detail}</td>
            <td className="pb-num">{r.days || ''}</td>
            <td>{r.b_type || r.type}</td>
            <td>{r.bk_code}</td>
            <td>{r.v_date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shows LEDGER / LOTSTOCK / BILLS postings for the opened purchase bill. */
export default function PurchaseBillPostingModal({
  open,
  apiBase,
  apiParams,
  billType = 'PU',
  rDate,
  rNo,
  onClose,
}) {
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
      const { data: out } = await axios.get(`${apiRoot}/api/purchase-bill/posting`, {
        params: {
          ...apiParams,
          type: billType,
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
  }, [apiParams, apiRoot, billType, rDate, rNo]);

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

  const isPb = String(billType || '').trim().toUpperCase() === 'PB';
  const tabs = isPb ? TABS_PB : TABS_PU;
  const counts = data?.counts || { ledger: 0, lotstock: 0, bardstock: 0, bills: 0 };
  const totals = data?.totals || {};
  const stockCount = isPb ? counts.bardstock : counts.lotstock;
  const stockLabel = isPb ? 'Bardstock' : 'Lotstock';
  const okPost =
    counts.ledger > 0 && counts.bills > 0
      ? 'Posting found in LEDGER and BILLS.'
      : counts.ledger > 0
        ? `LEDGER found — check BILLS / ${stockLabel} tabs.`
        : 'No posting rows yet — save the bill first.';

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="dialog" aria-modal="true" aria-label="Purchase bill posting">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel pb-posting-modal">
        <div className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">
            Posting — {String(billType || 'PU').toUpperCase()} {rNo} · {toOracleDateFromAny(rDate) || rDate || ''}
          </h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="pb-posting-modal__summary">
          <span>
            Ledger <strong>{counts.ledger}</strong>
            {totals.ledger_dr || totals.ledger_cr
              ? ` (Dr ${fmtAmt(totals.ledger_dr)} / Cr ${fmtAmt(totals.ledger_cr)})`
              : ''}
          </span>
          <span>
            {stockLabel} <strong>{stockCount}</strong>
          </span>
          <span>
            Bills <strong>{counts.bills}</strong>
            {totals.bills_dr || totals.bills_cr
              ? ` (Dr ${fmtAmt(totals.bills_dr)} / Cr ${fmtAmt(totals.bills_cr)})`
              : ''}
          </span>
          <span className="pb-posting-modal__ok">{okPost}</span>
        </div>

        <div className="pb-posting-modal__tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pb-posting-modal__tab${tab === t.id ? ' pb-posting-modal__tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} ({counts[t.id] ?? 0})
            </button>
          ))}
          <button type="button" className="pb-posting-modal__refresh" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>

        {error ? <p className="voucher-entry-form__status voucher-entry-form__status--err">{error}</p> : null}
        {loading ? <p className="voucher-entry-form__status">Loading posting…</p> : null}

        <div className="voucher-help-modal__body pb-posting-modal__body">
          {!loading && tab === 'ledger' ? (
            <LedgerTable
              rows={data?.ledger || []}
              totDr={totals.ledger_dr || 0}
              totCr={totals.ledger_cr || 0}
            />
          ) : null}
          {!loading && tab === 'lotstock' ? <LotstockTable rows={data?.lotstock || []} /> : null}
          {!loading && tab === 'bardstock' ? (
            <LotstockTable
              rows={data?.bardstock || []}
              emptyText="No BARDSTOCK rows (Stock may be N, or not posted)."
            />
          ) : null}
          {!loading && tab === 'bills' ? <BillsTable rows={data?.bills || []} /> : null}
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
