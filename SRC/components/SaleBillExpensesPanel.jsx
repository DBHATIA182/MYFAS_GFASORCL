import React, { useEffect, useMemo, useRef } from 'react';

function numInput(onChange) {
  return (e) => onChange(e.target.value.replace(/[^\d.-]/g, ''));
}

function HelpBtn({ onClick }) {
  return (
    <button type="button" className="pb-help-btn pb-exp-ft-help" onClick={onClick} title="F1 Help" tabIndex={-1}>
      ⌕
    </button>
  );
}

function Row({
  label,
  pct,
  code,
  amt,
  editable,
  onPct,
  onCode,
  onAmt,
  helpKey,
  openHelp,
  focusChain,
  pctFocusKey,
  codeFocusKey,
  amtFocusKey,
  readOnlyAmt,
  readOnlyCode,
  hasCode = true,
  hasPct = false,
}) {
  const onCodeKey = (e) => {
    if (e.key === 'F1' && helpKey) {
      e.preventDefault();
      openHelp?.(helpKey, codeFocusKey);
      return;
    }
    if (codeFocusKey) focusChain?.onEnter(codeFocusKey)(e);
  };

  return (
    <tr className="pb-exp-ft-row">
      <td className="pb-exp-ft-row__label">{label}</td>
      <td className="pb-exp-ft-row__pct">
        {hasPct ? (
          <input
            className="form-input pb-exp-ft-inp pb-exp-ft-inp--pct"
            value={pct ?? ''}
            disabled={!editable}
            placeholder="%"
            ref={(el) => focusChain?.register(pctFocusKey, el)}
            onChange={numInput(onPct)}
            onKeyDown={pctFocusKey ? focusChain?.onEnter(pctFocusKey) : undefined}
          />
        ) : null}
      </td>
      <td className="pb-exp-ft-row__code">
        {hasCode ? (
          readOnlyCode ? (
            <span className="pb-exp-ft-ro">{code || ''}</span>
          ) : (
            <span className="pb-exp-ft-code-wrap">
              <input
                className="form-input pb-exp-ft-inp pb-exp-ft-inp--code"
                value={code ?? ''}
                disabled={!editable}
                ref={(el) => focusChain?.register(codeFocusKey, el)}
                onChange={(e) => onCode?.(e.target.value.toUpperCase())}
                onKeyDown={onCodeKey}
              />
              {helpKey ? <HelpBtn onClick={() => openHelp?.(helpKey, codeFocusKey)} /> : null}
            </span>
          )
        ) : null}
      </td>
      <td className="pb-exp-ft-row__amt">
        {readOnlyAmt ? (
          <span className="pb-exp-ft-ro pb-exp-ft-ro--amt">{amt}</span>
        ) : (
          <input
            className="form-input pb-exp-ft-inp pb-exp-ft-inp--amt"
            value={amt ?? ''}
            disabled={!editable}
            ref={(el) => focusChain?.register(amtFocusKey, el)}
            onChange={numInput(onAmt)}
            onKeyDown={amtFocusKey ? focusChain?.onEnter(amtFocusKey) : undefined}
          />
        )}
      </td>
    </tr>
  );
}

/** Expenses Summary band — Discount/GST/Labour/Freight/Comm/Brok/Arh/Ins/Round/TDS/Bill Amt (VFP sumvalue). */
export default function SaleBillExpensesPanel({ footer, totals, editable, onFooter, openHelp, focusChain, fmtAmt, fmtWgt }) {
  const panelRef = useRef(null);
  useEffect(() => {
    panelRef.current?.scrollTo(0, 0);
  }, []);

  const rows = useMemo(
    () => [
      { type: 'total', label: 'Merchandise Amt', amt: fmtAmt(totals.amount) },
      { type: 'code', label: 'Discount', codeField: 'dis_code', amt: fmtAmt(totals.dis_amt), readOnlyAmt: true },
      { type: 'code', label: 'CGST', codeField: 'cgst_code', amt: fmtAmt(totals.cgst_amt), readOnlyAmt: true },
      { type: 'code', label: 'SGST', codeField: 'sgst_code', amt: fmtAmt(totals.sgst_amt), readOnlyAmt: true },
      { type: 'code', label: 'IGST', codeField: 'igst_code', amt: fmtAmt(totals.igst_amt), readOnlyAmt: true },
      { type: 'divider' },
      { type: 'total', label: 'Net Amount', amt: fmtAmt(totals.net_amount) },
      { type: 'amtcode', label: 'Labour', codeField: 'labour_code', amtField: 'labour' },
      { type: 'amtcode', label: 'Freight', codeField: 'freight_code', amtField: 'freight' },
      { type: 'amtcode', label: 'Insurance', codeField: 'ins_code', amtField: 'ins' },
      { type: 'pct', label: 'Commission %', pctField: 'comm_per', codeField: 'comm_code', amtField: 'comm_amt' },
      { type: 'pct', label: 'Brokerage %', pctField: 'brok_per', codeField: 'brok_code', amtField: 'brok_amt' },
      { type: 'pct', label: 'Arhatiya %', pctField: 'arh_per', codeField: 'arh_code', amtField: 'arh_amt' },
      { type: 'total', label: 'Other Exp (1–10)', amt: fmtAmt(totals.oth_exp_total) },
      { type: 'amt', label: 'Round Off', amtField: 'round_off' },
      { type: 'divider' },
      { type: 'total', label: 'Bill Amount', amt: fmtAmt(totals.bill_amt) },
      { type: 'amt', label: 'TdsOnAmount', amtField: 'tds_on_amt' },
      { type: 'pct', label: 'Tds %', pctField: 'tds_per', codeField: 'tds_code', amtField: 'tds_amt' },
      { type: 'net' },
    ],
    [fmtAmt, totals]
  );

  return (
    <div ref={panelRef} className="pb-tab-panel pb-tab-panel--exp-footer">
      <table className="pb-exp-footer-table">
        <colgroup>
          <col className="pb-exp-ft-col-label" />
          <col className="pb-exp-ft-col-pct" />
          <col className="pb-exp-ft-col-code" />
          <col className="pb-exp-ft-col-amt" />
        </colgroup>
        <thead className="pb-exp-footer-table__head">
          <tr>
            <th className="pb-exp-ft-th-label">&nbsp;</th>
            <th className="pb-exp-ft-th-pct">%</th>
            <th className="pb-exp-ft-th-code">Code</th>
            <th className="pb-exp-ft-th-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            if (r.type === 'divider') {
              return (
                <tr key={`div-${idx}`} className="pb-exp-ft-divider">
                  <td colSpan={4} />
                </tr>
              );
            }
            if (r.type === 'net') {
              return (
                <tr key="net" className="pb-exp-ft-row pb-exp-ft-row--net">
                  <td className="pb-exp-ft-row__label">NetPayable</td>
                  <td />
                  <td />
                  <td className="pb-exp-ft-row__amt pb-exp-ft-row__amt--net">{fmtAmt(totals.net_payable)}</td>
                </tr>
              );
            }
            if (r.type === 'total') {
              return <Row key={`${r.label}-${idx}`} label={r.label} hasCode={false} readOnlyCode readOnlyAmt amt={r.amt} />;
            }
            if (r.type === 'code') {
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  code={footer[r.codeField]}
                  amt={r.amt}
                  readOnlyAmt={r.readOnlyAmt}
                  editable={editable}
                  onCode={(v) => onFooter(r.codeField, v)}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={openHelp}
                  focusChain={focusChain}
                  codeFocusKey={`ft-${r.codeField}`}
                />
              );
            }
            if (r.type === 'amt') {
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  hasCode={false}
                  amt={footer[r.amtField]}
                  editable={editable}
                  onAmt={(v) => onFooter(r.amtField, v)}
                  focusChain={focusChain}
                  amtFocusKey={`ft-${r.amtField}`}
                />
              );
            }
            if (r.type === 'amtcode') {
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  code={footer[r.codeField]}
                  amt={footer[r.amtField]}
                  editable={editable}
                  onCode={(v) => onFooter(r.codeField, v)}
                  onAmt={(v) => onFooter(r.amtField, v)}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={openHelp}
                  focusChain={focusChain}
                  codeFocusKey={`ft-${r.codeField}`}
                  amtFocusKey={`ft-${r.amtField}`}
                />
              );
            }
            if (r.type === 'pct') {
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  hasPct
                  pct={footer[r.pctField]}
                  code={footer[r.codeField]}
                  amt={footer[r.amtField]}
                  editable={editable}
                  onPct={(v) => onFooter(r.pctField, v)}
                  onCode={(v) => onFooter(r.codeField, v)}
                  onAmt={(v) => onFooter(r.amtField, v)}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={openHelp}
                  focusChain={focusChain}
                  pctFocusKey={`ft-${r.pctField}`}
                  codeFocusKey={`ft-${r.codeField}`}
                  amtFocusKey={`ft-${r.amtField}`}
                />
              );
            }
            return null;
          })}
        </tbody>
      </table>
      <p className="pb-lines-hint sb-exp-hint">
        Total Qty {fmtWgt(totals.qnty)} · Weight {fmtWgt(totals.weight)} · Edit OTH_EXP1–10 on Other Expenses tab
      </p>
    </div>
  );
}
