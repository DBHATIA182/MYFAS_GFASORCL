import React from 'react';
import { humanizeColumnKey, isIncomeTaxGrandTotalRow } from '../data/incomeTaxReportDefs';

function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rowVal(row, key) {
  return row[key] ?? row[key?.toLowerCase?.()];
}

function BrokerSummaryMobileCard({ row, displayColumns, onClick, isGrand = false }) {
  const code = String(rowVal(row, 'BK_CODE') ?? '').trim();
  const name = String(rowVal(row, 'BNAME') ?? '').trim();
  const numCols = displayColumns.filter((c) => c.type === 'num');

  const Tag = !isGrand && onClick ? 'button' : 'article';
  return (
    <Tag
      type={!isGrand && onClick ? 'button' : undefined}
      className={[
        'broker-summary-card',
        !isGrand && onClick ? 'broker-summary-card--drill' : '',
        isGrand ? 'broker-summary-card--grand' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={!isGrand && onClick ? () => onClick(row) : undefined}
      title={!isGrand && onClick ? `View detail for ${code}` : undefined}
    >
      <header className="broker-summary-card__head">
        <span className="broker-summary-card__code">{isGrand ? 'GRAND TOTAL' : code}</span>
        {!isGrand && name ? <span className="broker-summary-card__name">{name}</span> : null}
      </header>
      <div className="broker-summary-card__grid">
        {numCols.map((c) => (
          <div key={c.key} className="broker-summary-card__metric">
            <span className="broker-summary-card__metric-label">{c.label || humanizeColumnKey(c.key)}</span>
            <span className="broker-summary-card__metric-val">{fmtNum(rowVal(row, c.key))}</span>
          </div>
        ))}
      </div>
    </Tag>
  );
}

function BrokerSummaryMobileList({ rows, displayColumns, onRowClick }) {
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r) && r._type !== 'subtotal');
  const grandRow = rows.find(isIncomeTaxGrandTotalRow);

  return (
    <div className="itax-mobile-list broker-summary-mobile-list">
      {dataRows.map((row, idx) => (
        <BrokerSummaryMobileCard
          key={row._id ?? `bsum-${idx}`}
          row={row}
          displayColumns={displayColumns}
          onClick={onRowClick}
        />
      ))}
      {grandRow ? (
        <BrokerSummaryMobileCard row={grandRow} displayColumns={displayColumns} isGrand />
      ) : null}
      {!dataRows.length && !grandRow ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function BrokerSummaryDesktopTable({ rows, displayColumns, onRowClick }) {
  const dataRows = rows.filter((r) => r._type !== 'partyGroup' && r._type !== 'group' && r._type !== 'subtotal');

  return (
    <table className="table-report itax-table broker-summary-table">
      <colgroup>
        {displayColumns.map((c) => (
          <col key={c.key} className={`broker-summary-col broker-summary-col--${c.key.toLowerCase()}`} />
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
          const clickable = !isGrand && Boolean(onRowClick);
          return (
            <tr
              key={row._id ?? `bsum-dt-${idx}`}
              className={[
                isGrand ? 'itax-grand-total' : '',
                clickable ? 'itax-row--broker-drill' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={clickable ? () => onRowClick(row) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              {displayColumns.map((c) => {
                const val = rowVal(row, c.key);
                const isName = c.key === 'BNAME';
                return (
                  <td
                    key={c.key}
                    className={[
                      c.type === 'num' ? 'num' : '',
                      isName ? 'broker-summary-cell--name' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={isName ? String(val ?? '').trim() : undefined}
                  >
                    {c.type === 'num' ? fmtNum(val) : String(val ?? '')}
                  </td>
                );
              })}
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

export default function BrokerSummaryView({ rows, displayColumns, isMobile = false, onRowClick }) {
  if (isMobile) {
    return <BrokerSummaryMobileList rows={rows} displayColumns={displayColumns} onRowClick={onRowClick} />;
  }
  return (
    <BrokerSummaryDesktopTable rows={rows} displayColumns={displayColumns} onRowClick={onRowClick} />
  );
}
