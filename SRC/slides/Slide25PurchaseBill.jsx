import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import PurchaseBillEntryForm from '../components/PurchaseBillEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM &G_PURCHASE_FORM WITH 'PU',CTOD('  /  /    '),0,'' */
export default function Slide25PurchaseBill({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const entryMeta = findTransactionModuleItem('purchase-bill-entry');
  const screenTitle = entryMeta?.title || 'Purchase Bill';

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
                <SessionToolbarChrome helpReportId="purchase-bill-entry" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <PurchaseBillEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            onBack={onPrev}
            onOpenChecklist={
              typeof onNavigateSlide === 'function'
                ? () => onNavigateSlide(11, { purchaseListType: 'PU' })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
