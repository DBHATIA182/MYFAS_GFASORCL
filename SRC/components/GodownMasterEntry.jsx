import React, { useMemo } from 'react';
import MasterPartyPickList from './MasterPartyPickList';
import { capsTyping, stateCodesMatch } from '../utils/godownMasterUtils';

function Section({ icon, title, children }) {
  return (
    <section className="godown-entry__section">
      <h4 className="godown-entry__section-title">
        <span className="godown-entry__section-icon" aria-hidden>
          {icon}
        </span>
        {title}
      </h4>
      <div className="godown-entry__section-body">{children}</div>
    </section>
  );
}

function Field({ label, className = '', children }) {
  return (
    <label className={['godown-entry__field', className].filter(Boolean).join(' ')}>
      <span className="godown-entry__label">{label}</span>
      {children}
    </label>
  );
}

/**
 * Sectioned godown entry form (master-detail right panel).
 * mode: view | edit | new
 */
export default function GodownMasterEntry({
  mode = 'view',
  form,
  setForm,
  states = [],
  godownOptions = [],
  formRef,
  onKeyDownCapture,
  codeInputRef,
}) {
  const readOnly = mode === 'view';
  const codeLocked = mode === 'view' || mode === 'edit';
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const mainGodownOptions = useMemo(
    () =>
      godownOptions
        .filter((g) => String(g.GOD_CODE) !== String(form.GOD_CODE))
        .map((g) => ({
          value: String(g.GOD_CODE ?? '').trim(),
          label: `${g.GOD_CODE ?? ''} — ${g.GOD_NAME ?? ''}`.trim(),
          CODE: g.GOD_CODE,
          NAME: g.GOD_NAME,
        })),
    [godownOptions, form.GOD_CODE]
  );

  const inputCls = 'form-input godown-entry__input';

  return (
    <form
      ref={formRef}
      className="godown-entry"
      onSubmit={(e) => e.preventDefault()}
      onKeyDownCapture={onKeyDownCapture}
    >
      <Section icon="◇" title="Basic Information">
        <div className="godown-entry__row godown-entry__row--code-name">
          <Field label="God. Code" className="godown-entry__field--code">
            <input
              ref={codeInputRef}
              className={`${inputCls} godown-entry__input--code`}
              value={form.GOD_CODE}
              readOnly={codeLocked}
              disabled={codeLocked}
              maxLength={6}
              onChange={(e) => setField('GOD_CODE', capsTyping(e.target.value, 6))}
            />
          </Field>
          <Field label="God. Name" className="godown-entry__field--grow">
            <input
              className={inputCls}
              value={form.GOD_NAME}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={80}
              onChange={(e) => setField('GOD_NAME', capsTyping(e.target.value, 80))}
            />
          </Field>
        </div>
        <Field label="Company Name" className="godown-entry__field--full">
          <input
            className={inputCls}
            value={form.GOD_NAME1}
            readOnly={readOnly}
            disabled={readOnly}
            maxLength={80}
            onChange={(e) => setField('GOD_NAME1', capsTyping(e.target.value, 80))}
          />
        </Field>
        <Field label="Address Line 1" className="godown-entry__field--full">
          <input
            className={inputCls}
            value={form.GOD_ADD1}
            readOnly={readOnly}
            disabled={readOnly}
            maxLength={80}
            onChange={(e) => setField('GOD_ADD1', capsTyping(e.target.value, 80))}
          />
        </Field>
        <Field label="Address Line 2" className="godown-entry__field--full">
          <input
            className={inputCls}
            value={form.GOD_ADD2}
            readOnly={readOnly}
            disabled={readOnly}
            maxLength={80}
            onChange={(e) => setField('GOD_ADD2', capsTyping(e.target.value, 80))}
          />
        </Field>
        <div className="godown-entry__row godown-entry__row--loc-pin">
          <Field label="Location / City" className="godown-entry__field--grow">
            <input
              className={inputCls}
              value={form.GOD_LOCATION}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={40}
              onChange={(e) => setField('GOD_LOCATION', capsTyping(e.target.value, 40))}
            />
          </Field>
          <Field label="Pin Code" className="godown-entry__field--pin">
            <input
              className={`${inputCls} godown-entry__input--pin`}
              value={form.GOD_PIN_CODE}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={10}
              inputMode="numeric"
              onChange={(e) =>
                setField('GOD_PIN_CODE', e.target.value.replace(/\D/g, '').slice(0, 10))
              }
            />
          </Field>
        </div>
        <div className="godown-entry__row godown-entry__row--state">
          <Field label="State Code" className="godown-entry__field--stcd">
            <div className="godown-entry__state-code-wrap">
              {states.length && !readOnly ? (
                <MasterPartyPickList
                  options={states}
                  value={form.GOD_STATE_CODE}
                  disabled={readOnly}
                  onChange={(code) => {
                    const c = String(code ?? '')
                      .trim()
                      .slice(0, 2);
                    const hit = states.find((s) => stateCodesMatch(s.STATE_CODE ?? s.state_code, c));
                    setForm((prev) => ({
                      ...prev,
                      GOD_STATE_CODE: c,
                      GOD_STATE: hit ? String(hit.STATE ?? hit.state ?? '').trim() : prev.GOD_STATE,
                    }));
                  }}
                  title="State"
                  placeholder="Cd"
                  filterPlaceholder="State code or name…"
                  showSearchIcon
                  getValue={(o) => String(o.STATE_CODE ?? o.state_code ?? '').trim()}
                  getLabel={(o) => `${o.STATE_CODE ?? o.state_code ?? ''} — ${o.STATE ?? o.state ?? ''}`}
                  getTriggerLabel={(o) => String(o.STATE_CODE ?? o.state_code ?? form.GOD_STATE_CODE)}
                />
              ) : (
                <input
                  className={`${inputCls} godown-entry__input--stcd`}
                  value={form.GOD_STATE_CODE}
                  readOnly={readOnly}
                  disabled={readOnly}
                  maxLength={2}
                  inputMode="numeric"
                  onChange={(e) =>
                    setField('GOD_STATE_CODE', e.target.value.replace(/\D/g, '').slice(0, 2))
                  }
                />
              )}
            </div>
          </Field>
          <Field label="State Name" className="godown-entry__field--grow">
            <input
              className={inputCls}
              value={form.GOD_STATE}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={40}
              placeholder="State name"
              onChange={(e) => setField('GOD_STATE', capsTyping(e.target.value, 40))}
            />
          </Field>
        </div>
      </Section>

      <Section icon="◇" title="Tax & Compliance">
        <div className="godown-entry__row godown-entry__row--gst-fssai">
          <Field label="Gst No." className="godown-entry__field--grow">
            <input
              className={inputCls}
              value={form.GOD_GST_NO}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={20}
              onChange={(e) => setField('GOD_GST_NO', capsTyping(e.target.value, 20))}
            />
          </Field>
          <Field label="Fssai No." className="godown-entry__field--fssai">
            <input
              className={inputCls}
              value={form.GOD_FSSAI_NO}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={20}
              onChange={(e) => setField('GOD_FSSAI_NO', capsTyping(e.target.value, 20))}
            />
          </Field>
        </div>
      </Section>

      <Section icon="◇" title="Contact">
        <div className="godown-entry__row godown-entry__row--tel">
          <Field label="Tel. No. 1" className="godown-entry__field--half">
            <input
              className={inputCls}
              value={form.GOD_TEL_NO_1}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={20}
              onChange={(e) => setField('GOD_TEL_NO_1', e.target.value)}
            />
          </Field>
          <Field label="Tel. No. 2" className="godown-entry__field--half">
            <input
              className={inputCls}
              value={form.GOD_TEL_NO_2}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={20}
              onChange={(e) => setField('GOD_TEL_NO_2', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section icon="◇" title="Settings">
        <div className="godown-entry__row godown-entry__row--settings">
          <Field label="Sale Bill Type" className="godown-entry__field--btype">
            <input
              className={`${inputCls} godown-entry__input--btype`}
              value={form.GOD_B_TYPE}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={1}
              onChange={(e) => setField('GOD_B_TYPE', capsTyping(e.target.value, 1) || 'N')}
            />
          </Field>
          <Field label="Main Godown" className="godown-entry__field--grow">
            {readOnly ? (
              <input className={inputCls} value={form.GOD_CODE_MAIN} readOnly disabled />
            ) : (
              <MasterPartyPickList
                options={mainGodownOptions}
                value={form.GOD_CODE_MAIN}
                onChange={(v) => setField('GOD_CODE_MAIN', capsTyping(v, 6))}
                title="Main godown"
                placeholder="Code"
                filterPlaceholder="Godown code or name…"
                showSearchIcon
                getValue={(o) => String(o.value ?? o.CODE ?? '').trim()}
                getLabel={(o) => o.label || ''}
                getTriggerLabel={(o) => String(o.value ?? o.CODE ?? form.GOD_CODE_MAIN)}
              />
            )}
          </Field>
        </div>
      </Section>
    </form>
  );
}
