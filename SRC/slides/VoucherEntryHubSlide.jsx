import React from 'react';
import SessionInfoLine from '../components/SessionInfoLine';
import CashVoucherEntryForm from '../components/CashVoucherEntryForm';
import {
  findTransactionModuleItem,
  voucherHubActionsForEntry,
} from '../data/transactionModuleConfig';
import { getVoucherEntryConfigByEntryId } from '../data/voucherEntryTypeConfig';

/**
 * Shared hub for cash / bank / journal voucher entry screens.
 * @param {{ apiBase: string, formData: object, userName: string, onPrev: () => void, onOpenAction: (id: string) => void, entryId: string, hubClassSuffix?: string }} props
 */
export default function VoucherEntryHubSlide({
  apiBase,
  formData,
  userName,
  onPrev,
  onOpenAction,
  entryId,
  hubClassSuffix = 'cash',
}) {
  const cfg = getVoucherEntryConfigByEntryId(entryId);
  const actions = voucherHubActionsForEntry(entryId);
  const entryMeta = findTransactionModuleItem(entryId);
  const backLabel = formData?.voucherHubReturn ? '← Back to report' : '← Back to menu';

  return (
    <div className={`slide voucher-entry-hub voucher-entry-hub--${hubClassSuffix}`}>
      <div className="voucher-entry-hub__shell">
        <header className="voucher-entry-hub__head">
          <h2 className="voucher-entry-hub__title">{entryMeta?.title || cfg.title}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId={cfg.helpReportId} />
        </header>

        <div className="voucher-entry-hub__body">
          <section className="voucher-entry-hub__primary" aria-labelledby={`${entryId}-heading`}>
            <h3 id={`${entryId}-heading`} className="voucher-entry-hub__section-label">
              Voucher entry
            </h3>
            <CashVoucherEntryForm
              apiBase={apiBase}
              formData={formData}
              userName={userName}
              onBack={onPrev}
              vrType={cfg.vrType}
              onOpenChecklist={
                cfg.checklistActionId && onOpenAction
                  ? () => onOpenAction(cfg.checklistActionId)
                  : undefined
              }
            />
          </section>

          {actions.length > 0 ? (
            <section className="voucher-entry-hub__actions" aria-labelledby={`${entryId}-actions-heading`}>
              <h3 id={`${entryId}-actions-heading`} className="voucher-entry-hub__section-label">
                {cfg.voucherKindLabel} actions
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
                      <span className="voucher-entry-hub__action-label">{action.shortTitle}</span>
                      <span className="voucher-entry-hub__action-title">{action.description}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="voucher-entry-hub__foot">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            {backLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
