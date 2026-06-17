/**
 * GFASORCL Master Module — aligned with VFP DO FORM / DO commands.
 * VFP sources live under APPTEST/VFP-IMPORT (and subfolders).
 */
export const MASTER_MODULE_ITEMS = [
  {
    id: 'schedule-master',
    title: 'Schedule Master',
    shortTitle: 'Schedule',
    description: 'Account schedule chart (VFP: DO FORM nschedule)',
    vfpCommand: 'DO FORM nschedule',
    vfpFiles: ['nschedule.scx', 'nschedule.SCT'],
    implemented: true,
    slide: 29,
  },
  {
    id: 'account-master',
    title: 'A/c Master',
    shortTitle: 'A/c Master',
    description: 'Add, edit, or delete accounts in MASTER',
    vfpCommand: 'A/c Master (MASTER)',
    vfpFiles: [],
    implemented: true,
    slide: 26,
  },
  {
    id: 'item-category-master',
    title: 'Item Category Master',
    shortTitle: 'Item Category',
    description: 'Category master — CATMAST (VFP: catmast.scx)',
    vfpCommand: 'DO FORM CATMAST',
    vfpFiles: ['catmast.scx', 'catmast.SCT'],
    implemented: true,
    slide: 30,
  },
  {
    id: 'item-group-master',
    title: 'Item Group Master',
    shortTitle: 'Item Group',
    description: 'ITEM_GRP — VFP DO FORM CAT (cat.scx)',
    vfpCommand: 'DO FORM CAT',
    vfpFiles: ['VFP-IMPORT/cat.scx', 'VFP-IMPORT/cat.SCT'],
    implemented: true,
    slide: 31,
  },
  {
    id: 'item-master',
    title: 'Item Master',
    shortTitle: 'Item Master',
    description: 'Add, edit, or delete items in ITEMMAST',
    vfpCommand: 'DO FORM itemmast',
    vfpFiles: ['ITEM-MASTER/itemmast.scx', 'ITEM-MASTER/itemmast.SCT'],
    implemented: true,
    slide: 27,
  },
  {
    id: 'user-master',
    title: 'User Master',
    shortTitle: 'User',
    description: 'USERS hub table — VFP DO FORM USER (user.scx)',
    vfpCommand: 'DO FORM USER',
    vfpFiles: ['VFP-IMPORT/user.SCX', 'VFP-IMPORT/user.SCT'],
    implemented: true,
    slide: 32,
  },
  {
    id: 'user-password',
    title: 'User Password',
    shortTitle: 'Password',
    description: 'Change USERS.PW — VFP DO FORM PASSWORD (password.scx)',
    vfpCommand: 'DO FORM PASSWORD',
    vfpFiles: ['VFP-IMPORT/password.scx', 'VFP-IMPORT/password_sup.SCT'],
    implemented: true,
    slide: 35,
  },
  {
    id: 'bikri-exp',
    title: 'Bikri Exp',
    shortTitle: 'Bikri Exp',
    description: 'Bikri expense rates — BIKEXP (VFP: DO FORM BIKEXP)',
    vfpCommand: 'DO FORM BIKEXP',
    vfpFiles: ['VFP-IMPORT/bikexp.scx', 'VFP-IMPORT/bikexp.SCT'],
    implemented: true,
    slide: 36,
  },
  {
    id: 'godown-rent-master',
    title: 'Godown Rent Master',
    shortTitle: 'Godown Rent',
    description: 'Godown rent (VFP: DO GODRENT)',
    vfpCommand: 'DO GODRENT',
    vfpFiles: ['godrent.prg'],
    implemented: true,
    slide: 37,
  },
  {
    id: 'godown-master',
    title: 'Godown Master',
    shortTitle: 'Godown',
    description: 'Godown locations (VFP: DO FORM GODOWN)',
    vfpCommand: 'DO FORM GODOWN',
    vfpFiles: ['godown.scx', 'godown.SCT', 'godown.prg'],
    implemented: true,
    slide: 38,
  },
  {
    id: 'cost-centre-master',
    title: 'Cost Centre Master',
    shortTitle: 'Cost Centre',
    description: 'COST — cost centre and linked account (VFP: DO FORM COSTMAST)',
    vfpCommand: 'DO FORM COSTMAST',
    vfpFiles: ['costmast.scx', 'costmast.SCT'],
    implemented: true,
    slide: 39,
  },
  {
    id: 'customer-interest',
    title: 'Customer Interest',
    shortTitle: 'Cust Interest',
    description: 'NEWINT interest slabs (VFP: DO CUSTINT)',
    vfpCommand: 'DO CUSTINT',
    vfpFiles: ['custint.prg'],
    implemented: true,
    slide: 40,
  },
  {
    id: 'holiday-master',
    title: 'Holiday Master',
    shortTitle: 'Holiday',
    description: 'Holiday calendar (VFP: DO HOLIDAY)',
    vfpCommand: 'DO HOLIDAY',
    vfpFiles: ['holiday.prg'],
    implemented: true,
    slide: 41,
  },
  {
    id: 'dane-master',
    title: 'Dane Master',
    shortTitle: 'Dane',
    description: 'Dane master (VFP: DO DANE)',
    vfpCommand: 'DO DANE',
    vfpFiles: ['dane.prg'],
    implemented: true,
    slide: 42,
  },
  {
    id: 'marka-master',
    title: 'Marka Master',
    shortTitle: 'Marka',
    description: 'Marka rates (VFP: DO FORM MARKA)',
    vfpCommand: 'DO FORM MARKA',
    vfpFiles: ['marka.scx', 'marka.SCT'],
    implemented: true,
    slide: 43,
  },
  {
    id: 'purchase-exp-master',
    title: 'Purchase Exp Master',
    shortTitle: 'Pur Exp',
    description: 'Purchase expenses — PUREXP (VFP: DO FORM PUREXP)',
    vfpCommand: 'DO FORM PUREXP',
    vfpFiles: ['purexp.scx', 'purexp.SCT'],
    vfpNote: 'VFP form title: Tdsnat — Oracle table PUREXP (CAL_TYPE)',
    implemented: true,
    slide: 44,
  },
  {
    id: 'sale-bill-condition',
    title: 'Sale Bill Condition',
    shortTitle: 'Sale Cond',
    description: 'Sale bill conditions — SALE_COND (VFP: DO SALECOND)',
    vfpCommand: 'DO SALECOND',
    vfpFiles: ['salecond.prg'],
    vfpNote: 'Seven fixed rows COND1..COND7 — no append/delete',
    implemented: true,
    slide: 45,
  },
  {
    id: 'location-btype',
    title: 'Location Wise BType',
    shortTitle: 'Loc BType',
    description: 'Location-wise bill type — LOC_B_TYPE (VFP: DO LOC_B_TYPE)',
    vfpCommand: 'DO LOC_B_TYPE',
    vfpFiles: ['loc_b_type.prg'],
    vfpNote: 'B_TYPE, BILL_INIT, FIN_YEAR — browse grid save all',
    implemented: true,
    slide: 46,
  },
  {
    id: 'detail-master',
    title: 'Detail Master',
    shortTitle: 'Detail',
    description: 'Detail master — DETAIL_MASTER (VFP: DO FORM DETAIL)',
    vfpCommand: 'DO FORM DETAIL',
    vfpFiles: ['detail.scx', 'detail.SCT'],
    vfpNote: 'S_No, A/c Code, Trn_No + Detail lines',
    implemented: true,
    slide: 47,
  },
  {
    id: 'gst-state-master',
    title: 'GST State Master',
    shortTitle: 'GST State',
    description: 'GST state codes (VFP: DO GST_STATE)',
    vfpCommand: 'DO GST_STATE',
    vfpFiles: ['gst_state.prg'],
    vfpNote: 'STATE_CODE, STATE — browse grid save all',
    implemented: true,
    slide: 48,
  },
];

/** Slide number for unimplemented masters (placeholder UI). */
export const MASTER_PLACEHOLDER_SLIDE = 28;

const MASTER_BY_ID = Object.fromEntries(MASTER_MODULE_ITEMS.map((m) => [m.id, m]));

export function findMasterModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return MASTER_BY_ID[id] || null;
}

export function isMasterModuleReport(reportId) {
  return Boolean(findMasterModuleItem(reportId));
}

/** Route reportType to slide number, or null if not a master screen. */
export function resolveMasterSlideNo(reportType) {
  const item = findMasterModuleItem(reportType);
  if (!item) return null;
  if (item.implemented && item.slide) return item.slide;
  return MASTER_PLACEHOLDER_SLIDE;
}

/** Menu tiles for reportMenuConfig master-module section. */
export function masterMenuItemsForReportConfig() {
  return MASTER_MODULE_ITEMS.map((m) => ({
    id: m.id,
    title: m.title,
    shortTitle: m.shortTitle,
    description: m.implemented ? m.description : `${m.description} · Web UI pending`,
  }));
}
