import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay, toInputDateString, toOracleDateFromAny } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function buildForm(rDate, rNo, seed = {}) {
  const dateVal = toInputDateString(seed.r_date ?? rDate) || '';
  const noVal = String(seed.r_no ?? rNo ?? '').trim();
  return {
    sdt: dateVal,
    edt: dateVal,
    sbno: noVal,
    ebno: noVal,
    b_type: String(seed.dc_b_type ?? '').trim(),
    tpt_detail: 'N',
    mnc: 'N',
    m_v_p: 'P',
    irn_no: String(seed.irn_no ?? '').trim(),
  };
}

function buildHeader(rDate, rNo, seed = {}) {
  return {
    r_date: seed.r_date ?? rDate,
    r_no: seed.r_no ?? rNo,
    code: seed.code ?? '',
    party_name: seed.party_name ?? '',
    dc_b_type: seed.dc_b_type ?? '',
    irn_no: seed.irn_no ?? '',
  };
}

function postBody(compCode, compUid, userName, noteType, rDate, rNo, form, extra = {}) {
  return {
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    type: noteType,
    r_date: toOracleDateFromAny(rDate),
    r_no: rNo,
    form,
    ...extra,
  };
}

/** Web equivalent of VFP DO FORM sale_gst_einv_DIRECT WITH type,r_date,r_date,r_no,r_no,''. */
export default function DcNoteEinvDirectModal({
  open,
  onClose,
  apiBase,
  apiParams,
  noteType,
  rDate,
  rNo,
  gstNo = '',
  voucherHeader = null,
  netAmount = 0,
  compYear = 0,
  onVoucherUpdated,
}) {
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const [header, setHeader] = useState(null);
  const [netAmt, setNetAmt] = useState(0);
  const [form, setForm] = useState(() => buildForm(rDate, rNo, voucherHeader));
  const [jsonText, setJsonText] = useState('');
  const [docType, setDocType] = useState('');
  const [savedFile, setSavedFile] = useState('');

  const compCode = apiParams?.comp_code;
  const compUid = apiParams?.comp_uid;
  const userName = apiParams?.user_name;

  const typeLabel = useMemo(() => (String(noteType || '').toUpperCase() === 'CX' ? 'CREDIT NOTE' : 'DEBIT NOTE'), [noteType]);
  const canAct = !!String(rNo ?? '').trim() && !busy;

  useEffect(() => {
    if (!open) {
      setStep('form');
      setLoading(false);
      setBusy(false);
      setErr('');
      setStatus('');
      setHeader(null);
      setJsonText('');
      setDocType('');
      setSavedFile('');
      return;
    }
    const seed = voucherHeader || {};
    setHeader(buildHeader(rDate, rNo, seed));
    setForm(buildForm(rDate, rNo, seed));
    setNetAmt(Number(netAmount) || 0);
    setErr('');
    setStatus('');
    setStep('form');
    setJsonText('');
    setDocType('');
    setSavedFile('');
  }, [open, rDate, rNo, voucherHeader, netAmount]);

  useEffect(() => {
    if (!open || !apiBase || !String(rNo ?? '').trim()) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/dc-note`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            user_name: userName,
            type: noteType,
            r_no: rNo,
            r_date: toOracleDateFromAny(rDate),
          },
          ...reqOpts,
        });
        if (cancelled) return;
        const h = data?.header || {};
        setHeader(buildHeader(rDate, rNo, h));
        setNetAmt(Number(data?.footer?.mbamt ?? data?.totals?.mbamt ?? netAmount) || 0);
        setForm(buildForm(rDate, rNo, h));
      } catch (e) {
        if (!cancelled) {
          setErr(e.response?.data?.error || e.message || 'Could not refresh voucher from server.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, compCode, compUid, userName, noteType, rDate, rNo, netAmount]);

  const previewJson = useCallback(async () => {
    if (!String(rNo ?? '').trim()) return;
    setBusy(true);
    setStatus('');
    setErr('');
    try {
      const { data } = await axios.post(
        `${apiBase}/api/dc-note/einv-json`,
        postBody(compCode, compUid, userName, noteType, rDate, rNo, form, { comp_year: compYear }),
        reqOpts
      );
      setJsonText(data?.jsonText || JSON.stringify(data?.json || {}, null, 2));
      setDocType(data?.docType || '');
      if (data?.header) setHeader(buildHeader(rDate, rNo, data.header));
      const filePath = data?.file?.jsonFile || '';
      setSavedFile(filePath);
      setStep('json');
      setStatus(
        data?.file?.saved
          ? `JSON saved: ${filePath}`
          : data?.file?.error
            ? `JSON built, but file save failed: ${data.file.error}`
            : 'Review the e-invoice JSON below, then click Create E-Inv.'
      );
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Failed to build e-invoice JSON.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, compCode, compUid, userName, form, noteType, rDate, rNo, compYear]);

  const createEinv = useCallback(async () => {
    if (!String(rNo ?? '').trim()) return;
    setBusy(true);
    setStatus('');
    setErr('');
    try {
      const { data } = await axios.post(
        `${apiBase}/api/dc-note/einv-direct`,
        postBody(compCode, compUid, userName, noteType, rDate, rNo, form, {
          confirm: true,
          comp_year: compYear,
        }),
        reqOpts
      );
      setStatus(data?.message || 'E-Invoice request submitted.');
      if (data?.header) {
        setHeader(buildHeader(rDate, rNo, data.header));
        setForm((f) => ({ ...f, irn_no: String(data.header.irn_no ?? data.irn_no ?? f.irn_no).trim() }));
        onVoucherUpdated?.(data);
      }
      if (data?.ok) setStep('form');
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'E-Invoice submission failed.';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [apiBase, compCode, compUid, userName, form, noteType, onVoucherUpdated, rDate, rNo, compYear]);

  const handlePrimary = useCallback(() => {
    if (step === 'json') void createEinv();
    else void previewJson();
  }, [createEinv, previewJson, step]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal voucher-help-modal--open" role="presentation" onClick={onClose}>
      <div
        className={`voucher-help-modal__panel dc-einv-modal${step === 'json' ? ' dc-einv-modal--json' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Direct E-Invoice"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voucher-help-modal__head">
          <h3>{typeLabel} / E-Invoice</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="dc-einv-modal__hint">
          VFP <code>sale_gst_einv_DIRECT</code> · GST {gstNo || '—'}
          {docType ? ` · ${docType}` : ''}
          {loading ? ' · refreshing…' : ''}
        </p>
        <div className="voucher-help-modal__body dc-einv-modal__body">
          {err ? (
            <p className="form-api-error" role="alert">
              {err}
            </p>
          ) : null}
          {status ? <p className="voucher-entry-form__status">{status}</p> : null}
          {header ? (
            <>
              <div className="dc-einv-modal__context">
                <div>
                  <strong>Party:</strong> {header.code} {header.party_name ? `— ${header.party_name}` : ''}
                </div>
                <div>
                  <strong>Vr.Date:</strong> {formatLedgerDateDisplay(header.r_date)}
                </div>
                <div>
                  <strong>Vr.No.:</strong> {header.r_no}
                </div>
                <div>
                  <strong>Net Amount:</strong>{' '}
                  {netAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              {step === 'form' ? (
                <div className="dc-einv-modal__grid">
                  <label>
                    <span>Starting Date</span>
                    <input
                      className="form-input"
                      type="date"
                      value={form.sdt}
                      onChange={(e) => setForm((f) => ({ ...f, sdt: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Ending Date</span>
                    <input
                      className="form-input"
                      type="date"
                      value={form.edt}
                      onChange={(e) => setForm((f) => ({ ...f, edt: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Starting Bill No.</span>
                    <input
                      className="form-input"
                      value={form.sbno}
                      onChange={(e) => setForm((f) => ({ ...f, sbno: e.target.value.replace(/\D/g, '') }))}
                    />
                  </label>
                  <label>
                    <span>Ending Bill No.</span>
                    <input
                      className="form-input"
                      value={form.ebno}
                      onChange={(e) => setForm((f) => ({ ...f, ebno: e.target.value.replace(/\D/g, '') }))}
                    />
                  </label>
                  <label>
                    <span>B.Type</span>
                    <input
                      className="form-input"
                      value={form.b_type}
                      maxLength={5}
                      onChange={(e) => setForm((f) => ({ ...f, b_type: e.target.value.toUpperCase() }))}
                    />
                  </label>
                  <label>
                    <span>Generate EWAY (Y/N)</span>
                    <select
                      className="form-input"
                      value={form.tpt_detail}
                      onChange={(e) => setForm((f) => ({ ...f, tpt_detail: e.target.value }))}
                    >
                      <option value="N">N</option>
                      <option value="Y">Y</option>
                    </select>
                  </label>
                  <label>
                    <span>(N)ew / (C)ancell</span>
                    <select
                      className="form-input"
                      value={form.mnc}
                      onChange={(e) => setForm((f) => ({ ...f, mnc: e.target.value }))}
                    >
                      <option value="N">N</option>
                      <option value="C">C</option>
                    </select>
                  </label>
                  <label>
                    <span>(Vfp) / (Python)</span>
                    <select
                      className="form-input"
                      value={form.m_v_p}
                      onChange={(e) => setForm((f) => ({ ...f, m_v_p: e.target.value }))}
                    >
                      <option value="P">P</option>
                      <option value="V">V</option>
                    </select>
                  </label>
                  <label className="dc-einv-modal__full">
                    <span>IRN No.</span>
                    <input
                      className="form-input"
                      value={form.irn_no}
                      onChange={(e) => setForm((f) => ({ ...f, irn_no: e.target.value }))}
                    />
                  </label>
                </div>
              ) : (
                <div className="dc-einv-modal__json-wrap">
                  <p className="dc-einv-modal__json-label">E-Invoice JSON (preview)</p>
                  {savedFile ? <p className="dc-einv-modal__json-path">{savedFile}</p> : null}
                  <pre className="dc-einv-modal__json">{jsonText || '{}'}</pre>
                </div>
              )}
            </>
          ) : null}
        </div>
        <footer className="voucher-help-modal__foot dc-einv-modal__foot">
          {step === 'json' ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep('form')} disabled={busy}>
              Back
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Quit
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void handlePrimary()} disabled={!canAct}>
            {busy ? 'Please wait…' : step === 'json' ? 'Create E-Inv' : 'Proceed'}
          </button>
        </footer>
      </div>
    </div>
  );
}
