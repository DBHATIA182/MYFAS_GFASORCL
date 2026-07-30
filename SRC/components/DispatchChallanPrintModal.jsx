import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDispatchChallanPrintContext,
  buildDispatchChallanPrintPayloadFromForm,
  buildDispatchChallanPrintPreviewHtml,
  exportDispatchChallanPdf,
  fetchDispatchChallanPrintBundle,
  printDispatchChallanBrowser,
  shareDispatchChallanWhatsApp,
} from '../utils/dispatchChallanPrint';

/**
 * Dispatch Challan print preview — VFP dcpnt.frx layout with PDF / WhatsApp / Print.
 */
export default function DispatchChallanPrintModal({
  open,
  onClose,
  apiBase,
  apiParams,
  formData,
  userName,
  dcType = 'DC',
  header,
  lines,
  totals,
}) {
  const [payload, setPayload] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [busy, setBusy] = useState(false);

  const printCtx = useMemo(
    () => ({
      formData,
      userName,
      compCode: apiParams?.comp_code,
      compUid: apiParams?.comp_uid,
    }),
    [apiParams, formData, userName]
  );

  const docLabel = String(dcType).toUpperCase() === 'DR' ? 'DC Return' : 'Dispatch Challan';

  const loadPreview = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      let next = null;
      const billNo = header?.bill_no;
      if (billNo && apiParams?.comp_code) {
        try {
          next = await fetchDispatchChallanPrintBundle(apiBase, apiParams, {
            billNo,
            bType: header?.b_type || 'N',
            dcType,
          });
        } catch {
          next = null;
        }
      }
      if (!next) {
        next = buildDispatchChallanPrintPayloadFromForm(header, lines, totals, { dcType });
      }
      const { payload: normalized, metadata } = await buildDispatchChallanPrintContext(
        apiBase,
        printCtx,
        next
      );
      setPayload(normalized);
      setPreviewHtml(buildDispatchChallanPrintPreviewHtml(normalized, metadata));
    } catch (err) {
      setPayload(null);
      setPreviewHtml('');
      setError(err?.response?.data?.error || err?.message || 'Could not build print preview.');
    } finally {
      setLoading(false);
    }
  }, [apiBase, apiParams, dcType, header, lines, open, printCtx, totals]);

  useEffect(() => {
    if (!open) {
      setPayload(null);
      setPreviewHtml('');
      setError('');
      setExportErr('');
      return;
    }
    void loadPreview();
  }, [open, loadPreview]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const runExport = async (fn) => {
    if (!payload) return;
    setBusy(true);
    setExportErr('');
    try {
      await fn(apiBase, printCtx, payload);
    } catch (err) {
      setExportErr(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={`${docLabel} print`}>
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="voucher-help-modal__panel voucher-help-modal__panel--account"
        style={{ width: 'min(920px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{docLabel} — Print</h3>
          <p className="voucher-help-modal__hint">VFP dcpnt layout · party address / GST / PAN · PDF · WhatsApp</p>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.4rem',
            padding: '0.35rem 0.75rem 0.55rem',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!payload || busy || loading}
            onClick={() => void runExport(exportDispatchChallanPdf)}
          >
            PDF
          </button>
          <button
            type="button"
            className="btn btn-sm btn-whatsapp"
            disabled={!payload || busy || loading}
            onClick={() => void runExport(shareDispatchChallanWhatsApp)}
          >
            WhatsApp
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!payload || busy || loading}
            onClick={() => void runExport(printDispatchChallanBrowser)}
          >
            Print
          </button>
          <button type="button" className="btn btn-sm" disabled={busy || loading} onClick={() => void loadPreview()}>
            Refresh
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <p className="deploy-update-msg deploy-update-msg--err" style={{ margin: '8px 12px' }}>{error}</p> : null}
        {exportErr ? (
          <p className="deploy-update-msg deploy-update-msg--err" style={{ margin: '8px 12px' }}>{exportErr}</p>
        ) : null}
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px 16px', background: '#f8fafc' }}>
          {loading ? <p>Loading preview…</p> : null}
          {!loading && previewHtml ? (
            <div
              style={{ background: '#fff', border: '1px solid #cbd5e1', padding: 8, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : null}
          {!loading && !previewHtml && !error ? <p>No print data.</p> : null}
        </div>
      </div>
    </div>
  );
}
