import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import PurchaseBillEntryForm from '../components/PurchaseBillEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM &G_PURCHASE_FORM WITH 'DN',CTOD('  /  /    '),0,'' */
export default function Slide27DebitNote({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const entryMeta = findTransactionModuleItem('debit-note-entry');
  const screenTitle = entryMeta?.title || 'Debit Note';

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
                <SessionToolbarChrome helpReportId="debit-note-entry" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <PurchaseBillEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            billType="DN"
            variant="debit"
            onBack={onPrev}
            onOpenChecklist={
              typeof onNavigateSlide === 'function'
                ? () => onNavigateSlide(11, { purchaseListType: 'DN' })
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
