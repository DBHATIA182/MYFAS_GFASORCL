import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import DcNoteOthersEntryForm from '../components/DcNoteOthersEntryForm';

/** VFP DO FORM DCNOTE WITH 'CX',... — Caption: Credit Note Others */
export default function Slide30CreditNoteOthers({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const screenTitle = 'Credit Note Others';

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--purchase">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head voucher-entry-hub__head--purchase-compact">
          <SessionInfoLine
            formData={formData}
            userName={userName}
            actions={
              <>
                <h2 className="voucher-entry-hub__screen-title">{screenTitle}</h2>
                <SessionToolbarChrome helpReportId="credit-note-others" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <DcNoteOthersEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            noteType="CX"
            onBack={onPrev}
            onOpenChecklist={
              typeof onNavigateSlide === 'function'
                ? () => onNavigateSlide(11, { purchaseListType: 'CX' })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
