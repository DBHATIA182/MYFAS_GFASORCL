import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPurchaseOrderPrintContext,
  buildPurchaseOrderPrintPreviewHtml,
  downloadPurchaseOrderPrintExcel,
  exportPurchaseOrderPdf,
  fetchPurchaseOrderPrintBatch,
  printPurchaseOrderBrowser,
  sharePurchaseOrderWhatsApp,
} from '../utils/purchaseOrderPrint';

function emptyFilters(defaultSoNo = '') {
  const no = String(defaultSoNo || '1').replace(/\D/g, '') || '1';
  return {
    sbno: no,
    ebno: no,
    pmt_due_yn: 'Y',
  };
}

export default function PurchaseOrderPrintModal({
  open,
  apiBase,
  apiParams,
  formData,
  userName,
  defaultSoNo = '',
  onClose,
}) {
  const [step, setStep] = useState('entry');
  const [filters, setFilters] = useState(() => emptyFilters(defaultSoNo));
  const [batchPayload, setBatchPayload] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');

  const sbnoRef = useRef(null);
  const ebnoRef = useRef(null);

  const printCtx = useMemo(
    () => ({
      formData,
      userName,
      compCode: apiParams?.comp_code,
      compUid: apiParams?.comp_uid,
      showPmtDue: String(filters.pmt_due_yn).trim().toUpperCase() !== 'N',
    }),
    [apiParams, filters.pmt_due_yn, formData, userName]
  );

  const canExport = Boolean(batchPayload?.orders?.length);

  const resetAndOpen = () => {
    setStep('entry');
    setFilters(emptyFilters(defaultSoNo));
    setBatchPayload(null);
    setPreviewHtml('');
    setError('');
    setExportErr('');
  };

  useEffect(() => {
    if (!open) return;
    resetAndOpen();
  }, [open, defaultSoNo]);

  const moveFocus = (ref) => window.setTimeout(() => ref?.current?.focus(), 0);

  const runProceed = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const payload = await fetchPurchaseOrderPrintBatch(apiBase, apiParams, {
        sbno: filters.sbno,
        ebno: filters.ebno,
        pmtDueYn: filters.pmt_due_yn,
      });
      if (!payload.orders?.length) {
        setError('No purchase orders found for selected bill number range.');
        setBatchPayload(null);
        setPreviewHtml('');
        return;
      }
      const { metadata } = await buildPurchaseOrderPrintContext(apiBase, printCtx, payload);
      setBatchPayload(payload);
      setPreviewHtml(buildPurchaseOrderPrintPreviewHtml(payload, metadata));
      setStep('report');
    } catch (err) {
      setBatchPayload(null);
      setPreviewHtml('');
      setError(err.response?.data?.error || err.message || 'Print failed.');
    } finally {
      setLoading(false);
    }
  };

  const runExport = async (fn) => {
    if (!canExport) return;
    setExportErr('');
    try {
      await fn(apiBase, printCtx, batchPayload);
    } catch (err) {
      setExportErr(err?.message || String(err));
    }
  };

  if (!open) return null;

  const isReport = step === 'report';

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Purchase order printing">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-print-modal${
          isReport ? ' purchase-order-print-modal--report' : ''
        }`}
      >
        <header className="voucher-help-modal__head purchase-order-print-modal__head">
          <h3 className="voucher-help-modal__title">
            {isReport ? 'Purchase Order — Print Preview' : 'Purchase Order Printing'}
          </h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!isReport ? (
          <div className="purchase-order-print-modal__entry">
            <div className="purchase-order-print-modal__filters">
              <label className="purchase-order-print-modal__field">
                <span>Starting Bill No.</span>
                <input
                  ref={sbnoRef}
                  type="text"
                  className="form-input"
                  value={filters.sbno}
                  onChange={(e) => setFilters((f) => ({ ...f, sbno: e.target.value.replace(/\D/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(ebnoRef)}
                />
              </label>
              <label className="purchase-order-print-modal__field">
                <span>Ending Bill No.</span>
                <input
                  ref={ebnoRef}
                  type="text"
                  className="form-input"
                  value={filters.ebno}
                  onChange={(e) => setFilters((f) => ({ ...f, ebno: e.target.value.replace(/\D/g, '') }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runProceed();
                    }
                  }}
                />
              </label>
              <label className="purchase-order-print-modal__field">
                <span>Print Payment Due Date (Y/N)</span>
                <select
                  className="form-input"
                  value={filters.pmt_due_yn}
                  onChange={(e) => setFilters((f) => ({ ...f, pmt_due_yn: e.target.value }))}
                >
                  <option value="Y">Y</option>
                  <option value="N">N</option>
                </select>
              </label>
            </div>
            <div className="purchase-order-print-modal__actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void runProceed()} disabled={loading}>
                {loading ? 'Loading…' : 'Proceed'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={loading}
                onClick={async () => {
                  setExportErr('');
                  try {
                    const payload = await fetchPurchaseOrderPrintBatch(apiBase, apiParams, {
                      sbno: filters.sbno,
                      ebno: filters.ebno,
                      pmtDueYn: filters.pmt_due_yn,
                    });
                    if (!payload.orders?.length) {
                      setError('No purchase orders found for selected bill number range.');
                      return;
                    }
                    downloadPurchaseOrderPrintExcel(payload, formData);
                  } catch (err) {
                    setExportErr(err?.message || String(err));
                  }
                }}
              >
                Excel
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Quit
              </button>
            </div>
            {error ? <p className="purchase-order-print-modal__error">{error}</p> : null}
            {exportErr ? <p className="purchase-order-print-modal__error">{exportErr}</p> : null}
          </div>
        ) : (
          <>
            <div className="purchase-order-print-modal__report-bar">
              <span className="purchase-order-print-modal__report-range">
                Bill No. {filters.sbno}
                {filters.ebno !== filters.sbno ? ` to ${filters.ebno}` : ''} · {batchPayload?.orders?.length || 0} order(s)
              </span>
              <div className="purchase-order-print-modal__report-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => void runExport(exportPurchaseOrderPdf)}
                >
                  PDF
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => {
                    try {
                      downloadPurchaseOrderPrintExcel(batchPayload, formData);
                    } catch (err) {
                      setExportErr(err?.message || String(err));
                    }
                  }}
                >
                  Excel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => void runExport(sharePurchaseOrderWhatsApp)}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => void runExport(printPurchaseOrderBrowser)}
                >
                  Print
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setStep('entry')}>
                  Back
                </button>
                <button type="button" className="btn btn-sm" onClick={onClose}>
                  Quit
                </button>
              </div>
            </div>
            {exportErr ? <p className="purchase-order-print-modal__error">{exportErr}</p> : null}
            <div className="purchase-order-print-modal__preview-wrap">
              {previewHtml ? (
                <iframe
                  className="purchase-order-print-modal__preview"
                  title="Purchase order print preview"
                  srcDoc={previewHtml}
                />
              ) : (
                <p className="voucher-help-modal__msg">No preview available.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
