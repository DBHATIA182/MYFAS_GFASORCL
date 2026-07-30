import React from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { humanizeColumnKey, isIncomeTaxGrandTotalRow } from '../data/incomeTaxReportDefs';

function fmtVal(value, type) {
  if (value == null || value === '') return '';
  if (type === 'num') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'date') return formatLedgerDateDisplay(value) || String(value);
  return String(value);
}

function rowVal(row, key) {
  return row[key] ?? row[key?.toLowerCase?.()];
}

function LabourDrillMobileCard({ row, isGrand = false }) {
  const section = String(rowVal(row, 'SECTION') ?? '').trim();
  const eType = String(rowVal(row, 'E_TYPE') ?? '').trim();
  const lc = String(rowVal(row, 'L_C') ?? '').trim();
  const status = String(rowVal(row, 'STATUS') ?? '').trim();
  const bNo = String(rowVal(row, 'B_NO') ?? '').trim();
  const itemName = String(rowVal(row, 'ITEM_NAME') ?? '').trim();
  const itemCode = String(rowVal(row, 'ITEM_CODE') ?? '').trim();
  const lot = String(rowVal(row, 'LOT') ?? '').trim();
  const supCode = String(rowVal(row, 'SUP_CODE') ?? '').trim();
  const supName = String(rowVal(row, 'SUP_NAME') ?? '').trim();
  const expCat = String(rowVal(row, 'EXP_CAT') ?? '').trim();
  const vrNo = String(rowVal(row, 'VR_NO') ?? '').trim();
  const vrType = String(rowVal(row, 'VR_TYPE') ?? '').trim();

  const tags = [
    section && { label: 'Section', value: section },
    eType && { label: 'Type', value: eType },
    lc && { label: 'L/C', value: lc },
    status && { label: 'St', value: status },
  ].filter(Boolean);

  const metrics = [
    { label: 'R Qty', value: fmtVal(rowVal(row, 'R_QNTY'), 'num') },
    { label: 'S Qty', value: fmtVal(rowVal(row, 'S_QNTY'), 'num') },
    { label: 'Lab Amt', value: fmtVal(rowVal(row, 'LAB_AMT'), 'num'), num: true },
  ];

  const details = [
    bNo && `B.No ${bNo}`,
    itemName && `Item ${itemName}`,
    !itemName && itemCode && `Item ${itemCode}`,
    lot && `Lot ${lot}`,
    supName && `Sup ${supName}`,
    !supName && supCode && `Sup ${supCode}`,
    expCat && `Exp ${expCat}`,
    vrNo && `Vr ${vrType ? `${vrType}/` : ''}${vrNo}`,
  ].filter(Boolean);

  return (
    <article className={`labour-drill-card${isGrand ? ' labour-drill-card--grand' : ''}`}>
      {isGrand ? (
        <header className="labour-drill-card__head">
          <span className="labour-drill-card__title">GRAND TOTAL</span>
        </header>
      ) : tags.length ? (
        <header className="labour-drill-card__head">
          <div className="labour-drill-card__tags">
            {tags.map((t) => (
              <span key={t.label} className="labour-drill-card__tag">
                <span className="labour-drill-card__tag-label">{t.label}</span>
                <span className="labour-drill-card__tag-val">{t.value}</span>
              </span>
            ))}
          </div>
        </header>
      ) : null}
      <div className="labour-drill-card__metrics">
        {metrics.map((m) => (
          <div key={m.label} className="labour-drill-card__metric">
            <span className="labour-drill-card__metric-label">{m.label}</span>
            <span className={`labour-drill-card__metric-val${m.num ? ' num' : ''}`}>{m.value || '0.00'}</span>
          </div>
        ))}
      </div>
      {!isGrand && details.length ? (
        <footer className="labour-drill-card__detail">{details.join(' · ')}</footer>
      ) : null}
    </article>
  );
}

function LabourDrillMobileList({ rows }) {
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r) && r._type !== 'subtotal');
  const grandRow = rows.find(isIncomeTaxGrandTotalRow);

  return (
    <div className="itax-mobile-list labour-drill-mobile-list">
      {dataRows.map((row, idx) => (
        <LabourDrillMobileCard key={row._id ?? `ldrill-${idx}`} row={row} />
      ))}
      {grandRow ? <LabourDrillMobileCard row={grandRow} isGrand /> : null}
      {!dataRows.length && !grandRow ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function labourDrillColClass(col) {
  const k = col.key;
  if (k === 'SECTION') return 'labour-drill-col labour-drill-col--section';
  if (k === 'E_TYPE') return 'labour-drill-col labour-drill-col--type';
  if (k === 'L_C') return 'labour-drill-col labour-drill-col--lc';
  if (k === 'STATUS') return 'labour-drill-col labour-drill-col--st';
  if (k === 'R_QNTY' || k === 'S_QNTY') return 'labour-drill-col labour-drill-col--qty';
  if (k === 'LAB_AMT') return 'labour-drill-col labour-drill-col--amt';
  if (k === 'B_NO' || k === 'VR_NO' || k === 'VR_TYPE' || k === 'EXP_CAT' || k === 'LOT') {
    return 'labour-drill-col labour-drill-col--text';
  }
  if (k === 'ITEM_CODE' || k === 'SUP_CODE') return 'labour-drill-col labour-drill-col--code';
  if (k === 'ITEM_NAME' || k === 'SUP_NAME') return 'labour-drill-col labour-drill-col--name';
  if (col.type === 'num') return 'labour-drill-col labour-drill-col--amt';
  return 'labour-drill-col labour-drill-col--text';
}

function LabourDrillDesktopTable({ rows, displayColumns }) {
  const dataRows = rows.filter((r) => r._type !== 'partyGroup' && r._type !== 'group' && r._type !== 'subtotal');

  return (
    <table className="table-report itax-table labour-drill-table">
      <colgroup>
        {displayColumns.map((c) => (
          <col key={c.key} className={labourDrillColClass(c)} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {displayColumns.map((c) => (
            <th key={c.key} className={c.type === 'num' ? 'num' : ''}>
              {c.label || humanizeColumnKey(c.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataRows.map((row, idx) => {
          const isGrand = isIncomeTaxGrandTotalRow(row);
          return (
            <tr key={row._id ?? `ldrill-dt-${idx}`} className={isGrand ? 'itax-grand-total' : ''}>
              {displayColumns.map((c) => (
                <td key={c.key} className={c.type === 'num' ? 'num' : ''}>
                  {fmtVal(rowVal(row, c.key), c.type)}
                </td>
              ))}
            </tr>
          );
        })}
        {!dataRows.length ? (
          <tr>
            <td colSpan={displayColumns.length}>No rows</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export default function LabourDrillView({ rows, displayColumns, isMobile = false }) {
  if (isMobile) {
    return <LabourDrillMobileList rows={rows} />;
  }
  return <LabourDrillDesktopTable rows={rows} displayColumns={displayColumns} />;
}
