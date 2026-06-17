import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import { findMasterModuleItem } from '../data/masterModuleConfig';
import Slide26AccountMaster from './Slide26AccountMaster';
import Slide27ItemMaster from './Slide27ItemMaster';
import Slide29ScheduleMaster from './Slide29ScheduleMaster';
import Slide30CatMastMaster from './Slide30CatMastMaster';
import Slide31ItemGrpMaster from './Slide31ItemGrpMaster';
import Slide32UserMaster from './Slide32UserMaster';
import Slide33BikriExpMaster from './Slide33BikriExpMaster';
import Slide35UserPassword from './Slide35UserPassword';
import Slide37GodownRentMaster from './Slide37GodownRentMaster';
import Slide38GodownMaster from './Slide38GodownMaster';

/** Implemented masters — if menu lands on slide 28, still open the real screen (mobile / cached routes). */
const IMPLEMENTED_BY_SLIDE = {
  26: Slide26AccountMaster,
  27: Slide27ItemMaster,
  29: Slide29ScheduleMaster,
  30: Slide30CatMastMaster,
  31: Slide31ItemGrpMaster,
  32: Slide32UserMaster,
  36: Slide33BikriExpMaster,
  35: Slide35UserPassword,
  37: Slide37GodownRentMaster,
  38: Slide38GodownMaster,
};

export default function Slide28MasterPlaceholder({ apiBase, formData, userName, onPrev, onReset }) {
  const reportType = String(formData?.reportType ?? '').trim().toLowerCase();
  const meta = findMasterModuleItem(reportType);

  if (meta?.implemented && meta.slide && meta.slide !== 28) {
    const Implemented = IMPLEMENTED_BY_SLIDE[meta.slide];
    if (Implemented) {
      return (
        <Implemented
          apiBase={apiBase}
          formData={formData}
          userName={userName}
          onPrev={onPrev}
          onReset={onReset}
        />
      );
    }
  }

  const title = meta?.title || 'Master';
  const vfpCommand = meta?.vfpCommand || '—';
  const vfpFiles = meta?.vfpFiles?.length ? meta.vfpFiles : [];
  const vfpNote = meta?.vfpNote || '';

  return (
    <div className="slide slide-28-master-placeholder master-placeholder-screen">
      <div className="master-placeholder-screen__head">
        <h2 className="sale-bill-page__title">{title}</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId={reportType || 'master'} />
      </div>

      <div className="master-placeholder-screen__card">
        <p className="master-placeholder-screen__badge">Web version — coming next</p>
        <p className="master-placeholder-screen__lead">
          This screen is listed in <strong>Master</strong> and mapped from your VFP system. Implementation will follow the
          files in <code>VFP-IMPORT</code>.
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
          {vfpNote ? (
            <div>
              <dt>Note</dt>
              <dd>{vfpNote}</dd>
            </div>
          ) : null}
        </dl>

        <p className="master-placeholder-screen__hint">
          Already live: <strong>A/c Master</strong>, <strong>Item Master</strong>, <strong>Schedule</strong>,{' '}
          <strong>Item Category</strong>, <strong>Item Group</strong>, and <strong>User Master</strong>. Open them from the
          Master menu.
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
