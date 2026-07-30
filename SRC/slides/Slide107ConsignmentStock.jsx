import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import ConsignmentStockEntryForm from '../components/ConsignmentStockEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM cstock WITH 'PC',G_BLNKDT,0,'' — Consignment Stock Entry */
export default function Slide107ConsignmentStock({ apiBase, formData, userName, onPrev }) {
  const entryMeta = findTransactionModuleItem('consignment-stock-entry');

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--purchase">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{entryMeta?.title || 'Consignment Stock Entry'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="consignment-stock-entry" />
        </header>
        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary">
            <ConsignmentStockEntryForm apiBase={apiBase} formData={formData} userName={userName} onBack={onPrev} />
          </section>
        </div>
      </div>
    </div>
  );
}
