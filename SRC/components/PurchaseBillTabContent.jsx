import React, { useEffect, useMemo, useState } from 'react';
import PurchaseBillHeaderPanel from './PurchaseBillHeaderPanel';
import PurchaseBillExpensesFooter from './PurchaseBillExpensesFooter';
import PurchaseBillBillExpensesPanel from './PurchaseBillBillExpensesPanel';
import { calcExpAmount } from './PurchaseBillExpGridModal';

/** Header + Grid 1 + Grid 2 + Expenses Summary + Bill Expenses. */
export const PB_TAB = {
  HEADER: 'header',
  GRID1: 'grid1',
  GRID2: 'grid2',
  BILL_EXP: 'bill_exp',
  EXPENSES: 'expenses',
};

/** Header + Grid 1 + Grid 2 + Expenses Summary + Bill Expenses (last). */
export function getPbTabList(opts = {}) {
  const tabs = [
    { id: PB_TAB.HEADER, label: 'Header' },
    { id: PB_TAB.GRID1, label: 'Grid 1' },
  ];
  if (!opts.hideGrid2) {
    tabs.push({ id: PB_TAB.GRID2, label: 'Grid 2' });
  }
  tabs.push(
    { id: PB_TAB.EXPENSES, label: 'Expenses Summary' },
    { id: PB_TAB.BILL_EXP, label: 'Bill Expenses' }
  );
  return tabs;
}

/** @deprecated use getPbTabList() */
export const PB_TAB_LIST = getPbTabList();

const BKH_OPTIONS = ['B', 'K', 'H'];

function HelpBtn({ onClick, disabled, title = 'Search help (F1)' }) {
  return (
    <button
      type="button"
      className="pb-help-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
      tabIndex={-1}
      aria-label={title}
    >
      ⌕
    </button>
  );
}

function GridCodeCell({
  className = 'form-input',
  value,
  disabled,
  focusRef,
  onChange,
  onKeyDown,
  onBlur,
  onHelp,
  helpTitle,
}) {
  return (
    <div className="pb-grid-cell-wrap">
      <input
        className={className}
        value={value ?? ''}
        disabled={disabled}
        ref={focusRef}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <HelpBtn onClick={onHelp} disabled={disabled} title={helpTitle} />
    </div>
  );
}

function numInput(onChange) {
  return (e) => onChange(e.target.value.replace(/[^\d.-]/g, ''));
}

function LnCell({
  className = 'form-input',
  value,
  disabled,
  readOnly,
  focusRef,
  onChange,
  onKeyDown,
  onBlur,
  maxLength,
}) {
  return (
    <input
      className={className}
      value={value ?? ''}
      disabled={disabled}
      readOnly={readOnly}
      ref={focusRef}
      maxLength={maxLength}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

function GridShell({ hint, editable, busy, onAddLine, children }) {
  return (
    <section className="pb-lines-section">
      <p className="pb-lines-hint">
        {hint}
        {editable ? (
          <button type="button" className="btn btn-xs pb-add-line-btn" onClick={onAddLine} disabled={busy}>
            + Line
          </button>
        ) : null}
      </p>
      <div className="pb-lines-wrap table-responsive--sale-list">{children}</div>
    </section>
  );
}

function HeaderTab(props) {
  return (
    <PurchaseBillHeaderPanel
      {...props}
      showBombayDhara={!props.isBardana}
      showTdsSummary
      isDebitNote={!!props.isDebitNote}
      onOpenDnBillHelp={props.onOpenDnBillHelp}
    />
  );
}

function Grid2Tab({
  lines,
  lineExpenses,
  setLineExpenses,
  purExpMaster,
  editable,
  setHelpField,
  purexpLineKey,
  setPurexpLineKey,
  showLineExp,
}) {
  if (!showLineExp) {
    return (
      <section className="pb-tab-panel pb-tab-panel--grid2 pb-grid2-disabled">
        <p className="pb-lines-hint">Grid 2 is not enabled for this company (G_PUR_EXP ≠ Y in defvalue).</p>
      </section>
    );
  }
  const activeLine = lines.find((l) => l.key === purexpLineKey) || lines[0] || null;
  const trnNo = activeLine?.trn_no || activeLine?.key;

  const rows = useMemo(() => {
    if (!activeLine) return [];
    const map = new Map(
      (lineExpenses || [])
        .filter((e) => e.trn_no === trnNo)
        .map((r) => [String(r.exp_name ?? '').trim().toUpperCase(), r])
    );
    return (purExpMaster || []).map((m, idx) => {
      const key = String(m.exp_name ?? '').trim().toUpperCase();
      const saved = map.get(key);
      const base = {
        key: idx + 1,
        exp_name: m.exp_name || '',
        exp_rate: saved?.exp_rate != null ? String(saved.exp_rate) : String(m.exp_rate ?? ''),
        cal_type: saved?.cal_type || m.cal_type || 'W',
        code: saved?.code || m.code || '',
        ac_name: saved?.ac_name || m.ac_name || '',
        amount: saved?.amount != null ? String(saved.amount) : '',
      };
      if (!base.amount && base.exp_rate) {
        const amt = calcExpAmount(base, activeLine);
        if (amt) base.amount = String(amt);
      }
      return base;
    });
  }, [activeLine, lineExpenses, purExpMaster, trnNo]);

  const [gridRows, setGridRows] = useState(rows);
  useEffect(() => {
    setGridRows(rows);
  }, [rows]);

  const commitRows = (nextRows) => {
    if (!trnNo) return;
    const out = nextRows
      .filter((r) => Number(String(r.amount).replace(/,/g, '')) || Number(String(r.exp_rate).replace(/,/g, '')))
      .map((r) => ({
        trn_no: trnNo,
        exp_name: r.exp_name,
        exp_rate: Number(String(r.exp_rate).replace(/,/g, '')) || 0,
        cal_type: r.cal_type,
        amount: Number(String(r.amount).replace(/,/g, '')) || 0,
        code: r.code,
      }));
    setLineExpenses((prev) => [...prev.filter((e) => e.trn_no !== trnNo), ...out]);
  };

  const updateRow = (rowKey, patch) => {
    setGridRows((prev) => {
      const next = prev.map((r) => {
        if (r.key !== rowKey) return r;
        const merged = { ...r, ...patch };
        if (patch.exp_rate != null && activeLine) {
          const amt = calcExpAmount(merged, activeLine);
          if (amt) merged.amount = String(amt);
        }
        return merged;
      });
      commitRows(next);
      return next;
    });
  };

  if (!lines.length) {
    return <p className="pb-lines-hint">Enter item lines on the Items tab first.</p>;
  }

  return (
    <section className="pb-tab-panel pb-tab-panel--purexp pb-lines-section">
      <p className="pb-lines-hint">Grid 2 — PUREXP line expenses (G_PUR_EXP=Y). F1 on Code.</p>
      <div className="pb-purexp-toolbar">
        <label>
          Line
          <select
            className="form-input"
            value={purexpLineKey ?? lines[0]?.key ?? ''}
            disabled={!editable}
            onChange={(e) => setPurexpLineKey(Number(e.target.value) || lines[0]?.key)}
          >
            {lines.map((ln, idx) => (
              <option key={ln.key} value={ln.key}>
                {idx + 1} — {ln.item_code || '?'}{ln.item_name ? ` ${ln.item_name}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pb-lines-wrap table-responsive--sale-list">
        <table className="purchase-bill-exp-grid__table pb-lines-table--purexp">
          <thead>
            <tr>
              <th>ExpName</th>
              <th>ExpRate</th>
              <th>Cal_type</th>
              <th>Amount</th>
              <th>Code</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {gridRows.map((r) => (
              <tr key={r.key}>
                <td>{r.exp_name}</td>
                <td>
                  <input
                    className="form-input"
                    value={r.exp_rate}
                    disabled={!editable}
                    onChange={(e) => updateRow(r.key, { exp_rate: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                </td>
                <td>{r.cal_type}</td>
                <td>
                  <input
                    className="form-input"
                    value={r.amount}
                    disabled={!editable}
                    onChange={(e) => updateRow(r.key, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                </td>
                <td>
                  <div className="pb-hdr-field__control pb-hdr-field__control--inline">
                    <input
                      className="form-input"
                      value={r.code}
                      disabled={!editable}
                      onChange={(e) => updateRow(r.key, { code: e.target.value.toUpperCase() })}
                      onKeyDown={(e) => {
                        if (e.key === 'F1') {
                          e.preventDefault();
                          setHelpField(`purexp-code-${r.key}`);
                        }
                      }}
                    />
                    <button type="button" className="pb-help-btn" onClick={() => setHelpField(`purexp-code-${r.key}`)} title="GRID2HLP">
                      🔍
                    </button>
                  </div>
                </td>
                <td>{r.ac_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Grid1Tab({
  lines,
  editable,
  busy,
  focusChain,
  updateLine,
  handleGridF1,
  onAddLine,
  openGridHelp,
  showGwCols = true,
  showUsdCols = false,
  isBardana = false,
}) {
  const pctAmt = (ln, perKey, amtKey, prefix) => (
    <>
      <td>
        <LnCell
          className="form-input pb-col-pct"
          value={ln[perKey]}
          disabled={!editable}
          focusRef={(el) => focusChain.register(`ln-${ln.key}-${prefix}-p`, el)}
          onChange={numInput((v) => updateLine(ln.key, { [perKey]: v }))}
          onKeyDown={focusChain.onEnter(`ln-${ln.key}-${prefix}-p`)}
        />
      </td>
      <td>
        <LnCell
          className="form-input pb-col-taxamt"
          value={ln[amtKey]}
          disabled={!editable}
          focusRef={(el) => focusChain.register(`ln-${ln.key}-${prefix}-a`, el)}
          onChange={numInput((v) => updateLine(ln.key, { [amtKey]: v }))}
          onKeyDown={focusChain.onEnter(`ln-${ln.key}-${prefix}-a`)}
        />
      </td>
    </>
  );

  return (
    <GridShell hint="Grid 1 — F1: Po / Item / Pur / Sale / Amount" editable={editable} busy={busy} onAddLine={onAddLine}>
      <table className="pb-lines-table pb-lines-table--grid1 pb-lines-table--full">
        <thead>
          <tr>
            <th>Sno</th>
            <th>PoNo</th>
            <th>Itemcode</th>
            <th>ItemName</th>
            <th>PurCode</th>
            <th>Name</th>
            <th>Salecode</th>
            <th>Name</th>
            <th>B/K/H</th>
            <th>Qty.</th>
            {!isBardana && showGwCols ? (
              <>
                <th>Gweight</th>
                <th>DaneWgt.</th>
              </>
            ) : null}
            <th>Weight</th>
            {!isBardana ? <th>StkWeight</th> : null}
            {!isBardana && showUsdCols ? (
              <>
                <th>UsdRate</th>
                <th>UsdAmount</th>
              </>
            ) : null}
            <th>Rate</th>
            <th title="Amount calc — W=Weight, Q=Qty">Amt_cal</th>
            <th>Amount</th>
            <th>Dis%</th>
            <th>DisAmt</th>
            {!isBardana ? (
              <>
                <th>Bard_Per</th>
                <th>Bard_Amt</th>
                <th>Lab_Per</th>
                <th>Lab_Amt</th>
                <th>Fgt_Amt</th>
                <th>Ins_amt</th>
                <th>Oth_amt</th>
              </>
            ) : null}
            <th>Cgst_per</th>
            <th>cgst_amt</th>
            <th>sgst_per</th>
            <th>sgst_amt</th>
            <th>igst_per</th>
            <th>igst_amt</th>
            {!isBardana ? (
              <>
                <th>Mlot_no</th>
                <th>Dane_rate</th>
                <th>Lot</th>
                <th>B_no</th>
                <th>Pmt_rate</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, idx) => (
            <tr key={ln.key}>
              <td className="pb-col-sno">{idx + 1}</td>
              <td>
                <GridCodeCell
                  className="form-input dc-line-so"
                  value={ln.so_no}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-po`, el)}
                  onChange={(e) => updateLine(ln.key, { so_no: e.target.value.replace(/\D/g, '') })}
                  onKeyDown={(e) => {
                    handleGridF1(e, 'po', ln.key);
                    if (!e.defaultPrevented) focusChain.onEnter(`ln-${ln.key}-po`)(e);
                  }}
                  onHelp={() => openGridHelp('po', ln.key)}
                  helpTitle="PO help (F1)"
                />
              </td>
              <td>
                <GridCodeCell
                  value={ln.item_code}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-item`, el)}
                  onChange={(e) => updateLine(ln.key, { item_code: e.target.value.replace(/\D/g, '') })}
                  onBlur={() => updateLine(ln.key, { item_code: ln.item_code })}
                  onKeyDown={(e) => {
                    handleGridF1(e, 'item', ln.key);
                    if (!e.defaultPrevented) focusChain.onEnter(`ln-${ln.key}-item`)(e);
                  }}
                  onHelp={() => openGridHelp('item', ln.key)}
                  helpTitle="Item help (F1)"
                />
              </td>
              <td className="pb-col-name">{ln.item_name}</td>
              <td>
                <GridCodeCell
                  value={ln.pur_code}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-pur`, el)}
                  onChange={(e) => updateLine(ln.key, { pur_code: e.target.value.toUpperCase() })}
                  onKeyDown={(e) => {
                    handleGridF1(e, 'pur', ln.key);
                    if (!e.defaultPrevented) focusChain.onEnter(`ln-${ln.key}-pur`)(e);
                  }}
                  onHelp={() => openGridHelp('pur', ln.key)}
                  helpTitle="Pur code help (F1)"
                />
              </td>
              <td className="pb-col-name">{ln.pur_name}</td>
              <td>
                <GridCodeCell
                  value={ln.s_code}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-sale`, el)}
                  onChange={(e) => updateLine(ln.key, { s_code: e.target.value.toUpperCase() })}
                  onKeyDown={(e) => {
                    handleGridF1(e, 'sale', ln.key);
                    if (!e.defaultPrevented) focusChain.onEnter(`ln-${ln.key}-sale`)(e);
                  }}
                  onHelp={() => openGridHelp('sale', ln.key)}
                  helpTitle="Sale code help (F1)"
                />
              </td>
              <td className="pb-col-name">{ln.s_name}</td>
              <td>
                <select
                  className="form-input"
                  value={ln.status}
                  disabled={!editable}
                  ref={(el) => focusChain.register(`ln-${ln.key}-status`, el)}
                  onChange={(e) => updateLine(ln.key, { status: e.target.value })}
                  onKeyDown={focusChain.onEnter(`ln-${ln.key}-status`)}
                >
                  {BKH_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <LnCell
                  className="form-input pb-qty-input"
                  value={ln.qnty}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-qty`, el)}
                  onChange={numInput((v) => updateLine(ln.key, { qnty: v }))}
                  onKeyDown={focusChain.onEnter(`ln-${ln.key}-qty`)}
                />
              </td>
              {!isBardana && showGwCols ? (
                <>
                  <td>
                    <LnCell
                      className="form-input pb-wgt-input"
                      value={ln.g_weight}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-gw`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { g_weight: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-gw`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-wgt-input"
                      value={ln.d_weight}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-dw`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { d_weight: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-dw`)}
                    />
                  </td>
                </>
              ) : null}
              <td>
                <LnCell
                  className="form-input pb-wgt-input"
                  value={ln.weight}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-wgt`, el)}
                  onChange={numInput((v) => updateLine(ln.key, { weight: v }))}
                  onKeyDown={focusChain.onEnter(`ln-${ln.key}-wgt`)}
                />
              </td>
              {!isBardana ? (
                <td>
                  <LnCell
                    className="form-input pb-wgt-input"
                    value={ln.stk_weight}
                    disabled={!editable}
                    focusRef={(el) => focusChain.register(`ln-${ln.key}-stk`, el)}
                    onChange={numInput((v) => updateLine(ln.key, { stk_weight: v }))}
                    onKeyDown={focusChain.onEnter(`ln-${ln.key}-stk`)}
                  />
                </td>
              ) : null}
              {!isBardana && showUsdCols ? (
                <>
                  <td>
                    <LnCell
                      className="form-input pb-rate-input"
                      value={ln.usd_rate}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-usd_rate`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { usd_rate: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-usd_rate`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-amt-input"
                      value={ln.usd_amount}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-usd_amt`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { usd_amount: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-usd_amt`)}
                    />
                  </td>
                </>
              ) : null}
              <td>
                <LnCell
                  className="form-input pb-rate-input"
                  value={ln.rate}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-rate`, el)}
                  onChange={numInput((v) => updateLine(ln.key, { rate: v }))}
                  onKeyDown={focusChain.onEnter(`ln-${ln.key}-rate`)}
                />
              </td>
              <td>
                <select
                  className="form-input pb-col-pct"
                  value={String(ln.amt_cal || 'W').toUpperCase() === 'Q' ? 'Q' : 'W'}
                  disabled={!editable}
                  title="W = Weight × Rate · Q = Qty × Rate"
                  ref={(el) => focusChain.register(`ln-${ln.key}-amt_cal`, el)}
                  onChange={(e) => updateLine(ln.key, { amt_cal: e.target.value })}
                  onKeyDown={focusChain.onEnter(`ln-${ln.key}-amt_cal`)}
                >
                  <option value="W">W</option>
                  <option value="Q">Q</option>
                </select>
              </td>
              <td>
                <LnCell
                  className="form-input pb-amt-input"
                  value={ln.amount}
                  disabled={!editable}
                  focusRef={(el) => focusChain.register(`ln-${ln.key}-amt`, el)}
                  onChange={numInput((v) => updateLine(ln.key, { amount: v }))}
                  onKeyDown={(e) => {
                    handleGridF1(e, 'amt', ln.key);
                    if (!e.defaultPrevented) focusChain.onEnter(`ln-${ln.key}-amt`)(e);
                  }}
                />
              </td>
              {pctAmt(ln, 'dis_per', 'dis_amt', 'dis')}
              {!isBardana ? (
                <>
                  {pctAmt(ln, 'bard_per', 'bard_amt', 'bard')}
                  {pctAmt(ln, 'lab_per', 'lab_amt', 'lab')}
                  <td>
                    <LnCell
                      className="form-input pb-col-taxamt"
                      value={ln.fgt_amt}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-fgt`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { fgt_amt: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-fgt`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-col-taxamt"
                      value={ln.ins_amt}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-ins`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { ins_amt: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-ins`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-col-taxamt"
                      value={ln.oth_amt}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-oth`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { oth_amt: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-oth`)}
                    />
                  </td>
                </>
              ) : null}
              {pctAmt(ln, 'cgst_per', 'cgst_amt', 'cgst')}
              {pctAmt(ln, 'sgst_per', 'sgst_amt', 'sgst')}
              {pctAmt(ln, 'igst_per', 'igst_amt', 'igst')}
              {!isBardana ? (
                <>
                  <td>
                    <LnCell
                      value={ln.mlot_no}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-mlot`, el)}
                      onChange={(e) => updateLine(ln.key, { mlot_no: e.target.value })}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-mlot`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-rate-input"
                      value={ln.dane_rate}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-dane`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { dane_rate: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-dane`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      value={ln.lot}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-lot`, el)}
                      onChange={(e) => updateLine(ln.key, { lot: e.target.value.replace(/\D/g, '') })}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-lot`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      value={ln.b_no}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-bno`, el)}
                      onChange={(e) => updateLine(ln.key, { b_no: e.target.value.replace(/\D/g, '') })}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-bno`)}
                    />
                  </td>
                  <td>
                    <LnCell
                      className="form-input pb-rate-input"
                      value={ln.pmt_rate}
                      disabled={!editable}
                      focusRef={(el) => focusChain.register(`ln-${ln.key}-pmt`, el)}
                      onChange={numInput((v) => updateLine(ln.key, { pmt_rate: v }))}
                      onKeyDown={focusChain.onEnter(`ln-${ln.key}-pmt`)}
                    />
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </GridShell>
  );
}

function BillExpensesTab(props) {
  return <PurchaseBillBillExpensesPanel {...props} />;
}

function ExpensesTab(props) {
  return <PurchaseBillExpensesFooter {...props} />;
}

export function PurchaseBillTabBar({ activeTab, onChange, tabs }) {
  const list = tabs || getPbTabList();
  return (
    <nav className="pb-tabs" role="tablist" aria-label="Purchase bill sections">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={activeTab === t.id}
          className={`pb-tabs__btn${activeTab === t.id ? ' pb-tabs__btn--active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export default function PurchaseBillTabContent(props) {
  const { activeTab } = props;
  switch (activeTab) {
    case PB_TAB.HEADER:
      return <HeaderTab {...props} />;
    case PB_TAB.GRID1:
      return <Grid1Tab {...props} />;
    case PB_TAB.GRID2:
      return <Grid2Tab {...props} />;
    case PB_TAB.BILL_EXP:
      return <BillExpensesTab {...props} />;
    case PB_TAB.EXPENSES:
      return <ExpensesTab {...props} />;
    default:
      return <HeaderTab {...props} />;
  }
}
