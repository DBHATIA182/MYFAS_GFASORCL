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
    <div className={`pb-mock-cell${ro ? ' pb-mock-cell--ro' : ''}`}>
      <span className="pb-mock-cell__label">{label}</span>
      {children}
    </div>
  );
}

function Ro({ value }) {
  return <span className="pb-mock-cell__val">{value || '—'}</span>;
}

/** Header — B.Type → Bill No → Bill Date · Value Date · Party · Broker · Delv (VFP sale_gst). */
export default function SaleBillHeaderPanel({
  header,
  totals,
  editable,
  docNoLocked,
  busy,
  fyMinYmd,
  fyMaxYmd,
  focusChain,
  setHeader,
  resolveParty,
  resolveBroker,
  resolveDelv,
  openHelp,
  onBillNoChange,
  onBillNoKeyDown,
  onBillNoBlur,
  onBillDateChange,
  onBillDateBlur,
  onBillDateKeyDown,
  onBillNoFocus,
  onBTypeChange,
  onBTypeBlur,
  onBTypeKeyDown,
  onAdvanceToGrid1,
  dateEditable,
  fmtAmt,
  fmtWgt,
}) {
  const docNoEditable = !docNoLocked && !busy;
  const billDateEditable = dateEditable != null ? dateEditable : docNoEditable;
  const f1 = (key, focusKey) => () => openHelp?.(key, focusKey);
  const hdrF1 = (key, focusKey) => (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      openHelp?.(key, focusKey);
    }
  };

  return (
    <div className="pb-tab-panel pb-tab-panel--header pb-mock-header sb-mock-header">
      <div className="pb-mock-header__row pb-mock-header__row--r1">
        <Cell label="B.Type">
          <input
            className="form-input pb-mock-inp"
            value={header.b_type}
            disabled={!docNoEditable}
            maxLength={1}
            title="Enter B.Type first — Bill No = last+1 for this type (VFP B_TYPE)"
            ref={(el) => focusChain.register('hdr-btype', el)}
            onChange={(e) => {
              const b_type = e.target.value.toUpperCase().slice(0, 1) || 'N';
              if (typeof onBTypeChange === 'function') onBTypeChange(b_type);
              else setHeader((h) => ({ ...h, b_type }));
            }}
            onBlur={onBTypeBlur}
            onKeyDown={onBTypeKeyDown || focusChain.onEnter('hdr-btype')}
          />
        </Cell>
        <Cell label="Bill No." ro={docNoLocked}>
          {docNoLocked ? (
            <Ro value={header.bill_no} />
          ) : (
            <input
              className="form-input pb-mock-inp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={header.bill_no}
              disabled={!docNoEditable}
              title="Auto last+1 for B.Type — Enter loads existing / starts new · F1 list"
              ref={(el) => focusChain.register('hdr-billno', el)}
              onChange={onBillNoChange}
              onFocus={onBillNoFocus}
              onKeyDown={onBillNoKeyDown}
              onBlur={onBillNoBlur}
            />
          )}
        </Cell>
        <Cell label="Bill Date">
          <VoucherDmyDateInput
            className="form-input pb-mock-inp"
            valueYmd={header.bill_date}
            minYmd={fyMinYmd}
            maxYmd={fyMaxYmd}
            disabled={!billDateEditable}
            inputRef={(el) => focusChain.register('hdr-billdt', el)}
            onChangeYmd={(v) => {
              if (typeof onBillDateChange === 'function') onBillDateChange(v);
              else setHeader((h) => ({ ...h, bill_date: v }));
            }}
            onBlurYmd={onBillDateBlur}
            onKeyDown={onBillDateKeyDown || focusChain.onEnter('hdr-billdt')}
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
        <Cell label="Due Days">
          <input
            className="form-input pb-mock-inp"
            value={header.due}
            disabled={!editable}
            ref={(el) => focusChain.register('hdr-due', el)}
            onChange={(e) => {
              const due = e.target.value.replace(/\D/g, '');
              setHeader((h) => ({
                ...h,
                due,
                v_date: h.bill_date ? addDaysToYmd(h.bill_date, due) || h.v_date : h.v_date,
              }));
            }}
            onKeyDown={focusChain.onEnter('hdr-due')}
          />
        </Cell>
        <Cell label="(B)ombay Dhara">
          <input
            className="form-input pb-mock-inp"
            value={header.int_type ?? ''}
            disabled={!editable}
            maxLength={1}
            title="INT_TYPE — (B)ombay Dhara. Default blank; enter B when applicable"
            ref={(el) => focusChain.register('hdr-int_type', el)}
            onChange={(e) =>
              setHeader((h) => ({
                ...h,
                int_type: e.target.value.toUpperCase().replace(/[^B]/g, '').slice(0, 1),
              }))
            }
            onKeyDown={focusChain.onEnter('hdr-int_type')}
          />
        </Cell>
      </div>

      <div className="pb-mock-header__row pb-mock-header__row--r2">
        <Cell label="Party">
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
        <Cell label="Delv">
          <span className="pb-mock-inline">
            <input
              className="form-input pb-mock-inp"
              value={header.delv_code}
              disabled={!editable}
              ref={(el) => focusChain.register('hdr-delv', el)}
              onChange={(e) => setHeader((h) => ({ ...h, delv_code: e.target.value.toUpperCase() }))}
              onBlur={() => header.delv_code && resolveDelv(header.delv_code.trim())}
              onKeyDown={(e) => {
                hdrF1('delv', 'hdr-delv')(e);
                if (!e.defaultPrevented) {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (typeof onAdvanceToGrid1 === 'function') onAdvanceToGrid1();
                    return;
                  }
                  focusChain.onEnter('hdr-delv')(e);
                }
              }}
            />
            <HelpBtn onClick={f1('delv', 'hdr-delv')} />
          </span>
        </Cell>
        <Cell label="Name" ro>
          <Ro value={header.delv_name} />
        </Cell>
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
          <span className="pb-hdr-summary__val pb-hdr-summary__val--bill">{fmtAmt(totals.bill_amt)}</span>
        </div>
        <div className="pb-hdr-summary__row pb-hdr-summary__row--net">
          <span className="pb-hdr-summary__label pb-hdr-summary__label--wide">Net Payable</span>
          <span className="pb-hdr-summary__val pb-hdr-summary__val--net">{fmtAmt(totals.net_payable)}</span>
        </div>
      </div>
    </div>
  );
}
