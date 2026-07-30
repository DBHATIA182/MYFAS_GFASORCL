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

/** VFP sale_gst OTH_EXP1–10 + OTH_CD1–10 (SALEFORM_GST S_NO=0). */
export default function SaleBillOthExpensesPanel({
  footer,
  editable,
  onFooter,
  openHelp,
  focusChain,
  visibleOthExp = null,
}) {
  const panelRef = useRef(null);
  useEffect(() => {
    panelRef.current?.scrollTo(0, 0);
  }, []);

  const rows = useMemo(() => {
    const all = [];
    for (let i = 1; i <= 10; i += 1) {
      if (Array.isArray(visibleOthExp) && !visibleOthExp.includes(i)) continue;
      all.push({
        n: i,
        label: `Others ${i}`,
        codeField: `oth_cd${i}`,
        amtField: `oth_exp${i}`,
      });
    }
    return all;
  }, [visibleOthExp]);

  return (
    <div ref={panelRef} className="pb-tab-panel pb-tab-panel--exp-footer">
      <p className="pb-lines-hint sb-exp-hint">Other expenses — OTH_EXP1…OTH_EXP10 / OTH_CD1…OTH_CD10 (VFP sale_gst)</p>
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
            <th className="pb-exp-ft-th-pct">&nbsp;</th>
            <th className="pb-exp-ft-th-code">Code</th>
            <th className="pb-exp-ft-th-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const codeFocusKey = `oe-${r.codeField}`;
            const amtFocusKey = `oe-${r.amtField}`;
            return (
              <tr key={r.n} className="pb-exp-ft-row">
                <td className="pb-exp-ft-row__label">{r.label}</td>
                <td className="pb-exp-ft-row__pct" />
                <td className="pb-exp-ft-row__code">
                  <span className="pb-exp-ft-code-wrap">
                    <input
                      className="form-input pb-exp-ft-inp pb-exp-ft-inp--code"
                      value={footer[r.codeField] ?? ''}
                      disabled={!editable}
                      ref={(el) => focusChain?.register(codeFocusKey, el)}
                      onChange={(e) => onFooter(r.codeField, e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'F1') {
                          e.preventDefault();
                          openHelp?.(`exp-${r.codeField}`, codeFocusKey);
                          return;
                        }
                        focusChain?.onEnter(codeFocusKey)?.(e);
                      }}
                    />
                    <HelpBtn onClick={() => openHelp?.(`exp-${r.codeField}`, codeFocusKey)} />
                  </span>
                </td>
                <td className="pb-exp-ft-row__amt">
                  <input
                    className="form-input pb-exp-ft-inp pb-exp-ft-inp--amt"
                    value={footer[r.amtField] ?? ''}
                    disabled={!editable}
                    ref={(el) => focusChain?.register(amtFocusKey, el)}
                    onChange={numInput((v) => onFooter(r.amtField, v))}
                    onKeyDown={amtFocusKey ? focusChain?.onEnter(amtFocusKey) : undefined}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
