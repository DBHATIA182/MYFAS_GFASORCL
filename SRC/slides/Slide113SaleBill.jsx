import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import SaleBillEntryForm from '../components/SaleBillEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM &G_SALE_FORM WITH 'SL',CTOD('  /  /    '),0,'','N' */
export default function Slide113SaleBill({ apiBase, formData, userName, onPrev, onNavigateSlide }) {
  const entryMeta = findTransactionModuleItem('sale-bill-entry');
  const screenTitle = entryMeta?.title || 'Sale Bill';

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sale">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head voucher-entry-hub__head--purchase-compact">
          <SessionInfoLine
            formData={formData}
            userName={userName}
            actions={
              <>
                <h2 className="voucher-entry-hub__screen-title">{screenTitle}</h2>
                <SessionToolbarChrome helpReportId="sale-bill-entry" />
              </>
            }
          />
        </header>
        <div className="voucher-entry-hub__body voucher-entry-hub__body--flush">
          <SaleBillEntryForm
            apiBase={apiBase}
            formData={formData}
            userName={userName}
            onBack={onPrev}
            onOpenChecklist={typeof onNavigateSlide === 'function' ? () => onNavigateSlide(8) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
