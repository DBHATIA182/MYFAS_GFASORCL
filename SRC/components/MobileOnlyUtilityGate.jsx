import React from 'react';
import SessionInfoLine from './SessionInfoLine';
import {
  findUtilitiesModuleItem,
  isUtilityMobileOnlyBlocked,
  utilityMobileOnlyMessage,
} from '../data/utilitiesModuleConfig';

/** Blocks utility screens on desktop when mobileOnly is set in config. */
export default function MobileOnlyUtilityGate({ utilityId, formData, userName, onPrev, children }) {
  const item = findUtilitiesModuleItem(utilityId);
  const blocked = item && isUtilityMobileOnlyBlocked(item);

  if (blocked) {
    return (
      <div className="slide slide-utility-denied inttrf-screen detail-mast-screen">
        <div className="account-master-screen__head inttrf-screen__head">
          <h2 className="sale-bill-page__title inttrf-screen__title">{item.title}</h2>
          <SessionInfoLine formData={formData} userName={userName} helpReportId={utilityId} />
        </div>
        <div className="utility-denied utility-denied--desktop">
          <p className="utility-denied__badge">Mobile only</p>
          <p>
            <strong>Not available on desktop.</strong> {utilityMobileOnlyMessage(item)}
          </p>
          <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  return children;
}
