import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import ExpVoucherEntryForm from '../components/ExpVoucherEntryForm';

/** VFP DO FORM EXPVOU WITH 'EV',CTOD('  /  /    '),0 — Caption: EXPENSES VOUCHER */
export default function Slide28PurchaseOtherItems({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const screenTitle = 'Expenses Voucher';

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
                <SessionToolbarChrome helpReportId="purchase-voucher-other-items" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <ExpVoucherEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            onBack={onPrev}
            onOpenChecklist={
              typeof onNavigateSlide === 'function'
                ? () => onNavigateSlide(11, { purchaseListType: 'EV' })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
