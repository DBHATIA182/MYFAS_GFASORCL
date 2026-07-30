import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import DispatchChallanEntryForm from '../components/DispatchChallanEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM dcadd WITH 'DC' | 'DR' — Dispatch Challan / DC Return */
export default function Slide110DispatchChallan({ apiBase, formData, userName, onPrev }) {
  const dcType = String(formData?.dcType || 'DC').toUpperCase() === 'DR' ? 'DR' : 'DC';
  const entryMeta = findTransactionModuleItem(
    dcType === 'DR' ? 'dispatch-challan-return' : 'dispatch-challan-entry'
  );

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sales">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">
            {entryMeta?.title || (dcType === 'DR' ? 'Dispatch Challan Return' : 'Dispatch Challan')}
          </h2>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId={dcType === 'DR' ? 'dispatch-challan-return' : 'dispatch-challan'}
          />
        </header>
        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary">
            <DispatchChallanEntryForm
              key={dcType}
              apiBase={apiBase}
              formData={formData}
              userName={userName}
              dcType={dcType}
              onBack={onPrev}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
