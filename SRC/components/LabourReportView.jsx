import React from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { isIncomeTaxGrandTotalRow } from '../data/incomeTaxReportDefs';
import {
  LABOUR_REPORT_GROUPS,
  labourRowValue,
  labourTotAmt,
  fmtLabourQty,
  fmtLabourAmt,
  labourGroupColSpan,
  sortLabourRowsByVrDate,
} from '../data/labourReportLayout';

function labourDateLabel(row) {
  if (isIncomeTaxGrandTotalRow(row)) return 'GRAND TOTAL';
  const raw = labourRowValue(row, 'VR_DATE');
  return formatLedgerDateDisplay(raw) || String(raw ?? '').trim() || '—';
}

function labourRowKey(row, idx) {
  return row._id ?? `labour-${labourDateLabel(row)}-${idx}`;
}

function pairHasData(row, pair) {
  const q = Number(labourRowValue(row, pair.qty));
  const a = Number(labourRowValue(row, pair.amt));
  return (Number.isFinite(q) && q !== 0) || (Number.isFinite(a) && a !== 0);
}

function LabourMobileSection({ group, row, hideZeros }) {
  const pairs = hideZeros ? group.pairs.filter((p) => pairHasData(row, p)) : group.pairs;
  if (!pairs.length) return null;
  return (
    <div className="labour-mobile-card__section">
      <div className="labour-mobile-card__section-title">{group.label}</div>
      <div className="labour-mobile-card__metrics">
        {pairs.map((pair) => (
          <React.Fragment key={pair.qty}>
            <div className="labour-mobile-card__metric">
              <span className="labour-mobile-card__metric-label">{pair.qtyLabel}</span>
              <span className="labour-mobile-card__metric-val">{fmtLabourQty(labourRowValue(row, pair.qty))}</span>
            </div>
            <div className="labour-mobile-card__metric">
              <span className="labour-mobile-card__metric-label">{pair.amtLabel}</span>
              <span className="labour-mobile-card__metric-val num">{fmtLabourAmt(labourRowValue(row, pair.amt))}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function LabourMobileList({ rows, onDateClick, selectedDateKey }) {
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const grandRow = rows.find(isIncomeTaxGrandTotalRow);

  return (
    <div className="itax-mobile-list labour-mobile-list">
      {dataRows.map((row, idx) => {
        const tot = Number(labourRowValue(row, 'TOT_AMT')) || labourTotAmt(row);
        const rowKey = labourRowKey(row, idx);
        const clickable = Boolean(onDateClick);
        const Tag = clickable ? 'button' : 'article';
        return (
          <Tag
            key={rowKey}
            type={clickable ? 'button' : undefined}
            className={[
              'labour-mobile-card',
              clickable ? 'labour-mobile-card--drill' : '',
              selectedDateKey === rowKey ? 'labour-mobile-card--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={clickable ? () => onDateClick(row) : undefined}
            title={clickable ? `View entries for ${labourDateLabel(row)}` : undefined}
          >
            <header className="labour-mobile-card__head">
              <span className="labour-mobile-card__date">{labourDateLabel(row)}</span>
              <span className="labour-mobile-card__tot">
                Tot. <strong>{fmtLabourAmt(tot)}</strong>
              </span>
            </header>
            {LABOUR_REPORT_GROUPS.map((group) => (
              <LabourMobileSection key={group.id} group={group} row={row} hideZeros />
            ))}
          </Tag>
        );
      })}
      {grandRow ? (
        <article className="labour-mobile-card labour-mobile-card--grand">
          <header className="labour-mobile-card__head">
            <span className="labour-mobile-card__date">GRAND TOTAL</span>
            <span className="labour-mobile-card__tot">
              <strong>{fmtLabourAmt(labourRowValue(grandRow, 'TOT_AMT') || labourTotAmt(grandRow))}</strong>
            </span>
          </header>
          {LABOUR_REPORT_GROUPS.map((group) => (
            <LabourMobileSection key={group.id} group={group} row={grandRow} hideZeros={false} />
          ))}
        </article>
      ) : null}
      {!dataRows.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function LabourDesktopTable({ rows, onDateClick, selectedDateKey }) {
  return (
    <table className="table-report itax-table labour-report-table">
      <thead>
        <tr className="labour-report-table__group-row">
          <th rowSpan={2} scope="col" className="labour-report-table__date">
            Date
          </th>
          {LABOUR_REPORT_GROUPS.map((group) => (
            <th key={group.id} colSpan={labourGroupColSpan(group)} scope="colgroup" className="labour-report-table__group">
              {group.label}
            </th>
          ))}
          <th rowSpan={2} scope="col" className="labour-report-table__tot num">
            Tot.Amt.
          </th>
        </tr>
        <tr className="labour-report-table__sub-row">
          {LABOUR_REPORT_GROUPS.map((group) =>
            group.pairs.map((pair) => (
              <React.Fragment key={`${group.id}-${pair.qty}`}>
                <th scope="col" className="labour-report-table__sub num">
                  {pair.qtyLabel}
                </th>
                <th scope="col" className="labour-report-table__sub num">
                  {pair.amtLabel}
                </th>
              </React.Fragment>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const isGrand = isIncomeTaxGrandTotalRow(row);
          const tot = Number(labourRowValue(row, 'TOT_AMT')) || labourTotAmt(row);
          const rowKey = labourRowKey(row, idx);
          const clickable = Boolean(onDateClick) && !isGrand;
          return (
            <tr
              key={rowKey}
              className={[
                isGrand ? 'itax-grand-total labour-report-table__grand' : '',
                clickable ? 'labour-report-table__row--drill' : '',
                selectedDateKey === rowKey ? 'labour-report-table__row--selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={clickable ? () => onDateClick(row) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onDateClick(row);
                      }
                    }
                  : undefined
              }
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              title={clickable ? `View entries for ${labourDateLabel(row)}` : undefined}
            >
              <td className={`labour-report-table__date${isGrand ? ' labour-report-table__date--total' : ''}`}>
                {labourDateLabel(row)}
              </td>
              {LABOUR_REPORT_GROUPS.map((group) =>
                group.pairs.map((pair) => (
                  <React.Fragment key={`${group.id}-${pair.qty}-val`}>
                    <td className="num labour-report-table__qty">{fmtLabourQty(labourRowValue(row, pair.qty))}</td>
                    <td className="num labour-report-table__amt">{fmtLabourAmt(labourRowValue(row, pair.amt))}</td>
                  </React.Fragment>
                ))
              )}
              <td className="num labour-report-table__tot-val">{fmtLabourAmt(tot)}</td>
            </tr>
          );
        })}
        {!rows.length ? (
          <tr>
            <td colSpan={1 + LABOUR_REPORT_GROUPS.reduce((s, g) => s + labourGroupColSpan(g), 0) + 1}>No rows</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export default function LabourReportView({ rows, isMobile = false, onDateClick, selectedDateKey = null }) {
  const sortedRows = sortLabourRowsByVrDate(rows);
  if (isMobile) {
    return <LabourMobileList rows={sortedRows} onDateClick={onDateClick} selectedDateKey={selectedDateKey} />;
  }
  return <LabourDesktopTable rows={sortedRows} onDateClick={onDateClick} selectedDateKey={selectedDateKey} />;
}
