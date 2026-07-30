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
  cal,
  code,
  amt,
  editable,
  onPct,
  onCal,
  onCode,
  onAmt,
  helpKey,
  openHelp,
  focusChain,
  pctFocusKey,
  calFocusKey,
  codeFocusKey,
  amtFocusKey,
  readOnlyAmt,
  readOnlyCode,
  hasCode = true,
  hasPct = false,
  hasCal = false,
  rowClass = '',
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
    <tr className={`pb-exp-ft-row${rowClass ? ` ${rowClass}` : ''}`}>
      <td className="pb-exp-ft-row__label">{label}</td>
      <td className="pb-exp-ft-row__pct">
        <span className="pb-exp-ft-pct-wrap">
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
          {hasCal ? (
            <input
              className="form-input pb-exp-ft-inp pb-exp-ft-inp--cal"
              value={cal ?? ''}
              disabled={!editable}
              placeholder="Q/W/A/M"
              maxLength={1}
              title="Q=Qty W=Weight A=Amount M=Manual"
              ref={(el) => focusChain?.register(calFocusKey, el)}
              onChange={(e) => onCal?.(e.target.value.toUpperCase().replace(/[^QWAM]/g, '').slice(0, 1))}
              onKeyDown={calFocusKey ? focusChain?.onEnter(calFocusKey) : undefined}
            />
          ) : null}
        </span>
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

/** Expenses Summary — full notepad list, top-to-bottom. */
export default function PurchaseBillExpensesFooter({
  footer,
  totals,
  editable,
  onFooter,
  openHelp,
  setHelpField,
  focusChain,
  fmtAmt,
  fmtWgt,
  isBardana = false,
}) {
  const panelRef = useRef(null);
  const help = openHelp || ((hk) => setHelpField?.(hk));

  useEffect(() => {
    panelRef.current?.scrollTo(0, 0);
  }, []);

  const rows = useMemo(() => {
    if (isBardana) {
      // VFP purchase_bardana right panel — expenses only; TDS yes, TCS no; no Grid-2 misc totals
      const othPairs = [
        ['Others Cr.', 'oth_cd_1', 'oth_exp_1'],
        ['Others Cr.', 'oth_cd_2', 'oth_exp_2'],
        ['Others Dr.', 'oth_cd_3', 'oth_exp_3'],
        ['Others Dr.', 'oth_cd_4', 'oth_exp_4'],
        ['Others', 'oth_cd_5', 'oth_exp_5'],
        ['Others', 'oth_cd_6', 'oth_exp_6'],
        ['Others', 'oth_cd_7', 'oth_exp_7'],
        ['Others', 'oth_cd_8', 'oth_exp_8'],
      ];
      return [
        { type: 'banner' },
        { type: 'code', label: 'Dis.%', codeField: 'dis_code', amt: fmtAmt(totals.dis_amt), readOnlyAmt: true },
        { type: 'code', label: 'CGST', codeField: 'cgst_code', amt: fmtAmt(totals.cgst_amt), readOnlyAmt: true },
        { type: 'code', label: 'SGST', codeField: 'sgst_code', amt: fmtAmt(totals.sgst_amt), readOnlyAmt: true },
        { type: 'code', label: 'IGST', codeField: 'igst_code', amt: fmtAmt(totals.igst_amt), readOnlyAmt: true },
        {
          type: 'pct',
          label: 'Commission',
          pctField: 'comm_per',
          calField: 'comm_cal',
          codeField: 'comm_code',
          amtField: 'comm_amt',
          hasCal: true,
        },
        {
          type: 'pct',
          label: 'Mudat %',
          pctField: 'mud_per',
          codeField: 'mud_code',
          amtField: 'mud_amt',
        },
        ...othPairs.map(([label, codeField, amtField]) => ({ type: 'oth', label, codeField, amtField })),
        { type: 'divider' },
        { type: 'total', label: 'Net Amount', amt: fmtAmt(totals.mbamt) },
        { type: 'amt', label: 'TdsOnAmount', amtField: 'ntds_on_amt' },
        {
          type: 'pct',
          label: 'Tds %',
          pctField: 'ntds_per',
          codeField: 'ntds_code',
          amtField: 'ntds_amt',
        },
        { type: 'net' },
      ];
    }

    const othPairs = [
      ['OthersCr', 'oth_cd_1', 'oth_exp_1'],
      ['OthersCr', 'oth_cd_2', 'oth_exp_2'],
      ['OthersDr', 'oth_cd_3', 'oth_exp_3'],
      ['OthersDr', 'oth_cd_4', 'oth_exp_4'],
      ['Others', 'oth_cd_5', 'oth_exp_5'],
      ['Others', 'oth_cd_6', 'oth_exp_6'],
      ['Others', 'oth_cd_7', 'oth_exp_7'],
      ['Others', 'oth_cd_8', 'oth_exp_8'],
    ];

    const expensePairs = [
      ['Mandiexp', 'mandi_exp_code', 'mandi_exp'],
      ['Labourexp', 'labour_exp_code', 'labour_exp'],
      ['Bardana', 'bardana_exp_code', 'bardana_exp'],
      ['Freight', 'freight_paid_code', 'freight_paid'],
      ['Cd. %', 'cd_amount_code', 'cd_amount', 'cd_per'],
      ['DharmKanta', 'dharam_kanta_code', 'dharam_kanta'],
      ['Tulwaiexp', 'tulwai_code', 'tulwai_exp'],
      ['RoundOff', 'round_off_code', 'round_off'],
    ];

    return [
      { type: 'banner' },
      { type: 'total', label: 'Misc Exp Total of grid 2', amt: fmtAmt(totals.misc_exp) },
      { type: 'code', label: 'Total Discount', codeField: 'dis_code', amt: fmtAmt(totals.dis_amt), readOnlyAmt: true },
      { type: 'total', label: 'Total Bardana', amt: fmtAmt(totals.bard_amt) },
      { type: 'total', label: 'Total Labour', amt: fmtAmt(totals.lab_amt) },
      { type: 'total', label: 'Total Freight', amt: fmtAmt(totals.fgt_amt) },
      { type: 'total', label: 'Total Insurance', amt: fmtAmt(totals.ins_amt) },
      { type: 'total', label: 'Total Others', amt: fmtAmt(totals.oth_amt) },
      { type: 'code', label: 'Total Cgst', codeField: 'cgst_code', amt: fmtAmt(totals.cgst_amt), readOnlyAmt: true },
      { type: 'code', label: 'Total Sgst', codeField: 'sgst_code', amt: fmtAmt(totals.sgst_amt), readOnlyAmt: true },
      { type: 'code', label: 'Total Igst', codeField: 'igst_code', amt: fmtAmt(totals.igst_amt), readOnlyAmt: true },
      {
        type: 'pct',
        label: 'Dami %',
        pctField: 'comm_per',
        calField: 'comm_cal',
        codeField: 'comm_code',
        amtField: 'comm_amt',
        hasCal: true,
      },
      {
        type: 'pct',
        label: 'Mudat %',
        pctField: 'mud_per',
        codeField: 'mud_code',
        amtField: 'mud_amt',
      },
      ...othPairs.map(([label, codeField, amtField]) => ({ type: 'oth', label, codeField, amtField })),
      {
        type: 'pct',
        label: 'BrokPaid %',
        pctField: 'brok_paid_per',
        calField: 'brok_cal',
        codeField: 'brok_paid_code',
        amtField: 'brok_paid',
        hasCal: true,
      },
      ...expensePairs.map(([label, codeField, amtField, pctField]) =>
        pctField
          ? { type: 'pct', label, pctField, codeField, amtField }
          : { type: 'oth', label, codeField, amtField }
      ),
      { type: 'divider' },
      { type: 'total', label: 'NetAmount', amt: fmtAmt(totals.mbamt) },
      { type: 'amt', label: 'TdsOnAmount', amtField: 'ntds_on_amt' },
      {
        type: 'pct',
        label: 'Tds %',
        pctField: 'ntds_per',
        codeField: 'ntds_code',
        amtField: 'ntds_amt',
      },
      { type: 'net' },
    ];
  }, [fmtAmt, totals, isBardana]);

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
            <th className="pb-exp-ft-th-pct">% / Cal</th>
            <th className="pb-exp-ft-th-code">Code</th>
            <th className="pb-exp-ft-th-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            if (r.type === 'banner') {
              return (
                <tr key="banner" className="pb-exp-ft-row pb-exp-ft-row--banner">
                  <td className="pb-exp-ft-row__label">
                    Total Qty <b>{fmtWgt(totals.qnty)}</b> Wgt <b>{fmtWgt(totals.weight)}</b>
                  </td>
                  <td />
                  <td />
                  <td className="pb-exp-ft-row__amt pb-exp-ft-row__amt--banner">{fmtAmt(totals.amount)}</td>
                </tr>
              );
            }
            if (r.type === 'divider') {
              return (
                <tr key="div" className="pb-exp-ft-divider">
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
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  hasCode={false}
                  readOnlyCode
                  readOnlyAmt
                  amt={r.amt}
                />
              );
            }
            if (r.type === 'code') {
              const amtField = r.amtField;
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  code={footer[r.codeField]}
                  amt={amtField ? footer[amtField] : r.amt}
                  readOnlyAmt={r.readOnlyAmt}
                  editable={editable}
                  onCode={(v) => onFooter(r.codeField, v)}
                  onAmt={amtField ? (v) => onFooter(amtField, v) : undefined}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={help}
                  focusChain={focusChain}
                  codeFocusKey={`ft-${r.codeField}`}
                  amtFocusKey={amtField ? `ft-${amtField}` : undefined}
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
            if (r.type === 'pct') {
              return (
                <Row
                  key={`${r.label}-${idx}`}
                  label={r.label}
                  hasPct
                  hasCal={!!r.hasCal || !!r.calField}
                  pct={footer[r.pctField]}
                  cal={r.calField ? footer[r.calField] : ''}
                  code={footer[r.codeField]}
                  amt={footer[r.amtField]}
                  editable={editable}
                  onPct={(v) => onFooter(r.pctField, v)}
                  onCal={r.calField ? (v) => onFooter(r.calField, v) : undefined}
                  onCode={(v) => onFooter(r.codeField, v)}
                  onAmt={(v) => onFooter(r.amtField, v)}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={help}
                  focusChain={focusChain}
                  pctFocusKey={`ft-${r.pctField}`}
                  calFocusKey={r.calField ? `ft-${r.calField}` : undefined}
                  codeFocusKey={`ft-${r.codeField}`}
                  amtFocusKey={`ft-${r.amtField}`}
                />
              );
            }
            if (r.type === 'oth') {
              return (
                <Row
                  key={`${r.label}-${r.codeField}`}
                  label={r.label}
                  code={footer[r.codeField]}
                  amt={footer[r.amtField]}
                  editable={editable}
                  onCode={(v) => onFooter(r.codeField, v)}
                  onAmt={(v) => onFooter(r.amtField, v)}
                  helpKey={`exp-${r.codeField}`}
                  openHelp={help}
                  focusChain={focusChain}
                  codeFocusKey={`ft-${r.codeField}`}
                  amtFocusKey={`ft-${r.amtField}`}
                />
              );
            }
            return null;
          })}
        </tbody>
      </table>
    </div>
  );
}
