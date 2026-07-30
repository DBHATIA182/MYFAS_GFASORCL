import React, { useEffect } from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  findTransactionModuleItem,
  transactionCategoryLabel,
  TRANSACTION_PLACEHOLDER_SLIDE,
  resolveTransactionSlideNo,
  GFASORCL_VFP_PATHS,
} from '../data/transactionModuleConfig';
import { gfasorclVfpFileLabel } from '../data/gfasorclVfpPaths';

export default function Slide92TransactionPlaceholder({
  formData,
  userName,
  onPrev,
  onReset,
  onNavigateSlide,
}) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findTransactionModuleItem(reportType);

  const title = meta?.title || 'Transaction';
  const vfpCommand = meta?.vfpCommand || '—';
  const vfpFiles = meta?.vfpFiles?.length ? meta.vfpFiles : [];
  const vfpNote = meta?.vfpNote || '';
  const category = meta?.category ? transactionCategoryLabel(meta.category) : '';

  const targetSlide = resolveTransactionSlideNo(reportType);

  useEffect(() => {
    if (
      targetSlide != null &&
      targetSlide !== TRANSACTION_PLACEHOLDER_SLIDE &&
      typeof onNavigateSlide === 'function'
    ) {
      onNavigateSlide(targetSlide);
    }
  }, [targetSlide, onNavigateSlide]);

  if (meta?.implemented && targetSlide != null && targetSlide !== TRANSACTION_PLACEHOLDER_SLIDE) {
    return (
      <div className="slide slide-92-transaction-placeholder">
        <p className="loading-msg">Opening {title}…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-92-transaction-placeholder master-placeholder-screen transaction-placeholder-screen">
      <div className="master-placeholder-screen__head">
        <h2 className="sale-bill-page__title">{title}</h2>
        <SessionInfoLine
          formData={formData}
          userName={userName}
          helpReportId={reportType || 'transaction-module'}
        />
      </div>

      <div className="master-placeholder-screen__card">
        <p className="master-placeholder-screen__badge">Web version — coming next</p>
        <p className="master-placeholder-screen__lead">
          This screen is listed in <strong>Transaction</strong> and mapped from VFP menu{' '}
          <code>{GFASORCL_VFP_PATHS.menuMpr}</code> popup <code>transactio</code>.
          {category ? (
            <>
              {' '}
              Category: <strong>{category}</strong>.
            </>
          ) : null}
        </p>

        <dl className="master-placeholder-screen__meta">
          <div>
            <dt>VFP paths</dt>
            <dd>
              <ul className="master-placeholder-screen__files">
                <li>
                  <code>{GFASORCL_VFP_PATHS.menu}</code>
                </li>
                <li>
                  <code>{GFASORCL_VFP_PATHS.forms}</code>
                </li>
                <li>
                  <code>{GFASORCL_VFP_PATHS.prg}</code>
                </li>
                <li>
                  <code>{GFASORCL_VFP_PATHS.reports}</code>
                </li>
              </ul>
            </dd>
          </div>
          <div>
            <dt>VFP command</dt>
            <dd>
              <code>{vfpCommand}</code>
            </dd>
          </div>
          {vfpNote ? (
            <div>
              <dt>Note</dt>
              <dd>{vfpNote}</dd>
            </div>
          ) : null}
          {vfpFiles.length > 0 ? (
            <div>
              <dt>GFASORCL files</dt>
              <dd>
                <ul className="master-placeholder-screen__files">
                  {vfpFiles.map((f) => (
                    <li key={f}>
                      <code>{gfasorclVfpFileLabel(f)}</code>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="master-placeholder-screen__hint">
          Cash, bank, journal, purchase, and sale screens are under <strong>Vouchers</strong>, <strong>Purchase</strong>, and{' '}
          <strong>Sales</strong> in the main menu. This Transaction section keeps production, bikri, TDS, bank
          reconciliation, freight, and related VFP forms.
        </p>
      </div>

      <div className="master-placeholder-screen__actions">
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back to menu
        </button>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Home
        </button>
      </div>
    </div>
  );
}
