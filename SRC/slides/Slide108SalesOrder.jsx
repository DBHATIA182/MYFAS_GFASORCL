import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import SalesOrderEntryForm from '../components/SalesOrderEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM SORDER WITH 'SO' — Sales Order Records */
export default function Slide108SalesOrder({ apiBase, formData, userName, onPrev }) {
  const entryMeta = findTransactionModuleItem('sales-order-entry');

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sales">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{entryMeta?.title || 'Sales Order Records'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="sales-order-entry" />
        </header>
        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary">
            <SalesOrderEntryForm apiBase={apiBase} formData={formData} userName={userName} onBack={onPrev} />
          </section>
        </div>
      </div>
    </div>
  );
}
