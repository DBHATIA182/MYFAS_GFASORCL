import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** ⋮ dropdown — PDF, Excel, WhatsApp, Print (ledger-style, desktop + mobile). */
export default function ReportExportMenu({
  onPdf,
  onWhatsApp,
  onExcel,
  onPrint,
  showPdf = true,
  showWhatsApp = true,
  showExcel = true,
  showPrint = false,
  printDisabled = false,
  pdfDisabled = false,
  whatsAppDisabled = false,
  className = '',
  variant = 'light',
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const updatePanelPos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPanelStyle({
      position: 'fixed',
      top: r.bottom + 4,
      left: r.right,
      transform: 'translateX(-100%)',
      zIndex: 10050,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }
    updatePanelPos();
    const onReflow = () => updatePanelPos();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [open]);

  const run = (fn) => {
    setOpen(false);
    fn?.();
  };

  const hasPdf = showPdf && onPdf;
  const hasWa = showWhatsApp && onWhatsApp;
  const hasExcel = showExcel && onExcel;
  const hasPrint = showPrint && onPrint;
  if (!hasPdf && !hasWa && !hasExcel && !hasPrint) return null;

  const panel = open ? (
    <div
      ref={panelRef}
      className="report-export-menu__panel report-export-menu__panel--portal"
      role="menu"
      style={panelStyle || undefined}
    >
      {hasPdf ? (
        <button
          type="button"
          role="menuitem"
          className="report-export-menu__item"
          disabled={pdfDisabled}
          onClick={() => run(onPdf)}
        >
          <span className="report-export-menu__item-icon" aria-hidden="true">
            📄
          </span>
          PDF
        </button>
      ) : null}
      {hasExcel ? (
        <button type="button" role="menuitem" className="report-export-menu__item" onClick={() => run(onExcel)}>
          <span className="report-export-menu__item-icon" aria-hidden="true">
            📊
          </span>
          Excel
        </button>
      ) : null}
      {hasWa ? (
        <button
          type="button"
          role="menuitem"
          className="report-export-menu__item"
          disabled={whatsAppDisabled}
          onClick={() => run(onWhatsApp)}
        >
          <span className="report-export-menu__item-icon" aria-hidden="true">
            💬
          </span>
          WhatsApp
        </button>
      ) : null}
      {hasPrint ? (
        <button
          type="button"
          role="menuitem"
          className="report-export-menu__item"
          disabled={printDisabled}
          onClick={() => run(onPrint)}
        >
          <span className="report-export-menu__item-icon" aria-hidden="true">
            🖨
          </span>
          Print
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className={`report-export-menu report-export-menu--${variant}${className ? ` ${className}` : ''}`}
      ref={wrapRef}
    >
      <button
        ref={btnRef}
        type="button"
        className="report-export-menu__btn"
        aria-label="Export options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
    </div>
  );
}
