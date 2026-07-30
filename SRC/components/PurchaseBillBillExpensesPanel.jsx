import React from 'react';

function numInput(onChange) {
  return (e) => onChange(e.target.value.replace(/[^\d.-]/g, ''));
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function HelpBtn({ onClick }) {
  return (
    <button type="button" className="pb-help-btn" onClick={onClick} title="F1 Help" tabIndex={-1}>
      ⌕
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="pb-bill-exp-field">
      <span className="pb-bill-exp-field__label">{label}</span>
      <div className="pb-bill-exp-field__control">{children}</div>
    </label>
  );
}

function Inp({ value, disabled, onChange, onKeyDown, className = '', readOnly, inputRef, maxLength }) {
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

function CodeInp({
  value,
  disabled,
  onChange,
  onKeyDown,
  helpKey,
  focusKey,
  openHelp,
  setHelpField,
  focusChain,
}) {
  const open = () => {
    if (openHelp) openHelp(helpKey, focusKey);
    else setHelpField?.(helpKey);
  };
  return (
    <span className="pb-mock-inline">
      <Inp
        value={value}
        disabled={disabled}
        className="pb-bill-exp-inp--code"
        inputRef={(el) => focusChain?.register(focusKey, el)}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'F1' && helpKey) {
            e.preventDefault();
            open();
            return;
          }
          if (onKeyDown) onKeyDown(e);
          else if (focusKey) focusChain?.onEnter(focusKey)(e);
        }}
      />
      {helpKey ? <HelpBtn onClick={open} /> : null}
    </span>
  );
}

function PctAmt({ label, perKey, amtKey, footer, editable, onFooter, focusChain }) {
  return (
    <Field label={label}>
      <Inp
        value={footer[perKey]}
        disabled={!editable}
        className="pb-bill-exp-inp--pct"
        inputRef={(el) => focusChain?.register(`be-${perKey}`, el)}
        onChange={numInput((v) => onFooter(perKey, v))}
        onKeyDown={focusChain?.onEnter(`be-${perKey}`)}
      />
      <Inp
        value={footer[amtKey]}
        disabled={!editable}
        className="pb-bill-exp-inp--amt"
        inputRef={(el) => focusChain?.register(`be-${amtKey}`, el)}
        onChange={numInput((v) => onFooter(amtKey, v))}
        onKeyDown={focusChain?.onEnter(`be-${amtKey}`)}
      />
    </Field>
  );
}

/** Logistics, TDS, brokerage, document fields (user notepad — separate from header). */
export default function PurchaseBillBillExpensesPanel({
  header,
  footer,
  totals,
  editable,
  setHeader,
  onFooter,
  setHelpField,
  openHelp,
  setCostHelpOpen,
  focusChain,
  fmtAmt,
  isBardana = false,
  onPickScanFile,
  scanBusy = false,
}) {
  const totTds = footer.tot_tds || num(footer.tds_amt) + num(footer.sur_amt) + num(footer.edu_amt);
  const enter = (key) => focusChain?.onEnter(key);
  const reg = (key) => (el) => focusChain?.register(key, el);
  const openCost = () => {
    if (typeof setCostHelpOpen === 'function') setCostHelpOpen(true);
  };

  if (isBardana) {
    return (
      <div className="pb-tab-panel pb-tab-panel--bill-exp">
        <div className="pb-bill-exp-grid pb-bill-exp-grid--bardana">
          <section className="pb-bill-exp-col">
            <Field label="Gr.No">
              <Inp
                value={header.gr_no}
                disabled={!editable}
                inputRef={reg('be-gr_no')}
                onChange={(e) => setHeader((h) => ({ ...h, gr_no: e.target.value }))}
                onKeyDown={enter('be-gr_no')}
              />
            </Field>
            <Field label="Transport">
              <Inp
                value={header.tpt}
                disabled={!editable}
                inputRef={reg('be-tpt')}
                onChange={(e) => setHeader((h) => ({ ...h, tpt: e.target.value }))}
                onKeyDown={enter('be-tpt')}
              />
            </Field>
            <Field label="Truck No">
              <Inp
                value={header.truck}
                disabled={!editable}
                inputRef={reg('be-truck')}
                onChange={(e) => setHeader((h) => ({ ...h, truck: e.target.value }))}
                onKeyDown={enter('be-truck')}
              />
            </Field>
            <Field label="Remarks">
              <Inp
                value={header.remarks}
                disabled={!editable}
                inputRef={reg('be-remarks')}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                onKeyDown={enter('be-remarks')}
              />
            </Field>
            <Field label="Scan Bill Path">
              <span className="pb-scan-path-wrap">
                <Inp
                  value={footer.p_bill_no_file_path}
                  disabled={!editable}
                  inputRef={reg('be-p_bill_no_file_path')}
                  onChange={(e) => {
                    let p = String(e.target.value || '').replace(/\//g, '\\');
                    p = p.replace(/^[A-Za-z]:/, '');
                    if (p && !p.startsWith('\\')) p = `\\${p}`;
                    onFooter('p_bill_no_file_path', p);
                  }}
                  onKeyDown={enter('be-p_bill_no_file_path')}
                />
                <input
                  type="file"
                  className="pb-scan-file-input"
                  tabIndex={-1}
                  disabled={!editable}
                  accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.bmp,.gif,.webp,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file && typeof onPickScanFile === 'function') onPickScanFile(file);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-xs pb-scan-browse-btn"
                  disabled={!editable || scanBusy}
                  tabIndex={-1}
                  onClick={(e) => {
                    const input = e.currentTarget.parentElement?.querySelector('input[type="file"]');
                    input?.click();
                  }}
                >
                  {scanBusy ? '…' : 'Browse'}
                </button>
              </span>
            </Field>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-tab-panel pb-tab-panel--bill-exp">
      <div className="pb-bill-exp-grid">
        <section className="pb-bill-exp-col">
          <Field label="Gr.No">
            <Inp
              value={header.gr_no}
              disabled={!editable}
              inputRef={reg('be-gr_no')}
              onChange={(e) => setHeader((h) => ({ ...h, gr_no: e.target.value }))}
              onKeyDown={enter('be-gr_no')}
            />
          </Field>
          <Field label="Transport">
            <Inp
              value={header.tpt}
              disabled={!editable}
              inputRef={reg('be-tpt')}
              onChange={(e) => setHeader((h) => ({ ...h, tpt: e.target.value }))}
              onKeyDown={enter('be-tpt')}
            />
          </Field>
          <Field label="Truck No">
            <Inp
              value={header.truck}
              disabled={!editable}
              inputRef={reg('be-truck')}
              onChange={(e) => setHeader((h) => ({ ...h, truck: e.target.value }))}
              onKeyDown={enter('be-truck')}
            />
          </Field>
          <Field label="Form">
            <CodeInp
              value={header.form}
              disabled={!editable}
              helpKey="exp-form"
              focusKey="be-form"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => setHeader((h) => ({ ...h, form: e.target.value }))}
            />
          </Field>
          <Field label="Freight">
            <Inp
              value={footer.freight_hdr}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-freight_hdr')}
              onChange={numInput((v) => onFooter('freight_hdr', v))}
              onKeyDown={enter('be-freight_hdr')}
            />
          </Field>
          <Field label="Fgt Debit A/c">
            <CodeInp
              value={footer.f_dr_code}
              disabled={!editable}
              helpKey="exp-f_dr_code"
              focusKey="be-f_dr_code"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('f_dr_code', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Fgt Credit A/c">
            <CodeInp
              value={footer.f_cr_code}
              disabled={!editable}
              helpKey="exp-f_cr_code"
              focusKey="be-f_cr_code"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('f_cr_code', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Labour">
            <Inp
              value={footer.labour || footer.lab_rate_hdr}
              disabled={!editable}
              inputRef={reg('be-labour')}
              onChange={numInput((v) => onFooter('labour', v))}
              onKeyDown={enter('be-labour')}
            />
          </Field>
          <Field label="Labour Debit A/c">
            <CodeInp
              value={footer.l_d_code}
              disabled={!editable}
              helpKey="exp-l_d_code"
              focusKey="be-l_d_code"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('l_d_code', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Labour Credit A/c">
            <CodeInp
              value={footer.l_c_code}
              disabled={!editable}
              helpKey="exp-l_c_code"
              focusKey="be-l_c_code"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('l_c_code', e.target.value.toUpperCase())}
            />
          </Field>
        </section>

        <section className="pb-bill-exp-col">
          <Field label="Total Comm">
            <Inp
              value={footer.tds_comm}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-tds_comm')}
              onChange={numInput((v) => onFooter('tds_comm', v))}
              onKeyDown={enter('be-tds_comm')}
            />
          </Field>
          <PctAmt
            label="Tds %"
            perKey="tds_per"
            amtKey="tds_amt"
            footer={footer}
            editable={editable}
            onFooter={onFooter}
            focusChain={focusChain}
          />
          <PctAmt
            label="Sur %"
            perKey="sur_per"
            amtKey="sur_amt"
            footer={footer}
            editable={editable}
            onFooter={onFooter}
            focusChain={focusChain}
          />
          <PctAmt
            label="Edu %"
            perKey="edu_per"
            amtKey="edu_amt"
            footer={footer}
            editable={editable}
            onFooter={onFooter}
            focusChain={focusChain}
          />
          <Field label="Total Tds">
            <Inp value={fmtAmt(totTds)} readOnly className="pb-bill-exp-inp--amt" />
          </Field>
          <Field label="Tds Code">
            <CodeInp
              value={footer.tds_code}
              disabled={!editable}
              helpKey="exp-tds_code"
              focusKey="be-tds_code"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('tds_code', e.target.value.toUpperCase())}
            />
          </Field>
        </section>

        <section className="pb-bill-exp-col">
          <Field label="Brok Rate / Cal / Amt">
            <Inp
              value={footer.brok_rate}
              disabled={!editable}
              className="pb-bill-exp-inp--pct"
              inputRef={reg('be-brok_rate')}
              onChange={numInput((v) => onFooter('brok_rate', v))}
              onKeyDown={enter('be-brok_rate')}
            />
            <Inp
              value={footer.brok_cal}
              disabled={!editable}
              className="pb-bill-exp-inp--qw"
              placeholder="Q/W"
              maxLength={1}
              inputRef={reg('be-brok_cal')}
              onChange={(e) => onFooter('brok_cal', e.target.value.toUpperCase().slice(0, 1))}
              onKeyDown={enter('be-brok_cal')}
            />
            <Inp
              value={footer.brok_amt}
              disabled={!editable}
              className="pb-bill-exp-inp--amt"
              inputRef={reg('be-brok_amt')}
              onChange={numInput((v) => onFooter('brok_amt', v))}
              onKeyDown={enter('be-brok_amt')}
            />
          </Field>
          <Field label="Brok Debit Code">
            <CodeInp
              value={footer.brok_d_cd}
              disabled={!editable}
              helpKey="exp-brok_d_cd"
              focusKey="be-brok_d_cd"
              openHelp={openHelp}
              setHelpField={setHelpField}
              focusChain={focusChain}
              onChange={(e) => onFooter('brok_d_cd', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Cost Code">
            <span className="pb-mock-inline">
              <Inp
                value={header.cost_code}
                disabled={!editable}
                className="pb-bill-exp-inp--code"
                inputRef={reg('be-cost_code')}
                onChange={(e) => setHeader((h) => ({ ...h, cost_code: e.target.value.toUpperCase() }))}
                onKeyDown={(e) => {
                  if (e.key === 'F1') {
                    e.preventDefault();
                    openCost();
                    return;
                  }
                  enter('be-cost_code')?.(e);
                }}
              />
              <HelpBtn onClick={openCost} />
            </span>
          </Field>
          <Field label="Stock Y/N">
            <Inp
              value={header.stk}
              disabled={!editable}
              className="pb-bill-exp-inp--qw"
              maxLength={1}
              inputRef={reg('be-stk')}
              onChange={(e) => setHeader((h) => ({ ...h, stk: e.target.value.toUpperCase().slice(0, 1) }))}
              onKeyDown={enter('be-stk')}
            />
          </Field>
          <Field label="ExpCat">
            <Inp
              value={footer.exp_cat}
              disabled={!editable}
              inputRef={reg('be-exp_cat')}
              onChange={(e) => onFooter('exp_cat', e.target.value)}
              onKeyDown={enter('be-exp_cat')}
            />
          </Field>
          <Field label="Dane Amount">
            <Inp value={fmtAmt(totals.dane_amt)} readOnly className="pb-bill-exp-inp--amt" />
          </Field>
        </section>
      </div>

      <div className="pb-bill-exp-bottom">
        <Field label="Bl.No.">
          <Inp
            value={footer.bl_no}
            disabled={!editable}
            inputRef={reg('be-bl_no')}
            onChange={(e) => onFooter('bl_no', e.target.value)}
            onKeyDown={enter('be-bl_no')}
          />
        </Field>
        <Field label="Job No.">
          <Inp
            value={footer.job_no}
            disabled={!editable}
            inputRef={reg('be-job_no')}
            onChange={(e) => onFooter('job_no', e.target.value)}
            onKeyDown={enter('be-job_no')}
          />
        </Field>
        <Field label="File No.">
          <Inp
            value={footer.file_no}
            disabled={!editable}
            inputRef={reg('be-file_no')}
            onChange={(e) => onFooter('file_no', e.target.value)}
            onKeyDown={enter('be-file_no')}
          />
        </Field>
        <Field label="Bank Ref.No.">
          <Inp
            value={footer.bref_no}
            disabled={!editable}
            inputRef={reg('be-bref_no')}
            onChange={(e) => onFooter('bref_no', e.target.value)}
            onKeyDown={enter('be-bref_no')}
          />
        </Field>
        <Field label="Remarks">
          <Inp
            value={header.remarks}
            disabled={!editable}
            inputRef={reg('be-remarks')}
            onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
            onKeyDown={enter('be-remarks')}
          />
        </Field>
        <Field label="Form Amount">
          <Inp
            value={footer.cform_amt}
            disabled={!editable}
            className="pb-bill-exp-inp--amt"
            inputRef={reg('be-cform_amt')}
            onChange={numInput((v) => onFooter('cform_amt', v))}
            onKeyDown={enter('be-cform_amt')}
          />
        </Field>
        <Field label="Upload Bill">
          <span className="pb-scan-path-wrap">
            <Inp
              value={footer.p_bill_no_file_path}
              disabled={!editable}
              inputRef={reg('be-p_bill_no_file_path')}
              onChange={(e) => {
                let p = String(e.target.value || '').replace(/\//g, '\\');
                p = p.replace(/^[A-Za-z]:/, '');
                if (p && !p.startsWith('\\')) p = `\\${p}`;
                onFooter('p_bill_no_file_path', p);
              }}
              onKeyDown={enter('be-p_bill_no_file_path')}
            />
            <input
              type="file"
              className="pb-scan-file-input"
              tabIndex={-1}
              disabled={!editable}
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.bmp,.gif,.webp,.doc,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file && typeof onPickScanFile === 'function') onPickScanFile(file);
              }}
            />
            <button
              type="button"
              className="btn btn-xs pb-scan-browse-btn"
              disabled={!editable || scanBusy}
              tabIndex={-1}
              onClick={(e) => {
                const input = e.currentTarget.parentElement?.querySelector('input[type="file"]');
                input?.click();
              }}
            >
              {scanBusy ? '…' : 'Browse'}
            </button>
          </span>
        </Field>
      </div>
    </div>
  );
}
