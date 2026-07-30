import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import { dispatchChallanHubActions, findTransactionModuleItem } from '../data/transactionModuleConfig';

/** Sales > Dispatch Challan — VFP dcadd DC / DR popup. */
export default function Slide111DispatchChallanHub({ formData, userName, onPrev, onOpenAction }) {
  const moduleMeta = findTransactionModuleItem('dispatch-challan');
  const actions = dispatchChallanHubActions();

  return (
    <div className="slide voucher-entry-hub voucher-entry-hub--sales">
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{moduleMeta?.title || 'Dispatch Challan'}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId="dispatch-challan" />
        </header>

        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__actions" aria-labelledby="dispatch-challan-actions-heading">
            <h3 id="dispatch-challan-actions-heading" className="voucher-entry-hub__section-label">
              Dispatch Challan
            </h3>
            <div className="voucher-entry-hub__action-grid" role="list">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="voucher-entry-hub__action voucher-entry-hub__action--live"
                  role="listitem"
                  title={action.description}
                  onClick={() => onOpenAction?.(action.id)}
                >
                  <span className="voucher-entry-hub__action-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span className="voucher-entry-hub__action-label">
                    {action.title.replace(/^Dispatch Challan\s*—\s*/i, '')}
                  </span>
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
