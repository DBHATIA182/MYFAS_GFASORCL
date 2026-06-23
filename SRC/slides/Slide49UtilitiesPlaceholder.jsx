import React, { useEffect } from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  findUtilitiesModuleItem,
  isUtilityDesktopOnlyBlocked,
  resolveUtilitiesSlideNo,
  utilityCategoryLabel,
  utilityDesktopOnlyMessage,
  UTILITIES_MODULE_ITEMS,
  UTILITIES_PLACEHOLDER_SLIDE,
} from '../data/utilitiesModuleConfig';

export default function Slide49UtilitiesPlaceholder({
  formData,
  userName,
  onPrev,
  onReset,
  onNavigateSlide,
}) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findUtilitiesModuleItem(reportType);

  const title = meta?.title || 'Utilities';
  const vfpCommand = meta?.vfpCommand || '—';
  const vfpFiles = meta?.vfpFiles?.length ? meta.vfpFiles : [];
  const category = meta?.category ? utilityCategoryLabel(meta.category) : '';

  const liveCount = UTILITIES_MODULE_ITEMS.filter((u) => u.implemented).length;
  const totalCount = UTILITIES_MODULE_ITEMS.length;
  const targetSlide = resolveUtilitiesSlideNo(reportType);
  const desktopBlocked = meta?.implemented && isUtilityDesktopOnlyBlocked(meta);

  useEffect(() => {
    if (
      targetSlide != null &&
      targetSlide !== UTILITIES_PLACEHOLDER_SLIDE &&
      typeof onNavigateSlide === 'function'
    ) {
      onNavigateSlide(targetSlide);
    }
  }, [targetSlide, onNavigateSlide]);

  if (desktopBlocked) {
    return (
      <div className="slide slide-49-utilities-placeholder slide-utility-denied">
        <div className="master-placeholder-screen__head">
          <h2 className="sale-bill-page__title">{title}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId={reportType || 'utilities-module'} />
        </div>
        <div className="utility-denied utility-denied--mobile">
          <p className="utility-denied__badge">Desktop only</p>
          <p>
            <strong>Not available on mobile.</strong> {utilityDesktopOnlyMessage(meta)}
          </p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (meta?.implemented && targetSlide != null && targetSlide !== UTILITIES_PLACEHOLDER_SLIDE) {
    return (
      <div className="slide slide-49-utilities-placeholder">
        <p className="loading-msg">Opening {title}…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-49-utilities-placeholder master-placeholder-screen utilities-placeholder-screen">
      <div className="master-placeholder-screen__head">
        <h2 className="sale-bill-page__title">{title}</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="utilities-module" />
      </div>

      <div className="master-placeholder-screen__card">
        <p className="master-placeholder-screen__badge">Web version — coming next</p>
        <p className="master-placeholder-screen__lead">
          This utility is listed in <strong>Utilities</strong> and mapped from your VFP{' '}
          <code>VFP-IMPORT/UTILITIES.txt</code> menu.
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
          {vfpFiles.length > 0 ? (
            <div>
              <dt>VFP-IMPORT files</dt>
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
          Already live in web: <strong>Change Year</strong>, <strong>Change Company</strong>,{' '}
          <strong>Change User</strong>, and <strong>New Year Books</strong> ({liveCount} of {totalCount} utilities).
          Open them from the Utilities menu.
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
