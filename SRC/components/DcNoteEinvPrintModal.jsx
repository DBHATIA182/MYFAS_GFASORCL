import React from 'react';
import PurchaseBillPrintModal from './PurchaseBillPrintModal';
import { toOracleDateFromAny } from '../utils/dateFormat';

/** Web equivalent of VFP DO FORM SALE_EINV_PRINT WITH type,r_date,r_date,r_no,r_no,''. */
export default function DcNoteEinvPrintModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  companyName,
  noteType,
  rDate,
  rNo,
  title = 'Debit Note',
}) {
  const oracleDt = toOracleDateFromAny(rDate);
  return (
    <PurchaseBillPrintModal
      open={open}
      onClose={onClose}
      apiBase={apiBase}
      compCode={compCode}
      compUid={compUid}
      companyName={companyName}
      einvMode
      billParams={
        rNo && oracleDt
          ? {
              type: noteType,
              oracleDt,
              r_date: oracleDt,
              rNo: rNo,
              r_no: rNo,
              label: `${title} — E-Invoice Print`,
            }
          : null
      }
    />
  );
}
