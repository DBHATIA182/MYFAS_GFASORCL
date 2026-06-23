import React, { useEffect } from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  findIncomeTaxModuleItem,
  incomeTaxCategoryLabel,
  INCOME_TAX_MODULE_ITEMS,
  INCOME_TAX_PLACEHOLDER_SLIDE,
  resolveIncomeTaxSlideNo,
} from '../data/incomeTaxModuleConfig';

export default function Slide87IncomeTaxPlaceholder({
  formData,
  userName,
  onPrev,
  onReset,
  onNavigateSlide,
}) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findIncomeTaxModuleItem(reportType);

  const title = meta?.title || 'Income Tax Reports';
  const vfpCommand = meta?.vfpCommand || '—';
  const vfpFiles = meta?.vfpFiles?.length ? meta.vfpFiles : [];
  const vfpNote = meta?.vfpNote || '';
  const category = meta?.category ? incomeTaxCategoryLabel(meta.category) : '';

  const liveCount = INCOME_TAX_MODULE_ITEMS.filter((m) => m.implemented).length;
  const totalCount = INCOME_TAX_MODULE_ITEMS.length;
  const targetSlide = resolveIncomeTaxSlideNo(reportType);

  useEffect(() => {
    if (
      targetSlide != null &&
      targetSlide !== INCOME_TAX_PLACEHOLDER_SLIDE &&
      typeof onNavigateSlide === 'function'
    ) {
      onNavigateSlide(targetSlide);
    }
  }, [targetSlide, onNavigateSlide]);

  if (meta?.implemented && targetSlide != null && targetSlide !== INCOME_TAX_PLACEHOLDER_SLIDE) {
    return (
      <div className="slide slide-87-income-tax-placeholder">
        <p className="loading-msg">Opening {title}…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-87-income-tax-placeholder master-placeholder-screen income-tax-placeholder-screen">
      <div className="master-placeholder-screen__head">
        <h2 className="sale-bill-page__title">{title}</h2>
        <SessionInfoLine
          formData={formData}
          userName={userName}
          helpReportId={reportType || 'income-tax-module'}
        />
      </div>

      <div className="master-placeholder-screen__card">
        <p className="master-placeholder-screen__badge">Web version — coming next</p>
        <p className="master-placeholder-screen__lead">
          This report is listed in <strong>Income Tax Reports</strong> and mapped from your VFP{' '}
          <code>menu/BW_MENU.MPR</code> popup <code>incometaxr</code>.
          {category ? (
            <>
              {' '}
              Category: <strong>{category}</strong>.
            </>
          ) : null}
        </p>

        <dl className="master-placeholder-screen__meta">
          <div>
            <dt>VFP command</dt>
            <dd>
              <code>{vfpCommand}</code>
            </dd>
          </div>
          {vfpNote ? (
            <div>
              <dt>Notes</dt>
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
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="master-placeholder-screen__hint">
          {liveCount} of {totalCount} income tax reports are live in the web app. Open any tile from the{' '}
          <strong>Income Tax Reports</strong> menu to see its VFP mapping until the screen is built.
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
