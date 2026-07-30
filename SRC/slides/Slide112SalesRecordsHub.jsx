import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  findTransactionModuleItem,
  saleTransactionMenuItemsForReportConfig,
} from '../data/transactionModuleConfig';

const PRIMARY_SALES_ACTIONS = [
  {
    id: 'sale-bill-printing',
    title: 'Sale Bill Printing',
    shortTitle: 'Sale Print',
    description: 'Print sale bills (GST)',
    implemented: true,
  },
  {
    id: 'sale-list',
    title: 'Sale Bill List',
    shortTitle: 'Sale List',
    description: 'Sale bill checklist',
    implemented: true,
  },
  {
    id: 'sale-chart',
    title: 'Sale Chart',
    shortTitle: 'Sale Chart',
    description: 'Month-wise weight and amount by item',
    implemented: true,
  },
];

/** Sales > Sales — all sale-record options except Sales Order and Dispatch Challan. */
export default function Slide112SalesRecordsHub({ formData, userName, onPrev, onOpenAction }) {
  const moduleMeta = findTransactionModuleItem('sales-records');
  const actions = [
    ...PRIMARY_SALES_ACTIONS,
    ...saleTransactionMenuItemsForReportConfig().map((action) => {
      const item = findTransactionModuleItem(action.id);
      return { ...action, implemented: Boolean(item?.implemented && item?.slide) };
    }),
  ];

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sales">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{moduleMeta?.title || 'Sales'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="sale-list" />
        </header>

        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__actions" aria-labelledby="sales-records-actions-heading">
            <h3 id="sales-records-actions-heading" className="voucher-entry-hub__section-label">
              Sales
            </h3>
            <div className="voucher-entry-hub__action-grid" role="list">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`voucher-entry-hub__action${
                    action.implemented ? ' voucher-entry-hub__action--live' : ''
                  }`}
                  role="listitem"
                  title={action.description}
                  onClick={() => onOpenAction?.(action.id)}
                >
                  <span className="voucher-entry-hub__action-icon" aria-hidden="true">
                    {action.implemented ? '✓' : '▣'}
                  </span>
                  <span className="voucher-entry-hub__action-label">{action.shortTitle || action.title}</span>
                  <span className="voucher-entry-hub__action-title">{action.description}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="voucher-entry-hub__foot">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back to Sales
          </button>
        </footer>
      </div>
    </div>
  );
}
