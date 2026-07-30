import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import GoodsInwardEntryForm from '../components/GoodsInwardEntryForm';
import { findTransactionModuleItem } from '../data/transactionModuleConfig';

/** VFP DO FORM inward WITH 'IN',G_BLNKDT,0 — Goods Inward Notes */
export default function Slide98GoodsInward({ apiBase, formData, userName, onPrev }) {
  const entryMeta = findTransactionModuleItem('goods-inward-chalan');

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--purchase">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{entryMeta?.title || 'Goods Inward Notes'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="goods-inward-chalan" />
        </header>
        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary">
            <GoodsInwardEntryForm apiBase={apiBase} formData={formData} userName={userName} onBack={onPrev} />
          </section>
        </div>
      </div>
    </div>
  );
}
