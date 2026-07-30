import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import PurchaseBillEntryForm from '../components/PurchaseBillEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM PURCHASE_bardana WITH 'PB',... */
export default function Slide26BardanaPurchaseBill({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const entryMeta = findTransactionModuleItem('bardana-purchase-bill');
  const screenTitle = entryMeta?.title || 'Purchase Bill Bardana';

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
                <SessionToolbarChrome helpReportId="bardana-purchase-bill" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <PurchaseBillEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            billType="PB"
            variant="bardana"
            onBack={onPrev}
            onOpenChecklist={
              typeof onNavigateSlide === 'function'
                ? () => onNavigateSlide(11, { purchaseListType: 'PB' })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
