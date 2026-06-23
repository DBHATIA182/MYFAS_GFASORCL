import React, { useMemo, useState } from 'react';
import {
  buildTrialDesktopGroups,
  collectTrialCityOptions,
  collectTrialScheduleOptions,
  trialDesktopGroupStats,
  trialBalanceRowLabel,
  trialGroupTitle,
} from '../utils/trialBalanceDesktopDisplay';
import { findTrialGrandRow } from '../utils/trialBalanceSort';

function fmt(val) {
  const num = parseFloat(val) || 0;
  return num === 0 ? '—' : num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function fmtAlways(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function rowNum(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === '') continue;
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function renderDateWiseCells(row) {
  const opDr = rowNum(row, 'OP_DR', 'op_dr');
  const opCr = rowNum(row, 'OP_CR', 'op_cr');
  const trnDr = rowNum(row, 'TRN_DR', 'trn_dr');
  const trnCr = rowNum(row, 'TRN_CR', 'trn_cr');
  const clDr = rowNum(row, 'CL_DR', 'cl_dr');
  const clCr = rowNum(row, 'CL_CR', 'cl_cr');
  return (
    <>
      <td className={`text-right ${opDr > 0 ? 'dr-amt' : ''}`}>{opDr > 0 ? fmt(opDr) : '—'}</td>
      <td className={`text-right ${opCr > 0 ? 'cr-amt' : ''}`}>{opCr > 0 ? fmt(opCr) : '—'}</td>
      <td className={`text-right ${trnDr > 0 ? 'dr-amt' : ''}`}>{trnDr > 0 ? fmt(trnDr) : '—'}</td>
      <td className={`text-right ${trnCr > 0 ? 'cr-amt' : ''}`}>{trnCr > 0 ? fmt(trnCr) : '—'}</td>
      <td className={`text-right ${clDr > 0 ? 'dr-amt' : ''}`}>{clDr > 0 ? fmt(clDr) : '—'}</td>
      <td className={`text-right ${clCr > 0 ? 'cr-amt' : ''}`}>{clCr > 0 ? fmt(clCr) : '—'}</td>
    </>
  );
}

function sumGroupDateWise(group, keys) {
  if (group.header) return rowNum(group.header, keys[0], keys[1]);
  let t = 0;
  group.accounts.forEach((row) => {
    t += rowNum(row, keys[0], keys[1]);
  });
  return t;
}

/** Desktop trial date wise — schedule / city filters + expand/collapse (same as trial balance). */
export default function TrialDateWiseDesktopTable({ data, onLedgerClick }) {
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [collapsedSchedules, setCollapsedSchedules] = useState({});
  const [selectedKey, setSelectedKey] = useState(null);

  const scheduleOptions = useMemo(() => collectTrialScheduleOptions(data), [data]);
  const cityOptions = useMemo(() => collectTrialCityOptions(data), [data]);

  const groups = useMemo(
    () => buildTrialDesktopGroups(data, { scheduleFilter, cityFilter }),
    [data, scheduleFilter, cityFilter]
  );

  const stats = useMemo(() => trialDesktopGroupStats(groups), [groups]);
  const grand = useMemo(() => findTrialGrandRow(data || []), [data]);
  const filterActive = scheduleFilter !== 'all' || cityFilter !== 'all';

  const groupKeys = useMemo(() => groups.map((g) => g.scheduleKey), [groups]);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((key) => !collapsedSchedules[key]);
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((key) => collapsedSchedules[key]);

  const toggleSchedule = (scheduleKey) => {
    setCollapsedSchedules((prev) => ({ ...prev, [scheduleKey]: !prev[scheduleKey] }));
  };

  const expandAll = () => setCollapsedSchedules({});
  const collapseAll = () => {
    const next = {};
    groupKeys.forEach((key) => {
      next[key] = true;
    });
    setCollapsedSchedules(next);
  };

  if (!data || data.length === 0) {
    return <p className="no-data">No data available.</p>;
  }

  const grandRow = grand || {
    OP_DR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['OP_DR', 'op_dr']), 0),
    OP_CR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['OP_CR', 'op_cr']), 0),
    TRN_DR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['TRN_DR', 'trn_dr']), 0),
    TRN_CR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['TRN_CR', 'trn_cr']), 0),
    CL_DR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['CL_DR', 'cl_dr']), 0),
    CL_CR: groups.reduce((s, g) => s + sumGroupDateWise(g, ['CL_CR', 'cl_cr']), 0),
  };

  return (
    <div className="trial-desktop trial-desktop--date-wise">
      <div className="trial-desktop__toolbar">
        <label className="trial-desktop__filter">
          <span className="trial-desktop__filter-label">Schedule</span>
          <select
            className="trial-desktop__filter-select"
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
            aria-label="Filter by schedule"
          >
            <option value="all">All schedules</option>
            {scheduleOptions.map((sch) => (
              <option key={sch} value={sch}>
                {sch}
              </option>
            ))}
          </select>
        </label>

        <label className="trial-desktop__filter">
          <span className="trial-desktop__filter-label">City</span>
          <select
            className="trial-desktop__filter-select"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label="Filter by city"
          >
            <option value="all">All cities</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <div className="trial-desktop__expand-actions">
          <button type="button" className="trial-desktop__expand-btn" onClick={expandAll} disabled={allExpanded}>
            Expand all
          </button>
          <button
            type="button"
            className="trial-desktop__expand-btn"
            onClick={collapseAll}
            disabled={groupKeys.length === 0 || allCollapsed}
          >
            Collapse all
          </button>
        </div>

        {filterActive ? (
          <span className="trial-desktop__filter-count">
            {stats.schedules} schedule{stats.schedules === 1 ? '' : 's'} · {stats.accounts} account
            {stats.accounts === 1 ? '' : 's'}
            {scheduleFilter !== 'all' ? ` · Sch ${scheduleFilter}` : ''}
            {cityFilter !== 'all' ? ` · ${cityFilter}` : ''}
          </span>
        ) : null}
      </div>

      <div className="table-responsive table-responsive--trial table-responsive--trial-date-wise">
        <table className="report-table report-table--trial report-table--trial-date-wise">
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="trial-desktop__col-expand" aria-label="Expand" />
              <th rowSpan={2} scope="col">
                Sch
              </th>
              <th rowSpan={2} scope="col">
                Account
              </th>
              <th rowSpan={2} scope="col">
                Code
              </th>
              <th rowSpan={2} scope="col">
                City
              </th>
              <th rowSpan={2} scope="col">
                Pan
              </th>
              <th colSpan={2} className="text-center" scope="colgroup">
                Opening
              </th>
              <th colSpan={2} className="text-center" scope="colgroup">
                Transactions
              </th>
              <th colSpan={2} className="text-center" scope="colgroup">
                Closing
              </th>
            </tr>
            <tr>
              <th className="text-right" scope="col">
                Dr
              </th>
              <th className="text-right" scope="col">
                Cr
              </th>
              <th className="text-right" scope="col">
                Dr
              </th>
              <th className="text-right" scope="col">
                Cr
              </th>
              <th className="text-right" scope="col">
                Dr
              </th>
              <th className="text-right" scope="col">
                Cr
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={13} className="trial-desktop__empty">
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const gKey = group.scheduleKey;
                const collapsed = Boolean(collapsedSchedules[gKey]);
                const headerRow = group.header;
                const schVal = headerRow
                  ? headerRow.SCHEDULE ?? headerRow.schedule ?? headerRow.SCH_NO ?? headerRow.sch_no ?? gKey
                  : gKey;
                const headerName = headerRow ? trialBalanceRowLabel(headerRow) : trialGroupTitle(group);
                const headerKey = `sch-${gKey}`;
                const headerAmountRow = headerRow || {
                  OP_DR: sumGroupDateWise(group, ['OP_DR', 'op_dr']),
                  OP_CR: sumGroupDateWise(group, ['OP_CR', 'op_cr']),
                  TRN_DR: sumGroupDateWise(group, ['TRN_DR', 'trn_dr']),
                  TRN_CR: sumGroupDateWise(group, ['TRN_CR', 'trn_cr']),
                  CL_DR: sumGroupDateWise(group, ['CL_DR', 'cl_dr']),
                  CL_CR: sumGroupDateWise(group, ['CL_CR', 'cl_cr']),
                };

                return (
                  <React.Fragment key={gKey}>
                    <tr
                      className={[
                        'trial-schedule-total-row',
                        'trial-desktop-schedule-row',
                        selectedKey === headerKey ? 'trial-row-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td className="trial-desktop__col-expand">
                        <button
                          type="button"
                          className="trial-desktop-expand-btn"
                          aria-label={collapsed ? 'Expand schedule' : 'Collapse schedule'}
                          aria-expanded={!collapsed}
                          onClick={() => toggleSchedule(gKey)}
                        >
                          {collapsed ? '▸' : '▾'}
                        </button>
                      </td>
                      <td className="trial-sch">{schVal != null && schVal !== '' ? schVal : '—'}</td>
                      <td className="trial-name" colSpan={2}>
                        <span className="name-text">{headerName}</span>
                      </td>
                      <td className="trial-city">—</td>
                      <td>—</td>
                      {renderDateWiseCells(headerAmountRow)}
                    </tr>

                    {!collapsed
                      ? group.accounts.map((row, idx) => {
                          const codeVal = row.CODE ?? row.code;
                          const nameVal = trialBalanceRowLabel(row);
                          const cityVal = row.CITY ?? row.city;
                          const schAccount = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;
                          const rowKey = `acc-${gKey}-${codeVal ?? idx}`;
                          return (
                            <tr
                              key={rowKey}
                              className={[
                                'clickable-row',
                                'trial-desktop-detail-row',
                                selectedKey === rowKey ? 'trial-row-selected' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                setSelectedKey(rowKey);
                                if (onLedgerClick) onLedgerClick(codeVal, nameVal);
                              }}
                            >
                              <td className="trial-desktop__col-expand" />
                              <td className="trial-sch">{schAccount != null && schAccount !== '' ? schAccount : '—'}</td>
                              <td className="trial-name">
                                <span className="name-text">{nameVal}</span>
                              </td>
                              <td className="trial-code">{codeVal != null && codeVal !== '' ? codeVal : '—'}</td>
                              <td className="trial-city">{cityVal != null && cityVal !== '' ? cityVal : '—'}</td>
                              <td>{row.PAN ?? row.pan ?? '—'}</td>
                              {renderDateWiseCells(row)}
                            </tr>
                          );
                        })
                      : null}
                  </React.Fragment>
                );
              })
            )}

            <tr
              className={[
                'trial-grand-total',
                'trial-grand-total-footer',
                selectedKey === 'trial-grand-footer' ? 'trial-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedKey('trial-grand-footer')}
            >
              <td colSpan={6}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'OP_DR', 'op_dr'))}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'OP_CR', 'op_cr'))}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'TRN_DR', 'trn_dr'))}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'TRN_CR', 'trn_cr'))}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'CL_DR', 'cl_dr'))}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(rowNum(grandRow, 'CL_CR', 'cl_cr'))}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
