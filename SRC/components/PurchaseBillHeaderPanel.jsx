import React from 'react';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import { addDaysToYmd } from '../utils/dateFormat';

function HelpBtn({ onClick, title = 'Search help (F1)' }) {
  return (
    <button type="button" className="pb-help-btn" onClick={onClick} title={title} tabIndex={-1} aria-label={title}>
      ⌕
    </button>
  );
}

function Cell({ label, children, ro }) {
  return (
    <label className={`pb-mock-cell${ro ? ' pb-mock-cell--ro' : ''}`}>
      <span className="pb-mock-cell__label">{label}</span>
      {children}
    </label>
  );
}

function Ro({ value }) {
  return <span className="pb-mock-cell__val">{value || '—'}</span>;
}

/** Header — 3 rows per user mockup. */
export default function PurchaseBillHeaderPanel({
  header,
  footer,
  totals,
  editable,
  docNoLocked,
  busy,
  fyMinYmd,
  fyMaxYmd,
  focusChain,
  setHeader,
  onFooter,
  resolveParty,
  resolveBroker,
  setHelpField,
  openHelp,
  openGodownHelp,
  onRnoChange,
  onRnoKeyDown,
  onRnoBlur,
  onRdateChange,
  onRdateBlur,
  onRdateKeyDown,
  onRnoFocus,
  onAdvanceToGrid1,
  showUsdCols = false,
  showBombayDhara = true,
  showTdsSummary = true,
  isDebitNote = false,
  onOpenDnBillHelp,
  fmtAmt,
  fmtWgt,
}) {
  const docNoEditable = !docNoLocked && !busy;
  const showHelp = openHelp || setHelpField;
  const f1 = (key, focusKey) => () => showHelp(key, focusKey);
  const hdrF1 = (key, focusKey) => (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      showHelp(key, focusKey);
    }
  };
  const openGodown = openGodownHelp || (() => setHelpField?.('godown'));

  return (
    <div className="pb-tab-panel pb-tab-panel--header pb-mock-header">
      <div className="pb-mock-header__row pb-mock-header__row--r1">
        <Cell label="R.Date">
          <VoucherDmyDateInput
            className="form-input pb-mock-inp"
            valueYmd={header.r_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!docNoEditable}
            inputRef={(el) => focusChain.register('hdr-rdate', el)}
            onChangeYmd={(v) => {
              if (typeof onRdateChange === 'function') onRdateChange(v);
              else setHeader((h) => ({ ...h, r_date: v }));
            }}
            onBlurYmd={onRdateBlur}
            onKeyDown={
              onRdateKeyDown ||
              focusChain.onEnter('hdr-rdate')
            }
          />
        </Cell>
        <Cell label="R.No." ro={docNoLocked}>
          {docNoLocked ? (
            <Ro value={header.r_no} />
          ) : (
            <input
              className="form-input pb-mock-inp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={header.r_no}
              disabled={!docNoEditable}
              title="Enter — load if exists, else new bill · F1 — bill list"
              ref={(el) => focusChain.register('hdr-rno', el)}
              onChange={onRnoChange}
              onFocus={onRnoFocus}
              onKeyDown={onRnoKeyDown}
              onBlur={onRnoBlur}
            />
          )}
        </Cell>
        <Cell label="Bill Date">
          <span className={`pb-mock-inline${isDebitNote ? ' pb-mock-inline--bill-help' : ''}`}>
            <VoucherDmyDateInput
              className="form-input pb-mock-inp"
              valueYmd={header.bill_date}
              minYmd={fyMinYmd}
              maxYmd={fyMaxYmd}
              disabled={!editable}
              inputRef={(el) => focusChain.register('hdr-billdt', el)}
              onChangeYmd={(v) =>
                setHeader((h) => ({
                  ...h,
                  bill_date: v,
                  v_date: h.due ? addDaysToYmd(v, h.due) || v : v,
                }))
              }
              onKeyDown={(e) => {
                if (isDebitNote && e.key === 'F1') {
                  e.preventDefault();
                  onOpenDnBillHelp?.();
                  return;
                }
                focusChain.onEnter('hdr-billdt')(e);
              }}
            />
            {isDebitNote ? (
              <HelpBtn
                onClick={() => onOpenDnBillHelp?.()}
                title="Purchase bill help (F1) — choose PU bill lines"
              />
            ) : null}
          </span>
        </Cell>
        <Cell label="Bill No.">
          <span className={`pb-mock-inline${isDebitNote ? ' pb-mock-inline--bill-help' : ''}`}>
            <input
              className="form-input pb-mock-inp"
              value={header.bill_no}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-billno', el)}
              onChange={(e) => setHeader((h) => ({ ...h, bill_no: e.target.value }))}
              onKeyDown={(e) => {
                if (isDebitNote && e.key === 'F1') {
                  e.preventDefault();
                  onOpenDnBillHelp?.();
                  return;
                }
                focusChain.onEnter('hdr-billno')(e);
              }}
            />
            {isDebitNote ? (
              <HelpBtn
                onClick={() => onOpenDnBillHelp?.()}
                title="Purchase bill help (F1) — choose PU bill lines"
              />
            ) : null}
          </span>
        </Cell>
        <Cell label="Due">
          <input
            className="form-input pb-mock-inp"
            value={header.due}
            disabled={!editable}
            ref={(el) => focusChain.register('hdr-due', el)}
            onChange={(e) => {
              const due = e.target.value.replace(/[^\d]/g, '');
              setHeader((h) => ({
                ...h,
                due,
                v_date: h.bill_date ? addDaysToYmd(h.bill_date, due) || h.v_date : h.v_date,
              }));
            }}
            onKeyDown={focusChain.onEnter('hdr-due')}
          />
        </Cell>
        <Cell label="Value Date">
          <VoucherDmyDateInput
            className="form-input pb-mock-inp"
            valueYmd={header.v_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!editable}
            inputRef={(el) => focusChain.register('hdr-vdate', el)}
            onChangeYmd={(v) => setHeader((h) => ({ ...h, v_date: v }))}
            onKeyDown={focusChain.onEnter('hdr-vdate')}
          />
        </Cell>
        {showBombayDhara ? (
          <Cell label="Bombay Dhara">
            <input
              className="form-input pb-mock-inp"
              value={header.bombay_dhara}
              disabled={!editable}
              maxLength={1}
              title="Bombay Dhara (Y/N)"
              ref={(el) => focusChain.register('hdr-bombay', el)}
              onChange={(e) =>
                setHeader((h) => ({
                  ...h,
                  bombay_dhara: e.target.value.toUpperCase().replace(/[^YN]/g, '').slice(0, 1),
                }))
              }
              onKeyDown={focusChain.onEnter('hdr-bombay')}
            />
          </Cell>
        ) : null}
      </div>

      <div className="pb-mock-header__row pb-mock-header__row--r2">
        <Cell label="Supplier">
          <span className="pb-mock-inline">
            <input
              className="form-input pb-mock-inp"
              value={header.code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-code', el)}
              onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
              onBlur={() => header.code && resolveParty(header.code.trim())}
              onKeyDown={(e) => {
                hdrF1('party', 'hdr-code')(e);
                if (!e.defaultPrevented) focusChain.onEnter('hdr-code')(e);
              }}
            />
            <HelpBtn onClick={f1('party', 'hdr-code')} />
          </span>
        </Cell>
        <Cell label="Name" ro>
          <Ro value={header.party_name} />
        </Cell>
        <Cell label="Place" ro>
          <Ro value={header.party_city} />
        </Cell>
        <Cell label="Gst No." ro>
          <Ro value={header.gst_no} />
        </Cell>
        <Cell label="Pan" ro>
          <Ro value={header.pan} />
        </Cell>
        <Cell label="L/C">
          <span className="pb-mock-inline">
            <input
              className="form-input pb-mock-inp"
              value={footer.l_c_code}
              disabled={!editable}
              onChange={(e) => onFooter('l_c_code', e.target.value.toUpperCase())}
              onKeyDown={hdrF1('exp-l_c_code')}
            />
            <HelpBtn onClick={f1('exp-l_c_code')} />
          </span>
        </Cell>
        <Cell label="Tot Pur" ro>
          <Ro value={fmtAmt(totals.mbamt)} />
        </Cell>
        <Cell label="Cur.Bal" ro>
          <Ro value={header.cur_bal} />
        </Cell>
      </div>

      <div className="pb-mock-header__row pb-mock-header__row--r3">
        <Cell label="Broker">
          <span className="pb-mock-inline">
            <input
              className="form-input pb-mock-inp"
              value={header.b_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-bk', el)}
              onChange={(e) => setHeader((h) => ({ ...h, b_code: e.target.value.toUpperCase() }))}
              onBlur={() => header.b_code && resolveBroker(header.b_code.trim())}
              onKeyDown={(e) => {
                hdrF1('broker', 'hdr-bk')(e);
                if (!e.defaultPrevented) focusChain.onEnter('hdr-bk')(e);
              }}
            />
            <HelpBtn onClick={f1('broker', 'hdr-bk')} />
          </span>
        </Cell>
        <Cell label="Name" ro>
          <Ro value={header.bk_name} />
        </Cell>
        <Cell label="God Code">
          <span className="pb-mock-inline">
            <input
              className="form-input pb-mock-inp"
              value={header.god_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-god', el)}
              onChange={(e) => setHeader((h) => ({ ...h, god_code: e.target.value.toUpperCase() }))}
              onKeyDown={(e) => {
                if (e.key === 'F1') {
                  e.preventDefault();
                  openGodown();
                  return;
                }
                if (!showUsdCols && e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) {
                  e.preventDefault();
                  if (typeof onAdvanceToGrid1 === 'function') onAdvanceToGrid1();
                  return;
                }
                focusChain.onEnter('hdr-god')(e);
              }}
            />
            <HelpBtn onClick={openGodown} />
          </span>
        </Cell>
        <Cell label="God Name" ro>
          <Ro value={header.god_name} />
        </Cell>
        {showUsdCols ? (
          <Cell label="Conv.Rate">
            <input
              className="form-input pb-mock-inp"
              value={header.conv_rate}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-conv', el)}
              onChange={(e) => setHeader((h) => ({ ...h, conv_rate: e.target.value.replace(/[^\d.-]/g, '') }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) {
                  e.preventDefault();
                  if (typeof onAdvanceToGrid1 === 'function') onAdvanceToGrid1();
                  return;
                }
                focusChain.onEnter('hdr-conv')(e);
              }}
            />
          </Cell>
        ) : null}
      </div>

      <div className="pb-hdr-summary">
        <div className="pb-hdr-summary__row pb-hdr-summary__row--qty">
          <span className="pb-hdr-summary__label">Total Qty.</span>
          <span className="pb-hdr-summary__val pb-hdr-summary__val--qty">{fmtWgt(totals.qnty)}</span>
          <span className="pb-hdr-summary__label">Weight</span>
          <span className="pb-hdr-summary__val pb-hdr-summary__val--wgt">{fmtWgt(totals.weight)}</span>
          <span className="pb-hdr-summary__label">Amount</span>
          <span className="pb-hdr-summary__val pb-hdr-summary__val--amt">{fmtAmt(totals.amount)}</span>
        </div>
        <div className="pb-hdr-summary__row">
          <span className="pb-hdr-summary__label pb-hdr-summary__label--wide">Total Bill Amount</span>
          <span className="pb-hdr-summary__val pb-hdr-summary__val--bill">{fmtAmt(totals.mbamt)}</span>
        </div>
        {showTdsSummary ? (
          <>
            <div className="pb-hdr-summary__row">
              <span className="pb-hdr-summary__label pb-hdr-summary__label--wide">Less Tds</span>
              <span className="pb-hdr-summary__val">{fmtAmt(footer.ntds_amt)}</span>
            </div>
            <div className="pb-hdr-summary__row pb-hdr-summary__row--net">
              <span className="pb-hdr-summary__label pb-hdr-summary__label--wide">Net Payable</span>
              <span className="pb-hdr-summary__val pb-hdr-summary__val--net">{fmtAmt(totals.net_payable)}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
