import React, { useEffect, useRef } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { buildBrokerOsDisplayRows } from '../utils/brokerOsDisplay';
import { buildSaleListDisplayRows, saleListMeas } from '../utils/saleListDisplay';
import { ageingCurBalDisplay } from '../utils/ageingDisplay';

const LEDGER_SALE_VR_TYPES = new Set(['SL', 'SE', 'CN']);

export default function ReportTable({
  data,
  type,
  onLedgerClick,
  onSaleBillClick,
  onVoucherClick,
  onLedgerSaleBillClick,
  meta,
  billLedgerInterest = false,
  billLedgerKind = 'customer',
}) {
  if (!data || data.length === 0) return <p className="no-data">No data available.</p>;

  const saleListTopScrollRef = useRef(null);
  const saleListTopInnerRef = useRef(null);
  const saleListGridScrollRef = useRef(null);

  useEffect(() => {
    if (type !== 'sale-list') return;
    const top = saleListTopScrollRef.current;
    const topInner = saleListTopInnerRef.current;
    const grid = saleListGridScrollRef.current;
    if (!top || !topInner || !grid) return;

    let syncingFromTop = false;
    let syncingFromGrid = false;

    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };

    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };

    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };

    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncWidths);
      ro.observe(grid);
      const tableEl = grid.querySelector('table');
      if (tableEl) ro.observe(tableEl);
    }

    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
      if (ro) ro.disconnect();
    };
  }, [type, data]);

  // Indian Currency Formatter
  const fmt = (val) => {
    const num = parseFloat(val) || 0;
    return num === 0 ? '-' : num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  const fmtAlways = (val) => {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  const clampText = (value, maxLen = 25) => {
    const s = String(value ?? '');
    if (s.length <= maxLen) return s;
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
  };

  // --- TRIAL BALANCE VIEW (full grid + grand total; scrolls horizontally on small screens) ---
  if (type === 'trial-balance') {
    let gDr = 0;
    let gCr = 0;
    let gCdr = 0;
    let gCcr = 0;
    data.forEach((row) => {
      gDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      gCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
      gCdr += parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
      gCcr += parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
    });

    return (
      <div className="table-responsive table-responsive--trial">
        <table className="report-table report-table--trial">
          <thead>
            <tr>
              <th scope="col">Sch</th>
              <th scope="col">Account</th>
              <th scope="col">Code</th>
              <th scope="col">City</th>
              <th scope="col" className="text-right">
                Clos. Dr
              </th>
              <th scope="col" className="text-right">
                Clos. Cr
              </th>
              <th scope="col" className="text-right">
                Dr amt
              </th>
              <th scope="col" className="text-right">
                Cr amt
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const codeVal = row.CODE ?? row.code;
              const nameVal = row.NAME ?? row.name;
              const cityVal = row.CITY ?? row.city;
              const schVal = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;

              const cdr = parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
              const ccr = parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
              const drAmt = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
              const crAmt = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;

              const isTotal =
                codeVal == null ||
                codeVal === '' ||
                (nameVal && String(nameVal).toUpperCase().includes('TOTAL'));

              return (
                <tr
                  key={idx}
                  className={isTotal ? 'trial-subtotal-row' : 'clickable-row'}
                  onClick={() => !isTotal && onLedgerClick && onLedgerClick(codeVal, nameVal)}
                >
                  <td className="trial-sch">{schVal != null && schVal !== '' ? schVal : '—'}</td>
                  <td className="trial-name">
                    <span className="name-text">{nameVal}</span>
                  </td>
                  <td className="trial-code">{codeVal != null && codeVal !== '' ? codeVal : '—'}</td>
                  <td className="trial-city">{cityVal != null && cityVal !== '' ? cityVal : '—'}</td>
                  <td className={`text-right ${cdr > 0 ? 'dr-amt' : ''}`}>{cdr > 0 ? fmt(cdr) : '—'}</td>
                  <td className={`text-right ${ccr > 0 ? 'cr-amt' : ''}`}>{ccr > 0 ? fmt(ccr) : '—'}</td>
                  <td className={`text-right ${drAmt > 0 ? 'dr-amt' : ''}`}>{drAmt > 0 ? fmt(drAmt) : '—'}</td>
                  <td className={`text-right ${crAmt > 0 ? 'cr-amt' : ''}`}>{crAmt > 0 ? fmt(crAmt) : '—'}</td>
                </tr>
              );
            })}
            <tr className="trial-grand-total">
              <td colSpan={4}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCdr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCcr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- LEDGER VIEW ---
  if (type === 'ledger') {
    let sumDr = 0;
    let sumCr = 0;
    data.forEach((row) => {
      sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    });
    const lastRow = data[data.length - 1];
    const closingBal =
      lastRow != null
        ? parseFloat(lastRow.CL_BALANCE ?? lastRow.cl_balance ?? lastRow.RUN_BAL ?? lastRow.run_bal ?? 0) || 0
        : 0;

    return (
      <div className="table-responsive table-responsive--ledger">
        <table className="report-table report-table--ledger">
          <thead>
            <tr>
              <th>vr_Date</th>
              <th>vr_no</th>
              <th>vr_type</th>
              <th>type</th>
              <th>detail</th>
              <th className="text-right">dr_amt</th>
              <th className="text-right">cr_amt</th>
              <th className="text-right">cl_balance</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const vrType = row.VR_TYPE ?? row.vr_type;
              const vrDate = row.VR_DATE ?? row.vr_date;
              const vrNo = row.VR_NO ?? row.vr_no;
              const lineType = row.TYPE ?? row.type;
              const clBal = row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal;
              const vrUpper = vrType ? String(vrType).toUpperCase() : '';
              const canSaleBill =
                typeof onLedgerSaleBillClick === 'function' &&
                vrUpper &&
                LEDGER_SALE_VR_TYPES.has(vrUpper) &&
                vrNo != null &&
                String(vrNo).trim() !== '' &&
                Number(vrNo) > 0;
              const canDrill =
                !canSaleBill &&
                onVoucherClick &&
                vrType &&
                vrUpper !== 'OP' &&
                vrNo != null &&
                String(vrNo).trim() !== '' &&
                Number(vrNo) > 0;
              const clickable = canSaleBill || canDrill;
              return (
                <tr
                  key={i}
                  className={[vrType === 'OP' ? 'opening-row' : '', clickable ? 'clickable-row' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (canSaleBill) onLedgerSaleBillClick(row);
                    else if (canDrill) onVoucherClick(row);
                  }}
                >
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(vrDate)}</td>
                  <td className="col-ledger-vr-no">{vrNo != null && vrNo !== '' ? String(vrNo) : '—'}</td>
                  <td className="col-ledger-type">
                    <span className={`badge-type ${String(vrType ?? '').replace(/\s+/g, '')}`}>{vrType ?? '—'}</span>
                  </td>
                  <td className="col-ledger-line-type">
                    {lineType != null && lineType !== '' ? String(lineType) : '—'}
                  </td>
                  <td className="ledger-detail">{row.DETAIL ?? row.detail}</td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right" style={{ fontWeight: 'bold', color: '#2c7a7b' }}>
                    {fmt(clBal)}
                  </td>
                </tr>
              );
            })}
            <tr className="ledger-grand-total">
              <td colSpan={5}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumCr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(closingBal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- Voucher detail: all LEDGER lines for one VR_DATE + VR_TYPE + VR_NO ---
  if (type === 'ledger-voucher') {
    let sumDr = 0;
    let sumCr = 0;
    data.forEach((row) => {
      sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    });

    return (
      <div className="table-responsive table-responsive--ledger">
        <table className="report-table report-table--ledger report-table--voucher">
          <thead>
            <tr>
              <th>Account</th>
              <th>Name</th>
              <th>City</th>
              <th>Type</th>
              <th>Detail</th>
              <th>DC</th>
              <th className="text-right">Dr Amt</th>
              <th className="text-right">Cr Amt</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const code = row.CODE ?? row.code;
              const lineType = row.TYPE ?? row.type;
              return (
                <tr key={i}>
                  <td>{code != null && code !== '' ? code : '—'}</td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td>{row.CITY ?? row.city ?? '—'}</td>
                  <td>
                    <span className="type-label">{lineType != null && lineType !== '' ? lineType : '—'}</span>
                  </td>
                  <td className="ledger-detail">{row.DETAIL ?? row.detail ?? '—'}</td>
                  <td className="ledger-detail" title={row.DC_NAME ?? row.dc_name ?? ''}>
                    {(row.DC_CODE ?? row.dc_code) != null && (row.DC_CODE ?? row.dc_code) !== ''
                      ? `${row.DC_CODE ?? row.dc_code}${(row.DC_NAME ?? row.dc_name) ? ` — ${row.DC_NAME ?? row.dc_name}` : ''}`
                      : '—'}
                  </td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                </tr>
              );
            })}
            <tr className="ledger-grand-total">
              <td colSpan={6}>
                <strong>VOUCHER TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing-ledger-detail') {
    let totalPending = 0;
    return (
      <div className="table-responsive table-responsive--ledger">
        <table className="report-table report-table--ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Detail</th>
              <th className="text-right">Dr Amt</th>
              <th className="text-right">Cr Amt</th>
              <th className="text-right">Pending Bal</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const pending = parseFloat(row.PENDING_BAL ?? row.pending_bal ?? 0) || 0;
              totalPending += pending;
              const vrType = row.VR_TYPE ?? row.vr_type;
              return (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date)}</td>
                  <td>
                    <span className={`badge-type ${vrType}`}>{vrType ?? '—'}</span>
                  </td>
                  <td className="ledger-detail">{row.DETAIL ?? row.detail ?? '—'}</td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right" style={{ fontWeight: 'bold', color: '#2c7a7b' }}>
                    {fmtAlways(pending)}
                  </td>
                </tr>
              );
            })}
            <tr className="ledger-grand-total">
              <td colSpan={5}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(totalPending)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- BILL-WISE LEDGER (BILLS + running balance per bill) ---
  if (type === 'bill-ledger') {
    const billKeyOf = (row) => {
      const billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
      const billDt = formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date);
      const bType = String(row.B_TYPE ?? row.b_type ?? '').trim();
      return `${billDt}__${billNo}__${bType}`;
    };

    let sumDr = 0;
    let sumCr = 0;
    let sumCurrent = 0;
    let sumInterest = 0;
    let sumClosePlusInt = 0;
    const displayRows = [];

    let billDr = 0;
    let billCr = 0;
    let billCurrent = 0;

    data.forEach((row, idx) => {
      const dr = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      const cr = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
      const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;

      sumDr += dr;
      sumCr += cr;
      billDr += dr;
      billCr += cr;
      billCurrent = cl;

      displayRows.push({ kind: 'detail', row, idx });

      const curKey = billKeyOf(row);
      const next = data[idx + 1];
      const nextKey = next ? billKeyOf(next) : '';
      const billEnds = !next || curKey !== nextKey;
      if (!billEnds) return;

      sumCurrent += billCurrent;
      const intAmt = billLedgerInterest ? parseFloat(row.INTEREST_AMT ?? row.interest_amt ?? '') || 0 : 0;
      const idays = billLedgerInterest ? (row.INTEREST_DAYS ?? row.interest_days ?? '') : '';
      const closePlusInt = billLedgerInterest ? billCurrent + intAmt : null;
      if (billLedgerInterest) {
        sumInterest += intAmt;
        sumClosePlusInt += closePlusInt ?? 0;
      }
      displayRows.push({
        kind: 'bill-total',
        CODE: row.CODE ?? row.code ?? '',
        NAME: row.NAME ?? row.name ?? '',
        BILL_NO: row.BILL_NO ?? row.bill_no ?? '',
        BILL_DATE: row.BILL_DATE ?? row.bill_date ?? '',
        B_TYPE: row.B_TYPE ?? row.b_type ?? '',
        DR_AMT: billDr,
        CR_AMT: billCr,
        CL_BALANCE: billCurrent,
        INTEREST_DAYS: idays === '' || idays == null ? null : idays,
        INTEREST_AMT: intAmt,
        CLOSE_PLUS_INT: closePlusInt,
      });

      billDr = 0;
      billCr = 0;
      billCurrent = 0;
    });

    const intHead = billLedgerInterest ? (
      <>
        <th className="text-right" scope="col">
          Int days
        </th>
        <th className="text-right bill-ledger-th-interest" scope="col">
          Interest
        </th>
        <th className="text-right" scope="col">
          Closing + int
        </th>
      </>
    ) : null;

    const firstRow = data?.[0] || {};
    const partyCodeTop = String(meta?.billLedgerPartyCode ?? firstRow.CODE ?? firstRow.code ?? '').trim();
    const partyNameTop = String(meta?.billLedgerPartyName ?? firstRow.NAME ?? firstRow.name ?? '').trim();

    return (
      <div className="table-responsive table-responsive--bill-ledger">
        {(partyCodeTop || partyNameTop) ? (
          <p style={{ margin: '0 0 8px', fontWeight: 700, color: '#0f172a' }}>
            {partyNameTop || 'Party'}{partyCodeTop ? ` (${partyCodeTop})` : ''}
          </p>
        ) : null}
        <table className="report-table report-table--bill-ledger">
          <thead>
            <tr>
              <th scope="col">Bill no</th>
              <th scope="col">Bill date</th>
              <th scope="col">B type</th>
              <th scope="col">Vr date</th>
              <th scope="col">Vr no</th>
              <th scope="col">Vr type</th>
              <th className="text-right" scope="col">
                Cr amt
              </th>
              <th className="text-right" scope="col">
                Dr amt
              </th>
              <th className="text-right" scope="col">
                Current bal
              </th>
              {intHead}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'bill-total') {
                const billNo = item.BILL_NO ?? '—';
                const billDt = formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date);
                const bType = item.B_TYPE ?? item.b_type ?? '—';
                return (
                  <tr key={`bt-${i}`} className="bill-ledger-bill-total">
                    <td colSpan={6}>
                      <strong>Bill total — {billDt} / {billNo} / {bType}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.CR_AMT)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.DR_AMT)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.CL_BALANCE)}</strong>
                    </td>
                    {billLedgerInterest ? (
                      <>
                        <td className="text-right">
                          <strong>{item.INTEREST_DAYS != null && item.INTEREST_DAYS !== '' ? item.INTEREST_DAYS : '—'}</strong>
                        </td>
                        <td className="text-right bill-ledger-interest-amt">
                          <strong>{fmtAlways(item.INTEREST_AMT)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtAlways(item.CLOSE_PLUS_INT)}</strong>
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              }

              const row = item.row;
              const billDt = row.BILL_DATE ?? row.bill_date;
              const vrDt = row.VR_DATE ?? row.vr_date;
              const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;
              return (
                <tr key={i}>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(billDt)}</td>
                  <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(vrDt)}</td>
                  <td>{row.VR_NO ?? row.vr_no ?? '—'}</td>
                  <td>
                    <span className={`badge-type ${row.VR_TYPE ?? row.vr_type ?? ''}`}>
                      {row.VR_TYPE ?? row.vr_type ?? '—'}
                    </span>
                  </td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right" style={{ fontWeight: 700, color: '#2c7a7b' }}>
                    {fmtAlways(cl)}
                  </td>
                  {billLedgerInterest ? (
                    <>
                      <td className="text-right" style={{ opacity: 0.65 }}>
                        —
                      </td>
                      <td className="text-right" style={{ opacity: 0.65 }}>
                        —
                      </td>
                      <td className="text-right" style={{ opacity: 0.65 }}>
                        —
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
            <tr className="bill-ledger-grand-total">
              <td colSpan={6}>
                <strong>GRAND TOTAL</strong>
                <span className="bill-ledger-grand-note">
                  {' '}
                  (Dr/Cr totals + sum of bill current balances
                  {billLedgerInterest ? `; interest per bill (${String(billLedgerKind).toLowerCase() === 'supplier' ? 'GETINT_SUP' : 'GETINT'})` : ''})
                </span>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(sumCr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(sumDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(sumCurrent)}</strong>
              </td>
              {billLedgerInterest ? (
                <>
                  <td className="text-right">
                    <strong>—</strong>
                  </td>
                  <td className="text-right bill-ledger-interest-amt">
                    <strong>{fmtAlways(sumInterest)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAlways(sumClosePlusInt)}</strong>
                  </td>
                </>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing-bills-detail') {
    let totalBal = 0;
    return (
      <div className="table-responsive table-responsive--bill-ledger">
        <table className="report-table report-table--bill-ledger">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Bill no</th>
              <th scope="col">Bill date</th>
              <th scope="col">B type</th>
              <th className="text-right" scope="col">Dr amt</th>
              <th className="text-right" scope="col">Cr amt</th>
              <th className="text-right" scope="col">Pending bal</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const bal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
              totalBal += bal;
              return (
                <tr key={i}>
                  <td className="bill-code">{row.CODE ?? row.code ?? '—'}</td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date)}</td>
                  <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right" style={{ fontWeight: 700, color: '#2c7a7b' }}>{fmtAlways(bal)}</td>
                </tr>
              );
            })}
            <tr className="bill-ledger-grand-total">
              <td colSpan={7}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(totalBal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- SALE LIST (SALE + MASTER + ITEMMAST); day / grand totals + item summaries; detail row opens bill ---
  if (type === 'sale-list') {
    const { displayRows } = buildSaleListDisplayRows(data);
    const clickable = typeof onSaleBillClick === 'function';
    return (
      <div className="table-responsive table-responsive--sale-list" ref={saleListGridScrollRef}>
        {onSaleBillClick ? (
          <p className="sale-list-hint">
            Use the <strong>horizontal scrollbar</strong> in this grid (or Shift+mouse wheel) to see all columns. Bill-wise
            and day-wise totals are shown; click a detail row to open full sale bill.
          </p>
        ) : null}
        <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={saleListTopScrollRef}>
          <div className="sale-list-scroll-sync-inner" ref={saleListTopInnerRef} />
        </div>
        <table className="report-table report-table--sale-list">
          <thead>
            <tr>
              <th scope="col">Tp</th>
              <th scope="col">InvDate</th>
              <th scope="col">InvNo</th>
              <th scope="col">Bt</th>
              <th scope="col">Party</th>
              <th scope="col">Name</th>
              <th scope="col">City</th>
              <th scope="col">PAN</th>
              <th scope="col">GST</th>
              <th scope="col">Bk</th>
              <th scope="col">Bk name</th>
              <th scope="col">Trn</th>
              <th scope="col">Item</th>
              <th scope="col">Item name</th>
              <th scope="col">Lot</th>
              <th scope="col">Status</th>
              <th className="text-right" scope="col">
                Qty
              </th>
              <th className="text-right" scope="col">
                Wt
              </th>
              <th className="text-right" scope="col">
                Rate
              </th>
              <th className="text-right" scope="col">
                Amount
              </th>
              <th className="text-right" scope="col">
                Taxable
              </th>
              <th className="text-right" scope="col">
                CGST
              </th>
              <th className="text-right" scope="col">
                SGST
              </th>
              <th className="text-right" scope="col">
                IGST
              </th>
              <th className="text-right" scope="col">
                Bill amt
              </th>
              <th className="text-right" scope="col">
                Dis amt
              </th>
              <th className="text-right" scope="col">
                Round off
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'day-header') {
                return (
                  <tr key={`dh-${i}`} className="sale-list-day-banner">
                    <td colSpan={27}>
                      <strong>Day — {item.dateLabel}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'day-total') {
                return (
                  <tr key={`dt-${i}`} className="sale-list-day-total">
                    <td colSpan={16}>
                      <strong>Day total</strong> — {item.dateLabel}
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                    <td className="text-right">{fmtAlways(item.disAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                  </tr>
                );
              }
              if (item.kind === 'bill-total') {
                return (
                  <tr key={`bt-${i}`} className="sale-list-bill-total">
                    <td colSpan={16}>
                      <strong>Bill total</strong> — {item.type} / {item.billDateLabel} / {item.billNo} / {item.bType}
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                    <td className="text-right">{fmtAlways(item.disAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                  </tr>
                );
              }
              if (item.kind === 'section-label') {
                return (
                  <tr key={`sl-${i}`} className="sale-list-section-label">
                    <td colSpan={27}>
                      <strong>{item.label}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'item-col-head') {
                return (
                  <tr key={`ich-${i}`} className="sale-list-item-col-head sale-list-item-summary-head">
                    <th scope="col" className="bill-code">
                      Item code
                    </th>
                    <th scope="col" className="ledger-detail">
                      Item name
                    </th>
                    <th scope="col" className="text-right">
                      Qty
                    </th>
                    <th scope="col" className="text-right">
                      Weight
                    </th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                    <td colSpan={22} className="sale-list-item-summary-filler sale-list-item-summary-filler--trail" />
                  </tr>
                );
              }
              if (item.kind === 'grand-item') {
                return (
                  <tr key={`gi-${i}-${item.code}`} className="sale-list-grand-item sale-list-item-summary-row">
                    <td className="bill-code">{item.code && item.code !== '—' ? item.code : '—'}</td>
                    <td className="ledger-detail">
                      <strong>{item.name}</strong>
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td colSpan={22} className="sale-list-item-summary-filler sale-list-item-summary-filler--trail">
                      —
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'grand-total') {
                return (
                  <tr key={`gt-${i}`} className="sale-list-grand-total">
                    <td colSpan={16}>
                      <strong>Grand total</strong>
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                    <td className="text-right">{fmtAlways(item.disAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                  </tr>
                );
              }
              const row = item.row;
              const billDt = row.BILL_DATE ?? row.bill_date;
              const saleType = String(row.TYPE ?? row.type ?? '').trim().toUpperCase();
              const isCreditNote = saleType === 'CN';
              const rowClass = [clickable && 'sale-list-row-clickable', isCreditNote && 'sale-list-row-cn']
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={`d-${i}`}
                  className={rowClass || undefined}
                  onClick={clickable ? () => onSaleBillClick(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSaleBillClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'button' : undefined}
                >
                  <td>{row.TYPE ?? row.type ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(billDt)}</td>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td className="bill-code">{row.CODE ?? row.code ?? '—'}</td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td>{row.CITY ?? row.city ?? '—'}</td>
                  <td>{row.PAN ?? row.pan ?? '—'}</td>
                  <td>{row.GST_NO ?? row.gst_no ?? '—'}</td>
                  <td className="bill-code">{row.BK_CODE ?? row.bk_code ?? '—'}</td>
                  <td className="ledger-detail" title={row.BK_NAME ?? row.bk_name ?? ''}>
                    {clampText(row.BK_NAME ?? row.bk_name ?? '—', 25)}
                  </td>
                  <td>{row.TRN_NO ?? row.trn_no ?? '—'}</td>
                  <td className="bill-code">{row.ITEM_CODE ?? row.item_code ?? '—'}</td>
                  <td className="ledger-detail">{row.ITEM_NAME ?? row.item_name ?? '—'}</td>
                  <td>{row.LOT ?? row.lot ?? '—'}</td>
                  <td>{row.STATUS ?? row.status ?? '—'}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'QNTY', 'qnty'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'WEIGHT', 'weight'))}</td>
                  <td className="text-right">{fmt(row.RATE ?? row.rate)}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'AMOUNT', 'amount'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'TAXABLE', 'taxable'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'CGST_AMT', 'cgst_amt'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'SGST_AMT', 'sgst_amt'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'IGST_AMT', 'igst_amt'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'BILL_AMT', 'bill_amt'))}</td>
                  <td className="text-right">{fmt(row.DIS_AMT ?? row.dis_amt)}</td>
                  <td className="text-right">{fmt(row.OTH_EXP5 ?? row.oth_exp5)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // --- BROKER-WISE OUTSTANDING (alpha party within broker + party / broker / grand totals) ---
  if (type === 'broker-os') {
    const { displayRows, grandDr, grandCr } = buildBrokerOsDisplayRows(data);

    return (
      <div className="table-responsive table-responsive--broker-os">
        <table className="report-table report-table--broker-os">
          <thead>
            <tr>
              <th scope="col">Broker</th>
              <th scope="col">Code</th>
              <th scope="col">Party</th>
              <th scope="col">Bill no</th>
              <th scope="col">Bill date</th>
              <th scope="col">Vr type</th>
              <th scope="col">Vr date</th>
              <th scope="col">Vr no</th>
              <th className="text-right" scope="col">
                Dr amt
              </th>
              <th className="text-right" scope="col">
                Cr amt
              </th>
              <th className="text-right" scope="col">
                Run bal
              </th>
              <th className="text-right" scope="col">
                Final bal
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'bill-total') {
                const code = item.CODE || '—';
                const billDt = formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date);
                const billNo = item.BILL_NO || '—';
                const bType = item.B_TYPE || '—';
                return (
                  <tr key={`blt-${i}`} className="broker-os-bill-total">
                    <td colSpan={8}>
                      <strong>
                        Bill total — {code} / {billDt} / {billNo} / {bType}
                      </strong>
                    </td>
                    <td className="text-right dr-amt">
                      <strong>{fmtAlways(item.DR_AMT)}</strong>
                    </td>
                    <td className="text-right cr-amt">
                      <strong>{fmtAlways(item.CR_AMT)}</strong>
                    </td>
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'party-total') {
                const label = `Party total — ${item.NAME || '—'} (${item.CODE})`;
                return (
                  <tr key={`pt-${i}`} className="broker-os-party-total">
                    <td colSpan={8}>
                      <strong>{label}</strong>
                    </td>
                    <td className="text-right dr-amt">
                      <strong>{fmtAlways(item.DR_AMT)}</strong>
                    </td>
                    <td className="text-right cr-amt">
                      <strong>{fmtAlways(item.CR_AMT)}</strong>
                    </td>
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'broker-total') {
                return (
                  <tr key={`bt-${i}`} className="broker-os-broker-total">
                    <td colSpan={8}>
                      <strong>Broker total — {item.BK_CODE || '—'}</strong>
                    </td>
                    <td className="text-right dr-amt">
                      <strong>{fmtAlways(item.DR_AMT)}</strong>
                    </td>
                    <td className="text-right cr-amt">
                      <strong>{fmtAlways(item.CR_AMT)}</strong>
                    </td>
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              const row = item.row;
              const billDt = row.BILL_DATE ?? row.bill_date;
              const vrDt = row.VR_DATE ?? row.vr_date;
              const runB = parseFloat(row.RUN_BAL ?? row.run_bal ?? 0) || 0;
              const finB = parseFloat(row.FINAL_BAL ?? row.final_bal ?? 0) || 0;
              return (
                <tr key={`d-${i}`}>
                  <td className="bill-code">{row.BK_CODE ?? row.bk_code ?? '—'}</td>
                  <td>{row.CODE ?? row.code ?? '—'}</td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(billDt)}</td>
                  <td>
                    <span className={`badge-type ${row.VR_TYPE ?? row.vr_type ?? ''}`}>
                      {row.VR_TYPE ?? row.vr_type ?? '—'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(vrDt)}</td>
                  <td>{row.VR_NO ?? row.vr_no ?? '—'}</td>
                  <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right" style={{ fontWeight: 700, color: '#2c7a7b' }}>
                    {fmtAlways(runB)}
                  </td>
                  <td className="text-right" style={{ fontWeight: 600, color: '#1e3a5f' }}>
                    {fmtAlways(finB)}
                  </td>
                </tr>
              );
            })}
            <tr className="bill-ledger-grand-total">
              <td colSpan={8}>
                <strong>GRAND TOTAL</strong>
                <span className="bill-ledger-grand-note"> (all detail lines)</span>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(grandDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(grandCr)}</strong>
              </td>
              <td className="text-right">
                <strong>—</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(grandDr - grandCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing') {
    const labels = Array.isArray(meta?.rangeLabels) && meta.rangeLabels.length === 5
      ? meta.rangeLabels
      : ['0 to 30', '31 to 60', '61 to 90', '91 to 180', '181 to 99999'];
    const scheduleRaw = meta?.schedule;
    const totals = {
      curBalDisplayed: 0,
      curBalRaw: 0,
      ranges: [0, 0, 0, 0, 0],
    };
    data.forEach((row) => {
      const rawBal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
      const { display } = ageingCurBalDisplay(scheduleRaw, rawBal);
      totals.curBalDisplayed += display;
      totals.curBalRaw += rawBal;
      for (let i = 0; i < 5; i += 1) {
        totals.ranges[i] += parseFloat(row[`RANGE_${i + 1}`] ?? row[`range_${i + 1}`] ?? 0) || 0;
      }
    });
    const totalCurAlert = ageingCurBalDisplay(scheduleRaw, totals.curBalRaw).alert;

    return (
      <div className="table-responsive table-responsive--trial">
        <table className="report-table report-table--trial">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>City</th>
              <th className="text-right">Cur. Bal</th>
              {labels.map((label, idx) => (
                <th key={idx} className="text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const rawBal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
              const curDisp = ageingCurBalDisplay(scheduleRaw, rawBal);
              return (
              <tr
                key={idx}
                className={typeof onLedgerClick === 'function' ? 'clickable-row' : ''}
                onClick={() => typeof onLedgerClick === 'function' && onLedgerClick(row.CODE ?? row.code, row.NAME ?? row.name, row)}
              >
                <td>{row.CODE ?? row.code ?? '—'}</td>
                <td className="trial-name">
                  <span className="name-text">{row.NAME ?? row.name ?? '—'}</span>
                </td>
                <td>{row.CITY ?? row.city ?? '—'}</td>
                <td className={`text-right${curDisp.alert ? ' ageing-cur-bal-alert' : ''}`}>
                  <strong>{fmtAlways(curDisp.display)}</strong>
                </td>
                {labels.map((_, i) => (
                  <td key={i} className="text-right">
                    {fmt(row[`RANGE_${i + 1}`] ?? row[`range_${i + 1}`])}
                  </td>
                ))}
              </tr>
              );
            })}
            <tr className="trial-grand-total">
              <td colSpan={3}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className={`text-right${totalCurAlert ? ' ageing-cur-bal-alert' : ''}`}>
                <strong>{fmtAlways(totals.curBalDisplayed)}</strong>
              </td>
              {totals.ranges.map((value, idx) => (
                <td key={idx} className="text-right">
                  <strong>{fmtAlways(value)}</strong>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}