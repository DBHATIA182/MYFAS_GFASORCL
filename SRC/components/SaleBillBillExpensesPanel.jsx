import React from 'react';

function numInput(onChange) {
  return (e) => onChange(e.target.value.replace(/[^\d.-]/g, ''));
}

function HelpBtn({ onClick }) {
  return (
    <button type="button" className="pb-help-btn" onClick={onClick} title="F1 Help" tabIndex={-1}>
      ⌕
    </button>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`pb-bill-exp-field${className ? ` ${className}` : ''}`}>
      <span className="pb-bill-exp-field__label">{label}</span>
      <div className="pb-bill-exp-field__control">{children}</div>
    </label>
  );
}

function Inp({ value, disabled, onChange, onKeyDown, className = '', maxLength, inputRef, readOnly }) {
  return (
    <input
      ref={inputRef}
      className={`form-input pb-bill-exp-inp ${className}`.trim()}
      value={value ?? ''}
      disabled={disabled}
      readOnly={readOnly}
      maxLength={maxLength}
      onChange={onChange}
      onKeyDown={onKeyDown}
    />
  );
}

function CodeInp({ value, disabled, onChange, helpKey, focusKey, openHelp, focusChain, className = '' }) {
  return (
    <span className="pb-mock-inline">
      <Inp
        value={value}
        disabled={disabled}
        className={`pb-bill-exp-inp--code ${className}`.trim()}
        inputRef={(el) => focusChain?.register(focusKey, el)}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'F1' && helpKey) {
            e.preventDefault();
            openHelp?.(helpKey, focusKey);
            return;
          }
          if (focusKey) focusChain?.onEnter(focusKey)(e);
        }}
      />
      {helpKey ? <HelpBtn onClick={() => openHelp?.(helpKey, focusKey)} /> : null}
    </span>
  );
}

/**
 * Bill Expenses — VFP sale_gst left/middle footer strip:
 * Dane / S.D. codes, G.R./Transport/Truck, Tot.Wgt/Adv.Fgt/To Pay,
 * Ex.Lab Dr/Cr, Less Dane/Cd/Ch/QC/Brok, E-Way/IRN, Remarks.
 */
export default function SaleBillBillExpensesPanel({
  header,
  footer,
  totals,
  editable,
  setHeader,
  onFooter,
  openHelp,
  focusChain,
  fmtWgt,
}) {
  const enter = (key) => focusChain?.onEnter(key);
  const reg = (key) => (el) => focusChain?.register(key, el);
  const setH = (patch) => setHeader((h) => ({ ...h, ...patch }));
  const numFt = (field) => numInput((v) => onFooter(field, v));
  const codeFt = (field) => (e) => onFooter(field, e.target.value.toUpperCase());

  return (
    <div className="pb-tab-panel pb-tab-panel--bill-exp sb-bill-exp-panel">
      <div className="pb-bill-exp-grid sb-bill-exp-grid sb-bill-exp-grid--dense">
        {/* ── Left: VFP left column ── */}
        <section className="pb-bill-exp-col">
          <Field label="Dane Code">
            <CodeInp
              value={footer.dane_code}
              disabled={!editable}
              helpKey="exp-dane_code"
              focusKey="be-dane_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('dane_code')}
            />
          </Field>
          <Field label="S.D. Code.R 1">
            <CodeInp
              value={footer.p_code1}
              disabled={!editable}
              helpKey="exp-p_code1"
              focusKey="be-p_code1"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('p_code1')}
            />
            <Inp
              value={footer.p_amt1}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-p_amt1')}
              onChange={numFt('p_amt1')}
              onKeyDown={enter('be-p_amt1')}
            />
          </Field>
          <Field label="S.D. Code.R 2">
            <CodeInp
              value={footer.p_code2}
              disabled={!editable}
              helpKey="exp-p_code2"
              focusKey="be-p_code2"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('p_code2')}
            />
            <Inp
              value={footer.p_amt2}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-p_amt2')}
              onChange={numFt('p_amt2')}
              onKeyDown={enter('be-p_amt2')}
            />
          </Field>
          <Field label="S.D. Code.R 3">
            <CodeInp
              value={footer.p_code3}
              disabled={!editable}
              helpKey="exp-p_code3"
              focusKey="be-p_code3"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('p_code3')}
            />
            <Inp
              value={footer.p_amt3}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-p_amt3')}
              onChange={numFt('p_amt3')}
              onKeyDown={enter('be-p_amt3')}
            />
          </Field>
          <Field label="S.D. Code.W">
            <CodeInp
              value={footer.p_code5}
              disabled={!editable}
              helpKey="exp-p_code5"
              focusKey="be-p_code5"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('p_code5')}
            />
            <Inp
              value={footer.p_amt5}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-p_amt5')}
              onChange={numFt('p_amt5')}
              onKeyDown={enter('be-p_amt5')}
            />
          </Field>

          <Field label="G.R.No">
            <Inp
              value={header.gr_no}
              disabled={!editable}
              inputRef={reg('be-gr_no')}
              onChange={(e) => setH({ gr_no: e.target.value })}
              onKeyDown={enter('be-gr_no')}
            />
          </Field>
          <Field label="Form">
            <CodeInp
              value={header.form}
              disabled={!editable}
              helpKey="exp-form"
              focusKey="be-form"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={(e) => setH({ form: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Transport">
            <Inp
              value={header.tpt}
              disabled={!editable}
              inputRef={reg('be-tpt')}
              onChange={(e) => setH({ tpt: e.target.value })}
              onKeyDown={enter('be-tpt')}
            />
          </Field>
          <Field label="Truck">
            <Inp
              value={header.truck}
              disabled={!editable}
              inputRef={reg('be-truck')}
              onChange={(e) => setH({ truck: e.target.value })}
              onKeyDown={enter('be-truck')}
            />
          </Field>
          <Field label="(R)oad / (L)Rail">
            <Inp
              value={footer.rl_type}
              disabled={!editable}
              maxLength={1}
              className="pb-bill-exp-inp--qw"
              inputRef={reg('be-rl_type')}
              onChange={(e) => onFooter('rl_type', e.target.value.toUpperCase().replace(/[^RL]/g, '').slice(0, 1))}
              onKeyDown={enter('be-rl_type')}
            />
          </Field>
          <Field label="Remarks" className="sb-bill-exp-field--wide">
            <Inp
              value={header.remarks}
              disabled={!editable}
              className="pb-bill-exp-inp--wide"
              inputRef={reg('be-remarks')}
              onChange={(e) => setH({ remarks: e.target.value })}
              onKeyDown={enter('be-remarks')}
            />
          </Field>
          <Field label="Tot.Wgt.">
            <Inp
              value={footer.tot_wgt || (totals?.weight != null ? fmtWgt?.(totals.weight) : '')}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-tot_wgt')}
              onChange={numFt('tot_wgt')}
              onKeyDown={enter('be-tot_wgt')}
            />
          </Field>
          <Field label="Freight (Tpt)">
            <Inp
              value={footer.tot_fgt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-tot_fgt')}
              onChange={numFt('tot_fgt')}
              onKeyDown={enter('be-tot_fgt')}
            />
          </Field>
          <Field label="Adv.Fgt.">
            <Inp
              value={footer.adv_fgt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-adv_fgt')}
              onChange={numFt('adv_fgt')}
              onKeyDown={enter('be-adv_fgt')}
            />
          </Field>
          <Field label="To Pay">
            <Inp
              value={footer.to_pay}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-to_pay')}
              onChange={numFt('to_pay')}
              onKeyDown={enter('be-to_pay')}
            />
          </Field>
        </section>

        {/* ── Middle: Ex.Lab + Less deductions ── */}
        <section className="pb-bill-exp-col">
          <Field label="Ex.Lab. Rate">
            <Inp
              value={footer.e_lab_rate}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-e_lab_rate')}
              onChange={numFt('e_lab_rate')}
              onKeyDown={enter('be-e_lab_rate')}
            />
            <Inp
              value={footer.e_lab_cal}
              disabled={!editable}
              maxLength={1}
              className="pb-bill-exp-inp--qw"
              inputRef={reg('be-e_lab_cal')}
              onChange={(e) => onFooter('e_lab_cal', e.target.value.toUpperCase().replace(/[^QWA]/g, '').slice(0, 1))}
              onKeyDown={enter('be-e_lab_cal')}
              title="Q/W/A"
            />
            <Inp
              value={footer.e_lab_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-e_lab_amt')}
              onChange={numFt('e_lab_amt')}
              onKeyDown={enter('be-e_lab_amt')}
            />
          </Field>
          <Field label="Ex.Lab Dr.Code">
            <CodeInp
              value={footer.l_d_code}
              disabled={!editable}
              helpKey="exp-l_d_code"
              focusKey="be-l_d_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_d_code')}
            />
          </Field>
          <Field label="Ex.Lab Cr.Code">
            <CodeInp
              value={footer.l_c_code}
              disabled={!editable}
              helpKey="exp-l_c_code"
              focusKey="be-l_c_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_c_code')}
            />
          </Field>

          <Field label="L.Dane">
            <Inp
              value={footer.l_dane}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-l_dane')}
              onChange={numFt('l_dane')}
              onKeyDown={enter('be-l_dane')}
            />
            <CodeInp
              value={footer.l_dane_code}
              disabled={!editable}
              helpKey="exp-l_dane_code"
              focusKey="be-l_dane_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_dane_code')}
            />
            <Inp
              value={footer.l_dane_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-l_dane_amt')}
              onChange={numFt('l_dane_amt')}
              onKeyDown={enter('be-l_dane_amt')}
            />
          </Field>
          <Field label="L.Dane Wgt">
            <Inp
              value={footer.l_dane_wgt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-l_dane_wgt')}
              onChange={numFt('l_dane_wgt')}
              onKeyDown={enter('be-l_dane_wgt')}
            />
          </Field>
          <Field label="L.Cd">
            <Inp
              value={footer.l_cd_per}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-l_cd_per')}
              onChange={numFt('l_cd_per')}
              onKeyDown={enter('be-l_cd_per')}
            />
            <CodeInp
              value={footer.l_cd_code}
              disabled={!editable}
              helpKey="exp-l_cd_code"
              focusKey="be-l_cd_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_cd_code')}
            />
            <Inp
              value={footer.l_cd_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-l_cd_amt')}
              onChange={numFt('l_cd_amt')}
              onKeyDown={enter('be-l_cd_amt')}
            />
          </Field>
          <Field label="L.Ch">
            <Inp
              value={footer.l_ch_per}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-l_ch_per')}
              onChange={numFt('l_ch_per')}
              onKeyDown={enter('be-l_ch_per')}
            />
            <CodeInp
              value={footer.l_ch_code}
              disabled={!editable}
              helpKey="exp-l_ch_code"
              focusKey="be-l_ch_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_ch_code')}
            />
            <Inp
              value={footer.l_ch_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-l_ch_amt')}
              onChange={numFt('l_ch_amt')}
              onKeyDown={enter('be-l_ch_amt')}
            />
          </Field>
          <Field label="QC">
            <Inp
              value={footer.l_qc_per}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-l_qc_per')}
              onChange={numFt('l_qc_per')}
              onKeyDown={enter('be-l_qc_per')}
            />
            <CodeInp
              value={footer.l_qc_code}
              disabled={!editable}
              helpKey="exp-l_qc_code"
              focusKey="be-l_qc_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('l_qc_code')}
            />
            <Inp
              value={footer.l_qc_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-l_qc_amt')}
              onChange={numFt('l_qc_amt')}
              onKeyDown={enter('be-l_qc_amt')}
            />
          </Field>
          <Field label="L.Brok">
            <Inp
              value={footer.ld_per}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-ld_per')}
              onChange={numFt('ld_per')}
              onKeyDown={enter('be-ld_per')}
            />
            <CodeInp
              value={footer.ld_code}
              disabled={!editable}
              helpKey="exp-ld_code"
              focusKey="be-ld_code"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('ld_code')}
            />
            <Inp
              value={footer.ld_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-ld_amt')}
              onChange={numFt('ld_amt')}
              onKeyDown={enter('be-ld_amt')}
            />
          </Field>
          <Field label="SaleMan">
            <CodeInp
              value={footer.saleman}
              disabled={!editable}
              helpKey="exp-saleman"
              focusKey="be-saleman"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('saleman')}
            />
          </Field>
          <Field label="Disp.From">
            <CodeInp
              value={footer.disp_from}
              disabled={!editable}
              helpKey="exp-disp_from"
              focusKey="be-disp_from"
              openHelp={openHelp}
              focusChain={focusChain}
              onChange={codeFt('disp_from')}
            />
          </Field>
        </section>

        {/* ── Right: E-Way / IRN ── */}
        <section className="pb-bill-exp-col">
          <Field label="IRN No.">
            <Inp
              value={footer.irn_no}
              disabled={!editable}
              className="pb-bill-exp-inp--wide"
              inputRef={reg('be-irn_no')}
              onChange={(e) => onFooter('irn_no', e.target.value)}
              onKeyDown={enter('be-irn_no')}
            />
          </Field>
          <Field label="ACK No.">
            <Inp
              value={footer.ack_no}
              disabled={!editable}
              className="pb-bill-exp-inp--wide"
              inputRef={reg('be-ack_no')}
              onChange={(e) => onFooter('ack_no', e.target.value)}
              onKeyDown={enter('be-ack_no')}
            />
          </Field>
          <Field label="Eway Bill No.">
            <Inp
              value={footer.eway_bill_no}
              disabled={!editable}
              inputRef={reg('be-eway_bill_no')}
              onChange={(e) => onFooter('eway_bill_no', e.target.value)}
              onKeyDown={enter('be-eway_bill_no')}
            />
          </Field>
          <Field label="Eway Date">
            <Inp
              value={footer.eway_date}
              disabled={!editable}
              inputRef={reg('be-eway_date')}
              onChange={(e) => onFooter('eway_date', e.target.value)}
              onKeyDown={enter('be-eway_date')}
              placeholder="DD-MM-YYYY"
            />
          </Field>
          <Field label="Eway Valid">
            <Inp
              value={footer.eway_valid}
              disabled={!editable}
              inputRef={reg('be-eway_valid')}
              onChange={(e) => onFooter('eway_valid', e.target.value)}
              onKeyDown={enter('be-eway_valid')}
              placeholder="DD-MM-YYYY"
            />
          </Field>
          <Field label="Qr Code">
            <Inp
              value={footer.qr_code}
              disabled={!editable}
              className="pb-bill-exp-inp--wide"
              inputRef={reg('be-qr_code')}
              onChange={(e) => onFooter('qr_code', e.target.value)}
              onKeyDown={enter('be-qr_code')}
            />
          </Field>
          <Field label="Reason">
            <Inp
              value={footer.eway_reason}
              disabled={!editable}
              className="pb-bill-exp-inp--wide"
              inputRef={reg('be-eway_reason')}
              onChange={(e) => onFooter('eway_reason', e.target.value)}
              onKeyDown={enter('be-eway_reason')}
            />
          </Field>
          <Field label="Eway Close">
            <Inp
              value={footer.eway_close}
              disabled={!editable}
              maxLength={1}
              className="pb-bill-exp-inp--qw"
              inputRef={reg('be-eway_close')}
              onChange={(e) => onFooter('eway_close', e.target.value.toUpperCase().slice(0, 1))}
              onKeyDown={enter('be-eway_close')}
            />
          </Field>
        </section>
      </div>
    </div>
  );
}
