import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import { findTransactionModuleItem, salesOrderHubActions } from '../data/transactionModuleConfig';

/** VFP Sale Records > Sales Order popup. */
export default function Slide109SalesOrderHub({ formData, userName, onPrev, onOpenAction }) {
  const moduleMeta = findTransactionModuleItem('sales-order');
  const actions = salesOrderHubActions();

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sales">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{moduleMeta?.title || 'Sales Order Records'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="sales-order-entry" />
        </header>

        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__actions" aria-labelledby="sales-order-actions-heading">
            <h3 id="sales-order-actions-heading" className="voucher-entry-hub__section-label">
              Sales Order
            </h3>
            <div className="voucher-entry-hub__action-grid" role="list">
              {actions.map((action) => {
                const live = Boolean(action.implemented && action.slide);
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={`voucher-entry-hub__action${live ? ' voucher-entry-hub__action--live' : ''}`}
                    role="listitem"
                    title={action.description}
                    onClick={() => onOpenAction?.(action.id)}
                  >
                    <span className="voucher-entry-hub__action-icon" aria-hidden="true">
                      {live ? '✓' : '▣'}
                    </span>
                    <span className="voucher-entry-hub__action-label">
                      {action.title.replace(/^Sales Order\s*—\s*/i, '')}
                    </span>
                    <span className="voucher-entry-hub__action-title">{action.description}</span>
                  </button>
                );
              })}
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
