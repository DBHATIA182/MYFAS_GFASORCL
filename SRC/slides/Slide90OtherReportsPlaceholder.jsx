import React, { useEffect } from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  findOtherReportsModuleItem,
  otherReportsCategoryLabel,
  OTHER_REPORTS_MODULE_ITEMS,
  OTHER_REPORTS_PLACEHOLDER_SLIDE,
  resolveOtherReportsSlideNo,
  GFASORCL_VFP_PATHS,
} from '../data/otherReportsModuleConfig';
import { gfasorclVfpFileLabel } from '../data/gfasorclVfpPaths';

export default function Slide90OtherReportsPlaceholder({
  formData,
  userName,
  onPrev,
  onReset,
  onNavigateSlide,
}) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findOtherReportsModuleItem(reportType);

  const title = meta?.title || 'Other Reports';
  const vfpCommand = meta?.vfpCommand || '—';
  const vfpFiles = meta?.vfpFiles?.length ? meta.vfpFiles : [];
  const vfpNote = meta?.vfpNote || '';
  const category = meta?.category ? otherReportsCategoryLabel(meta.category) : '';

  const liveCount = OTHER_REPORTS_MODULE_ITEMS.filter((m) => m.implemented).length;
  const totalCount = OTHER_REPORTS_MODULE_ITEMS.length;
  const targetSlide = resolveOtherReportsSlideNo(reportType);

  useEffect(() => {
    if (
      targetSlide != null &&
      targetSlide !== OTHER_REPORTS_PLACEHOLDER_SLIDE &&
      typeof onNavigateSlide === 'function'
    ) {
      onNavigateSlide(targetSlide);
    }
  }, [targetSlide, onNavigateSlide]);

  if (meta?.implemented && targetSlide != null && targetSlide !== OTHER_REPORTS_PLACEHOLDER_SLIDE) {
    return (
      <div className="slide slide-90-other-reports-placeholder">
        <p className="loading-msg">Opening {title}…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-90-other-reports-placeholder master-placeholder-screen other-reports-placeholder-screen">
      <div className="master-placeholder-screen__head">
        <h2 className="sale-bill-page__title">{title}</h2>
        <SessionInfoLine
          formData={formData}
          userName={userName}
          helpReportId={reportType || 'other-reports-module'}
        />
      </div>

      <div className="master-placeholder-screen__card">
        <p className="master-placeholder-screen__badge">Web version — coming next</p>
        <p className="master-placeholder-screen__lead">
          This report is listed in <strong>Other Reports</strong> and mapped from VFP menu{' '}
          <code>{GFASORCL_VFP_PATHS.menuMpr}</code> popup <code>otherreports</code>.
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
              <dt>Underlying form</dt>
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
          All {totalCount} other reports are live in the web app (Slide 91). Use the{' '}
          <strong>Other Reports</strong> menu to run any report with the same filters as VFP.
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
