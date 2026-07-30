import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import PurchaseOrderEntryForm from '../components/PurchaseOrderEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM PORDER WITH 'SO' — Purchase Order Records */
export default function Slide97PurchaseOrder({ apiBase, formData, userName, onPrev }) {
  const entryMeta = findTransactionModuleItem('purchase-order');

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--purchase">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{entryMeta?.title || 'Purchase Order Records'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="purchase-order" />
        </header>
        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary">
            <PurchaseOrderEntryForm apiBase={apiBase} formData={formData} userName={userName} onBack={onPrev} />
          </section>
        </div>
      </div>
    </div>
  );
}
