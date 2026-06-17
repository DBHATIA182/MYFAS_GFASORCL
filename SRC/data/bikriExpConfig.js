/** VFP bikexp.scx — BIKEXP columns (GRAINFAS.BIKEXP). */
export const BIKRI_EXP_CAT_ORDER = 'ABCDEFGHIJKLMZ'.split('');

/** Grid rows: Bags / Katta / Hkatta / Amount + A/c code (name resolved from MASTER). */
export const BIKRI_EXP_GRID_ROWS = [
  { key: 'arhat', label: 'Arhat', b: 'ARHAT_B', k: 'ARHAT_K', h: 'ARHAT_H', a: 'ARHAT_A', cd: 'ARHAT_CD' },
  { key: 'labour', label: 'Labour', b: 'LABOUR_B', k: 'LABOUR_K', h: 'LABOUR_H', a: 'LABOUR_A', cd: 'LABOUR_CD' },
  { key: 'dala', label: 'Dala', b: 'DALA_B', k: 'DALA_K', h: 'DALA_H', a: 'DALA_A', cd: 'DALA_CD' },
  { key: 'dalali', label: 'Dalali', b: 'DALALI_B', k: 'DALALI_K', h: 'DALALI_H', a: 'DALALI_A', cd: 'DALALI_CD' },
  { key: 'postage', label: 'Postage', b: 'POSTAGE_B', k: 'POSTAGE_K', h: 'POSTAGE_H', a: 'POSTAGE_A', cd: 'POSTAGE_CD' },
  { key: 'sutli', label: 'Sutli', b: 'SUTLI_B', k: 'SUTLI_K', h: 'SUTLI_H', a: 'SUTLI_A', cd: 'SUTLI_CD' },
];

/** Amount + A/c only rows. */
export const BIKRI_EXP_AMOUNT_ROWS = [
  { key: 'dharmada', label: 'Dharmada', a: 'DHARMADA', cd: 'DHAR_CD' },
  { key: 'gaushala', label: 'Gaushala', a: 'GAUSHALA', cd: 'GAU_CD' },
  { key: 'insurance', label: 'Insurance', a: 'INSURANCE', cd: 'INS_CD' },
  { key: 'mudat', label: 'Mudat', a: 'MUDAT', cd: 'MUDAT_CD' },
];

/** Special rows (VFP bikexp.scx). */
export const BIKRI_EXP_SPECIAL_ROWS = [
  { key: 'godrent', label: 'Godrent', yn: 'GODRENT', cd: 'GOD_RENT_CODE', altCd: 'GODRENT_CD' },
  { key: 'avg_days', label: 'Days', a: 'AVG_DAYS' },
  { key: 'tl', label: 'Tampoo Labour', b: 'TL_RATE_B', k: 'TL_RATE_K', h: 'TL_RATE_H', a: 'TL_AMT_A', cd: 'TL_CODE' },
  { key: 'tb', label: 'Tampoo Bhara', b: 'TB_RATE_B', k: 'TB_RATE_K', h: 'TB_RATE_H', a: 'TB_AMT_A', cd: 'TB_CODE' },
  { key: 'st', label: 'Serv.Tax %', a: 'ST_PER', amt: 'ST_AMT', cd: 'ST_CODE' },
  { key: 'se', label: 'Edu.Cess %', a: 'SE_PER', amt: 'SE_AMT', cd: 'SE_CODE' },
];

export const BIKRI_EXP_CODE_FIELDS = [
  'ARHAT_CD',
  'LABOUR_CD',
  'DALA_CD',
  'DALALI_CD',
  'POSTAGE_CD',
  'SUTLI_CD',
  'DHAR_CD',
  'GAU_CD',
  'INS_CD',
  'MUDAT_CD',
  'GODRENT_CD',
  'GOD_RENT_CODE',
  'TL_CODE',
  'TB_CODE',
  'ST_CODE',
  'SE_CODE',
];
