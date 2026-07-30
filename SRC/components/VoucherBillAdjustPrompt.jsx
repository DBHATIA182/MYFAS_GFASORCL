import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const CHOICES = [
  { id: 'manual', label: 'Manual' },
  { id: 'auto', label: 'Auto' },
  { id: 'autoInt', label: 'Auto+Interest' },
];

/** VFP bill_hlp — "BILLS ADJUSTMENT" / SELECT BUTTON (Manual, Auto, Auto+Interest). */
export default function VoucherBillAdjustPrompt({ open, onClose, onChoice }) {
  const [sel, setSel] = useState(0);
  const manualRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    window.setTimeout(() => manualRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(CHOICES.length - 1, s + 1));
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onChoice?.(CHOICES[sel].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sel, onChoice, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="sale-bill-modal-backdrop voucher-bill-adjust-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sale-bill-modal voucher-bill-adjust-prompt" role="dialog" aria-labelledby="bill-adjust-title">
        <div className="sale-bill-modal-head voucher-bill-adjust-prompt__head">
          <h3 id="bill-adjust-title">BILLS ADJUSTMENT</h3>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="voucher-bill-adjust-prompt__body">
          <p className="voucher-bill-adjust-prompt__msg">SELECT BUTTON</p>
          <p className="voucher-bill-adjust-prompt__hint">↑↓←→ move · Enter select · Esc cancel</p>
          <div className="voucher-bill-adjust-prompt__actions">
            {CHOICES.map((c, i) => (
              <button
                key={c.id}
                ref={i === 0 ? manualRef : undefined}
                type="button"
                className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}${sel === i ? ' voucher-bill-adjust-prompt__btn--active' : ''}`}
                onClick={() => onChoice?.(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onChoice?.(c.id);
                  }
                }}
                onMouseEnter={() => setSel(i)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
