import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ReportToolbarActions from '../components/ReportToolbarActions';
import FasReportHeader from '../components/FasReportHeader';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { toDisplayDate, toInputDateString, toOracleDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import { apiUrl } from '../utils/resolveApiBase';
import { findIncomeTaxModuleItem } from '../data/incomeTaxModuleConfig';
import { findOtherReportsModuleItem } from '../data/otherReportsModuleConfig';
import { findLedgerModuleItem } from '../data/ledgerModuleConfig';
import { findVoucherBooksModuleItem } from '../data/voucherBooksModuleConfig';
import {
  getLedgerReportDef,
  resolveLedgerReportFilterMeta,
  resolveLedgerReportDisplayColumns,
} from '../data/ledgerReportDefs';
import {
  getVoucherBookReportDef,
  resolveVoucherBookReportFilterMeta,
  resolveVoucherBookDisplayColumns,
  isVoucherBookCashOpenRow,
  isVoucherBookDayTotalRow,
  isVoucherBookDayCloseRow,
  isVoucherBookSummaryRow,
} from '../data/voucherBookReportDefs';
import {
  getIncomeTaxReportDef,
  humanizeColumnKey,
  resolveIncomeTaxDisplayColumns,
  formatPartyBlockParts,
  partyBlockExportText,
  partyRowToExcelCols,
  emptyPartyExcelCols,
  compactTableColClass,
  buildGroupedDisplayRows,
  resolveIncomeTaxFilterMeta,
  FISCAL_MONTH_KEYS,
  resolveExpenseExpType,
  fiscalMonthColLabel,
  isIncomeTaxGrandTotalRow,
  isIncomeTaxItemTotalRow,
  isIncomeTaxPartyTotalRow,
  isIncomeTaxBillTotalRow,
  ensureIncomeTaxGrandTotalRows,
  buildItemMonthGroupedRows,
  buildPartyBillGroupedRows,
  buildBillGroupedRows,
  buildItemPartyMonthGroupedRows,
  buildBrokerItemGroupedRows,
  buildChantGroupedRows,
  formatItemCodeGroupLabel,
  formatItemGroupLabel,
  formatPartyGroupLabel,
  resolveItaxGroupLabelFn,
  isIncomeTaxBrokerTotalRow,
  isIncomeTaxLotRateTotalRow,
} from '../data/incomeTaxReportDefs';
import {
  getOtherReportDef,
  resolveOtherReportFilterMeta,
  resolveOtherReportDisplayColumns,
} from '../data/otherReportDefs';
import LabourReportView from './LabourReportView';
import LabourDrillView from './LabourDrillView';
import BrokerSummaryView from './BrokerSummaryView';

const reqOpts = { withCredentials: true, timeout: 600000 };
const MASTER_ACCOUNT_SEARCH_MS = 280;

function mapAccountPickOption(a) {
  return {
    value: String(a.CODE ?? a.code ?? '').trim(),
    label: String(a.NAME ?? a.name ?? '').trim(),
    CODE: a.CODE ?? a.code,
    NAME: a.NAME ?? a.name,
    CITY: String(a.CITY ?? a.city ?? '').trim(),
  };
}

function godownHelpPickProps(triggerCode) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: true,
    filterPlaceholder: 'Type godown name or code…',
    getValue: (o) => String(o.value ?? o.GOD_CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.GOD_CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.GOD_NAME ?? o.label ?? '').trim(),
  };
}

function mapGodownPickOption(row) {
  return {
    value: String(row.GOD_CODE ?? row.god_code ?? '').trim(),
    label: String(row.GOD_NAME ?? row.god_name ?? '').trim(),
    GOD_CODE: row.GOD_CODE ?? row.god_code,
    GOD_NAME: row.GOD_NAME ?? row.god_name,
  };
}

function mapItemPickOption(row) {
  return {
    value: String(row.ITEM_CODE ?? row.item_code ?? '').trim(),
    label: String(row.ITEM_NAME ?? row.item_name ?? '').trim(),
    ITEM_CODE: row.ITEM_CODE ?? row.item_code,
    ITEM_NAME: row.ITEM_NAME ?? row.item_name,
  };
}

function accountHelpPickProps(triggerCode) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: true,
    filterPlaceholder: 'Type name or code…',
    getValue: (o) => String(o.value ?? o.CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
    getOptionCity: (o) => String(o.CITY ?? '').trim(),
  };
}

function itemHelpPickProps(triggerCode) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: true,
    filterPlaceholder: 'Type item name or code…',
    getValue: (o) => String(o.value ?? o.ITEM_CODE ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.ITEM_CODE ?? triggerCode ?? ''),
    getOptionHint: (o) => String(o.ITEM_NAME ?? o.label ?? '').trim(),
  };
}

function mapSchedulePickOption(s) {
  const no = s.NO ?? s.no;
  return {
    value: String(no ?? '').trim(),
    label: String(s.NAME ?? s.name ?? '').trim(),
    NO: no,
    NAME: s.NAME ?? s.name,
  };
}

function scheduleHelpPickProps(triggerNo) {
  return {
    panelVariant: 'accountHelp',
    showAllWhenEmpty: true,
    filterPlaceholder: 'Type schedule name or no…',
    getValue: (o) => String(o.value ?? o.NO ?? '').trim(),
    getTriggerLabel: (o) => String(o.value ?? o.NO ?? triggerNo ?? ''),
    getOptionHint: (o) => String(o.NAME ?? o.label ?? '').trim(),
  };
}

function ItaxField({ label, hint, children, fullWidth = false }) {
  return (
    <div className={`itax-field${fullWidth ? ' itax-field--full' : ''}`}>
      <label className="itax-field__label">{label}</label>
      <div className="itax-field__ctl">{children}</div>
      {hint ? <p className="itax-field__hint">{hint}</p> : null}
    </div>
  );
}

function ItaxManualCodeField({ value, onChange, disabled, inputClass, dataField, onHelpRequest, children }) {
  return (
    <div className="itax-manual-code">
      <input
        type="text"
        className={`${inputClass} itax-manual-code__input`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'F1' || e.keyCode === 112) && onHelpRequest) {
            e.preventDefault();
            e.stopPropagation();
            onHelpRequest();
          }
        }}
        data-itax-field={dataField}
        autoComplete="off"
        spellCheck={false}
      />
      {children}
    </div>
  );
}

function SupplierManualCodeField({
  value,
  onChange,
  disabled,
  inputClass,
  dataField,
  title,
  placeholder,
  pickListProps,
}) {
  const pickRef = useRef(null);
  return (
    <ItaxManualCodeField
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputClass={inputClass}
      dataField={dataField}
      onHelpRequest={() => pickRef.current?.openSearch?.()}
    >
      <MasterPartyPickList
        ref={pickRef}
        value={value}
        onChange={onChange}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        showSearchIcon
        searchBtnTabIndex={-1}
        {...pickListProps}
      />
    </ItaxManualCodeField>
  );
}

function BrokerManualCodeField({
  value,
  onChange,
  disabled,
  inputClass,
  dataField,
  title,
  placeholder,
  pickListProps,
}) {
  const pickRef = useRef(null);
  return (
    <ItaxManualCodeField
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputClass={inputClass}
      dataField={dataField}
      onHelpRequest={() => pickRef.current?.openSearch?.()}
    >
      <MasterPartyPickList
        ref={pickRef}
        value={value}
        onChange={onChange}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        showSearchIcon
        searchBtnTabIndex={-1}
        {...pickListProps}
      />
    </ItaxManualCodeField>
  );
}

function isFullWidthFilter(key) {
  return key !== 'sdt' && key !== 'edt';
}

function fmtCell(value, type, decimals = 2) {
  if (value == null || value === '') return '';
  if (type === 'num') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const dec = Number.isFinite(decimals) ? decimals : 2;
    return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  if (type === 'date') return formatLedgerDateDisplay(value) || String(value);
  return String(value);
}

function renderReportCell(row, col) {
  if (col.type === 'partyBlock') {
    const { name, subs } = formatPartyBlockParts(row, col);
    return (
      <div className="itax-party-block">
        {name ? <div className="itax-party-block__name">{name}</div> : null}
        {subs.map((line, i) => (
          <div key={`${line}-${i}`} className="itax-party-block__sub">
            {line}
          </div>
        ))}
      </div>
    );
  }
  return fmtCell(row[col.key] ?? row[col.key?.toLowerCase?.()], col.type, col.decimals);
}

function renderPartyGroupHeader(row, { minimal = false, ledgerDrillCode = null, onLedgerDrill = null } = {}) {
  const code = String(
    row.BK_CODE ?? row.bk_code ?? row.SUP_CODE ?? row.sup_code ?? row.CODE ?? row.code ?? ''
  ).trim();
  const name = String(
    row.BNAME ?? row.bname ?? row.BK_NAME ?? row.bk_name ?? row.NAME ?? row.name ?? ''
  ).trim();
  const subs = minimal
    ? []
    : ['ADD1', 'ADD2', 'ADD3', 'CITY', 'PAN', 'GST_NO']
        .map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '').trim())
        .filter(Boolean);
  const inner = (
    <>
      <div className="itax-party-block__name">{[code, name].filter(Boolean).join(' ')}</div>
      {subs.map((line, i) => (
        <div key={`${line}-${i}`} className="itax-party-block__sub">
          {line}
        </div>
      ))}
    </>
  );
  if (ledgerDrillCode && onLedgerDrill) {
    return (
      <button
        type="button"
        className="itax-party-block itax-party-block--group itax-party-block--ledger-btn"
        onClick={() => onLedgerDrill(ledgerDrillCode)}
        title={`Open ledger for ${ledgerDrillCode}`}
      >
        {inner}
      </button>
    );
  }
  return <div className="itax-party-block itax-party-block--group">{inner}</div>;
}

function rowLedgerCode(row, displayColumns) {
  for (const k of ['CODE', 'code', 'SUP_CODE', 'sup_code']) {
    const v = String(row[k] ?? '').trim();
    if (v) return v;
  }
  const codeCol = displayColumns.find((c) => /^code$/i.test(String(c.key)));
  if (codeCol) {
    const v = String(row[codeCol.key] ?? row[codeCol.key?.toLowerCase?.()] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function partySubtotalHeadLabel(row) {
  for (const k of ['NAME', 'DETAIL', 'VR_DATE', 'vr_date', 'BILL_DATE', 'bill_date', 'R_DATE', 'r_date', 'CMTH', 'cmth', 'ITEM_NAME', 'item_name', 'ITEM_CAT', 'item_cat']) {
    const v = String(row?.[k] ?? '').trim();
    if (v) return v;
  }
  return 'PARTY TOTAL';
}

function rowFieldCode(row, key) {
  if (!key) return '';
  return String(row[key] ?? row[key?.toLowerCase?.()] ?? '').trim();
}

function monthKeyToOracleDate(mthKey) {
  const parts = String(mthKey ?? '').trim().split('-');
  if (parts.length < 2) return '';
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '';
  return `01-${String(m).padStart(2, '0')}-${y}`;
}

function cellAmount(row, key) {
  const n = Number(row[key] ?? row[key?.toLowerCase?.()]);
  return Number.isFinite(n) ? n : 0;
}

function ItaxMobileExpenseMonthPivotList({ rows, displayColumns, onMonthClick }) {
  const monthCols = displayColumns.filter((c) => FISCAL_MONTH_KEYS.has(c.key));

  return (
    <div className="itax-mobile-list itax-mobile-list--expense-month">
      {rows.map((row, idx) => {
        const head = String(row.HEAD_NAME ?? row.head_name ?? '').trim();
        const isGrand = isIncomeTaxGrandTotalRow(row) || head.toUpperCase() === 'TOTAL';
        if (isGrand) {
          return (
            <div key={row._id ?? `exp-tot-${idx}`} className="itax-mobile-card itax-mobile-card--grand-total">
              <div className="itax-mobile-card__head">
                <span className="itax-mobile-card__code">{head || 'TOTAL'}</span>
              </div>
              <div className="itax-mobile-card__grid itax-mobile-card__grid--months">
                {monthCols.map((c) => (
                  <div key={c.key} className="itax-mobile-card__attr">
                    <span className="itax-mobile-card__attr-label">{c.label || c.key}</span>
                    <span className="itax-mobile-card__attr-val num">{fmtCell(row[c.key], 'num')}</span>
                  </div>
                ))}
                <div className="itax-mobile-card__attr">
                  <span className="itax-mobile-card__attr-label">Tot</span>
                  <span className="itax-mobile-card__attr-val num">{fmtCell(row.TOT ?? row.tot, 'num')}</span>
                </div>
              </div>
            </div>
          );
        }

        const expType = resolveExpenseExpType(head);
        const activeMonths = monthCols.filter((c) => cellAmount(row, c.key) !== 0);

        return (
          <div key={row._id ?? `exp-head-${idx}`} className="itax-mobile-card itax-mobile-card--expense-head">
            <div className="itax-mobile-card__head">
              <span className="itax-mobile-card__code">{head}</span>
            </div>
            {activeMonths.length ? (
              <div className="itax-mobile-card__grid itax-mobile-card__grid--months">
                {activeMonths.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="itax-mobile-card__attr itax-mobile-card__month-drill"
                    disabled={!expType || !onMonthClick}
                    onClick={() => onMonthClick?.(row, c.key)}
                  >
                    <span className="itax-mobile-card__attr-label">{c.label || c.key}</span>
                    <span className="itax-mobile-card__attr-val num">{fmtCell(row[c.key], 'num')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="itax-mobile-list__empty">No amounts in range</p>
            )}
          </div>
        );
      })}
      {!rows.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function ItaxMobileMonthPivotList({ items, displayColumns, ledgerDrillEnabled, onRowClick }) {
  const monthCols = displayColumns.filter((c) => FISCAL_MONTH_KEYS.has(c.key));

  return (
    <div className="itax-mobile-list itax-mobile-list--month-pivot">
      {items.map((item) => {
        if (item._type === 'group') {
          return (
            <div key={item._id} className="itax-mobile-group">
              {item.label}
            </div>
          );
        }

        const r = item;
        const code = rowLedgerCode(r, displayColumns);
        const name = String(r.NAME ?? r.name ?? '').trim();
        const clickable = ledgerDrillEnabled && Boolean(code);
        const Tag = clickable ? 'button' : 'div';
        const activeMonths = monthCols.filter((c) => cellAmount(r, c.key) !== 0);

        return (
          <Tag
            key={r._id}
            type={clickable ? 'button' : undefined}
            className={`itax-mobile-card itax-mobile-card--month${clickable ? ' itax-mobile-card--ledger' : ''}`}
            onClick={clickable ? () => onRowClick(r) : undefined}
          >
            <div className="itax-mobile-card__head itax-mobile-card__head--month">
              <span className="itax-mobile-card__code">{fmtCell(code, 'text')}</span>
              {name ? <span className="itax-mobile-card__name-inline">{name}</span> : null}
            </div>
            <div className="itax-mobile-card__grid itax-mobile-card__grid--summary">
              <div className="itax-mobile-card__attr">
                <span className="itax-mobile-card__attr-label">Op</span>
                <span className="itax-mobile-card__attr-val num">{fmtCell(r.OP ?? r.op, 'num')}</span>
              </div>
              <div className="itax-mobile-card__attr">
                <span className="itax-mobile-card__attr-label">Tot</span>
                <span className="itax-mobile-card__attr-val num">{fmtCell(r.TOT ?? r.tot, 'num')}</span>
              </div>
            </div>
            {activeMonths.length ? (
              <div className="itax-mobile-card__months">
                <div className="itax-mobile-card__months-label">Months</div>
                <div className="itax-mobile-card__grid itax-mobile-card__grid--months">
                  {activeMonths.map((c) => (
                    <div key={c.key} className="itax-mobile-card__attr">
                      <span className="itax-mobile-card__attr-label">{c.label || c.key}</span>
                      <span className="itax-mobile-card__attr-val num">{fmtCell(r[c.key], 'num')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Tag>
        );
      })}
      {!items.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function ItaxMobilePartyList({ rows, displayColumns, ledgerDrillEnabled, onOpenLedger, onRowClick }) {
  const partyCol = displayColumns.find((c) => c.type === 'partyBlock');
  const attrCols = displayColumns.filter((c) => c.type !== 'partyBlock' && c.key !== 'CODE');

  return (
    <div className="itax-mobile-list">
      {rows.map((r, idx) => {
        const isGrand = isIncomeTaxGrandTotalRow(r);
        const code = rowLedgerCode(r, displayColumns);
        const clickable = !isGrand && ledgerDrillEnabled && onOpenLedger && Boolean(code);
        const Tag = clickable ? 'button' : 'div';
        const rowKey = r._id ?? `party-row-${idx}`;

        if (isGrand) {
          return (
            <div key={rowKey} className="itax-mobile-card itax-mobile-card--grand-total">
              <div className="itax-mobile-card__head">
                <span className="itax-mobile-card__code">GRAND TOTAL</span>
              </div>
              <div className="itax-mobile-card__grid">
                {attrCols.map((c) => (
                  <div key={c.key} className="itax-mobile-card__attr">
                    <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
                    <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>
                      {renderReportCell(r, c)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return (
          <Tag
            key={rowKey}
            type={clickable ? 'button' : undefined}
            className={`itax-mobile-card${clickable ? ' itax-mobile-card--ledger' : ''}`}
            onClick={clickable ? () => onRowClick(r) : undefined}
          >
            <div className="itax-mobile-card__head">
              <span className="itax-mobile-card__code">{fmtCell(r.CODE ?? r.code, 'text')}</span>
            </div>
            {partyCol ? <div className="itax-mobile-card__party">{renderReportCell(r, partyCol)}</div> : null}
            <div className="itax-mobile-card__grid">
              {attrCols.map((c) => (
                <div key={c.key} className="itax-mobile-card__attr">
                  <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
                  <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>
                    {renderReportCell(r, c)}
                  </span>
                </div>
              ))}
            </div>
          </Tag>
        );
      })}
      {!rows.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

/** Mobile Top N sales cards — name left, amount + qty right (tap → party ledger). */
function ItaxMobileTopSalesList({ rows, title, topN, ledgerDrillEnabled, onOpenLedger, onRowClick }) {
  const dataRows = (rows || []).filter((r) => !isIncomeTaxGrandTotalRow(r));
  const totalAmt = dataRows.reduce((s, r) => s + Number(r.AMOUNT ?? r.amount ?? 0), 0);
  const totalQty = dataRows.reduce((s, r) => s + Number(r.QNTY ?? r.qnty ?? 0), 0);
  const label = title || `Top ${topN || dataRows.length} Sales`;

  return (
    <div className="itax-top-sales">
      <div className="itax-top-sales__header">
        <div className="itax-top-sales__header-left">
          <div className="itax-top-sales__title">{label}</div>
          <div className="itax-top-sales__sub">Tap a party to open sale ledger</div>
        </div>
        <div className="itax-top-sales__header-right">
          <div className="itax-top-sales__total-amt">{fmtCell(totalAmt, 'num')}</div>
          <div className="itax-top-sales__total-qty">Q {fmtCell(totalQty, 'num')}</div>
        </div>
      </div>
      <div className="itax-mobile-list itax-top-sales__list">
        {dataRows.map((r, idx) => {
          const code = String(r.CODE ?? r.code ?? '').trim();
          const name = String(r.NAME ?? r.name ?? '').trim();
          const city = String(r.CITY ?? r.city ?? '').trim();
          const displayName = city ? `${name} - ${city}` : name;
          const clickable = ledgerDrillEnabled && onOpenLedger && Boolean(code);
          const Tag = clickable ? 'button' : 'div';
          return (
            <Tag
              key={r._id ?? `top-sale-${code || idx}`}
              type={clickable ? 'button' : undefined}
              className={`itax-top-sales__row${clickable ? ' itax-top-sales__row--ledger' : ''}`}
              onClick={clickable ? () => onRowClick(r) : undefined}
            >
              <div className="itax-top-sales__row-main">
                <span className="itax-top-sales__rank">{fmtCell(r.RANK_NO ?? idx + 1, 'text')}</span>
                <span className="itax-top-sales__name">{displayName || code}</span>
              </div>
              <div className="itax-top-sales__vals">
                <span className="itax-top-sales__amt">{fmtCell(r.AMOUNT ?? r.amount, 'num')}</span>
                <span className="itax-top-sales__qty">{fmtCell(r.QNTY ?? r.qnty, 'num')}</span>
              </div>
            </Tag>
          );
        })}
        {!dataRows.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
      </div>
    </div>
  );
}

function ItaxMobileMonthSummaryList({ rows, items, displayColumns, headKeys, ledgerDrillEnabled, onRowClick }) {
  const list = items ?? rows?.map((r) => ({ _type: 'data', ...r })) ?? [];
  const headCols = (headKeys?.length ? headKeys : ['CMTH'])
    .map((k) => displayColumns.find((c) => c.key === k))
    .filter(Boolean);
  const headKeySet = new Set(headCols.map((c) => c.key));
  const attrCols = displayColumns.filter(
    (c) => c.type === 'num' || (c.type === 'text' && !headKeySet.has(c.key))
  );

  const renderAmountCard = (r, { isGrand = false, isItemTotal = false, isBillTotal = false, clickable = false } = {}) => {
    const Tag = clickable ? 'button' : 'div';
    const cardClass = [
      'itax-mobile-card',
      'itax-mobile-card--month-summary',
      isGrand ? 'itax-mobile-card--grand-total' : '',
      isItemTotal ? 'itax-mobile-card--item-total' : '',
      isBillTotal ? 'itax-mobile-card--party-total' : '',
      clickable ? 'itax-mobile-card--ledger' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const headLabel = isGrand
      ? 'GRAND TOTAL'
      : isBillTotal
        ? 'B.NO TOTAL'
        : isItemTotal
          ? 'ITEM TOTAL'
          : null;

    return (
      <Tag
        key={r._id}
        type={clickable ? 'button' : undefined}
        className={cardClass}
        onClick={clickable ? () => onRowClick?.(r) : undefined}
      >
        <div className="itax-mobile-card__head">
          {headLabel ? (
            <span className="itax-mobile-card__code">{headLabel}</span>
          ) : (
            headCols.map((c, idx) => {
              const val = fmtCell(r[c.key] ?? r[c.key?.toLowerCase?.()], c.type);
              if (!val) return null;
              return (
                <span
                  key={c.key}
                  className={idx === 0 ? 'itax-mobile-card__code' : 'itax-mobile-card__head-month'}
                >
                  {val}
                </span>
              );
            })
          )}
        </div>
        <div className="itax-mobile-card__grid">
          {attrCols.map((c) => (
            <div key={c.key} className="itax-mobile-card__attr">
              <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
              <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>
                {renderReportCell(r, c)}
              </span>
            </div>
          ))}
        </div>
      </Tag>
    );
  };

  return (
    <div className="itax-mobile-list itax-mobile-list--month-summary">
      {list.map((item) => {
        if (item._type === 'group') {
          return (
            <div key={item._id} className="itax-mobile-group itax-mobile-group--item">
              {item.label}
            </div>
          );
        }
        if (item._type === 'subtotal' || isIncomeTaxItemTotalRow(item)) {
          return renderAmountCard(item, { isItemTotal: true });
        }
        if (item._type === 'subtotal' || isIncomeTaxBillTotalRow(item)) {
          return renderAmountCard(item, { isBillTotal: true });
        }
        const isGrand = isIncomeTaxGrandTotalRow(item);
        const code = rowLedgerCode(item, displayColumns);
        const monthKey = String(item.MTH_KEY ?? item.mth_key ?? '').trim();
        const clickable =
          !isGrand &&
          Boolean(onRowClick) &&
          ((ledgerDrillEnabled && Boolean(code)) || Boolean(monthKey));
        return renderAmountCard(item, { isGrand, clickable });
      })}
      {!list.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function ItaxMobilePartyBillList({
  items,
  displayColumns,
  ledgerDrillEnabled,
  onRowClick,
  onLedgerDrill,
  headKeys,
  partyGroupHeaderMinimal = false,
  suppressPartyHeader = false,
  ledgerDrillKeys = null,
}) {
  const dualLedgerDrill = Boolean(ledgerDrillKeys?.party && ledgerDrillKeys?.detail);
  const headCols = (headKeys?.length ? headKeys : [])
    .map((k) => displayColumns.find((c) => c.key === k))
    .filter(Boolean);
  const headKeySet = new Set(headCols.map((c) => c.key));
  const attrCols = displayColumns.filter(
    (c) => !(headKeySet.has(c.key) && c.type !== 'partyBlock')
  );

  const renderMobileHeadValue = (row, col) => {
    if (col.type === 'partyBlock') {
      return String(row[col.key] ?? row[col.key?.toLowerCase?.()] ?? '').trim();
    }
    return fmtCell(row[col.key] ?? row[col.key?.toLowerCase?.()], col.type, col.decimals);
  };

  const renderMobileAttrCell = (row, col) => {
    if (col.type === 'partyBlock' && headKeySet.has(col.key)) {
      const subs = (col.subKeys || [])
        .map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '').trim())
        .filter(Boolean);
      if (!subs.length) return null;
      return (
        <div className="itax-party-block itax-party-block--mobile-subs">
          {subs.map((line, i) => (
            <div key={`${line}-${i}`} className="itax-party-block__sub">
              {line}
            </div>
          ))}
        </div>
      );
    }
    return renderReportCell(row, col);
  };

  const renderBillCard = (r, { isGrand = false, isPartyTotal = false, clickable = false, onClick = null } = {}) => {
    const Tag = clickable ? 'button' : 'div';
    const headLabel = isGrand
      ? 'GRAND TOTAL'
      : isPartyTotal
        ? partySubtotalHeadLabel(r)
        : null;
    const handleClick = onClick ?? (clickable ? () => onRowClick?.(r) : undefined);
    return (
      <Tag
        key={r._id}
        type={clickable ? 'button' : undefined}
        className={[
          'itax-mobile-card',
          'itax-mobile-card--party-bill',
          isGrand ? 'itax-mobile-card--grand-total' : '',
          isPartyTotal ? 'itax-mobile-card--party-total' : '',
          clickable ? 'itax-mobile-card--ledger' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={clickable ? handleClick : undefined}
      >
        {headLabel || headCols.length ? (
          <div className="itax-mobile-card__head">
            {headLabel ? (
              <span className="itax-mobile-card__code">{headLabel}</span>
            ) : (
              headCols.map((c, idx) => {
                const val = renderMobileHeadValue(r, c);
                if (!val) return null;
                return (
                  <span
                    key={c.key}
                    className={idx === 0 ? 'itax-mobile-card__code' : 'itax-mobile-card__head-month'}
                  >
                    {val}
                  </span>
                );
              })
            )}
          </div>
        ) : null}
        <div className="itax-mobile-card__grid">
          {attrCols.map((c) => {
            const cell = renderMobileAttrCell(r, c);
            if (cell == null) return null;
            const subsOnly = c.type === 'partyBlock' && headKeySet.has(c.key);
            return (
              <div
                key={c.key}
                className={`itax-mobile-card__attr${subsOnly ? ' itax-mobile-card__attr--full' : ''}`}
              >
                {!subsOnly ? (
                  <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
                ) : null}
                <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>{cell}</span>
              </div>
            );
          })}
        </div>
      </Tag>
    );
  };

  return (
    <div className="itax-mobile-list itax-mobile-list--party-bill">
      {items.map((item) => {
        if (item._type === 'partyGroup') {
          if (suppressPartyHeader) return null;
          const partyCode = rowFieldCode(item.partyRow, ledgerDrillKeys?.party ?? 'CODE');
          const partyDrill = dualLedgerDrill && ledgerDrillEnabled && partyCode && onLedgerDrill;
          return (
            <div key={item._id} className="itax-mobile-group itax-mobile-group--party">
              {renderPartyGroupHeader(item.partyRow, {
                minimal: partyGroupHeaderMinimal,
                ledgerDrillCode: partyDrill ? partyCode : null,
                onLedgerDrill: partyDrill ? onLedgerDrill : null,
              })}
            </div>
          );
        }
        if (item._type === 'subtotal' || isIncomeTaxPartyTotalRow(item)) {
          return renderBillCard(item, { isPartyTotal: true });
        }
        const isGrand = isIncomeTaxGrandTotalRow(item);
        const code = dualLedgerDrill
          ? rowFieldCode(item, ledgerDrillKeys.detail)
          : rowLedgerCode(item, displayColumns);
        const clickable = !isGrand && ledgerDrillEnabled && Boolean(code);
        return renderBillCard(item, {
          isGrand,
          clickable,
          onClick: clickable ? () => (onLedgerDrill ? onLedgerDrill(code) : onRowClick?.(item)) : undefined,
        });
      })}
      {!items.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

function ItaxMobileItemPartyMonthList({ items, displayColumns, ledgerDrillEnabled, onRowClick, headKeys, partyGroupHeaderMinimal = false }) {
  const headCols = (headKeys?.length ? headKeys : [])
    .map((k) => displayColumns.find((c) => c.key === k))
    .filter(Boolean);
  const headKeySet = new Set(headCols.map((c) => c.key));
  const attrCols = displayColumns.filter((c) => c.type !== 'partyBlock' && !headKeySet.has(c.key));

  const renderLineCard = (r, { isGrand = false, isPartyTotal = false, isItemTotal = false, isBrokerTotal = false, clickable = false } = {}) => {
    const Tag = clickable ? 'button' : 'div';
    const headLabel = isGrand
      ? 'GRAND TOTAL'
      : isBrokerTotal || isPartyTotal || isItemTotal
        ? partySubtotalHeadLabel(r)
        : null;
    return (
      <Tag
        key={r._id}
        type={clickable ? 'button' : undefined}
        className={[
          'itax-mobile-card',
          'itax-mobile-card--party-bill',
          isGrand ? 'itax-mobile-card--grand-total' : '',
          isBrokerTotal ? 'itax-mobile-card--broker-total' : '',
          isPartyTotal ? 'itax-mobile-card--party-total' : '',
          isItemTotal ? 'itax-mobile-card--item-total' : '',
          clickable ? 'itax-mobile-card--ledger' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={clickable ? () => onRowClick?.(r) : undefined}
      >
        {headLabel || headCols.length ? (
          <div className="itax-mobile-card__head">
            {headLabel ? (
              <span className="itax-mobile-card__code">{headLabel}</span>
            ) : (
              headCols.map((c, idx) => {
                const val = fmtCell(r[c.key] ?? r[c.key?.toLowerCase?.()], c.type);
                if (!val) return null;
                return (
                  <span
                    key={c.key}
                    className={idx === 0 ? 'itax-mobile-card__code' : 'itax-mobile-card__head-month'}
                  >
                    {val}
                  </span>
                );
              })
            )}
          </div>
        ) : null}
        <div className="itax-mobile-card__grid">
          {attrCols.map((c) => (
            <div key={c.key} className="itax-mobile-card__attr">
              <span className="itax-mobile-card__attr-label">{c.label || humanizeColumnKey(c.key)}</span>
              <span className={`itax-mobile-card__attr-val${c.type === 'num' ? ' num' : ''}`}>
                {renderReportCell(r, c)}
              </span>
            </div>
          ))}
        </div>
      </Tag>
    );
  };

  return (
    <div className="itax-mobile-list itax-mobile-list--item-party-month">
      {items.map((item) => {
        if (item._type === 'group') {
          return (
            <div key={item._id} className="itax-mobile-group itax-mobile-group--item">
              {item.label}
            </div>
          );
        }
        if (item._type === 'partyGroup') {
          return (
            <div key={item._id} className="itax-mobile-group itax-mobile-group--party">
              {renderPartyGroupHeader(item.partyRow, { minimal: partyGroupHeaderMinimal })}
            </div>
          );
        }
        if (item._type === 'subtotal' && isIncomeTaxLotRateTotalRow(item)) {
          return renderLineCard(item, { isItemTotal: true });
        }
        if (item._type === 'subtotal' && isIncomeTaxItemTotalRow(item)) {
          return renderLineCard(item, { isItemTotal: true });
        }
        if (item._type === 'subtotal' && isIncomeTaxBrokerTotalRow(item)) {
          return renderLineCard(item, { isBrokerTotal: true });
        }
        if (item._type === 'subtotal' || isIncomeTaxPartyTotalRow(item)) {
          return renderLineCard(item, { isPartyTotal: true });
        }
        const isGrand = isIncomeTaxGrandTotalRow(item);
        const clickable = !isGrand && Boolean(onRowClick);
        return renderLineCard(item, { isGrand, clickable });
      })}
      {!items.length ? <p className="itax-mobile-list__empty">No rows</p> : null}
    </div>
  );
}

/** Generic income tax report screen — all BW_MENU incometaxr items (VFP forms/prg/reports). */
export default function IncomeTaxReportScreen({
  apiBase,
  formData,
  userName,
  onPrev,
  onOpenLedger,
  onOpenVoucher,
  returnSlide,
  viewMode = 'desktop',
  reportModule = 'income-tax',
}) {
  const isOtherReports = reportModule === 'other-reports';
  const isLedgerReports = reportModule === 'ledger-reports';
  const isVoucherBooks = reportModule === 'voucher-books';
  const findModuleItem = isOtherReports
    ? findOtherReportsModuleItem
    : isLedgerReports
      ? findLedgerModuleItem
      : isVoucherBooks
        ? findVoucherBooksModuleItem
        : findIncomeTaxModuleItem;
  const getReportDef = isOtherReports
    ? getOtherReportDef
    : isLedgerReports
      ? getLedgerReportDef
      : isVoucherBooks
        ? getVoucherBookReportDef
        : getIncomeTaxReportDef;
  const resolveFilterMeta = isOtherReports
    ? resolveOtherReportFilterMeta
    : isLedgerReports
      ? resolveLedgerReportFilterMeta
      : isVoucherBooks
        ? resolveVoucherBookReportFilterMeta
        : resolveIncomeTaxFilterMeta;
  const resolveDisplayColumns = isOtherReports
    ? resolveOtherReportDisplayColumns
    : isLedgerReports
      ? resolveLedgerReportDisplayColumns
      : isVoucherBooks
        ? resolveVoucherBookDisplayColumns
        : resolveIncomeTaxDisplayColumns;
  const reportApiPath = isOtherReports
    ? '/api/other-report'
    : isLedgerReports
      ? '/api/ledger-report'
      : isVoucherBooks
        ? '/api/voucher-book'
        : '/api/income-tax-report';
  const helpModuleId = isOtherReports
    ? 'other-reports-module'
    : isLedgerReports
      ? 'ledger-reports-module'
      : isVoucherBooks
        ? 'voucher-books-module'
        : 'income-tax-module';

  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findModuleItem(reportType) || (isLedgerReports ? findLedgerModuleItem(reportType) : null);
  const def = getReportDef(reportType);
  const pdfReportType = isOtherReports
    ? 'other-report'
    : isLedgerReports
      ? 'ledger-report'
      : isVoucherBooks
        ? 'voucher-book'
        : reportType === 'loaner-list'
          ? 'loaner-list'
          : 'income-tax-report';

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sdt, setSdt] = useState(fyStart);
  const [edt, setEdt] = useState(fyEnd);
  const [minAmt, setMinAmt] = useState('0');
  const [topN, setTopN] = useState('10');
  const [scheduleNo, setScheduleNo] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [scode, setScode] = useState('');
  const [icode, setIcode] = useState('');
  const [bkCode, setBkCode] = useState('');
  const [bkName, setBkName] = useState('');
  const [godCode, setGodCode] = useState('');
  const [mcode, setMcode] = useState(() => {
    const fm = resolveFilterMeta(String(formData?.reportType ?? '').trim().toLowerCase(), 'mcode');
    return fm.defaultValue ? fm.defaultValue.toUpperCase() : '';
  });
  const [mdc, setMdc] = useState('');
  const [mru, setMru] = useState('');
  const [bNo, setBNo] = useState('');
  const [panYn, setPanYn] = useState('');
  const [spNo, setSpNo] = useState('');
  const [sbCode, setSbCode] = useState('B00000');
  const [ebCode, setEbCode] = useState('B99999');
  const [msp, setMsp] = useState('S');
  const [mds, setMds] = useState('D');
  const [csdt, setCsdt] = useState(fyStart);
  const [cedt, setCedt] = useState(fyEnd);
  const [icat, setIcat] = useState('');
  const [mlc, setMlc] = useState('');
  const [btype, setBtype] = useState('');
  const [mSupCode, setMSupCode] = useState('');
  const [mcn, setMcn] = useState('D');
  const [rpttype, setRpttype] = useState('');

  const [masterAccounts, setMasterAccounts] = useState([]);
  const [itemMasters, setItemMasters] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const masterAccountSearchRef = useRef(null);
  const masterPickQueryRef = useRef({ prefix: '', sort: 'name' });
  const itemMasterSearchRef = useRef(null);
  const godownSearchRef = useRef(null);
  const scheduleSearchRef = useRef(null);
  const masterAccountOptions = useMemo(() => masterAccounts.map(mapAccountPickOption), [masterAccounts]);
  const itemMasterOptions = useMemo(() => itemMasters.map(mapItemPickOption), [itemMasters]);
  const scheduleOptions = useMemo(
    () =>
      schedules
        .map(mapSchedulePickOption)
        .sort((a, b) => Number(a.value) - Number(b.value)),
    [schedules]
  );
  const godownOptions = useMemo(
    () =>
      godowns
        .map(mapGodownPickOption)
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    [godowns]
  );
  const filterMetaDeps = [reportType, isOtherReports, isLedgerReports];
  const scodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'scode'), filterMetaDeps);
  const icodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'icode'), filterMetaDeps);
  const bkCodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'bkCode'), filterMetaDeps);
  const godCodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'godCode'), filterMetaDeps);
  const scheduleNoFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'scheduleNo'), filterMetaDeps);
  const mcodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'mcode'), filterMetaDeps);
  const spNoFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'spNo'), filterMetaDeps);
  const sbCodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'sbCode'), filterMetaDeps);
  const ebCodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'ebCode'), filterMetaDeps);
  const needsMasterAccountPick =
    scodeFilterMeta.pickList === 'masterAccount' || mcodeFilterMeta.pickList === 'masterAccount';
  const mSupCodeFilterMeta = useMemo(() => resolveFilterMeta(reportType, 'mSupCode'), filterMetaDeps);
  const needsMasterSupplierPick =
    scodeFilterMeta.pickList === 'masterSupplier' || mSupCodeFilterMeta.pickList === 'masterSupplier';
  const needsMasterBrokerPick =
    bkCodeFilterMeta.pickList === 'masterBroker' ||
    sbCodeFilterMeta.pickList === 'masterBroker' ||
    ebCodeFilterMeta.pickList === 'masterBroker' ||
    mcodeFilterMeta.pickList === 'masterBroker';
  const needsMasterCustomerPick = mcodeFilterMeta.pickList === 'masterCustomer';
  const needsCashAccountPick = mcodeFilterMeta.pickList === 'cashAccount';
  const voucherBookDefaultAccount = useMemo(() => {
    if (!isVoucherBooks || !getReportDef(reportType).filters?.includes('mcode')) return null;
    const sched = String(mcodeFilterMeta.schedules ?? '').trim();
    if (sched === '9.10') return 'cash';
    if (sched === '9.20') return 'bank';
    return null;
  }, [isVoucherBooks, reportType, mcodeFilterMeta.schedules]);
  const needsMasterPick =
    needsMasterAccountPick ||
    needsMasterSupplierPick ||
    needsMasterBrokerPick ||
    needsMasterCustomerPick ||
    needsCashAccountPick;
  const needsItemMasterPick = icodeFilterMeta.pickList === 'itemMaster';
  const needsGodownPick = godCodeFilterMeta.pickList === 'godown';
  const needsSchedulePick =
    scheduleNoFilterMeta.pickList === 'scheduleMaster' || spNoFilterMeta.pickList === 'scheduleMaster';

  const fetchMasterAccounts = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      try {
        const trimmed = String(q ?? '').trim();
        const { prefix, sort } = masterPickQueryRef.current;
        const params = {
          comp_code: compCode,
          comp_uid: compUid,
          sort: sort || 'name',
        };
        if (prefix === 'B') params.code_prefix = 'B';
        else if (prefix === 'ST') params.code_prefix = 'ST';
        else if (prefix === 'C') params.code_prefix = 'C';
        else if (needsCashAccountPick) {
          params.sort = 'name';
          params.schedules = '9.10,9.20,9.30';
        } else if (mcodeFilterMeta.schedules) {
          params.schedules = mcodeFilterMeta.schedules;
        } else if (needsMasterBrokerPick) params.code_prefix = 'B';
        else if (needsMasterSupplierPick) params.code_prefix = 'ST';
        else if (needsMasterCustomerPick) {
          params.code_prefix = 'C';
          params.sort = 'name_city';
        }
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-accounts'), {
          params,
          ...reqOpts,
        });
        setMasterAccounts(Array.isArray(data) ? data : []);
      } catch {
        setMasterAccounts([]);
      }
    },
    [apiBase, compCode, compUid, needsMasterSupplierPick, needsMasterBrokerPick, needsMasterCustomerPick, needsCashAccountPick, mcodeFilterMeta.schedules]
  );

  const openMasterPick = useCallback(
    (prefix, sort = 'name') => {
      masterPickQueryRef.current = { prefix, sort };
      void fetchMasterAccounts('');
    },
    [fetchMasterAccounts]
  );

  const filterMasterPick = useCallback(
    (prefix, sort, q) => {
      masterPickQueryRef.current = { prefix, sort };
      if (masterAccountSearchRef.current) clearTimeout(masterAccountSearchRef.current);
      masterAccountSearchRef.current = setTimeout(() => {
        void fetchMasterAccounts(q);
      }, MASTER_ACCOUNT_SEARCH_MS);
    },
    [fetchMasterAccounts]
  );

  const brokerPickListProps = useCallback(
    (triggerCode) => ({
      options: masterAccountOptions,
      ...accountHelpPickProps(triggerCode),
      openFilterSeed: triggerCode,
      onOpen: (seed) => {
        openMasterPick('B', 'name');
        const q = String(seed ?? triggerCode ?? '').trim();
        if (q) filterMasterPick('B', 'name', q);
      },
      onFilterChange: (q) => filterMasterPick('B', 'name', q),
    }),
    [openMasterPick, filterMasterPick, masterAccountOptions]
  );

  const handleBrokerCodeInputChange = useCallback(
    (setter) => (raw) => {
      const next = String(raw ?? '').trim().toUpperCase();
      setter(next);
      const q = next.trim();
      if (q.length >= 2) filterMasterPick('B', 'name', q);
      else if (!q) openMasterPick('B', 'name');
    },
    [filterMasterPick, openMasterPick]
  );

  const supplierPickListProps = useCallback(
    (triggerCode) => ({
      options: masterAccountOptions,
      ...accountHelpPickProps(triggerCode),
      openFilterSeed: triggerCode,
      onOpen: (seed) => {
        openMasterPick('ST', 'name_city');
        const q = String(seed ?? triggerCode ?? '').trim();
        if (q) filterMasterPick('ST', 'name_city', q);
      },
      onFilterChange: (q) => filterMasterPick('ST', 'name_city', q),
    }),
    [openMasterPick, filterMasterPick, masterAccountOptions]
  );

  const handleSupplierCodeInputChange = useCallback(
    (setter) => (raw) => {
      const next = String(raw ?? '').trim().toUpperCase();
      setter(next);
      const q = next.trim();
      if (q.length >= 2) filterMasterPick('ST', 'name_city', q);
      else if (!q) openMasterPick('ST', 'name_city');
    },
    [filterMasterPick, openMasterPick]
  );

  const handleMasterAccountFilterChange = useCallback(
    (q) => {
      if (masterAccountSearchRef.current) clearTimeout(masterAccountSearchRef.current);
      masterAccountSearchRef.current = setTimeout(() => {
        void fetchMasterAccounts(q);
      }, MASTER_ACCOUNT_SEARCH_MS);
    },
    [fetchMasterAccounts]
  );

  const handleMasterAccountPickerOpen = useCallback(() => {
    if (needsMasterBrokerPick) openMasterPick('B', 'name');
    else if (needsMasterSupplierPick) openMasterPick('ST', 'name_city');
    else if (needsMasterCustomerPick) openMasterPick('C', 'name_city');
    else openMasterPick('', 'name');
  }, [openMasterPick, needsMasterBrokerPick, needsMasterSupplierPick, needsMasterCustomerPick]);

  const fetchItemMasters = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      try {
        const trimmed = String(q ?? '').trim();
        const params = { comp_code: compCode, comp_uid: compUid };
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/item-master-list'), {
          params,
          ...reqOpts,
        });
        setItemMasters(Array.isArray(data) ? data : []);
      } catch {
        setItemMasters([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleItemMasterFilterChange = useCallback(
    (q) => {
      if (itemMasterSearchRef.current) clearTimeout(itemMasterSearchRef.current);
      itemMasterSearchRef.current = setTimeout(() => {
        void fetchItemMasters(q);
      }, MASTER_ACCOUNT_SEARCH_MS);
    },
    [fetchItemMasters]
  );

  const handleItemMasterPickerOpen = useCallback(() => {
    void fetchItemMasters('');
  }, [fetchItemMasters]);

  const fetchGodowns = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      try {
        const trimmed = String(q ?? '').trim();
        const params = { comp_code: compCode, comp_uid: compUid };
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(apiUrl(apiBase, '/api/godown-list'), {
          params,
          ...reqOpts,
        });
        setGodowns(Array.isArray(data) ? data : []);
      } catch {
        setGodowns([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleGodownFilterChange = useCallback(
    (q) => {
      if (godownSearchRef.current) clearTimeout(godownSearchRef.current);
      godownSearchRef.current = setTimeout(() => {
        void fetchGodowns(q);
      }, MASTER_ACCOUNT_SEARCH_MS);
    },
    [fetchGodowns]
  );

  const handleGodownPickerOpen = useCallback(() => {
    void fetchGodowns('');
  }, [fetchGodowns]);

  const fetchSchedules = useCallback(
    async (q) => {
      if (!compCode || compUid == null) return;
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/master-party-schedules'), {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        });
        const list = Array.isArray(data) ? data : [];
        const trimmed = String(q ?? '').trim().toLowerCase();
        if (!trimmed) {
          setSchedules(list);
          return;
        }
        setSchedules(
          list.filter((s) => {
            const name = String(s.NAME ?? s.name ?? '').toLowerCase();
            const no = String(s.NO ?? s.no ?? '').toLowerCase();
            return name.includes(trimmed) || no.includes(trimmed);
          })
        );
      } catch {
        setSchedules([]);
      }
    },
    [apiBase, compCode, compUid]
  );

  const handleScheduleFilterChange = useCallback(
    (q) => {
      if (scheduleSearchRef.current) clearTimeout(scheduleSearchRef.current);
      scheduleSearchRef.current = setTimeout(() => {
        void fetchSchedules(q);
      }, MASTER_ACCOUNT_SEARCH_MS);
    },
    [fetchSchedules]
  );

  const handleSchedulePickerOpen = useCallback(() => {
    void fetchSchedules('');
  }, [fetchSchedules]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [showReport, setShowReport] = useState(false);
  const [expenseDrill, setExpenseDrill] = useState(null);
  const [labourDrill, setLabourDrill] = useState(null);
  const [brokerDrill, setBrokerDrill] = useState(null);
  const [voucherDrill, setVoucherDrill] = useState(null);
  const [brokerLedgerDrill, setBrokerLedgerDrill] = useState(null);
  const [outstandingMonthDrill, setOutstandingMonthDrill] = useState(null);
  const [drillRows, setDrillRows] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  );
  const reportRestoreRanRef = useRef(null);
  const entryFormRef = useRef(null);

  const handleEntryFormKeyDown = useCallback((e) => {
    if (focusNextOnEnter(e, entryFormRef)) return;
    if (e.key !== 'Enter') return;
    const formEl = entryFormRef.current;
    const target = e.target;
    if (!formEl || !(target instanceof HTMLElement) || !formEl.contains(target)) return;
    if (!target.matches('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')) {
      return;
    }
    const proceed = formEl.querySelector('button.fas-tb-run-bottom:not([disabled])');
    if (proceed instanceof HTMLElement) {
      e.preventDefault();
      e.stopPropagation();
      proceed.focus();
    }
  }, []);

  const title = meta?.title || (isLedgerReports ? 'Ledger Report' : isOtherReports ? 'Other Report' : 'Income Tax Report');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (fyStart) setSdt(fyStart);
    if (fyEnd) setEdt(fyEnd);
  }, [fyStart, fyEnd, reportType]);

  useEffect(() => {
    const meta = resolveFilterMeta(reportType, 'scode');
    if (meta.defaultValue) {
      setScode(meta.defaultValue.toUpperCase());
    } else if (getReportDef(reportType).filters?.includes('scode')) {
      setScode('');
    }
  }, [reportType]);

  useEffect(() => {
    const meta = resolveFilterMeta(reportType, 'mcode');
    if (meta.defaultValue) {
      setMcode(meta.defaultValue.toUpperCase());
    } else if (getReportDef(reportType).filters?.includes('mcode')) {
      setMcode('');
    }
  }, [reportType]);

  useEffect(() => {
    if (!voucherBookDefaultAccount || !compCode || compUid == null) return;
    if (String(mcode ?? '').trim()) return;
    const endpoint =
      voucherBookDefaultAccount === 'bank'
        ? '/api/voucher-entry/default-bank'
        : '/api/voucher-entry/default-cash';
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, endpoint), {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
          timeout: 15000,
        });
        const code = String(data?.code ?? '').trim().toUpperCase();
        if (!cancelled && code) setMcode(code);
      } catch {
        /* optional default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voucherBookDefaultAccount, compCode, compUid, apiBase, mcode, reportType]);

  useEffect(() => {
    if (!needsCashAccountPick || !compCode || compUid == null) return;
    if (String(mcode ?? '').trim()) return;
    if (voucherBookDefaultAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/voucher-entry/default-cash'), {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
          timeout: 15000,
        });
        const code = String(data?.code ?? '').trim().toUpperCase();
        if (!cancelled && code) setMcode(code);
      } catch {
        /* optional default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsCashAccountPick, voucherBookDefaultAccount, compCode, compUid, apiBase, mcode, reportType]);

  useEffect(() => {
    if (!needsMasterPick) return;
    if (needsMasterBrokerPick) {
      openMasterPick('B', 'name');
      return;
    }
    const seed = needsCashAccountPick
      ? mcodeFilterMeta.defaultValue || ''
      : scodeFilterMeta.defaultValue || '';
    void fetchMasterAccounts(seed);
  }, [
    needsMasterPick,
    needsMasterBrokerPick,
    needsCashAccountPick,
    openMasterPick,
    fetchMasterAccounts,
    scodeFilterMeta.defaultValue,
    mcodeFilterMeta.defaultValue,
  ]);

  useEffect(() => {
    if (!needsItemMasterPick) return;
    void fetchItemMasters('');
  }, [needsItemMasterPick, fetchItemMasters]);

  useEffect(() => {
    if (!needsGodownPick) return;
    void fetchGodowns('');
  }, [needsGodownPick, fetchGodowns]);

  useEffect(() => {
    if (!needsSchedulePick) return;
    void fetchSchedules('');
  }, [needsSchedulePick, fetchSchedules]);

  useEffect(
    () => () => {
      if (masterAccountSearchRef.current) clearTimeout(masterAccountSearchRef.current);
      if (itemMasterSearchRef.current) clearTimeout(itemMasterSearchRef.current);
      if (godownSearchRef.current) clearTimeout(godownSearchRef.current);
      if (scheduleSearchRef.current) clearTimeout(scheduleSearchRef.current);
    },
    []
  );

  const filterValues = useMemo(
    () => ({
      sdt,
      edt,
      minAmt,
      topN,
      scheduleNo,
      stateCode,
      scode,
      icode,
      bkCode,
      bkName,
      godCode,
      mcode,
      mdc,
      mru,
      bNo,
      panYn,
      spNo,
      sbCode,
      ebCode,
      msp,
      mds,
      csdt,
      cedt,
      icat,
      mlc,
      btype,
      mSupCode,
      mcn,
      rpttype,
    }),
    [sdt, edt, minAmt, topN, scheduleNo, stateCode, scode, icode, bkCode, bkName, godCode, mcode, mdc, mru, bNo, panYn, spNo, sbCode, ebCode, msp, mds, csdt, cedt, icat, mlc, btype, mSupCode, mcn, rpttype]
  );

  const monthExpenseDrill = Boolean(def?.monthExpenseDrill);
  const labourDateDrill = Boolean(def?.labourDateDrill);
  const monthOutstandingDrill = Boolean(def?.monthOutstandingDrill);
  const brokerSummaryDrill = Boolean(def?.brokerSummaryDrill);
  const brokerItemSummaryDrill = Boolean(def?.brokerItemSummaryDrill);
  const voucherLedgerDrill = Boolean(def?.voucherLedgerDrill);
  const brokerLedgerDrillEnabled = Boolean(def?.brokerLedgerDrill);
  const inExpenseDrill = monthExpenseDrill && Boolean(expenseDrill);
  const inLabourDrill = labourDateDrill && Boolean(labourDrill);
  const inOutstandingMonthDrill = monthOutstandingDrill && Boolean(outstandingMonthDrill);
  const inBrokerDrill = (brokerSummaryDrill || brokerItemSummaryDrill) && Boolean(brokerDrill);
  const inVoucherDrill = voucherLedgerDrill && Boolean(voucherDrill);
  const inBrokerLedgerDrill = brokerLedgerDrillEnabled && Boolean(brokerLedgerDrill);
  const inBrokerSummaryView =
    ((brokerSummaryDrill && mds === 'S') || Boolean(def?.brokerSummaryOnly)) && !inBrokerDrill;
  const inBrokerItemSummaryView = brokerItemSummaryDrill && mds === 'S' && !inBrokerDrill;
  const inInsuranceSummaryView = reportType === 'insurance-report' && mcn === 'S';
  const inReportDrill =
    inExpenseDrill || inLabourDrill || inOutstandingMonthDrill || inBrokerDrill || inVoucherDrill || inBrokerLedgerDrill;

  const displayColumns = useMemo(() => {
    if (inLabourDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inOutstandingMonthDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inExpenseDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inBrokerDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inVoucherDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inBrokerLedgerDrill && def?.drillDisplayColumns?.length) return def.drillDisplayColumns;
    if (inBrokerSummaryView && def?.summaryDisplayColumns?.length) return def.summaryDisplayColumns;
    if (inBrokerItemSummaryView && def?.summaryDisplayColumns?.length) return def.summaryDisplayColumns;
    if (inInsuranceSummaryView && def?.summaryDisplayColumns?.length) return def.summaryDisplayColumns;
    if (reportType === 'insurance-report' && def?.detailDisplayColumns?.length && mcn !== 'S') {
      return def.detailDisplayColumns;
    }
    return resolveDisplayColumns(reportType, columns, rows);
  }, [inLabourDrill, inOutstandingMonthDrill, inExpenseDrill, inBrokerDrill, inVoucherDrill, inBrokerLedgerDrill, inBrokerSummaryView, inBrokerItemSummaryView, inInsuranceSummaryView, def?.drillDisplayColumns, def?.summaryDisplayColumns, def?.detailDisplayColumns, reportType, columns, rows, mcn]);

  const activeReportRows = inReportDrill ? drillRows : rows;

  const reportRows = useMemo(
    () =>
      ensureIncomeTaxGrandTotalRows(activeReportRows, displayColumns, {
        enabled:
          (Boolean(
            def?.monthSummaryCards ||
              def?.partyGroupWithTotals ||
              def?.brokerItemGroups ||
              def?.chantGroups ||
              def?.itemGroupWithTotals ||
              def?.itemPartyMonthGroups ||
              def?.billGroupWithTotals
          ) ||
            Boolean(def?.grandTotalKeys?.length && def?.grandTotalLabelKey)) &&
          !inReportDrill &&
          !inBrokerSummaryView &&
          !inBrokerItemSummaryView,
        labelKey: inBrokerSummaryView || inBrokerItemSummaryView
          ? def?.summaryGrandTotalLabelKey ?? def?.grandTotalLabelKey ?? 'BNAME'
          : def?.grandTotalLabelKey ?? 'CMTH',
      }),
    [
      activeReportRows,
      displayColumns,
      def?.monthSummaryCards,
      def?.partyGroupWithTotals,
      def?.brokerItemGroups,
      def?.chantGroups,
      def?.itemGroupWithTotals,
      def?.itemPartyMonthGroups,
      def?.billGroupWithTotals,
      def?.grandTotalLabelKey,
      inReportDrill,
      inBrokerSummaryView,
      inBrokerItemSummaryView,
      def?.summaryGrandTotalLabelKey,
    ]
  );

  const drillSuppressPartyHeader = inExpenseDrill && Boolean(def?.drillPartySuppressHeader);
  const partyGroupHeaderMinimal = Boolean(def?.partyGroupHeaderMinimal);
  const compactEntry = Boolean(def?.compactEntry);
  const showEntryFilterHints = !compactEntry || Boolean(def?.entryFilterHints);
  const brokerItemGroups = Boolean(def?.brokerItemGroups);
  const chantGroups = def?.chantGroups ?? (def?.chantFormat1Groups ? 'lotRate' : null);
  const compactTable = Boolean(def?.compactTable) || inLabourDrill || inOutstandingMonthDrill || inBrokerDrill || inBrokerLedgerDrill || brokerItemGroups || Boolean(chantGroups);
  const labourReportLayout = Boolean(def?.labourReportLayout);
  const monthPivot = Boolean(def?.monthPivot);
  const monthOutstandingLayout = Boolean(def?.monthOutstandingLayout);
  const groupByKeys = Array.isArray(def?.groupBy) ? def.groupBy : null;
  const itemGroupWithTotals = Boolean(def?.itemGroupWithTotals);
  const partyGroupWithTotals =
    Boolean(def?.partyGroupWithTotals || (inExpenseDrill && def?.drillPartyGroup)) &&
    !inBrokerSummaryView &&
    !inVoucherDrill;
  const billGroupWithTotals = Boolean(def?.billGroupWithTotals);
  const itemPartyMonthGroups = Boolean(def?.itemPartyMonthGroups);
  const isMobileUi = viewMode === 'mobile' || narrowViewport;
  const useMobileLabourCards = isMobileUi && labourReportLayout && !inLabourDrill;
  const useMobilePartyCards = isMobileUi && compactTable && displayColumns.some((c) => c.type === 'partyBlock') && !def?.topSalesCards;
  const useMobileTopSalesCards = Boolean(def?.topSalesCards);
  const useMobileMonthCards = isMobileUi && monthPivot && !monthExpenseDrill;
  const useMobileMonthSummaryCards =
    isMobileUi && Boolean(def?.monthSummaryCards || def?.billGroupWithTotals) && !inOutstandingMonthDrill;
  const useMobilePartyBillCards = isMobileUi && partyGroupWithTotals && !monthExpenseDrill;
  const useMobileItemPartyMonthCards = isMobileUi && Boolean(def?.itemPartyMonthGroups || def?.brokerItemGroups || chantGroups);
  const useMobileBrokerDrillCards = isMobileUi && inBrokerDrill && Boolean(def?.mobileCardHeadKeys?.length);
  const useMobileVoucherDrillCards = isMobileUi && inVoucherDrill && Boolean(def?.voucherDrillMobileCardHeadKeys?.length || def?.mobileCardHeadKeys?.length);
  const useMobileBrokerLedgerDrillCards = isMobileUi && inBrokerLedgerDrill && Boolean(def?.mobileCardHeadKeys?.length);
  const useMobileExpenseMonthPivot = isMobileUi && monthExpenseDrill && !inExpenseDrill;
  const useMobileExpenseDrill = isMobileUi && inExpenseDrill && def?.drillPartyGroup;
  const useMobileCards =
    useMobileLabourCards ||
    useMobilePartyCards ||
    useMobileTopSalesCards ||
    useMobileMonthCards ||
    useMobileMonthSummaryCards ||
    useMobilePartyBillCards ||
    useMobileItemPartyMonthCards ||
    useMobileBrokerDrillCards ||
    useMobileVoucherDrillCards ||
    useMobileBrokerLedgerDrillCards ||
    useMobileExpenseMonthPivot ||
    useMobileExpenseDrill;
  const useMobileToolbar = isMobileUi;
  const mobileTableScroll = isMobileUi && compactTable && !useMobileCards;

  const itemPartyTable =
    itemGroupWithTotals && displayColumns.some((c) => c.key === 'CODE' && c.type === 'text');
  const flatPartyTable =
    compactTable &&
    displayColumns.some((c) => c.key === 'CODE') &&
    displayColumns.some((c) => c.key === 'NAME') &&
    !itemGroupWithTotals &&
    !partyGroupWithTotals &&
    !billGroupWithTotals &&
    !itemPartyMonthGroups;

  const reportMetaCounts = useMemo(() => {
    const dataRows = reportRows.filter((r) => !isIncomeTaxGrandTotalRow(r));
    const grandRow = reportRows.find(isIncomeTaxGrandTotalRow);
    const hasBillCnt = displayColumns.some((c) => c.key === 'BILL_CNT');
    const totalBills = hasBillCnt
      ? Number(grandRow?.BILL_CNT ?? grandRow?.bill_cnt ?? 0) ||
        dataRows.reduce((s, r) => s + (Number(r.BILL_CNT ?? r.bill_cnt ?? 0) || 0), 0)
      : null;
    return { dataRows: dataRows.length, totalBills };
  }, [reportRows, displayColumns]);

  const filterSelectionSummary = useMemo(() => {
    const keys = def?.selectionSummaryKeys;
    if (!showReport || !keys?.length) return '';
    const parts = [];
    const supplierCode = scode.trim().toUpperCase();
    if (keys.includes('scode') && supplierCode) {
      const hit = masterAccountOptions.find((o) => o.value === supplierCode);
      parts.push(`Supplier: ${hit?.label ? `${supplierCode} — ${hit.label}` : supplierCode}`);
    }
    const itemCode = icode.trim();
    if (keys.includes('icode') && itemCode) {
      const hit = itemMasterOptions.find((o) => String(o.value) === itemCode);
      parts.push(`Item: ${hit?.label ? `${itemCode} — ${hit.label}` : itemCode}`);
    }
    const gCode = godCode.trim();
    if (keys.includes('godCode') && gCode) {
      const hit = godownOptions.find((o) => String(o.value) === gCode);
      parts.push(`Godown: ${hit?.label ? `${gCode} — ${hit.label}` : gCode}`);
    }
    const brokerCode = bkCode.trim().toUpperCase();
    if (keys.includes('bkCode') && brokerCode) {
      const hit = masterAccountOptions.find((o) => o.value === brokerCode);
      parts.push(`Broker: ${hit?.label ? `${brokerCode} — ${hit.label}` : brokerCode}`);
    }
    return parts.join(' · ');
  }, [
    def?.selectionSummaryKeys,
    showReport,
    scode,
    icode,
    godCode,
    bkCode,
    masterAccountOptions,
    itemMasterOptions,
    godownOptions,
  ]);

  const tableRows = useMemo(() => {
    if (chantGroups && reportRows.length) {
      return buildChantGroupedRows(reportRows, displayColumns, { mode: chantGroups });
    }
    if (brokerItemGroups && reportRows.length && !inBrokerDrill) {
      const mdsIsSummary = String(mds).trim().toUpperCase() === 'S';
      return buildBrokerItemGroupedRows(reportRows, displayColumns, {
        brokerGroupKeys: def?.brokerGroupKeys ?? ['BK_CODE'],
        itemGroupKeys: def?.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'],
        brokerHideKeys: def?.brokerGroupHideKeys,
        itemHideKeys: def?.itemGroupHideKeys,
        subtotalLabelKey: mdsIsSummary
          ? def?.summaryBrokerSubtotalLabelKey ?? 'ITEM_NAME'
          : def?.brokerSubtotalLabelKey ?? def?.itemSubtotalLabelKey ?? 'NAME',
        brokerSubtotalLabel: def?.brokerSubtotalLabel ?? 'BROKER TOTAL',
        itemSubtotalLabel: def?.itemSubtotalLabel ?? 'ITEM TOTAL',
        skipItemSubtotal: mdsIsSummary,
        itemLabelFn: resolveItaxGroupLabelFn(def?.itemGroupLabelFn) ?? formatItemGroupLabel,
      });
    }
    if (itemPartyMonthGroups && reportRows.length) {
      return buildItemPartyMonthGroupedRows(reportRows, displayColumns, {
        itemGroupKeys: def?.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'],
        partyGroupKeys: def?.partyGroupKeys ?? ['CODE'],
        itemHideKeys: def?.itemGroupHideKeys,
        partyHideKeys: def?.partyGroupHideKeys,
        subtotalLabelKey: def?.grandTotalLabelKey ?? 'CMTH',
        itemLabelFn: resolveItaxGroupLabelFn(def?.itemGroupLabelFn) ?? formatItemGroupLabel,
        partyLabelFn: resolveItaxGroupLabelFn(def?.partyGroupLabelFn) ?? formatPartyGroupLabel,
        partyHeaderType: def?.partyHeaderType,
        partySubtotalLabel: def?.partySubtotalLabel,
        itemSubtotalLabel: def?.itemSubtotalLabel,
      });
    }
    if (partyGroupWithTotals && reportRows.length) {
      return buildPartyBillGroupedRows(reportRows, displayColumns, {
        groupKeys: inExpenseDrill
          ? def?.drillPartyGroupKeys ?? ['CODE']
          : def?.partyGroupKeys ?? ['SUP_CODE'],
        hideInDataKeys: inExpenseDrill
          ? def?.drillPartyHideKeys ?? []
          : def?.partyGroupHideKeys,
        blankRepeatInDataKeys: inExpenseDrill ? def?.drillPartyBlankRepeatKeys : undefined,
        suppressPartyHeader: inExpenseDrill && Boolean(def?.drillPartySuppressHeader),
        subtotalLabelKey: inExpenseDrill
          ? def?.drillPartySubtotalLabelKey ?? 'NAME'
          : def?.partyGroupSubtotalLabelKey ?? def?.grandTotalLabelKey ?? 'R_DATE',
        subtotalLabel: inExpenseDrill
          ? def?.drillPartySubtotalLabel ?? 'CODE TOTAL'
          : def?.partyGroupSubtotalLabel ?? 'PARTY TOTAL',
      });
    }
    if (billGroupWithTotals && reportRows.length) {
      return buildBillGroupedRows(reportRows, displayColumns, {
        groupKeys: def?.billGroupKeys ?? ['B_NO'],
        hideInDataKeys: def?.billGroupHideKeys,
        subtotalLabelKey: def?.grandTotalLabelKey ?? 'B_NO',
        billBalanceTotals: Boolean(def?.billBalanceTotals),
      });
    }
    if (itemGroupWithTotals && reportRows.length) {
      const groupKeys = def?.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'];
      const labelFn =
        def?.itemGroupLabelFn === 'itemCode' ? formatItemCodeGroupLabel : undefined;
      return buildItemMonthGroupedRows(reportRows, displayColumns, {
        groupKeys,
        hideInDataKeys: def?.itemGroupHideKeys ?? groupKeys,
        subtotalLabelKey: def?.grandTotalLabelKey ?? 'CMTH',
        ...(labelFn ? { labelFn } : {}),
      });
    }
    if (!groupByKeys?.length || !reportRows.length) {
      return reportRows.map((r) => ({ _type: 'data', ...r }));
    }
    return buildGroupedDisplayRows(reportRows, groupByKeys);
  }, [
    reportRows,
    groupByKeys,
    displayColumns,
    chantGroups,
    itemGroupWithTotals,
    partyGroupWithTotals,
    billGroupWithTotals,
    brokerItemGroups,
    inBrokerDrill,
    def?.brokerGroupKeys,
    def?.itemGroupKeys,
    def?.brokerGroupHideKeys,
    def?.itemGroupHideKeys,
    def?.brokerSubtotalLabelKey,
    def?.itemSubtotalLabelKey,
    def?.summaryBrokerSubtotalLabelKey,
    def?.brokerSubtotalLabel,
    def?.itemSubtotalLabel,
    mds,
    itemPartyMonthGroups,
    def?.itemGroupKeys,
    def?.itemGroupHideKeys,
    def?.itemGroupLabelFn,
    def?.partyGroupKeys,
    def?.partyGroupHideKeys,
    def?.partyGroupLabelFn,
    def?.partyHeaderType,
    def?.partySubtotalLabel,
    def?.itemSubtotalLabel,
    def?.billGroupKeys,
    def?.billGroupHideKeys,
    def?.billBalanceTotals,
    def?.grandTotalLabelKey,
    inExpenseDrill,
    def?.drillPartyGroupKeys,
    def?.drillPartyHideKeys,
    def?.drillPartyBlankRepeatKeys,
    def?.drillPartySuppressHeader,
    def?.drillPartySubtotalLabelKey,
    def?.drillPartySubtotalLabel,
    def?.partyGroupSubtotalLabel,
  ]);

  const saleBillDrillEnabled =
    Boolean(def?.saleBillDrill) && msp === 'S' && !inBrokerSummaryView && !inBrokerItemSummaryView;
  const brokerSummaryRowDrillEnabled = inBrokerSummaryView;
  const brokerItemSummaryRowDrillEnabled = inBrokerItemSummaryView;
  const voucherEntryRowDrillEnabled =
    Boolean(def?.voucherEntryDrill) && typeof onOpenVoucher === 'function';
  const voucherLedgerRowDrillEnabled =
    Boolean(def?.voucherLedgerDrill) && !inVoucherDrill && !voucherEntryRowDrillEnabled;
  const brokerLedgerRowDrillEnabled = brokerLedgerDrillEnabled && !inBrokerLedgerDrill;
  const monthOutstandingRowDrillEnabled = monthOutstandingDrill && !inOutstandingMonthDrill;
  const ledgerDrillEnabled =
    !saleBillDrillEnabled &&
    !voucherLedgerRowDrillEnabled &&
    !brokerLedgerRowDrillEnabled &&
    (Boolean(def?.ledgerDrilldown) || displayColumns.some((c) => /^code$/i.test(String(c.key))));
  const ledgerDrillKeys = def?.ledgerDrillKeys ?? null;
  const dualLedgerDrill = Boolean(ledgerDrillKeys?.party && ledgerDrillKeys?.detail);

  const openLedgerForCode = useCallback(
    (code) => {
      if (!onOpenLedger || !ledgerDrillEnabled) return;
      const c = String(code ?? '').trim();
      if (!c) return;
      onOpenLedger({ code: c, reportType, sdt, edt });
    },
    [onOpenLedger, ledgerDrillEnabled, reportType, sdt, edt]
  );

  const openSaleBillFromRow = useCallback((row) => {
    const typ = row.TYPE ?? row.type;
    const billNo = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bType = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || billNo == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    setBillPrintParams({
      type: String(typ).trim(),
      billNo: String(billNo).trim(),
      bType: String(bType).trim(),
      oracleDt,
      label: `Sale bill — ${typ} / ${billNo} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  }, []);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      reportTitle: title,
      reportId: reportType,
      period: `${toDisplayDate(sdt)} – ${toDisplayDate(edt)}`,
      columns: displayColumns,
      tableRows:
        groupByKeys?.length ||
        itemGroupWithTotals ||
        partyGroupWithTotals ||
        billGroupWithTotals ||
        itemPartyMonthGroups ||
        brokerItemGroups
          ? tableRows
          : undefined,
      pdfLandscape: def?.pdfLandscape !== false,
      partyGroupHeaderMinimal,
    }),
    [compName, compYear, title, reportType, sdt, edt, displayColumns, groupByKeys, itemGroupWithTotals, partyGroupWithTotals, billGroupWithTotals, itemPartyMonthGroups, brokerItemGroups, tableRows, def?.pdfLandscape, partyGroupHeaderMinimal]
  );

  const buildPayload = () => {
    const body = {
      report_id: reportType,
      comp_code: compCode,
      comp_uid: compUid,
      s_date: toOracleDate(sdt),
      e_date: toOracleDate(edt),
      min_amt: minAmt,
      top_n: topN,
      schedule_no: scheduleNo.trim() || '0',
      state_code: stateCode.trim(),
      scode: scode.trim(),
      icode: icode.trim(),
      bk_code: bkCode.trim(),
      bk_name: bkName.trim(),
      god_code: godCode.trim(),
      mcode: mcode.trim(),
      mdc: mdc.trim(),
      mru: mru.trim(),
      b_no: bNo.trim() || '0',
      pan_yn: panYn.trim(),
      sp_no: spNo.trim() || '0',
      sb_code: sbCode.trim(),
      eb_code: ebCode.trim(),
      msp: msp.trim(),
      mds: mds.trim(),
      cs_date: toOracleDate(csdt || sdt),
      ce_date: toOracleDate(cedt || edt),
      icat: icat.trim(),
      mlc: mlc.trim(),
      btype: btype.trim(),
      m_sup_code: mSupCode.trim(),
      mcn: mcn.trim(),
      rpttype: rpttype.trim(),
      comp_year: compYear ? Number(compYear) || compYear : undefined,
      fy_s_date: fyStart ? toOracleDate(fyStart) : undefined,
    };
    return body;
  };

  const fetchBrokerItemDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row)) return;
      const bkCode = String(row.BK_CODE ?? row.bk_code ?? '').trim().toUpperCase();
      const itemCatDrill = def?.brokerItemSummaryDrillMode === 'itemCat';
      const itemCode = String(row.ITEM_CODE ?? row.item_code ?? '').trim();
      const itemName = String(row.ITEM_NAME ?? row.item_name ?? '').trim();
      const itemCat = String(row.ITEM_CAT ?? row.item_cat ?? '').trim();
      if (!bkCode || (!itemCatDrill && !itemCode)) return;
      setDrillLoading(true);
      setBrokerDrill({
        bkCode,
        itemCode: itemCatDrill ? undefined : itemCode,
        itemName: itemCatDrill ? undefined : itemName,
        itemCat: itemCatDrill ? itemCat : undefined,
        label: itemCatDrill
          ? [bkCode, itemCat].filter(Boolean).join(' — ')
          : [bkCode, itemCode, itemName].filter(Boolean).join(' — '),
        rowKey: row._id ?? (itemCatDrill ? `${bkCode}|${itemCat}` : `${bkCode}|${itemCode}`),
      });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            ...buildPayload(),
            detail_mode: itemCatDrill ? 'broker-item-cat' : 'broker-item',
            detail_bk_code: bkCode,
            ...(itemCatDrill
              ? { detail_item_cat: itemCat }
              : { detail_item_code: itemCode, detail_item_name: itemName }),
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `broker-item-drill-${idx}` })));
        if (!list.length) {
          alert(
            itemCatDrill
              ? `No detail for broker ${bkCode}, category ${itemCat || '(all)'}.`
              : `No detail for broker ${bkCode}, item ${itemCode}.`
          );
        }
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Detail load failed';
        alert(msg);
        setBrokerDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportApiPath, compCode, compUid, sdt, edt, scode, icode, mcode, sbCode, ebCode, msp, mds, icat, mlc, btype, mSupCode, godCode, bkCode, bkName, bNo, panYn, spNo, minAmt, topN, scheduleNo, stateCode, mdc, mru, csdt, cedt, mcn, rpttype, def?.brokerItemSummaryDrillMode]
  );

  const fetchBrokerDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row)) return;
      const bkCode = String(row.BK_CODE ?? row.bk_code ?? '').trim().toUpperCase();
      const bname = String(row.BNAME ?? row.bname ?? '').trim();
      if (!bkCode) return;
      setDrillLoading(true);
      setBrokerDrill({
        bkCode,
        label: [bkCode, bname].filter(Boolean).join(' '),
        rowKey: row._id ?? bkCode,
      });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            ...buildPayload(),
            detail_mode: 'broker',
            detail_bk_code: bkCode,
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `broker-drill-${idx}` })));
        if (!list.length) alert(`No detail for broker ${bkCode}.`);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Detail load failed';
        alert(msg);
        setBrokerDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportApiPath, compCode, compUid, sdt, edt, scode, icode, mcode, sbCode, ebCode, msp, mds, icat, mlc, btype, mSupCode, godCode, bkCode, bkName, bNo, panYn, spNo, minAmt, topN, scheduleNo, stateCode, mdc, mru, csdt, cedt, mcn, rpttype]
  );

  const fetchVoucherLedgerDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row) || isIncomeTaxPartyTotalRow(row)) return;
      const vrType = String(row.VR_TYPE ?? row.vr_type ?? '').trim();
      const vrNo = row.VR_NO ?? row.vr_no;
      const vrDateOracle = toOracleDate(toInputDateString(row.VR_DATE ?? row.vr_date));
      if (!vrType || vrNo == null || String(vrNo).trim() === '' || !vrDateOracle) {
        alert('Cannot load voucher: missing type, date, or voucher number.');
        return;
      }
      setDrillLoading(true);
      setVoucherDrill({
        label: `${vrType} ${toDisplayDate(toInputDateString(row.VR_DATE ?? row.vr_date))} / ${vrNo}`,
        rowKey: row._id ?? `${vrType}|${vrDateOracle}|${vrNo}`,
      });
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/ledger-voucher'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            vr_type: vrType,
            vr_date: vrDateOracle,
            vr_no: Number(vrNo),
          },
          ...reqOpts,
        });
        const list = Array.isArray(data) ? data : [];
        const sumDr = list.reduce((s, r) => s + (Number(r.DR_AMT) || 0), 0);
        const sumCr = list.reduce((s, r) => s + (Number(r.CR_AMT) || 0), 0);
        const mapped = list.map((r, idx) => ({ ...r, _id: `voucher-drill-${idx}` }));
        if (mapped.length) {
          mapped.push({
            DETAIL: 'GRAND TOTAL',
            DR_AMT: sumDr,
            CR_AMT: sumCr,
            _isGrandTotal: true,
            _id: 'voucher-drill-grand',
          });
        }
        setDrillRows(mapped);
        if (!list.length) alert(`No ledger lines for ${vrType} ${vrNo}.`);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Voucher detail load failed';
        alert(msg);
        setVoucherDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, compCode, compUid]
  );

  const fetchBrokerLedgerDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row)) return;
      const code = String(row.CODE ?? row.code ?? '').trim().toUpperCase();
      const name = String(row.NAME ?? row.name ?? '').trim();
      if (!code) return;
      setDrillLoading(true);
      setBrokerLedgerDrill({
        code,
        label: [code, name].filter(Boolean).join(' '),
        rowKey: row._id ?? code,
      });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            report_id: 'broker-ledger',
            comp_code: compCode,
            comp_uid: compUid,
            s_date: toOracleDate(sdt),
            e_date: toOracleDate(edt),
            mcode: code,
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `broker-ledger-drill-${idx}` })));
        if (!list.length) alert(`No ledger entries for ${code}.`);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Broker ledger load failed';
        alert(msg);
        setBrokerLedgerDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportApiPath, compCode, compUid, sdt, edt]
  );

  const fetchOutstandingMonthDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row)) return;
      const monthLabel = String(row.CMTH ?? row.cmth ?? '').trim();
      const mthKey = String(row.MTH_KEY ?? row.mth_key ?? '').trim();
      const detailMonth = monthKeyToOracleDate(mthKey);
      if (!detailMonth) return;
      setDrillLoading(true);
      setOutstandingMonthDrill({
        monthLabel,
        mthKey,
        rowKey: row._id ?? mthKey,
      });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            report_id: reportType,
            comp_code: compCode,
            comp_uid: compUid,
            s_date: toOracleDate(sdt),
            e_date: toOracleDate(edt),
            detail_mode: 'month',
            detail_month: detailMonth,
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `month-out-drill-${idx}` })));
        if (!list.length) alert(`No entries for ${monthLabel || detailMonth}.`);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Detail load failed';
        alert(msg);
        setOutstandingMonthDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportApiPath, reportType, compCode, compUid, sdt, edt]
  );

  const handleRowClick = useCallback(
    (row) => {
      if (def?.bookDayWiseFormat && isVoucherBookSummaryRow(row)) return;
      if (voucherEntryRowDrillEnabled) {
        onOpenVoucher(row, {
          reportType,
          returnSlide,
          filters: { sdt, edt, mcode: String(mcode ?? '').trim().toUpperCase() },
        });
        return;
      }
      if (brokerItemSummaryRowDrillEnabled) {
        fetchBrokerItemDetail(row);
        return;
      }
      if (brokerSummaryRowDrillEnabled) {
        fetchBrokerDetail(row);
        return;
      }
      if (brokerLedgerRowDrillEnabled) {
        fetchBrokerLedgerDetail(row);
        return;
      }
      if (monthOutstandingRowDrillEnabled) {
        fetchOutstandingMonthDetail(row);
        return;
      }
      if (voucherLedgerRowDrillEnabled) {
        fetchVoucherLedgerDetail(row);
        return;
      }
      if (saleBillDrillEnabled) {
        openSaleBillFromRow(row);
        return;
      }
      const code = dualLedgerDrill
        ? rowFieldCode(row, ledgerDrillKeys.detail)
        : rowLedgerCode(row, displayColumns);
      openLedgerForCode(code);
    },
    [
      def?.bookDayWiseFormat,
      voucherEntryRowDrillEnabled,
      onOpenVoucher,
      reportType,
      returnSlide,
      sdt,
      edt,
      mcode,
      brokerItemSummaryRowDrillEnabled,
      fetchBrokerItemDetail,
      brokerSummaryRowDrillEnabled,
      fetchBrokerDetail,
      brokerLedgerRowDrillEnabled,
      fetchBrokerLedgerDetail,
      monthOutstandingRowDrillEnabled,
      fetchOutstandingMonthDetail,
      voucherLedgerRowDrillEnabled,
      fetchVoucherLedgerDetail,
      saleBillDrillEnabled,
      openSaleBillFromRow,
      dualLedgerDrill,
      ledgerDrillKeys,
      displayColumns,
      openLedgerForCode,
    ]
  );

  const fetchLabourDateDetail = useCallback(
    async (row) => {
      if (isIncomeTaxGrandTotalRow(row)) return;
      const raw = row.VR_DATE ?? row.vr_date;
      const dateLabel = formatLedgerDateDisplay(raw) || String(raw ?? '').trim();
      const detailDate = toOracleDate(toInputDateString(raw));
      if (!detailDate) return;
      setDrillLoading(true);
      setLabourDrill({ dateLabel, detailDate, rowKey: row._id ?? dateLabel });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            report_id: reportType,
            comp_code: compCode,
            comp_uid: compUid,
            s_date: toOracleDate(sdt),
            e_date: toOracleDate(edt),
            detail_mode: 'date',
            detail_date: detailDate,
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `labour-drill-${idx}` })));
        if (!list.length) alert(`No lot entries for ${dateLabel}.`);
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Detail load failed';
        alert(msg);
        setLabourDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportApiPath, reportType, compCode, compUid, sdt, edt]
  );

  const fetchExpenseMonthDetail = useCallback(
    async (row, monthKey) => {
      const expType = resolveExpenseExpType(row.HEAD_NAME ?? row.head_name);
      if (!expType || cellAmount(row, monthKey) === 0) return;
      const head = String(row.HEAD_NAME ?? row.head_name ?? '').trim();
      if (head.toUpperCase() === 'TOTAL') return;
      setDrillLoading(true);
      setExpenseDrill({
        monthKey,
        expType,
        headName: head,
        label: `${head} — ${fiscalMonthColLabel(monthKey)}`,
      });
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, '/api/income-tax-report'),
          {
            report_id: reportType,
            comp_code: compCode,
            comp_uid: compUid,
            s_date: toOracleDate(sdt),
            e_date: toOracleDate(edt),
            detail_mode: 'month',
            month_key: monthKey,
            exp_type: expType,
          },
          reqOpts
        );
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setDrillRows(list.map((r, idx) => ({ ...r, _id: `drill-${idx}` })));
        if (!list.length) alert('No detail rows for the selected month.');
      } catch (e) {
        const msg = e?.response?.data?.error || e.message || 'Detail load failed';
        alert(msg);
        setExpenseDrill(null);
        setDrillRows([]);
      } finally {
        setDrillLoading(false);
      }
    },
    [apiBase, reportType, compCode, compUid, sdt, edt]
  );

  const runReport = async () => {
    if (!reportType) {
      alert('Report type is missing.');
      return;
    }
    if (def?.ledgerDrCrDateEntry) {
      if (!String(mcode ?? '').trim()) {
        alert('Account code is required.');
        return;
      }
      if (!sdt || !edt) {
        alert('Debit starting and ending dates are required.');
        return;
      }
      if (!csdt || !cedt) {
        alert('Credit starting and ending dates are required.');
        return;
      }
    } else if (!sdt || !edt) {
      alert('Starting Date and Ending Date are required.');
      return;
    }
    setLoading(true);
    setErr('');
    setExpenseDrill(null);
    setLabourDrill(null);
    setOutstandingMonthDrill(null);
    setBrokerDrill(null);
    setVoucherDrill(null);
    setDrillRows([]);
    try {
      const { data } = await axios.post(apiUrl(apiBase, reportApiPath), buildPayload(), reqOpts);
      const list = Array.isArray(data?.rows) ? data.rows : [];
      const cols = Array.isArray(data?.columns) ? data.columns : [];
      setRows(list.map((r, idx) => ({ ...r, _id: `${idx}` })));
      setColumns(cols);
      setShowReport(true);
      if (!list.length) alert('No rows returned for the selected criteria.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Report failed';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEntrySubmit = (e) => {
    e?.preventDefault?.();
    if (!loading) void runReport();
  };

  useEffect(() => {
    const ret = formData?.voucherBookReturn;
    if (!isVoucherBooks || reportRestoreRanRef.current === ret?.restoreAt) return;
    if (!ret?.restoreReport || ret.reportType !== reportType) return;
    reportRestoreRanRef.current = ret.restoreAt ?? true;
    const f = ret.filters || {};
    const rs = f.sdt || sdt;
    const re = f.edt || edt;
    const rm = f.mcode ? String(f.mcode).trim().toUpperCase() : String(mcode ?? '').trim().toUpperCase();
    if (f.sdt) setSdt(rs);
    if (f.edt) setEdt(re);
    if (f.mcode) setMcode(rm);
    if (!rs || !re || !compCode || compUid == null) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      setExpenseDrill(null);
      setLabourDrill(null);
      setOutstandingMonthDrill(null);
      setBrokerDrill(null);
      setVoucherDrill(null);
      setDrillRows([]);
      try {
        const { data } = await axios.post(
          apiUrl(apiBase, reportApiPath),
          {
            report_id: reportType,
            comp_code: compCode,
            comp_uid: compUid,
            s_date: toOracleDate(rs),
            e_date: toOracleDate(re),
            mcode: rm,
            comp_year: compYear ? Number(compYear) || compYear : undefined,
            fy_s_date: fyStart ? toOracleDate(fyStart) : undefined,
          },
          reqOpts
        );
        if (cancelled) return;
        const list = Array.isArray(data?.rows) ? data.rows : [];
        const cols = Array.isArray(data?.columns) ? data.columns : [];
        setRows(list.map((r, idx) => ({ ...r, _id: `${idx}` })));
        setColumns(cols);
        setShowReport(true);
      } catch (e) {
        if (!cancelled) {
          const msg = e?.response?.data?.error || e.message || 'Report failed';
          setErr(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isVoucherBooks,
    formData?.voucherBookReturn,
    reportType,
    apiBase,
    reportApiPath,
    compCode,
    compUid,
    compYear,
    fyStart,
    sdt,
    edt,
    mcode,
  ]);

  const excelRows = useMemo(() => {
    const excelCellValue = (r, c) => {
      const raw = r[c.key] ?? r[c.key?.toLowerCase?.()];
      if (c.type === 'date') return formatLedgerDateDisplay(raw) || '';
      if (c.type === 'num') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return raw ?? '';
        const dec = Number.isFinite(c.decimals) ? c.decimals : 2;
        return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      }
      if (c.type === 'partyBlock') return partyBlockExportText(r, c);
      return raw ?? '';
    };

    const buildFlatExcelRow = (r, cols) => {
      const o = {};
      cols.forEach((c) => {
        o[c.label || c.key] = excelCellValue(r, c);
      });
      return o;
    };

    const buildItemCols = (r) => {
      const o = {};
      displayColumns.forEach((c) => {
        o[c.label || c.key] = excelCellValue(r, c);
      });
      return o;
    };

    const excelCols = def?.excelExportColumns;
    const useBrokerExcelCols = Boolean(def?.brokerItemGroups);
    const useChantExcelCols = Boolean(chantGroups);

    if (
      !groupByKeys?.length &&
      !itemGroupWithTotals &&
      !partyGroupWithTotals &&
      !billGroupWithTotals &&
      !itemPartyMonthGroups &&
      !useBrokerExcelCols &&
      !useChantExcelCols
    ) {
      if (excelCols?.length) {
        return reportRows.map((r) => buildFlatExcelRow(r, excelCols));
      }
      return reportRows.map(buildItemCols);
    }

    const usePartyExcelCols = partyGroupWithTotals || itemPartyMonthGroups || useBrokerExcelCols || useChantExcelCols;
    const useFlatPartyExcel = Boolean(usePartyExcelCols && excelCols?.length);
    const emptyGroupCols = () => emptyPartyExcelCols({ broker: useBrokerExcelCols });
    const out = [];
    for (const item of tableRows) {
      if (item._type === 'group') {
        const o = usePartyExcelCols ? { ...emptyGroupCols() } : {};
        displayColumns.forEach((c, idx) => {
          o[c.label || c.key] = idx === 0 ? item.label : '';
        });
        out.push(o);
      } else if (item._type === 'partyGroup') {
        if (drillSuppressPartyHeader) continue;
        out.push({
          ...partyRowToExcelCols(item.partyRow || item, {
            minimal: partyGroupHeaderMinimal,
            broker: useBrokerExcelCols,
          }),
          ...Object.fromEntries((useFlatPartyExcel ? excelCols : displayColumns).map((c) => [c.label || c.key, ''])),
        });
      } else if (useFlatPartyExcel) {
        const row = { ...emptyGroupCols() };
        excelCols.forEach((c) => {
          row[c.label || c.key] = excelCellValue(item, c);
        });
        out.push(row);
      } else {
        out.push(
          usePartyExcelCols ? { ...emptyGroupCols(), ...buildItemCols(item) } : buildItemCols(item)
        );
      }
    }
    return out;
  }, [reportRows, displayColumns, groupByKeys, itemGroupWithTotals, partyGroupWithTotals, billGroupWithTotals, itemPartyMonthGroups, brokerItemGroups, chantGroups, tableRows, def?.excelExportColumns, def?.brokerItemGroups, partyGroupHeaderMinimal, drillSuppressPartyHeader]);

  const handleExcel = () => {
    if (!reportRows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    downloadExcelRows(excelRows, title.replace(/\s+/g, ''), `${compName || 'Company'}_${reportType}`);
  };

  const handlePdf = () => {
    if (!reportRows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const pdfType = pdfReportType;
    generatePDF(pdfType, reportRows, pdfMeta).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!reportRows.length) {
      alert('Run Proceed first to load data.');
      return;
    }
    const pdfType = pdfReportType;
    const shareText = [`${title} — ${compName}`, `${compYear} | ${pdfMeta.period}`, `Rows: ${reportRows.length}`].join('\n');
    sharePdfWithWhatsApp(pdfType, reportRows, pdfMeta, shareText).catch((e) => alert(String(e?.message || e)));
  };

  const renderFilter = (key) => {
    const { label, hint, pickList, required, manualCode } = resolveFilterMeta(reportType, key);
    const fullWidth = isFullWidthFilter(key);
    const inputClass = 'itax-field__input';
    switch (key) {
      case 'sdt':
        return (
          <ItaxField key={key} label={`${label} *`} fullWidth={fullWidth}>
            <input
              type="date"
              className={inputClass}
              value={sdt}
              disabled={loading}
              autoFocus={reportType === 'brokerage-date-wise' || reportType === 'brokerage-item-wise' || reportType === 'brokerage-item-cat-wise' || reportType === 'broker-summary' || reportType === 'trading-exp' || reportType === 'broker-ledger' || reportType === 'chant-format-1' || reportType === 'chant-format-2' || reportType === 'chant-format-3' || reportType === 'chant-summary'}
              onChange={(e) => setSdt(e.target.value)}
            />
          </ItaxField>
        );
      case 'edt':
        return (
          <ItaxField key={key} label={`${label} *`} fullWidth={fullWidth}>
            <input type="date" className={inputClass} value={edt} disabled={loading} onChange={(e) => setEdt(e.target.value)} />
          </ItaxField>
        );
      case 'topN':
        return (
          <ItaxField key={key} label={label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              inputMode="numeric"
              className={inputClass}
              value={topN}
              disabled={loading}
              onChange={(e) => setTopN(String(e.target.value || '').replace(/[^\d]/g, ''))}
              placeholder="10"
            />
          </ItaxField>
        );
      case 'csdt':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input type="date" className={inputClass} value={csdt} disabled={loading} onChange={(e) => setCsdt(e.target.value)} />
          </ItaxField>
        );
      case 'cedt':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input type="date" className={inputClass} value={cedt} disabled={loading} onChange={(e) => setCedt(e.target.value)} />
          </ItaxField>
        );
      case 'msp':
      case 'mds':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <select
              className={inputClass}
              value={key === 'msp' ? msp : mds}
              disabled={loading}
              onChange={(e) => (key === 'msp' ? setMsp(e.target.value) : setMds(e.target.value))}
            >
              {(pickList || []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </ItaxField>
        );
      case 'mcn':
      case 'rpttype':
      case 'mlc':
        if (pickList?.length) {
          const val = key === 'mcn' ? mcn : key === 'rpttype' ? rpttype : mlc;
          const onVal = (v) => {
            const u = String(v ?? '').toUpperCase();
            if (key === 'mcn') setMcn(u);
            else if (key === 'rpttype') setRpttype(u);
            else setMlc(u);
          };
          return (
            <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
              <select className={inputClass} value={val} disabled={loading} onChange={(e) => onVal(e.target.value)}>
                {pickList.map((o) => (
                  <option key={o.value || '__all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </ItaxField>
          );
        }
        break;
      case 'mdc':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <select className={inputClass} value={mdc} disabled={loading} onChange={(e) => setMdc(e.target.value)}>
              <option value="">All</option>
              <option value="D">Debit (D)</option>
              <option value="C">Credit (C)</option>
            </select>
          </ItaxField>
        );
      case 'mru':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <select className={inputClass} value={mru} disabled={loading} onChange={(e) => setMru(e.target.value)}>
              <option value="">All</option>
              <option value="R">With GST (R)</option>
              <option value="U">Without GST (U)</option>
            </select>
          </ItaxField>
        );
      case 'panYn':
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <select className={inputClass} value={panYn} disabled={loading} onChange={(e) => setPanYn(e.target.value)}>
              <option value="">All</option>
              <option value="Y">With PAN (Y)</option>
              <option value="N">Without PAN (N)</option>
            </select>
          </ItaxField>
        );
      case 'mcode':
        if (manualCode && pickList === 'masterBroker') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <BrokerManualCodeField
                value={mcode}
                onChange={handleBrokerCodeInputChange(setMcode)}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-mcode"
                title={label}
                placeholder="Broker code"
                pickListProps={brokerPickListProps(mcode)}
              />
            </ItaxField>
          );
        }
        if (pickList === 'masterBroker') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                value={mcode}
                onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder="Broker code"
                showSearchIcon
                {...brokerPickListProps(mcode)}
              />
            </ItaxField>
          );
        }
        if (manualCode && pickList === 'masterAccount') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <ItaxManualCodeField
                value={mcode}
                onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-mcode"
              >
                <MasterPartyPickList
                  options={masterAccountOptions}
                  value={mcode}
                  onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                  disabled={loading}
                  title={label}
                  placeholder="Account code"
                  showSearchIcon
                  searchBtnTabIndex={-1}
                  onFilterChange={handleMasterAccountFilterChange}
                  onOpen={handleMasterAccountPickerOpen}
                  {...accountHelpPickProps(mcode)}
                />
              </ItaxManualCodeField>
            </ItaxField>
          );
        }
        if (manualCode && pickList === 'masterCustomer') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <ItaxManualCodeField
                value={mcode}
                onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-mcode"
              >
                <MasterPartyPickList
                  options={masterAccountOptions}
                  value={mcode}
                  onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                  disabled={loading}
                  title={label}
                  placeholder="Party code"
                  showSearchIcon
                  searchBtnTabIndex={-1}
                  onFilterChange={(q) => filterMasterPick('C', 'name_city', q)}
                  onOpen={() => openMasterPick('C', 'name_city')}
                  {...accountHelpPickProps(mcode)}
                />
              </ItaxManualCodeField>
            </ItaxField>
          );
        }
        if (pickList === 'cashAccount' || pickList === 'masterCustomer') {
          const customerPick = pickList === 'masterCustomer';
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={masterAccountOptions}
                value={mcode}
                onChange={(v) => setMcode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder={customerPick ? 'Party code' : 'Cash code'}
                showSearchIcon
                onFilterChange={(q) =>
                  customerPick
                    ? filterMasterPick('C', 'name_city', q)
                    : handleMasterAccountFilterChange(q)
                }
                onOpen={() =>
                  customerPick ? openMasterPick('C', 'name_city') : handleMasterAccountPickerOpen()
                }
                {...accountHelpPickProps(mcode)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={mcode}
              disabled={loading}
              onChange={(e) => setMcode(e.target.value.toUpperCase())}
            />
          </ItaxField>
        );
      case 'spNo':
        if (pickList === 'scheduleMaster') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={scheduleOptions}
                value={spNo}
                onChange={(v) => setSpNo(String(v ?? '').trim())}
                disabled={loading}
                title={label}
                placeholder="Schedule no."
                showSearchIcon
                onFilterChange={handleScheduleFilterChange}
                onOpen={handleSchedulePickerOpen}
                {...scheduleHelpPickProps(spNo)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={spNo}
              disabled={loading}
              placeholder="0 = all schedules"
              inputMode="decimal"
              onChange={(e) => setSpNo(e.target.value)}
            />
          </ItaxField>
        );
      case 'scheduleNo':
        if (pickList === 'scheduleMaster') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={scheduleOptions}
                value={scheduleNo}
                onChange={(v) => setScheduleNo(String(v ?? '').trim())}
                disabled={loading}
                title={label}
                placeholder="Schedule no."
                showSearchIcon
                onFilterChange={handleScheduleFilterChange}
                onOpen={handleSchedulePickerOpen}
                {...scheduleHelpPickProps(scheduleNo)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={scheduleNo}
              disabled={loading}
              placeholder="0 = all schedules"
              inputMode="decimal"
              onChange={(e) => setScheduleNo(e.target.value)}
            />
          </ItaxField>
        );
      case 'scode':
        if (manualCode && pickList === 'masterSupplier') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <SupplierManualCodeField
                value={scode}
                onChange={handleSupplierCodeInputChange(setScode)}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-scode"
                title={label}
                placeholder="Supplier code"
                pickListProps={supplierPickListProps(scode)}
              />
            </ItaxField>
          );
        }
        if (pickList === 'masterAccount' || pickList === 'masterSupplier') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                value={scode}
                onChange={(v) => setScode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder="Supplier code"
                showSearchIcon
                {...(pickList === 'masterSupplier' ? supplierPickListProps(scode) : {
                  options: masterAccountOptions,
                  onFilterChange: handleMasterAccountFilterChange,
                  onOpen: handleMasterAccountPickerOpen,
                  ...accountHelpPickProps(scode),
                })}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={scode}
              disabled={loading}
              onChange={(e) => setScode(e.target.value.toUpperCase())}
            />
          </ItaxField>
        );
      case 'sbCode':
      case 'ebCode': {
        if (manualCode && pickList === 'masterBroker') {
          const val = key === 'sbCode' ? sbCode : ebCode;
          const setVal = key === 'sbCode' ? setSbCode : setEbCode;
          return (
            <ItaxField key={key} label={label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <BrokerManualCodeField
                value={val}
                onChange={handleBrokerCodeInputChange(setVal)}
                disabled={loading}
                inputClass={inputClass}
                dataField={`itax-${key}`}
                title={label}
                placeholder="Broker code"
                pickListProps={brokerPickListProps(val)}
              />
            </ItaxField>
          );
        }
        if (pickList === 'masterBroker') {
          const val = key === 'sbCode' ? sbCode : ebCode;
          const setVal = key === 'sbCode' ? setSbCode : setEbCode;
          return (
            <ItaxField key={key} label={label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={masterAccountOptions}
                value={val}
                onChange={(v) => setVal(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder="Broker code"
                showSearchIcon
                {...brokerPickListProps(val)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={key === 'sbCode' ? sbCode : ebCode}
              disabled={loading}
              onChange={(e) => (key === 'sbCode' ? setSbCode : setEbCode)(e.target.value.toUpperCase())}
            />
          </ItaxField>
        );
      }
      case 'bkCode':
        if (pickList === 'masterBroker') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                value={bkCode}
                onChange={(v) => setBkCode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder="Broker code"
                showSearchIcon
                {...brokerPickListProps(bkCode)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={bkCode}
              disabled={loading}
              onChange={(e) => setBkCode(e.target.value.toUpperCase())}
            />
          </ItaxField>
        );
      case 'icode':
        if (manualCode && pickList === 'itemMaster') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <ItaxManualCodeField
                value={icode}
                onChange={(v) => setIcode(String(v ?? '').trim())}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-icode"
              >
                <MasterPartyPickList
                  options={itemMasterOptions}
                  value={icode}
                  onChange={(v) => setIcode(String(v ?? '').trim())}
                  disabled={loading}
                  title={label}
                  placeholder="Item code"
                  showSearchIcon
                  searchBtnTabIndex={-1}
                  onFilterChange={handleItemMasterFilterChange}
                  onOpen={handleItemMasterPickerOpen}
                  {...itemHelpPickProps(icode)}
                />
              </ItaxManualCodeField>
            </ItaxField>
          );
        }
        if (pickList === 'itemMaster') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={itemMasterOptions}
                value={icode}
                onChange={(v) => setIcode(String(v ?? '').trim())}
                disabled={loading}
                title={label}
                placeholder="Item code"
                showSearchIcon
                onFilterChange={handleItemMasterFilterChange}
                onOpen={handleItemMasterPickerOpen}
                {...itemHelpPickProps(icode)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={icode}
              disabled={loading}
              onChange={(e) => setIcode(e.target.value)}
            />
          </ItaxField>
        );
      case 'godCode':
        if (pickList === 'godown') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                options={godownOptions}
                value={godCode}
                onChange={(v) => setGodCode(String(v ?? '').trim())}
                disabled={loading}
                title={label}
                placeholder="Godown code"
                showSearchIcon
                onFilterChange={handleGodownFilterChange}
                onOpen={handleGodownPickerOpen}
                {...godownHelpPickProps(godCode)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={required ? `${label} *` : label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={godCode}
              disabled={loading}
              onChange={(e) => setGodCode(e.target.value)}
            />
          </ItaxField>
        );
      case 'mSupCode':
        if (manualCode && pickList === 'masterSupplier') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <SupplierManualCodeField
                value={mSupCode}
                onChange={handleSupplierCodeInputChange(setMSupCode)}
                disabled={loading}
                inputClass={inputClass}
                dataField="itax-msupcode"
                title={label}
                placeholder="Main supplier code"
                pickListProps={supplierPickListProps(mSupCode)}
              />
            </ItaxField>
          );
        }
        if (pickList === 'masterSupplier') {
          return (
            <ItaxField key={key} label={required ? `${label} *` : label} hint={showEntryFilterHints ? hint : undefined} fullWidth={fullWidth}>
              <MasterPartyPickList
                value={mSupCode}
                onChange={(v) => setMSupCode(String(v ?? '').trim().toUpperCase())}
                disabled={loading}
                title={label}
                placeholder="Main supplier code"
                showSearchIcon
                {...supplierPickListProps(mSupCode)}
              />
            </ItaxField>
          );
        }
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={mSupCode}
              disabled={loading}
              onChange={(e) => setMSupCode(e.target.value.toUpperCase())}
            />
          </ItaxField>
        );
      default:
        return (
          <ItaxField key={key} label={label} hint={hint} fullWidth={fullWidth}>
            <input
              type="text"
              className={inputClass}
              value={filterValues[key] ?? ''}
              disabled={loading}
              onChange={(e) => {
                const v = e.target.value;
                if (key === 'minAmt') setMinAmt(v);
                else if (key === 'topN') setTopN(v.replace(/[^\d]/g, ''));
                else if (key === 'stateCode') setStateCode(v);
                else if (key === 'scode') setScode(v);
                else if (key === 'icode') setIcode(v);
                else if (key === 'bkCode') setBkCode(v);
                else if (key === 'bkName') setBkName(v);
                else if (key === 'godCode') setGodCode(v);
                else if (key === 'mcode') setMcode(v);
                else if (key === 'bNo') setBNo(v);
                else if (key === 'panYn') setPanYn(v);
                else if (key === 'spNo') setSpNo(v);
                else if (key === 'sbCode') setSbCode(v.toUpperCase());
                else if (key === 'ebCode') setEbCode(v.toUpperCase());
                else if (key === 'icat') setIcat(v);
                else if (key === 'mlc') setMlc(v.toUpperCase());
                else if (key === 'btype') setBtype(v.toUpperCase());
                else if (key === 'mSupCode') setMSupCode(v.toUpperCase());
                else if (key === 'mcn') setMcn(v.toUpperCase());
                else if (key === 'rpttype') setRpttype(v.toUpperCase());
              }}
            />
          </ItaxField>
        );
    }
  };

  if (showReport) {
    return (
      <>
      <div
        className={`slide slide-89-itax slide-report itax-screen itax-screen--report${compactTable ? ' itax-screen--compact-table' : ''}${reportType === 'insurance-report' ? ' itax-screen--insurance' : ''}${labourReportLayout ? ' itax-screen--labour-report' : ''}${inLabourDrill ? ' itax-screen--labour-drill' : ''}${monthPivot ? ' itax-screen--month-pivot' : ''}${monthOutstandingLayout ? ' itax-screen--month-outstanding' : ''}${monthExpenseDrill ? ' itax-screen--expense-month' : ''}${inExpenseDrill ? ' itax-screen--expense-drill' : ''}${itemGroupWithTotals || itemPartyMonthGroups ? ' itax-screen--item-groups' : ''}${itemPartyTable || flatPartyTable ? ' itax-screen--item-party' : ''}${partyGroupWithTotals || itemPartyMonthGroups ? ' itax-screen--party-groups' : ''}${reportType === 'brokerage-date-wise' ? ' itax-screen--broker-date' : ''}${brokerItemGroups ? ' itax-screen--broker-item' : ''}${inBrokerItemSummaryView ? ' itax-screen--broker-item-summary' : ''}${reportType === 'broker-summary' || inBrokerSummaryView ? ' itax-screen--broker-summary' : ''}${inBrokerDrill && def?.drillDisplayColumns?.length ? ' itax-screen--broker-drill' : ''}${inVoucherDrill ? ' itax-screen--voucher-drill' : ''}${billGroupWithTotals ? ' itax-screen--bill-groups' : ''}${useMobilePartyCards ? ' itax-screen--party-cards' : ''}${useMobileLabourCards ? ' itax-screen--labour-cards' : ''}${useMobileMonthCards ? ' itax-screen--month-cards' : ''}${useMobileMonthSummaryCards ? ' itax-screen--month-summary-cards' : ''}${useMobilePartyBillCards ? ' itax-screen--party-bill-cards' : ''}${useMobileItemPartyMonthCards ? ' itax-screen--item-party-month-cards' : ''}${useMobileExpenseMonthPivot ? ' itax-screen--expense-month-cards' : ''}${useMobileExpenseDrill ? ' itax-screen--expense-drill-cards' : ''}${useMobileToolbar ? ' itax-screen--mobile-toolbar' : ''}${mobileTableScroll ? ' itax-screen--mobile-scroll' : ''}`}
      >
        <div className="itax-screen__scroll">
          <div className="report-toolbar">
            <h2>{title}</h2>
            <ReportToolbarActions
              reportId={reportType || helpModuleId}
              compactMobile={isMobileUi}
              onBack={() => {
                if (inLabourDrill) {
                  setLabourDrill(null);
                  setDrillRows([]);
                  return;
                }
                if (inOutstandingMonthDrill) {
                  setOutstandingMonthDrill(null);
                  setDrillRows([]);
                  return;
                }
                if (inBrokerDrill) {
                  setBrokerDrill(null);
                  setDrillRows([]);
                  return;
                }
                if (inVoucherDrill) {
                  setVoucherDrill(null);
                  setDrillRows([]);
                  return;
                }
                if (inBrokerLedgerDrill) {
                  setBrokerLedgerDrill(null);
                  setDrillRows([]);
                  return;
                }
                if (inExpenseDrill) {
                  setExpenseDrill(null);
                  setDrillRows([]);
                  return;
                }
                setShowReport(false);
              }}
              onPdf={handlePdf}
              onExcel={handleExcel}
              onWhatsApp={handleWhatsApp}
              onMenu={onPrev}
            />
          </div>

          <p className="itax-screen__meta">
            {inBrokerDrill && brokerDrill?.label ? (
              <>
                <strong>Detail for {brokerDrill.label}</strong>
                {' · '}
              </>
            ) : null}
            {inVoucherDrill && voucherDrill?.label ? (
              <>
                <strong>Voucher {voucherDrill.label}</strong>
                {' · '}
              </>
            ) : null}
            {inBrokerLedgerDrill && brokerLedgerDrill?.label ? (
              <>
                <strong>Broker ledger — {brokerLedgerDrill.label}</strong>
                {' · '}
              </>
            ) : null}
            {inLabourDrill && labourDrill?.dateLabel ? (
              <>
                <strong>Entries for {labourDrill.dateLabel}</strong>
                {' · '}
              </>
            ) : null}
            {inOutstandingMonthDrill && outstandingMonthDrill?.monthLabel ? (
              <>
                <strong>Entries for {outstandingMonthDrill.monthLabel}</strong>
                {' · '}
              </>
            ) : null}
            {inExpenseDrill && expenseDrill?.label ? (
              <>
                <strong>{expenseDrill.label}</strong>
                {' · '}
              </>
            ) : null}
            {toDisplayDate(sdt)} – {toDisplayDate(edt)}
            {filterSelectionSummary ? <> · {filterSelectionSummary}</> : null}
            {' · '}
            {drillLoading
              ? 'Loading detail…'
              : reportMetaCounts.totalBills != null
                ? `${reportMetaCounts.dataRows} party(s) · ${reportMetaCounts.totalBills} bill(s)`
                : `${reportRows.length} row(s)`}
            {saleBillDrillEnabled ? <> · Tap a row to open sale bill</> : null}
            {voucherEntryRowDrillEnabled ? <> · Tap a voucher line to open voucher entry</> : null}
            {voucherLedgerRowDrillEnabled ? <> · Tap a voucher line to view ledger entries</> : null}
            {brokerLedgerRowDrillEnabled ? <> · Tap a broker row to view broker ledger</> : null}
            {chantGroups === 'lotRate' ? <> · Grouped by supplier, item, lot and rate</> : null}
            {chantGroups === 'item' ? <> · Grouped by supplier and item</> : null}
            {chantGroups === 'supplier' ? <> · Grouped by supplier</> : null}
            {chantGroups === 'summary' ? <> · Grouped by date, supplier and item (CHANT BAHI)</> : null}
            {brokerSummaryRowDrillEnabled ? <> · Tap a broker to view detail</> : null}
            {brokerItemSummaryRowDrillEnabled ? (
              <>
                {' '}
                · Tap {def?.brokerItemSummaryDrillMode === 'itemCat' ? 'a category row' : 'an item row'} to view bill detail
              </>
            ) : null}
            {labourDateDrill && !inLabourDrill ? <> · Tap a date to view lot entries</> : null}
            {monthOutstandingRowDrillEnabled ? <> · Tap a month to view all entries</> : null}
            {monthExpenseDrill && !inExpenseDrill ? <> · Tap a month amount to view code-wise detail</> : null}
            {ledgerDrillEnabled && onOpenLedger && inExpenseDrill ? (
              <> · Tap code to open ledger</>
            ) : null}
            {ledgerDrillEnabled && onOpenLedger && !inExpenseDrill ? (
              dualLedgerDrill ? (
                <> · Tap party code for party ledger · tap DC code (or card) for DC ledger</>
              ) : (
                <> · Tap a card to open party ledger</>
              )
            ) : null}
            {mobileTableScroll ? <> · Swipe sideways for all columns</> : null}
            {labourReportLayout && !isMobileUi ? <> · Scroll sideways for all columns</> : null}
            {useMobileLabourCards ? <> · One card per date with Local / Central / Sales sections</> : null}
            {monthPivot && !isMobileUi && !inExpenseDrill ? <> · Scroll sideways if needed</> : null}
            {useMobileMonthCards ? <> · Month amounts shown for non-zero months</> : null}
            {!isMobileUi && !compactTable && displayColumns.length > 6 ? <> · Scroll horizontally for more columns</> : null}
          </p>

          <div className={`itax-screen__table-wrap${drillLoading ? ' itax-screen__table-wrap--loading' : ''}`} role="region" aria-label="Report table" tabIndex={0}>
            {useMobileExpenseMonthPivot ? (
              <ItaxMobileExpenseMonthPivotList
                rows={reportRows}
                displayColumns={displayColumns}
                onMonthClick={fetchExpenseMonthDetail}
              />
            ) : useMobileExpenseDrill ? (
              <ItaxMobilePartyBillList
                items={tableRows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onRowClick={handleRowClick}
                onLedgerDrill={openLedgerForCode}
                headKeys={['CODE', 'NAME']}
                suppressPartyHeader={drillSuppressPartyHeader}
                partyGroupHeaderMinimal={Boolean(def?.drillPartyHeaderMinimal ?? true)}
                ledgerDrillKeys={ledgerDrillKeys}
              />
            ) : useMobileTopSalesCards ? (
              <ItaxMobileTopSalesList
                rows={reportRows}
                title={title}
                topN={topN}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onOpenLedger={onOpenLedger}
                onRowClick={handleRowClick}
              />
            ) : useMobilePartyCards ? (
              <ItaxMobilePartyList
                rows={reportRows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onOpenLedger={onOpenLedger}
                onRowClick={handleRowClick}
              />
            ) : useMobileMonthCards ? (
              <ItaxMobileMonthPivotList
                items={tableRows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onRowClick={handleRowClick}
              />
            ) : useMobileMonthSummaryCards ? (
              <ItaxMobileMonthSummaryList
                items={itemGroupWithTotals || billGroupWithTotals ? tableRows : undefined}
                rows={itemGroupWithTotals || billGroupWithTotals ? undefined : reportRows}
                displayColumns={displayColumns}
                headKeys={def?.mobileCardHeadKeys}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onRowClick={handleRowClick}
              />
            ) : useMobilePartyBillCards ? (
              <ItaxMobilePartyBillList
                items={tableRows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onRowClick={handleRowClick}
                onLedgerDrill={openLedgerForCode}
                headKeys={def?.mobileCardHeadKeys}
                partyGroupHeaderMinimal={partyGroupHeaderMinimal}
                ledgerDrillKeys={ledgerDrillKeys}
              />
            ) : useMobileItemPartyMonthCards ? (
              <ItaxMobileItemPartyMonthList
                items={tableRows}
                displayColumns={displayColumns}
                ledgerDrillEnabled={ledgerDrillEnabled}
                onRowClick={handleRowClick}
                headKeys={
                  inBrokerItemSummaryView
                    ? def?.itemSummaryMobileCardHeadKeys ?? ['ITEM_CODE', 'ITEM_NAME']
                    : def?.mobileCardHeadKeys
                }
                partyGroupHeaderMinimal={partyGroupHeaderMinimal}
              />
            ) : useMobileVoucherDrillCards ? (
              <ItaxMobileMonthSummaryList
                rows={reportRows}
                displayColumns={displayColumns}
                headKeys={def?.voucherDrillMobileCardHeadKeys ?? def?.mobileCardHeadKeys}
              />
            ) : useMobileBrokerLedgerDrillCards ? (
              <ItaxMobileMonthSummaryList
                rows={reportRows}
                displayColumns={displayColumns}
                headKeys={def?.mobileCardHeadKeys}
              />
            ) : useMobileBrokerDrillCards ? (
              <ItaxMobileMonthSummaryList
                rows={reportRows}
                displayColumns={displayColumns}
                headKeys={def?.mobileCardHeadKeys}
                onRowClick={saleBillDrillEnabled ? handleRowClick : undefined}
              />
            ) : inBrokerSummaryView ? (
              <BrokerSummaryView
                rows={tableRows}
                displayColumns={displayColumns}
                isMobile={isMobileUi}
                onRowClick={brokerSummaryRowDrillEnabled ? fetchBrokerDetail : undefined}
              />
            ) : inLabourDrill ? (
              <LabourDrillView rows={tableRows} displayColumns={displayColumns} isMobile={isMobileUi} />
            ) : labourReportLayout ? (
              <LabourReportView
                rows={reportRows}
                isMobile={isMobileUi}
                onDateClick={labourDateDrill ? fetchLabourDateDetail : undefined}
                selectedDateKey={labourDrill?.rowKey ?? null}
              />
            ) : (
            <table className="table-report itax-table">
              {compactTable ? (
                <colgroup>
                  {displayColumns.map((c) => (
                    <col key={c.key} className={compactTableColClass(c)} />
                  ))}
                </colgroup>
              ) : null}
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
                {tableRows.map((item) => {
                  if (item._type === 'partyGroup') {
                    if (drillSuppressPartyHeader) return null;
                    const partyCode = rowFieldCode(item.partyRow, ledgerDrillKeys?.party ?? 'CODE');
                    const partyClickable =
                      dualLedgerDrill && ledgerDrillEnabled && onOpenLedger && Boolean(partyCode);
                    return (
                      <tr
                        key={item._id}
                        className={`itax-party-group${partyClickable ? ' itax-party-group--ledger' : ''}`}
                      >
                        <td colSpan={displayColumns.length}>
                          {renderPartyGroupHeader(item.partyRow, {
                            minimal: inExpenseDrill
                              ? Boolean(def?.drillPartyHeaderMinimal ?? true)
                              : partyGroupHeaderMinimal,
                            ledgerDrillCode: partyClickable ? partyCode : null,
                            onLedgerDrill: partyClickable ? openLedgerForCode : null,
                          })}
                        </td>
                      </tr>
                    );
                  }
                  if (item._type === 'group') {
                    return (
                      <tr key={item._id} className="itax-schedule-group">
                        <td colSpan={displayColumns.length}>{item.label}</td>
                      </tr>
                    );
                  }

                  const r = item;
                  const isGrand = isIncomeTaxGrandTotalRow(r);
                  const isBookOpen = Boolean(def?.bookDayWiseFormat) && isVoucherBookCashOpenRow(r);
                  const isBookDayTotal = Boolean(def?.bookDayWiseFormat) && isVoucherBookDayTotalRow(r);
                  const isBookDayClose = Boolean(def?.bookDayWiseFormat) && isVoucherBookDayCloseRow(r);
                  const isLotRateTotal = item._type === 'subtotal' && isIncomeTaxLotRateTotalRow(r);
                  const isItemTotal = item._type === 'subtotal' && isIncomeTaxItemTotalRow(r);
                  const isPartyTotal = item._type === 'subtotal' && isIncomeTaxPartyTotalRow(r);
                  const isBillTotal = item._type === 'subtotal' && isIncomeTaxBillTotalRow(r);
                  const isBrokerTotal = item._type === 'subtotal' && isIncomeTaxBrokerTotalRow(r);
                  const code = rowLedgerCode(r, displayColumns) || String(r.SUP_CODE ?? r.sup_code ?? '').trim();
                  const dcCode = dualLedgerDrill ? rowFieldCode(r, ledgerDrillKeys.detail) : '';
                  const rowClickable =
                    !dualLedgerDrill &&
                    !isGrand &&
                    !isBookOpen &&
                    !isBookDayTotal &&
                    !isBookDayClose &&
                    !isLotRateTotal &&
                    !isItemTotal &&
                    !isPartyTotal &&
                    !isBillTotal &&
                    !isBrokerTotal &&
                    (voucherEntryRowDrillEnabled ||
                      brokerSummaryRowDrillEnabled ||
                      brokerItemSummaryRowDrillEnabled ||
                      brokerLedgerRowDrillEnabled ||
                      monthOutstandingRowDrillEnabled ||
                      voucherLedgerRowDrillEnabled ||
                      saleBillDrillEnabled ||
                      (ledgerDrillEnabled && onOpenLedger && Boolean(code)));
                  return (
                    <tr
                      key={r._id}
                      className={[
                        isGrand ? 'itax-grand-total' : '',
                        isBookDayClose ? 'itax-book-day-close' : '',
                        isBookDayTotal ? 'itax-book-day-total' : '',
                        isBookOpen ? 'itax-book-day-open' : '',
                        isLotRateTotal || isItemTotal ? 'itax-item-total' : '',
                        isPartyTotal || isBillTotal ? 'itax-party-total' : '',
                        isBrokerTotal ? 'itax-broker-total' : '',
                        rowClickable
                          ? voucherEntryRowDrillEnabled
                            ? 'itax-row--voucher-entry'
                            : brokerSummaryRowDrillEnabled || brokerItemSummaryRowDrillEnabled
                            ? 'itax-row--broker-drill'
                            : brokerLedgerRowDrillEnabled
                              ? 'itax-row--broker-ledger'
                            : monthOutstandingRowDrillEnabled
                              ? 'itax-row--month-drill'
                            : voucherLedgerRowDrillEnabled
                              ? 'itax-row--voucher-drill'
                            : saleBillDrillEnabled
                              ? 'itax-row--sale-bill'
                              : 'itax-row--ledger'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={rowClickable ? () => handleRowClick(r) : undefined}
                      onKeyDown={
                        rowClickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRowClick(r);
                              }
                            }
                          : undefined
                      }
                      role={rowClickable ? 'button' : undefined}
                      tabIndex={rowClickable ? 0 : undefined}
                      title={
                        rowClickable
                          ? voucherEntryRowDrillEnabled
                            ? `Open ${String(r.VR_TYPE ?? r.vr_type ?? '').trim()} voucher ${String(r.VR_NO ?? r.vr_no ?? '').trim()}`
                            : brokerItemSummaryRowDrillEnabled
                            ? def?.brokerItemSummaryDrillMode === 'itemCat'
                              ? `View bill detail for category ${String(r.ITEM_CAT ?? r.item_cat ?? '').trim()}`
                              : `View bill detail for ${String(r.ITEM_CODE ?? r.item_code ?? '').trim()} ${String(r.ITEM_NAME ?? r.item_name ?? '').trim()}`.trim()
                            : brokerSummaryRowDrillEnabled
                              ? `View detail for ${String(r.BK_CODE ?? r.bk_code ?? '').trim()}`
                              : monthOutstandingRowDrillEnabled
                                ? `View entries for ${String(r.CMTH ?? r.cmth ?? '').trim()}`
                              : voucherLedgerRowDrillEnabled
                                ? `View ledger entries for ${String(r.VR_TYPE ?? r.vr_type ?? '').trim()} ${String(r.VR_NO ?? r.vr_no ?? '').trim()}`
                                : saleBillDrillEnabled
                                  ? 'Open sale bill'
                                  : `Open ledger for ${code}`
                          : undefined
                      }
                    >
                      {displayColumns.map((c) => {
                        const clipKeys = ['NAME', 'CITY', 'PAN', 'ITEM_NAME', 'ITEM_CODE', 'SUP_CODE', 'REMARKS', 'CUST_NAME', 'MSUP_NAME'];
                        const billClipKeys = ['NAME', 'ITEM_NAME', 'ITEM_CODE', 'SUP_CODE', 'REMARKS', 'CUST_NAME', 'MSUP_NAME', 'LOT', 'STATUS'];
                        const textVal = clipKeys.includes(c.key)
                          ? String(r[c.key] ?? r[c.key?.toLowerCase?.()] ?? '').trim()
                          : '';
                        const clipCell =
                          compactTable &&
                          ((monthPivot && c.key === 'NAME') ||
                            (partyGroupWithTotals && c.key === 'ITEM_NAME') ||
                            (billGroupWithTotals && billClipKeys.includes(c.key)) ||
                            (itemPartyTable && clipKeys.includes(c.key)) ||
                            (flatPartyTable && clipKeys.includes(c.key)) ||
                            (inBrokerDrill && def?.drillDisplayColumns?.length && clipKeys.includes(c.key)));
                        const isDcDrillCell =
                          dualLedgerDrill &&
                          c.key === ledgerDrillKeys.detail &&
                          !isGrand &&
                          !isItemTotal &&
                          !isPartyTotal &&
                          !isBillTotal &&
                          ledgerDrillEnabled &&
                          onOpenLedger &&
                          Boolean(dcCode);
                        const monthExpenseDrillable =
                          monthExpenseDrill &&
                          !inExpenseDrill &&
                          FISCAL_MONTH_KEYS.has(c.key) &&
                          !isGrand &&
                          item._type !== 'subtotal' &&
                          resolveExpenseExpType(r.HEAD_NAME ?? r.head_name) &&
                          cellAmount(r, c.key) !== 0;
                        const cellTitle = monthExpenseDrillable
                          ? `View ${r.HEAD_NAME ?? r.head_name} detail for ${fiscalMonthColLabel(c.key)}`
                          : isDcDrillCell
                          ? `Open ledger for ${dcCode}`
                          : rowClickable && c.key === 'CODE'
                            ? `Open ledger for ${code}`
                            : clipCell && textVal
                              ? textVal
                              : undefined;
                        return (
                        <td
                          key={c.key}
                          title={cellTitle}
                          className={[
                            c.type === 'num' ? 'num' : '',
                            c.type === 'partyBlock' ? 'itax-cell--party' : '',
                            clipCell ? 'itax-cell--text-clip' : '',
                            isDcDrillCell ? 'itax-cell--ledger' : '',
                            monthExpenseDrillable ? 'itax-cell--month-drill' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={
                            monthExpenseDrillable
                              ? (e) => {
                                  e.stopPropagation();
                                  void fetchExpenseMonthDetail(r, c.key);
                                }
                              : isDcDrillCell
                              ? (e) => {
                                  e.stopPropagation();
                                  openLedgerForCode(dcCode);
                                }
                              : undefined
                          }
                          onKeyDown={
                            monthExpenseDrillable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void fetchExpenseMonthDetail(r, c.key);
                                  }
                                }
                              : isDcDrillCell
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openLedgerForCode(dcCode);
                                  }
                                }
                              : undefined
                          }
                          role={monthExpenseDrillable || isDcDrillCell ? 'button' : undefined}
                          tabIndex={monthExpenseDrillable || isDcDrillCell ? 0 : undefined}
                        >
                          {renderReportCell(r, c)}
                        </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!tableRows.length ? (
                  <tr>
                    <td colSpan={displayColumns.length || 1}>No rows</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>
      <SaleBillPrintModal
        open={billPrintOpen}
        onClose={() => {
          setBillPrintOpen(false);
          setBillPrintParams(null);
        }}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={billPrintParams}
        companyName={compName}
      />
      </>
    );
  }

  return (
    <div className={`slide slide-89-itax itax-screen itax-screen--entry fas-tb-host fas-tb-host--form${compactEntry ? ' itax-screen--compact-entry' : ''}`}>
      <div className="fas-flow fas-tb-flow fas-tb-flow--form-app">
        <div className="fas-ledger-sticky-top">
          <FasReportHeader
            title={title}
            onBack={onPrev}
          />
        </div>
        <div className="fas-flow-body fas-tb-body">
          <form
            ref={entryFormRef}
            className="fas-tb-form-shell itax-entry-form-shell"
            onSubmit={handleEntrySubmit}
            onKeyDownCapture={handleEntryFormKeyDown}
            noValidate
          >
            <TrialBalanceSessionCard
              formData={formData}
              helpReportId={reportType || helpModuleId}
              compact
            />

            {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

            {def?.ledgerDrCrDateEntry ? (
              <div className="itax-entry-filters itax-entry-filters--ledger-dr-cr">
                <section className="itax-entry-section" aria-labelledby="ledger-drcr-account">
                  <h3 id="ledger-drcr-account" className="itax-entry-section__title">
                    Account
                  </h3>
                  <div className="itax-entry-section__grid">{renderFilter('mcode')}</div>
                </section>
                <section className="itax-entry-section" aria-labelledby="ledger-drcr-debit">
                  <h3 id="ledger-drcr-debit" className="itax-entry-section__title">
                    Debit (Dr) date range
                  </h3>
                  <div className="itax-entry-section__grid itax-entry-section__grid--dates">
                    {renderFilter('sdt')}
                    {renderFilter('edt')}
                  </div>
                </section>
                <section className="itax-entry-section" aria-labelledby="ledger-drcr-credit">
                  <h3 id="ledger-drcr-credit" className="itax-entry-section__title">
                    Credit (Cr) date range
                  </h3>
                  <div className="itax-entry-section__grid itax-entry-section__grid--dates">
                    {renderFilter('csdt')}
                    {renderFilter('cedt')}
                  </div>
                </section>
              </div>
            ) : (
              <div className="itax-entry-filters">{def.filters.map((f) => renderFilter(f))}</div>
            )}

            <div className="fas-tb-form-footer">
              <button type="submit" className="fas-btn fas-btn-primary fas-tb-run-bottom" disabled={loading}>
                {loading ? 'Loading…' : '▶ Proceed'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
