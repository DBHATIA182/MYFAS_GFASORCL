/**
 * Purchase Bill entry — VFP DO FORM &G_PURCHASE_FORM WITH 'PU', ...
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const express = require('express');

const PU_TYPE = 'PU';
const SCAN_UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'purchase-scan');

/** Store paths without drive letter — e.g. E:\GFAS\a.pdf → \GFAS\a.pdf */
function stripDriveLetterPath(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/\//g, '\\');
  if (!s) return '';
  s = s.replace(/^[A-Za-z]:/, '');
  if (s && !s.startsWith('\\')) s = '\\' + s;
  return s;
}

/** Resolve stored \path or drive path to an absolute FS path for open/read. */
function expandStoredScanPath(stored) {
  let s = String(stored || '')
    .trim()
    .replace(/\//g, '\\');
  if (!s) return '';
  if (/^[A-Za-z]:/.test(s)) return path.resolve(s);
  if (s.startsWith('\\\\')) return path.resolve(s);
  const withoutSlash = s.replace(/^\\+/, '');
  const uploadRootAbs = path.resolve(SCAN_UPLOAD_ROOT);
  const primaryRoot = path.parse(uploadRootAbs).root; // e.g. E:\
  const candidates = [
    path.join(primaryRoot, withoutSlash),
    path.join('E:\\', withoutSlash),
    path.join('D:\\', withoutSlash),
    path.join('C:\\', withoutSlash),
    path.join(uploadRootAbs, path.basename(withoutSlash)),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.resolve(c);
    } catch {
      /* ignore */
    }
  }
  return path.resolve(path.join(primaryRoot, withoutSlash));
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normStatus(v) {
  const s = String(v ?? 'B').trim().toUpperCase();
  return s || 'B';
}

function formatDateOut(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const dd = String(raw.getDate()).padStart(2, '0');
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${raw.getFullYear()}`;
  }
  const s = String(raw).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
  return s;
}

function entTimeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Ignore missing optional tables (BARDSTOCK / TDS / BILLS). */
async function tryExec(q, sql, binds) {
  try {
    await q(sql, binds);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/ORA-00942|ORA-00904/i.test(msg)) return;
    throw err;
  }
}

/**
 * VFP MYDEL — clear prior posts for this voucher before re-save.
 * Order: LEDGER → LOTSTOCK → BILLS → BARDSTOCK → TDS → PUREXP_DET → PURCHASE
 */
async function deletePurchaseRelated(q, { comp_code, type, r_date, r_no }) {
  const binds = { comp_code, type, r_date, r_no };
  const byVr = `COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:type)
      AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')) AND VR_NO = :r_no`;
  const byType = `COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
      AND TRUNC(R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')) AND R_NO = :r_no`;
  await q(`DELETE FROM LEDGER WHERE ${byVr}`, binds);
  await q(`DELETE FROM LOTSTOCK WHERE ${byVr}`, binds);
  await tryExec(q, `DELETE FROM BILLS WHERE ${byVr}`, binds);
  await tryExec(q, `DELETE FROM BARDSTOCK WHERE ${byVr}`, binds);
  await tryExec(q, `DELETE FROM TDS WHERE ${byVr}`, binds);
  await q(`DELETE FROM PUREXP_DET WHERE ${byType}`, binds);
  await q(`DELETE FROM PURCHASE WHERE ${byType}`, binds);
}

async function nextLotNo(q, comp_code, item_code, { stockTable = 'LOTSTOCK' } = {}) {
  const table = stockTable === 'BARDSTOCK' ? 'BARDSTOCK' : 'LOTSTOCK';
  const rows = await q(
    `SELECT NVL(MAX(LOT), 0) + 1 AS N FROM ${table} WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code`,
    { comp_code, item_code }
  );
  return Number(rows?.[0]?.N ?? rows?.[0]?.n ?? 1) || 1;
}

async function nextBatchNo(q, comp_code, { stockTable = 'LOTSTOCK' } = {}) {
  const table = stockTable === 'BARDSTOCK' ? 'BARDSTOCK' : 'LOTSTOCK';
  const rows = await q(`SELECT NVL(MAX(B_NO), 0) + 1 AS N FROM ${table} WHERE COMP_CODE = :comp_code`, {
    comp_code,
  });
  return Number(rows?.[0]?.N ?? rows?.[0]?.n ?? 1) || 1;
}

async function insertBardstockRow(q, binds) {
  await q(
    `INSERT INTO BARDSTOCK (
       COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, E_TYPE, SUP_CODE, ITEM_CODE, STATUS,
       QNTY, WEIGHT, RATE, AMOUNT, LOT, B_NO, GOD_CODE, SUP_DATE, COST_CODE, REMARKS,
       MSUP_CODE, MSUP_NAME, TAX_FORM
     ) VALUES (
       :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
       'R', :sup_code, :item_code, :status,
       :qnty, :weight, :rate, :amount, :lot, :b_no, :god_code, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')),
       :cost_code, :remarks,
       :msup_code, :msup_name, :tax_form
     )`,
    binds
  );
}

/** VFP Validate — per-line LEDGER + stock (LOTSTOCK for PU; BARDSTOCK for PB). */
async function postLineLedgerAndLotstock(q, {
  cc,
  cy,
  typ,
  rDateBind,
  r_no,
  header,
  ln,
  xLot,
  xBno,
  partyName,
  detail,
  ctx,
  user,
  ent_time,
  computer,
}) {
  // VFP M_PUR_CODE — use line PUR_CODE; fall back to supplier (same as PURCHASE insert).
  const purCode = normCode(ln.pur_code) || normCode(header.code);
  // Line merchandise + grid expenses without dedicated a/c codes (VFP uses G_LABCODE etc.)
  let drAmt =
    num(ln.amount) +
    num(ln.lab_amt) +
    num(ln.bard_amt) +
    num(ln.fgt_amt) +
    num(ln.ins_amt) +
    num(ln.oth_amt);
  if (typ === 'DN') drAmt = -Math.abs(drAmt);
  const xDetail = `${detail} @ ${num(ln.rate).toFixed(2)}`.slice(0, 100);
  if (purCode) {
    await q(
      `INSERT INTO LEDGER (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DETAIL, DC_CODE,
         ITEM_CODE, STATUS, QNTY, WEIGHT, RATE, COST_CODE, LOT, B_NO, TRN_NO, G_WEIGHT,
         USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         :code, :dr_amt, 0, :detail, :dc_code,
         :item_code, :status, :qnty, :weight, :rate, :cost_code, :lot, :b_no, :trn_no, :g_weight,
         :user_name, TRUNC(SYSDATE), :ent_time, :computer_name
       )`,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: typ,
        r_date: rDateBind,
        vr_no: r_no,
        code: purCode,
        dr_amt: drAmt,
        detail: xDetail,
        dc_code: header.code,
        item_code: ln.item_code,
        status: ln.status,
        qnty: ln.qnty,
        weight: ln.weight,
        rate: ln.rate,
        cost_code: ln.cost_code || header.cost_code,
        lot: xLot,
        b_no: xBno,
        trn_no: ln.trn_no,
        g_weight: ln.g_weight,
        user_name: user,
        ent_time,
        computer_name: computer,
      }
    );
  }

  // VFP: IF MSTK='Y' → stock table (PB → BARDSTOCK; else LOTSTOCK)
  if (header.stk !== 'Y') return;

  const useBardstock = String(typ || '').trim().toUpperCase() === 'PB';
  const mw =
    String(ctx.pur_wgt ?? 'W').trim().toUpperCase() === 'S' ? num(ln.stk_weight) : num(ln.weight);
  let qnty = num(ln.qnty);
  let weight = mw;
  let amount = num(ln.amount);
  let gWeight = num(ln.g_weight);
  let aWeight = num(ln.weight);
  let rate = num(ln.rate);
  if (typ === 'DN') {
    qnty = -Math.abs(qnty);
    weight = -Math.abs(weight);
    amount = -Math.abs(amount);
    gWeight = -Math.abs(gWeight);
    aWeight = -Math.abs(aWeight);
  }
  const stockBinds = {
    comp_code: cc,
    comp_year: cy,
    vr_type: typ,
    r_date: rDateBind,
    vr_no: r_no,
    // VFP SUP_CODE = M.S_CODE; fall back to bill supplier
    sup_code: normCode(ln.s_code) || header.code,
    item_code: ln.item_code,
    status: ln.status,
    qnty,
    weight,
    rate,
    amount,
    lot: xLot,
    b_no: xBno,
    god_code: header.god_code,
    cost_code: ln.cost_code || header.cost_code,
    remarks: String(ln.mlot_no || '').slice(0, 40),
    msup_code: header.code,
    msup_name: partyName,
    tax_form: header.form,
  };

  if (useBardstock) {
    await insertBardstockRow(q, stockBinds);
    return;
  }

  const lotBinds = {
    ...stockBinds,
    g_weight: gWeight,
    a_weight: aWeight,
    user_name: user,
    ent_time,
    computer_name: computer,
    exp_cat: header.exp_cat || '',
  };
  try {
    await q(
      `INSERT INTO LOTSTOCK (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, E_TYPE, SUP_CODE, ITEM_CODE, STATUS,
         QNTY, WEIGHT, RATE, AMOUNT, LOT, B_NO, GOD_CODE, SUP_DATE, COST_CODE, REMARKS,
         MSUP_CODE, MSUP_NAME, TAX_FORM, G_WEIGHT, A_WEIGHT, USER_NAME, ENT_DATE, ENT_TIME,
         COMPUTER_NAME, EXP_CAT
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         'R', :sup_code, :item_code, :status,
         :qnty, :weight, :rate, :amount, :lot, :b_no, :god_code, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')),
         :cost_code, :remarks,
         :msup_code, :msup_name, :tax_form, :g_weight, :a_weight, :user_name, TRUNC(SYSDATE), :ent_time,
         :computer_name, :exp_cat
       )`,
      lotBinds
    );
  } catch (err) {
    // Older schemas may lack EXP_CAT — retry without it (VFP always sends it when present).
    if (!/ORA-00904/i.test(String(err?.message || err))) throw err;
    const { exp_cat: _exp, ...bindsNoExp } = lotBinds;
    await q(
      `INSERT INTO LOTSTOCK (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, E_TYPE, SUP_CODE, ITEM_CODE, STATUS,
         QNTY, WEIGHT, RATE, AMOUNT, LOT, B_NO, GOD_CODE, SUP_DATE, COST_CODE, REMARKS,
         MSUP_CODE, MSUP_NAME, TAX_FORM, G_WEIGHT, A_WEIGHT, USER_NAME, ENT_DATE, ENT_TIME,
         COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         'R', :sup_code, :item_code, :status,
         :qnty, :weight, :rate, :amount, :lot, :b_no, :god_code, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')),
         :cost_code, :remarks,
         :msup_code, :msup_name, :tax_form, :g_weight, :a_weight, :user_name, TRUNC(SYSDATE), :ent_time,
         :computer_name
       )`,
      bindsNoExp
    );
  }

  // VFP: packaging bardana line → also BARDSTOCK when BARD_ITEM_CODE set
  const bardItem = Number(ln.bard_item_code ?? 0) || 0;
  if (bardItem) {
    let bQnty = qnty;
    let bAmount = amount;
    if (typ === 'DN') {
      bQnty = -Math.abs(bQnty);
      bAmount = -Math.abs(bAmount);
    }
    await insertBardstockRow(q, {
      ...stockBinds,
      item_code: bardItem,
      qnty: bQnty,
      amount: bAmount,
    });
  }
}

/** VFP Validate — header / expense / GST LEDGER rows after line scan. */
async function postHeaderLedger(q, {
  cc,
  cy,
  typ,
  rDateBind,
  r_no,
  header,
  lines,
  lineExpenses,
  partyName,
  detail,
  user,
  ent_time,
  computer,
  ntdsNature = '',
  fySDate = '',
  fyEDate = '',
}) {
  const isDn = typ === 'DN';
  const totQ = lines.reduce((s, ln) => s + num(ln.qnty), 0);
  const totW = lines.reduce((s, ln) => s + num(ln.weight), 0);
  const totCgst = lines.reduce((s, ln) => s + num(ln.cgst_amt), 0);
  const totSgst = lines.reduce((s, ln) => s + num(ln.sgst_amt), 0);
  const totIgst = lines.reduce((s, ln) => s + num(ln.igst_amt), 0);
  const totDis = lines.reduce((s, ln) => s + num(ln.dis_amt), 0);

  let myDetail = detail;
  if (header.truck) myDetail = `${myDetail} Truck No.${header.truck}`;
  if (!isDn && header.remarks) myDetail = `${myDetail} ${header.remarks}`;
  myDetail = myDetail.slice(0, 100);

  const billCr = num(header.bill_amt);
  await q(
    `INSERT INTO LEDGER (
       COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DETAIL,
       TRN_NO, QNTY, WEIGHT, V_DATE, USER_NAME, ENT_DATE, ENT_TIME,
       TCS_PER, TCS_ON_AMT, TCS_AMT, TDS_PER, TDS_ON_AMT, TDS_AMT, COMPUTER_NAME,
       BILL_DATE, INV_NO, INV_DATE
     ) VALUES (
       :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
       :code, :dr_amt, :cr_amt, :detail,
       101, :qnty, :weight, TRUNC(TO_DATE(:v_date, 'DD-MM-YYYY')), :user_name, TRUNC(SYSDATE), :ent_time,
       :tcs_per, :tcs_on_amt, :tcs_amt, :tds_per, :tds_on_amt, :tds_amt, :computer_name,
       TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY')), :inv_no, TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
     )`,
    {
      comp_code: cc,
      comp_year: cy,
      vr_type: typ,
      r_date: rDateBind,
      vr_no: r_no,
      code: header.code,
      dr_amt: isDn ? billCr : 0,
      cr_amt: isDn ? 0 : billCr,
      detail: myDetail,
      qnty: totQ,
      weight: totW,
      v_date: formatDateBindSafe(header.v_date) || rDateBind,
      user_name: user,
      ent_time,
      tcs_per: header.tcs_per,
      tcs_on_amt: totAmtForTcs(header, lines),
      tcs_amt: header.tcs_amt,
      tds_per: header.ntds_per,
      tds_on_amt: header.ntds_on_amt,
      tds_amt: header.ntds_amt,
      computer_name: computer,
      bill_date: formatDateBindSafe(header.bill_date) || rDateBind,
      inv_no: header.bill_no,
    }
  );

  let trn = 102;
  const postExp = async (code, amt, { flip = false } = {}) => {
    const a = num(amt);
    const c = normCode(code);
    if (!a || !c) {
      trn += 1;
      return;
    }
    let dr = 0;
    let cr = 0;
    if (flip) {
      // mud / discount style: PU → CR expense code
      if (isDn) {
        dr = a;
      } else {
        cr = a;
      }
    } else if (isDn) {
      cr = a;
    } else {
      dr = a;
    }
    await q(
      `INSERT INTO LEDGER (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DETAIL, DC_CODE,
         TRN_NO, COST_CODE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         :code, :dr_amt, :cr_amt, :detail, :dc_code,
         :trn_no, :cost_code, :user_name, TRUNC(SYSDATE), :ent_time, :computer_name
       )`,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: typ,
        r_date: rDateBind,
        vr_no: r_no,
        code: c,
        dr_amt: dr,
        cr_amt: cr,
        detail: detail.slice(0, 100),
        dc_code: header.code,
        trn_no: trn,
        cost_code: header.cost_code,
        user_name: user,
        ent_time,
        computer_name: computer,
      }
    );
    trn += 1;
  };

  await postExp(header.comm_code, header.comm_amt);
  await postExp(header.mud_code, header.mud_amt, { flip: true });

  // Debit-note style expenses on bill
  await postExp(header.brok_paid_code, header.brok_paid, { flip: true });
  await postExp(header.mandi_exp_code, header.mandi_exp, { flip: true });
  await postExp(header.labour_exp_code, header.labour_exp, { flip: true });
  await postExp(header.bardana_exp_code, header.bardana_exp, { flip: true });
  await postExp(header.freight_paid_code, header.freight_paid, { flip: true });
  await postExp(header.cd_amount_code, header.cd_amount, { flip: true });
  await postExp(header.dharam_kanta_code, header.dharam_kanta, { flip: true });
  await postExp(header.tulwai_code, header.tulwai_exp, { flip: true });
  await postExp(header.round_off_code, header.round_off, { flip: true });

  for (const [cd, amt] of [
    [header.oth_cd_1, header.oth_exp_1],
    [header.oth_cd_2, header.oth_exp_2],
    [header.oth_cd_3, header.oth_exp_3],
    [header.oth_cd_4, header.oth_exp_4],
    [header.oth_cd_5, header.oth_exp_5],
    [header.oth_cd_6, header.oth_exp_6],
    [header.oth_cd_7, header.oth_exp_7],
    [header.oth_cd_8, header.oth_exp_8],
  ]) {
    await postExp(cd, amt);
  }

  // GST / discount (VFP TRNNO 401+)
  trn = 401;
  const postTax = async (code, amt, { asCredit = false } = {}) => {
    const a = num(amt);
    const c = normCode(code);
    if (!a || !c) return;
    let dr = 0;
    let cr = 0;
    if (asCredit) {
      dr = isDn ? 0 : -a;
      cr = isDn ? -a : 0;
    } else if (isDn) {
      cr = a;
    } else {
      dr = a;
    }
    await q(
      `INSERT INTO LEDGER (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DETAIL, DC_CODE,
         TRN_NO, COST_CODE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         :code, :dr_amt, :cr_amt, :detail, :dc_code,
         :trn_no, :cost_code, :user_name, TRUNC(SYSDATE), :ent_time, :computer_name
       )`,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: typ,
        r_date: rDateBind,
        vr_no: r_no,
        code: c,
        dr_amt: dr,
        cr_amt: cr,
        detail: detail.slice(0, 100),
        dc_code: header.code,
        trn_no: trn,
        cost_code: header.cost_code,
        user_name: user,
        ent_time,
        computer_name: computer,
      }
    );
    trn += 1;
  };

  await postTax(header.cgst_code, totCgst);
  await postTax(header.sgst_code, totSgst);
  await postTax(header.igst_code, totIgst);
  await postTax(header.dis_code, totDis, { asCredit: true });

  // PUREXP_DET → LEDGER
  for (const exp of lineExpenses || []) {
    const amt = num(exp.amount);
    const code = normCode(exp.code);
    if (!amt || !code) continue;
    await q(
      `INSERT INTO LEDGER (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DETAIL, DC_CODE,
         COST_CODE, TRN_NO, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         :code, :dr_amt, :cr_amt, :detail, :dc_code,
         :cost_code, :trn_no, :user_name, TRUNC(SYSDATE), :ent_time, :computer_name
       )`,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: typ,
        r_date: rDateBind,
        vr_no: r_no,
        code,
        dr_amt: isDn ? 0 : amt,
        cr_amt: isDn ? amt : 0,
        detail: String(exp.exp_name || partyName || detail).slice(0, 100),
        dc_code: header.code,
        cost_code: header.cost_code,
        trn_no: trn++,
        user_name: user,
        ent_time,
        computer_name: computer,
      }
    );
  }

  // VFP Validate — PARTY TDS (NTDS): TRN 151 party DR + 152 TDS A/c CR + TDS table
  const ntdsAmt = num(header.ntds_amt);
  const ntdsCode = normCode(header.ntds_code);
  if (ntdsAmt && ntdsCode) {
    const ntdsOn = num(header.ntds_on_amt) || totAmtForTcs(header, lines);
    const ntdsPer = num(header.ntds_per);
    const nature = String(ntdsNature || '').trim().slice(0, 40);
    const detParty = `TDS ON AMOUNT ${ntdsOn.toFixed(2)} @ ${ntdsPer.toFixed(2)}%`.slice(0, 100);
    const detTds =
      `TDS ON AMOUNT ${ntdsOn.toFixed(2)} @ ${ntdsPer.toFixed(2)}% ${partyName} Inv.No. ${header.bill_no}`.slice(
        0,
        100
      );
    let partyDr = 0;
    let partyCr = 0;
    let tdsDr = 0;
    let tdsCr = 0;
    if (typ === 'PU' || typ === 'PB') {
      partyDr = ntdsAmt;
      tdsCr = ntdsAmt;
    } else {
      partyCr = ntdsAmt;
      tdsDr = ntdsAmt;
    }
    const partyBinds = {
      comp_code: cc,
      comp_year: cy,
      vr_type: typ,
      r_date: rDateBind,
      vr_no: r_no,
      code: header.code,
      dr_amt: partyDr,
      cr_amt: partyCr,
      dc_code: ntdsCode,
      detail: detParty,
      user_name: user,
      ent_time,
    };
    try {
      await q(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DC_CODE, TRN_NO, DETAIL,
           USER_NAME, ENT_DATE, ENT_TIME, E_TYPE
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, :dr_amt, :cr_amt, :dc_code, 151, :detail,
           :user_name, TRUNC(SYSDATE), :ent_time, 'T'
         )`,
        partyBinds
      );
    } catch (err) {
      if (!/ORA-00904/i.test(String(err?.message || err))) throw err;
      await q(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DC_CODE, TRN_NO, DETAIL,
           USER_NAME, ENT_DATE, ENT_TIME
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, :dr_amt, :cr_amt, :dc_code, 151, :detail,
           :user_name, TRUNC(SYSDATE), :ent_time
         )`,
        partyBinds
      );
    }
    try {
      await q(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DC_CODE, TRN_NO, DETAIL,
           TDS_PER, TDS_ON_AMT, TDS_AMT, TOT_TDS, TDS_ON_CD, NATURE,
           USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME, E_TYPE
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, :dr_amt, :cr_amt, :dc_code, 152, :detail,
           :tds_per, :tds_on_amt, :tds_amt, :tot_tds, :tds_on_cd, :nature,
           :user_name, TRUNC(SYSDATE), :ent_time, :computer_name, 'T'
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: typ,
          r_date: rDateBind,
          vr_no: r_no,
          code: ntdsCode,
          dr_amt: tdsDr,
          cr_amt: tdsCr,
          dc_code: header.code,
          detail: detTds,
          tds_per: ntdsPer,
          tds_on_amt: ntdsOn,
          tds_amt: ntdsAmt,
          tot_tds: ntdsAmt,
          tds_on_cd: header.code,
          nature,
          user_name: user,
          ent_time,
          computer_name: computer,
        }
      );
    } catch (err) {
      // Narrow schemas may omit TDS_* / NATURE / E_TYPE on LEDGER — post core CR row.
      if (!/ORA-00904/i.test(String(err?.message || err))) throw err;
      await q(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT, DC_CODE, TRN_NO, DETAIL,
           USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, :dr_amt, :cr_amt, :dc_code, 152, :detail,
           :user_name, TRUNC(SYSDATE), :ent_time, :computer_name
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: typ,
          r_date: rDateBind,
          vr_no: r_no,
          code: ntdsCode,
          dr_amt: tdsDr,
          cr_amt: tdsCr,
          dc_code: header.code,
          detail: detTds,
          user_name: user,
          ent_time,
          computer_name: computer,
        }
      );
    }
    const sDate = formatDateBindSafe(fySDate) || rDateBind;
    const eDate = formatDateBindSafe(fyEDate) || rDateBind;
    await tryExec(
      q,
      `INSERT INTO TDS (
         COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, AMOUNT, TDS_PER, TDS_AMT,
         TOT_TDS, NATURE, TC_CODE, S_DATE, E_DATE, ENT_TIME, USER_NAME, COMPUTER_NAME
       ) VALUES (
         :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
         :code, :amount, :tds_per, :tds_amt,
         :tot_tds, :nature, :tc_code,
         TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')), TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')),
         :ent_time, :user_name, :computer_name
       )`,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: typ,
        r_date: rDateBind,
        vr_no: r_no,
        code: header.code,
        amount: ntdsOn,
        tds_per: ntdsPer,
        tds_amt: ntdsAmt,
        tot_tds: ntdsAmt,
        nature,
        tc_code: ntdsCode,
        s_date: sDate,
        e_date: eDate,
        ent_time,
        user_name: user,
        computer_name: computer,
      }
    );
  }
}

/**
 * VFP PROCEDURE bills_trf + EXTRA LABOUR IN BILLS (Validate).
 * Main party CR bill (TRN 1), NTDS/expense adjustments on BILLS, optional labour row.
 */
async function postPurchaseBills(q, {
  cc,
  cy,
  typ,
  rDateBind,
  r_no,
  header,
  lines,
  partyName,
  partyCity = '',
  detail,
  ctx = {},
}) {
  const isDn = typ === 'DN';
  const billDate = formatDateBindSafe(header.bill_date) || rDateBind;
  const vDate = formatDateBindSafe(header.v_date) || billDate;
  // VFP bills_trf: for PU, BILL_NO := R_NO; for DN keep PU_R_NO / bill linkage
  const billsBillNo = isDn
    ? String(header.pu_r_no || header.bill_no || r_no)
    : String(r_no);
  const totQ = lines.reduce((s, ln) => s + num(ln.qnty), 0);
  const totW = lines.reduce((s, ln) => s + num(ln.weight), 0);
  const bDetail =
    detail ||
    `B.NO.:${header.bill_no || ''} ${totQ} ${Number(totW).toFixed(3)}`.slice(0, 100);
  const costCode = header.cost_code || '';
  const mbamt = num(header.bill_amt);
  const party = normCode(header.code);
  if (!party || !mbamt) return;

  const insertBill = async (binds) => {
    try {
      await q(
        `INSERT INTO BILLS (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, BILL_DATE, BILL_NO,
           DR_AMT, CR_AMT, DAYS, V_DATE, INT_TYPE, BK_CODE, DETAIL, COST_CODE, TRN_NO,
           TYPE, B_TYPE, TRUCK_NO
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY')), :bill_no,
           :dr_amt, :cr_amt, :days, TRUNC(TO_DATE(:v_date, 'DD-MM-YYYY')), :int_type, :bk_code,
           :detail, :cost_code, :trn_no,
           :type, :b_type, :truck_no
         )`,
        binds
      );
    } catch (err) {
      // Narrow schemas: omit optional columns and retry.
      if (!/ORA-00904/i.test(String(err?.message || err))) throw err;
      await q(
        `INSERT INTO BILLS (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, BILL_DATE, BILL_NO,
           DR_AMT, CR_AMT, V_DATE, DETAIL, COST_CODE, TRN_NO
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :vr_no,
           :code, TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY')), :bill_no,
           :dr_amt, :cr_amt, TRUNC(TO_DATE(:v_date, 'DD-MM-YYYY')), :detail, :cost_code, :trn_no
         )`,
        {
          comp_code: binds.comp_code,
          comp_year: binds.comp_year,
          vr_type: binds.vr_type,
          r_date: binds.r_date,
          vr_no: binds.vr_no,
          code: binds.code,
          bill_date: binds.bill_date,
          bill_no: binds.bill_no,
          dr_amt: binds.dr_amt,
          cr_amt: binds.cr_amt,
          v_date: binds.v_date,
          detail: binds.detail,
          cost_code: binds.cost_code,
          trn_no: binds.trn_no,
        }
      );
    }
  };

  const base = {
    comp_code: cc,
    comp_year: cy,
    vr_type: typ,
    r_date: rDateBind,
    vr_no: r_no,
    code: party,
    bill_date: billDate,
    bill_no: billsBillNo,
    v_date: vDate,
    cost_code: costCode,
    days: 0,
    int_type: '',
    bk_code: '',
    type: '',
    b_type: '',
    truck_no: '',
  };

  // TRN 1 — party purchase bill (PU: CR MBAMT)
  await insertBill({
    ...base,
    dr_amt: isDn ? mbamt : 0,
    cr_amt: isDn ? 0 : mbamt,
    days: num(header.due),
    int_type: header.bombay_dhara || '',
    bk_code: header.b_code || '',
    detail: bDetail.slice(0, 100),
    trn_no: 1,
  });

  const partyAdj = async (amt, trnNo, det, { flip = false } = {}) => {
    const a = num(amt);
    if (!a) return;
    let dr = 0;
    let cr = 0;
    if (flip) {
      // OTH_EXP 3/4 style on PU → CR
      if (isDn) {
        dr = a;
      } else {
        cr = a;
      }
    } else if (isDn) {
      cr = a;
    } else {
      dr = a;
    }
    await insertBill({
      ...base,
      dr_amt: dr,
      cr_amt: cr,
      detail: String(det || '').slice(0, 100),
      trn_no: trnNo,
    });
  };

  if (num(header.ntds_amt)) {
    await partyAdj(
      header.ntds_amt,
      3,
      `TDS ON ${num(header.ntds_on_amt).toFixed(2)} @ ${num(header.ntds_per).toFixed(2)}`
    );
  }

  if (
    num(header.brok_amt) &&
    normCode(header.brok_d_cd) &&
    normCode(header.brok_d_cd) === party
  ) {
    await partyAdj(header.brok_amt, 4, bDetail);
  }

  const purExpType = Number(ctx.pur_exp_type ?? 0) || 0;
  if (purExpType === 2) {
    await partyAdj(header.oth_exp_1, 5, 'Others 1');
    await partyAdj(header.oth_exp_2, 6, 'Others 2');
    await partyAdj(header.oth_exp_3, 7, 'Others 3', { flip: true });
    await partyAdj(header.oth_exp_4, 8, 'Others 4', { flip: true });
  }

  const dnExpType = Number(ctx.pur_debit_note_exp_type ?? 0) || 0;
  if (dnExpType === 1) {
    await partyAdj(header.brok_paid, 9, 'BROKERAGE');
    await partyAdj(header.mandi_exp, 10, 'MANDI EXP');
    await partyAdj(header.labour_exp, 11, 'LABOUR');
    await partyAdj(header.bardana_exp, 12, 'BARDANA EXP');
    await partyAdj(header.freight_paid, 13, 'FREIGHT');
    await partyAdj(header.cd_amount, 14, 'CD AMOUNT');
    await partyAdj(header.dharam_kanta, 15, 'DHARAM KANTA EXP');
    await partyAdj(header.tulwai_exp, 16, 'TULWAI');
    await partyAdj(header.round_off, 17, 'ROUND OFF');
  }

  // Broker commission TDS → BILLS TYPE/B_TYPE Z (Validate TRN after ledger 201)
  if (num(header.tds_amt) || num(header.tot_tds)) {
    const tdsAmt = num(header.tds_amt) || num(header.tot_tds);
    await insertBill({
      ...base,
      type: 'Z',
      b_type: 'Z',
      bill_no: String(r_no),
      dr_amt: tdsAmt,
      cr_amt: 0,
      detail: `TDS ON BILL NO.${header.bill_no || ''}`.slice(0, 100),
      trn_no: 2,
    });
  }

  // EXTRA LABOUR IN BILLS — CR on labour credit a/c, BK_CODE = labour debit a/c
  if (num(header.labour) && normCode(header.l_c_code)) {
    const truckNo = `${header.truck || ''}  ${partyName} ${partyCity}`.trim().slice(0, 50);
    const det = `Wgt:${Number(totW).toFixed(3)} Q ${totQ}`.slice(0, 100);
    await insertBill({
      ...base,
      code: normCode(header.l_c_code),
      bill_no: String(r_no),
      dr_amt: 0,
      cr_amt: num(header.labour),
      b_type: 'N',
      bk_code: normCode(header.l_d_code),
      int_type: 'F',
      truck_no: truckNo,
      detail: det,
      trn_no: 9,
    });
  }
}

/**
 * VFP Validate — expense amounts that post to LEDGER require A/c code (blank rejected).
 * Returns error message or ''.
 */
function validateLedgerExpenseCodes(header, lines, lineExpenses) {
  const need = (amt, code, label) => {
    if (!num(amt)) return '';
    if (normCode(code)) return '';
    return `${label} has amount but A/c code is blank.`;
  };
  const checks = [
    [header.comm_amt, header.comm_code, 'Dami / Commission'],
    [header.mud_amt, header.mud_code, 'Mudat'],
    [header.brok_paid, header.brok_paid_code, 'BrokPaid'],
    [header.mandi_exp, header.mandi_exp_code, 'Mandiexp'],
    [header.labour_exp, header.labour_exp_code, 'Labourexp'],
    [header.bardana_exp, header.bardana_exp_code, 'Bardana'],
    [header.freight_paid, header.freight_paid_code, 'Freight'],
    [header.cd_amount, header.cd_amount_code, 'Cd.'],
    [header.dharam_kanta, header.dharam_kanta_code, 'DharmKanta'],
    [header.tulwai_exp, header.tulwai_code, 'Tulwaiexp'],
    [header.round_off, header.round_off_code, 'RoundOff'],
    [header.oth_exp_1, header.oth_cd_1, 'Others 1'],
    [header.oth_exp_2, header.oth_cd_2, 'Others 2'],
    [header.oth_exp_3, header.oth_cd_3, 'Others 3'],
    [header.oth_exp_4, header.oth_cd_4, 'Others 4'],
    [header.oth_exp_5, header.oth_cd_5, 'Others 5'],
    [header.oth_exp_6, header.oth_cd_6, 'Others 6'],
    [header.oth_exp_7, header.oth_cd_7, 'Others 7'],
    [header.oth_exp_8, header.oth_cd_8, 'Others 8'],
    [header.ntds_amt, header.ntds_code, 'TDS'],
    [header.tcs_amt, header.tcs_code, 'TCS'],
    [header.brok_amt, header.brok_d_cd, 'Broker Debit'],
    [header.freight_hdr, header.f_dr_code, 'Freight Dr'],
    [header.freight_hdr, header.f_cr_code, 'Freight Cr'],
    [header.labour, header.l_d_code, 'Labour Dr'],
    [header.labour, header.l_c_code, 'Labour Cr'],
  ];
  for (const row of checks) {
    const err = need(row[0], row[1], row[2]);
    if (err) return err;
  }
  const sum = (k) => (lines || []).reduce((s, ln) => s + num(ln[k]), 0);
  for (const [amt, code, label] of [
    [sum('dis_amt'), header.dis_code, 'Discount'],
    [sum('cgst_amt'), header.cgst_code, 'CGST'],
    [sum('sgst_amt'), header.sgst_code, 'SGST'],
    [sum('igst_amt'), header.igst_code, 'IGST'],
  ]) {
    const err = need(amt, code, label);
    if (err) return err;
  }
  for (const exp of lineExpenses || []) {
    if (!num(exp.amount)) continue;
    if (normCode(exp.code)) continue;
    const name = String(exp.exp_name ?? '').trim() || 'Grid 2 expense';
    return `${name} has amount but A/c code is blank.`;
  }
  return '';
}

/** Collect A/c codes that must exist in MASTER — only when related amount/value is used (VFP Validate). */
function collectPurchaseMasterCodeChecks(header, lines, lineExpenses) {
  const out = [];
  const add = (code, label) => {
    const c = normCode(code);
    if (!c) return;
    out.push({ code: c, label });
  };
  /** Only validate when amount posts / is used — unused default codes (e.g. TCS from DEFVALUE) are skipped. */
  const addIfAmt = (amt, code, label) => {
    if (!num(amt)) return;
    add(code, label);
  };

  add(header.code, 'Supplier');
  addIfAmt(header.brok_amt, header.b_code, 'Broker');
  addIfAmt(header.brok_amt, header.brok_d_cd, 'Broker Debit');
  addIfAmt(header.comm_amt, header.comm_code, 'Dami / Commission');
  addIfAmt(header.mud_amt, header.mud_code, 'Mudat');
  addIfAmt(header.brok_paid, header.brok_paid_code, 'BrokPaid');
  addIfAmt(header.mandi_exp, header.mandi_exp_code, 'Mandiexp');
  addIfAmt(header.labour_exp, header.labour_exp_code, 'Labourexp');
  addIfAmt(header.bardana_exp, header.bardana_exp_code, 'Bardana');
  addIfAmt(header.freight_paid, header.freight_paid_code, 'Freight');
  addIfAmt(header.cd_amount, header.cd_amount_code, 'Cd.');
  addIfAmt(header.dharam_kanta, header.dharam_kanta_code, 'DharmKanta');
  addIfAmt(header.tulwai_exp, header.tulwai_code, 'Tulwaiexp');
  addIfAmt(header.round_off, header.round_off_code, 'RoundOff');
  addIfAmt(header.oth_exp_1, header.oth_cd_1, 'Others 1');
  addIfAmt(header.oth_exp_2, header.oth_cd_2, 'Others 2');
  addIfAmt(header.oth_exp_3, header.oth_cd_3, 'Others 3');
  addIfAmt(header.oth_exp_4, header.oth_cd_4, 'Others 4');
  addIfAmt(header.oth_exp_5, header.oth_cd_5, 'Others 5');
  addIfAmt(header.oth_exp_6, header.oth_cd_6, 'Others 6');
  addIfAmt(header.oth_exp_7, header.oth_cd_7, 'Others 7');
  addIfAmt(header.oth_exp_8, header.oth_cd_8, 'Others 8');
  addIfAmt(header.ntds_amt, header.ntds_code, 'TDS');
  addIfAmt(header.tcs_amt, header.tcs_code, 'TCS');
  addIfAmt(header.tds_amt || header.tot_tds, header.tds_code, 'Broker TDS');
  addIfAmt(header.freight_hdr, header.f_dr_code, 'Freight Dr');
  addIfAmt(header.freight_hdr, header.f_cr_code, 'Freight Cr');
  addIfAmt(header.labour, header.l_d_code, 'Labour Dr');
  addIfAmt(header.labour, header.l_c_code, 'Labour Cr');

  const sum = (k) => (lines || []).reduce((s, ln) => s + num(ln[k]), 0);
  addIfAmt(sum('dis_amt'), header.dis_code, 'Discount');
  addIfAmt(sum('cgst_amt'), header.cgst_code, 'CGST');
  addIfAmt(sum('sgst_amt'), header.sgst_code, 'SGST');
  addIfAmt(sum('igst_amt'), header.igst_code, 'IGST');

  for (const ln of lines || []) {
    if (!ln.item_code) continue;
    add(ln.pur_code, 'Purchase');
    add(ln.s_code, 'Sale');
  }
  for (const exp of lineExpenses || []) {
    if (!num(exp.amount)) continue;
    add(exp.code, String(exp.exp_name || '').trim() || 'Grid 2 expense');
  }
  return out;
}

function formatDateBindSafe(raw) {
  if (!raw) return '';
  if (typeof raw === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(raw.trim())) return raw.trim();
  try {
    const d = raw instanceof Date ? raw : null;
    if (d && !Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}-${mm}-${d.getFullYear()}`;
    }
  } catch {
    /* ignore */
  }
  return String(raw).trim();
}

function totAmtForTcs(header, lines) {
  const mamt = lines.reduce((s, ln) => s + num(ln.amount), 0);
  return mamt;
}

function isLoginOptionalTableError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

function isEffectiveCompUid(comp_uid) {
  const s = String(comp_uid ?? '').trim();
  return s.length > 0 && s !== '0';
}

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
}

function calcNetWeight(gWeight, dWeight) {
  return Math.max(0, Math.round((num(gWeight) - num(dWeight)) * 1000) / 1000);
}

function calcLineAmount(line, defaultQw = 'W') {
  const rate = num(line.rate);
  const mode = String(line.amt_cal ?? line.AMT_CAL ?? defaultQw).trim().toUpperCase() || defaultQw;
  const base = mode === 'Q' ? num(line.qnty) : num(line.weight);
  return Math.round(base * rate * 100) / 100;
}

function createPurchaseBill({ runQuery, parseDateOnly, withCompTransaction, runHubQuery }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createPurchaseBill requires runQuery and parseDateOnly');
  }
  const queryHub = typeof runHubQuery === 'function' ? runHubQuery : runQuery;

  function makeQuery(comp_uid, exec) {
    if (exec) {
      return async (sql, binds = {}) => {
        const result = await exec(sql, binds);
        return result.rows;
      };
    }
    return (sql, binds = {}) => runQuery(sql, binds, comp_uid, { autoCommit: true });
  }

  async function runInCompTx(comp_uid, fn) {
    if (typeof withCompTransaction === 'function') {
      return withCompTransaction(comp_uid, fn);
    }
    return fn(null);
  }

  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  /** VFP Validate — every non-blank A/c code must exist in MASTER. */
  async function assertPurchaseMasterCodesExist(comp_code, comp_uid, checks) {
    const list = Array.isArray(checks) ? checks : [];
    const unique = [];
    const seen = new Set();
    for (const row of list) {
      const c = normCode(row?.code);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      unique.push(c);
    }
    if (!unique.length) return;
    const found = new Set();
    const cc = Number(comp_code) || 0;
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40);
      const binds = { comp_code: cc };
      const ph = chunk.map((code, idx) => {
        binds[`c${idx}`] = code;
        return `TRIM(UPPER(:c${idx}))`;
      });
      const rows = await runQuery(
        `SELECT TRIM(CODE) AS CODE
           FROM MASTER
          WHERE COMP_CODE = :comp_code
            AND TRIM(UPPER(CODE)) IN (${ph.join(', ')})`,
        binds,
        comp_uid
      );
      for (const r of rows || []) {
        found.add(normCode(r.CODE ?? r.code));
      }
    }
    for (const row of list) {
      const c = normCode(row?.code);
      if (!c) continue;
      if (found.has(c)) continue;
      const err = new Error(`!!! Invalid ${row.label || 'A/c'} Code "${c}" !!!`);
      err.status = 400;
      throw err;
    }
  }

  async function fetchPurchaseUserF2String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f2: '', source: 'empty_user' };
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F2 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F2 ?? rows[0].f2;
          return { f2: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* optional */
        }
      }
    }
    return { f2: '', source: 'none' };
  }

  function purchasePermissionsFromF2(f2) {
    const str = String(f2 ?? '').trim();
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f2',
    };
  }

  async function fetchPurchaseUserPermissions(user_name) {
    const { f2, source } = await fetchPurchaseUserF2String(user_name);
    return { f2, source, ...purchasePermissionsFromF2(f2) };
  }

  async function assertPurchasePermission(user_name, kind) {
    const perms = await fetchPurchaseUserPermissions(user_name);
    if (!perms.canOpen) {
      const err = new Error('Access Denied');
      err.status = 403;
      throw err;
    }
    if (kind === 'add' && !perms.canAdd) {
      const err = new Error('Add permission denied.');
      err.status = 403;
      throw err;
    }
    if (kind === 'edit' && !perms.canEdit) {
      const err = new Error('Edit permission denied.');
      err.status = 403;
      throw err;
    }
    if (kind === 'delete' && !perms.canDelete) {
      const err = new Error('Delete permission denied.');
      err.status = 403;
      throw err;
    }
    return perms;
  }

  async function fetchPurchaseDefContext(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(PUR_EXP, 'N') AS PUR_EXP,
                NVL(PUR_EXP_TYPE, 0) AS PUR_EXP_TYPE,
                NVL(PUR_DEBIT_NOTE_EXP_TYPE, 0) AS PUR_DEBIT_NOTE_EXP_TYPE,
                NVL(PUR_ORDER_TYPE, 'N') AS PUR_ORDER_TYPE,
                NVL(PUR_WGT, 'W') AS PUR_WGT,
                NVL(PUR_STK_TRF, 'N') AS PUR_STK_TRF,
                NVL(PUR_CAL, 'W') AS PUR_CAL,
                NVL(WGT_K_Q, 'W') AS WGT_K_Q,
                NVL(GW_IN_PUR, 'Y') AS GW_IN_PUR,
                NVL(PDOLLAR_RATE, 'N') AS PDOLLAR_RATE,
                NVL(BROK_PAID_CODE, '') AS BROK_PAID_CODE,
                NVL(MANDI_EXP_CODE, '') AS MANDI_EXP_CODE,
                NVL(LABOUR_EXP_CODE, '') AS LABOUR_EXP_CODE,
                NVL(BARDANA_EXP_CODE, '') AS BARDANA_EXP_CODE,
                NVL(FREIGHT_PAID_CODE, '') AS FREIGHT_PAID_CODE,
                NVL(CD_AMOUNT_CODE, '') AS CD_AMOUNT_CODE,
                NVL(DHARAM_KANTA_CODE, '') AS DHARAM_KANTA_CODE,
                NVL(TULWAI_CODE, '') AS TULWAI_CODE,
                NVL(ROUND_OFF_CODE_PUR, '') AS ROUND_OFF_CODE,
                NVL(COMM_CODE, '') AS COMM_CODE,
                NVL(TCS_CODE, '') AS TCS_CODE,
                NVL(NTDS_CODE, '') AS NTDS_CODE,
                NVL(NTDS_NATURE, '') AS NTDS_NATURE,
                NVL(NTDS_PER, 0) AS NTDS_PER,
                NVL(EXP_CAT, '') AS EXP_CAT,
                NVL(CGST_CODE, '') AS CGST_CODE,
                NVL(SGST_CODE, '') AS SGST_CODE,
                NVL(IGST_CODE, '') AS IGST_CODE,
                NVL(BOMBAY_DHARA, '0') AS BOMBAY_DHARA
         FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const r = rows?.[0] || {};
      const yn = (v, def = 'N') => {
        const s = String(v ?? def).trim().toUpperCase();
        return s === 'Y' ? 'Y' : 'N';
      };
      const qw = (v) => (String(v ?? 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W');
      const wgtMode = (v) => {
        const s = String(v ?? 'W').trim().toUpperCase().slice(0, 1);
        return s || 'W';
      };
      let tds_round_off_value = 0;
      try {
        const tr = await runQuery(
          `SELECT NVL(TDS_ROUND_OFF_VALUE, 0) AS TDS_ROUND_OFF_VALUE
           FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
          { comp_code: Number(comp_code) || 0 },
          comp_uid
        );
        tds_round_off_value = num(tr?.[0]?.TDS_ROUND_OFF_VALUE ?? tr?.[0]?.tds_round_off_value);
      } catch {
        tds_round_off_value = 0;
      }
      return {
        pur_exp: yn(r.PUR_EXP ?? r.pur_exp),
        pur_exp_type: Number(r.PUR_EXP_TYPE ?? r.pur_exp_type ?? 0) || 0,
        pur_debit_note_exp_type: Number(r.PUR_DEBIT_NOTE_EXP_TYPE ?? r.pur_debit_note_exp_type ?? 0) || 0,
        pur_order_type: String(r.PUR_ORDER_TYPE ?? r.pur_order_type ?? 'N').trim().toUpperCase(),
        pur_wgt: qw(r.PUR_WGT ?? r.pur_wgt),
        pur_stk_trf: String(r.PUR_STK_TRF ?? r.pur_stk_trf ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
        pur_cal: qw(r.PUR_CAL ?? r.pur_cal),
        wgt_kq: wgtMode(r.WGT_K_Q ?? r.wgt_kq),
        tds_round_off_value,
        gw_in_pur: yn(r.GW_IN_PUR ?? r.gw_in_pur, 'Y'),
        pdollar_rate: yn(r.PDOLLAR_RATE ?? r.pdollar_rate, 'N'),
        brok_paid_code: normCode(r.BROK_PAID_CODE ?? r.brok_paid_code),
        mandi_exp_code: normCode(r.MANDI_EXP_CODE ?? r.mandi_exp_code),
        labour_exp_code: normCode(r.LABOUR_EXP_CODE ?? r.labour_exp_code),
        bardana_exp_code: normCode(r.BARDANA_EXP_CODE ?? r.bardana_exp_code),
        freight_paid_code: normCode(r.FREIGHT_PAID_CODE ?? r.freight_paid_code),
        cd_amount_code: normCode(r.CD_AMOUNT_CODE ?? r.cd_amount_code),
        dharam_kanta_code: normCode(r.DHARAM_KANTA_CODE ?? r.dharam_kanta_code),
        tulwai_code: normCode(r.TULWAI_CODE ?? r.tulwai_code),
        round_off_code: normCode(r.ROUND_OFF_CODE ?? r.round_off_code),
        comm_code: normCode(r.COMM_CODE ?? r.comm_code),
        tcs_code: normCode(r.TCS_CODE ?? r.tcs_code),
        ntds_code: normCode(r.NTDS_CODE ?? r.ntds_code),
        ntds_nature: String(r.NTDS_NATURE ?? r.ntds_nature ?? '').trim().slice(0, 40),
        ntds_per: num(r.NTDS_PER ?? r.ntds_per),
        tds_code: '',
        exp_cat: String(r.EXP_CAT ?? r.exp_cat ?? '').trim(),
        cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
        sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
        igst_code: normCode(r.IGST_CODE ?? r.igst_code),
        bombay_dhara: 'N',
      };
    } catch {
      return {
        pur_exp: 'N',
        pur_exp_type: 0,
        pur_debit_note_exp_type: 0,
        pur_order_type: 'N',
        pur_wgt: 'W',
        pur_stk_trf: 'N',
        pur_cal: 'W',
        wgt_kq: 'W',
        tds_round_off_value: 0,
        gw_in_pur: 'Y',
        pdollar_rate: 'N',
        brok_paid_code: '',
        mandi_exp_code: '',
        labour_exp_code: '',
        bardana_exp_code: '',
        freight_paid_code: '',
        cd_amount_code: '',
        dharam_kanta_code: '',
        tulwai_code: '',
        round_off_code: '',
        comm_code: '',
        tcs_code: '',
        ntds_code: '',
        ntds_nature: '',
        ntds_per: 0,
        tds_code: '',
        exp_cat: '',
        cgst_code: '',
        sgst_code: '',
        igst_code: '',
        bombay_dhara: 'N',
      };
    }
  }

  async function fetchGroupCd(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(GROUP_ID, 0) AS GROUP_ID FROM COMPANY WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      return Number(rows?.[0]?.GROUP_ID ?? rows?.[0]?.group_id ?? 0) || 0;
    } catch {
      return 0;
    }
  }

  async function fetchPurExpMaster(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT TRIM(T.EXP_NAME) AS EXP_NAME,
                NVL(T.EXP_RATE, 0) AS EXP_RATE,
                TRIM(NVL(T.CAL_TYPE, 'W')) AS CAL_TYPE,
                TRIM(NVL(T.CODE, '')) AS CODE,
                NVL(M.NAME, '') AS AC_NAME
         FROM PUREXP T
         LEFT JOIN MASTER M ON T.COMP_CODE = M.COMP_CODE AND TRIM(T.CODE) = TRIM(M.CODE)
         WHERE T.COMP_CODE = :comp_code
         ORDER BY UPPER(TRIM(T.EXP_NAME))`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      return (rows || []).map((r) => ({
        exp_name: String(r.EXP_NAME ?? r.exp_name ?? '').trim(),
        exp_rate: num(r.EXP_RATE ?? r.exp_rate),
        cal_type: String(r.CAL_TYPE ?? r.cal_type ?? 'W').trim().toUpperCase().slice(0, 1) || 'W',
        code: normCode(r.CODE ?? r.code),
        ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      }));
    } catch {
      return [];
    }
  }

  async function fetchNextRNo(comp_code, comp_uid, r_date, type = PU_TYPE) {
    const d = formatDateBind(r_date);
    if (!d) return 1;
    const rows = await runQuery(
      `SELECT NVL(MAX(R_NO), 0) + 1 AS NEXT_NO
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
         AND TRUNC(R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))`,
      { comp_code: Number(comp_code) || 0, type, r_date: d },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  function mapHeaderFromRow(h) {
    return {
      type: String(h.TYPE ?? h.type ?? PU_TYPE).trim(),
      r_date: formatDateOut(h.R_DATE ?? h.r_date),
      r_no: Number(h.R_NO ?? h.r_no ?? 0) || 0,
      bill_date: formatDateOut(h.BILL_DATE ?? h.bill_date),
      bill_no: String(h.BILL_NO ?? h.bill_no ?? '').trim(),
      due: num(h.DUE ?? h.due),
      v_date: formatDateOut(h.V_DATE ?? h.v_date),
      bombay_dhara: (() => {
        const raw = String(
          h.INT_TYPE ?? h.int_type ?? h.BOMBAY_DHARA ?? h.bombay_dhara ?? 'N'
        )
          .trim()
          .toUpperCase();
        return raw === 'Y' || raw === '1' ? 'Y' : 'N';
      })(),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? h.NAME ?? h.name ?? '').trim(),
      party_city: String(h.PARTY_CITY ?? h.party_city ?? h.CITY ?? h.city ?? '').trim(),
      gst_no: String(h.GST_NO ?? h.gst_no ?? '').trim(),
      pan: String(h.PAN ?? h.pan ?? '').trim(),
      msme_no: String(h.MSME_NO ?? h.msme_no ?? '').trim(),
      conv_rate: num(h.CONV_RATE ?? h.conv_rate),
      b_code: normCode(h.B_CODE ?? h.b_code),
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      gr_no: String(h.GR_NO ?? h.gr_no ?? '').trim(),
      tpt: String(h.TPT ?? h.tpt ?? '').trim(),
      form: String(h.FORM ?? h.form ?? h.M_FORM ?? '').trim(),
      truck: String(h.TRUCK ?? h.truck ?? '').trim(),
      god_code: normCode(h.GOD_CODE ?? h.god_code),
      god_name: String(h.GOD_NAME ?? h.god_name ?? '').trim(),
      cost_code: normCode(h.COST_CODE ?? h.cost_code),
      remarks: String(h.REMARKS ?? h.remarks ?? '').trim(),
      stk: String(h.STK ?? h.stk ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
      comm_per: num(h.COMM_PER ?? h.comm_per),
      comm_amt: num(h.COMM_AMT ?? h.comm_amt),
      comm_code: normCode(h.COMM_CODE ?? h.comm_code),
      comm_cal: String(h.COMM_CAL ?? h.comm_cal ?? '').trim(),
      brok_rate: num(h.BROK_RATE ?? h.brok_rate),
      brok_cal: String(h.BROK_CAL ?? h.brok_cal ?? '').trim(),
      brok_amt: num(h.BROK_AMT ?? h.brok_amt),
      brok_d_cd: normCode(h.BROK_D_CD ?? h.brok_d_cd),
      tds_comm: num(h.TDS_COMM ?? h.tds_comm),
      tds_no: String(h.TDS_NO ?? h.tds_no ?? '').trim(),
      sur_per: num(h.SUR_PER ?? h.sur_per),
      sur_amt: num(h.SUR_AMT ?? h.sur_amt),
      edu_per: num(h.EDU_PER ?? h.edu_per),
      edu_amt: num(h.EDU_AMT ?? h.edu_amt),
      tot_tds: num(h.TOT_TDS ?? h.tot_tds),
      freight_hdr: num(h.FREIGHT_HDR ?? h.freight_hdr ?? h.FREIGHT ?? h.freight),
      f_dr_code: normCode(h.F_DR_CODE ?? h.f_dr_code),
      f_cr_code: normCode(h.F_CR_CODE ?? h.f_cr_code),
      bl_no: String(h.BL_NO ?? h.bl_no ?? '').trim(),
      file_no: String(h.FILE_NO ?? h.file_no ?? '').trim(),
      bref_no: String(h.BREF_NO ?? h.bref_no ?? '').trim(),
      job_no: String(h.JOB_NO ?? h.job_no ?? '').trim(),
      p_bill_no_file_path: stripDriveLetterPath(h.P_BILL_NO_FILE_PATH ?? h.p_bill_no_file_path ?? ''),
      cform_amt: num(h.CFORM_AMT ?? h.cform_amt),
      lab_rate_hdr: num(h.LAB_RATE_HDR ?? h.lab_rate_hdr ?? h.LABOUR ?? h.labour),
      exp_cat: String(h.EXP_CAT ?? h.exp_cat ?? '').trim(),
      dis_per_hdr: num(h.DIS_PER_HDR ?? h.dis_per_hdr ?? h.DIS_PER ?? h.dis_per),
      dis_amt_hdr: num(h.DIS_AMT_HDR ?? h.dis_amt_hdr ?? h.DIS_AMT ?? h.dis_amt),
      dis_code: normCode(h.DIS_CODE ?? h.dis_code),
      cgst_code: normCode(h.CGST_CODE ?? h.cgst_code),
      sgst_code: normCode(h.SGST_CODE ?? h.sgst_code),
      igst_code: normCode(h.IGST_CODE ?? h.igst_code),
      mud_per: num(h.MUD_PER ?? h.mud_per),
      mud_amt: num(h.MUD_AMT ?? h.mud_amt),
      mud_code: normCode(h.MUD_CODE ?? h.mud_code),
      tcs_per: num(h.TCS_PER ?? h.tcs_per),
      tcs_amt: num(h.TCS_AMT ?? h.tcs_amt),
      tcs_code: normCode(h.TCS_CODE ?? h.tcs_code),
      ntds_per: num(h.NTDS_PER ?? h.ntds_per),
      ntds_amt: num(h.NTDS_AMT ?? h.ntds_amt),
      ntds_code: normCode(h.NTDS_CODE ?? h.ntds_code),
      ntds_on_amt: num(h.NTDS_ON_AMT ?? h.ntds_on_amt),
      tds_per: num(h.TDS_PER ?? h.tds_per),
      tds_amt: num(h.TDS_AMT ?? h.tds_amt),
      tds_code: normCode(h.TDS_CODE ?? h.tds_code),
      oth_exp_1: num(h.OTH_EXP_1 ?? h.oth_exp_1),
      oth_exp_2: num(h.OTH_EXP_2 ?? h.oth_exp_2),
      oth_exp_3: num(h.OTH_EXP_3 ?? h.oth_exp_3),
      oth_exp_4: num(h.OTH_EXP_4 ?? h.oth_exp_4),
      oth_exp_5: num(h.OTH_EXP_5 ?? h.oth_exp_5),
      oth_exp_6: num(h.OTH_EXP_6 ?? h.oth_exp_6),
      oth_exp_7: num(h.OTH_EXP_7 ?? h.oth_exp_7),
      oth_exp_8: num(h.OTH_EXP_8 ?? h.oth_exp_8),
      oth_cd_1: normCode(h.OTH_CD_1 ?? h.oth_cd_1),
      oth_cd_2: normCode(h.OTH_CD_2 ?? h.oth_cd_2),
      oth_cd_3: normCode(h.OTH_CD_3 ?? h.oth_cd_3),
      oth_cd_4: normCode(h.OTH_CD_4 ?? h.oth_cd_4),
      oth_cd_5: normCode(h.OTH_CD_5 ?? h.oth_cd_5),
      oth_cd_6: normCode(h.OTH_CD_6 ?? h.oth_cd_6),
      oth_cd_7: normCode(h.OTH_CD_7 ?? h.oth_cd_7),
      oth_cd_8: normCode(h.OTH_CD_8 ?? h.oth_cd_8),
      brok_paid: num(h.BROK_PAID ?? h.brok_paid),
      brok_paid_code: normCode(h.BROK_PAID_CODE ?? h.brok_paid_code),
      mandi_exp: num(h.MANDI_EXP ?? h.mandi_exp),
      mandi_exp_code: normCode(h.MANDI_EXP_CODE ?? h.mandi_exp_code),
      labour_exp: num(h.LABOUR_EXP ?? h.labour_exp),
      labour_exp_code: normCode(h.LABOUR_EXP_CODE ?? h.labour_exp_code),
      bardana_exp: num(h.BARDANA_EXP ?? h.bardana_exp),
      bardana_exp_code: normCode(h.BARDANA_EXP_CODE ?? h.bardana_exp_code),
      freight_paid: num(h.FREIGHT_PAID ?? h.freight_paid ?? h.FREIGHT ?? h.freight),
      freight_paid_code: normCode(h.FREIGHT_PAID_CODE ?? h.freight_paid_code),
      cd_amount: num(h.CD_AMOUNT ?? h.cd_amount),
      cd_amount_code: normCode(h.CD_AMOUNT_CODE ?? h.cd_amount_code),
      dharam_kanta: num(h.DHARAM_KANTA ?? h.dharam_kanta),
      dharam_kanta_code: normCode(h.DHARAM_KANTA_CODE ?? h.dharam_kanta_code),
      tulwai_exp: num(h.TULWAI_EXP ?? h.tulwai_exp),
      tulwai_code: normCode(h.TULWAI_CODE ?? h.tulwai_code),
      round_off: num(h.ROUND_OFF ?? h.round_off),
      round_off_code: normCode(h.ROUND_OFF_CODE ?? h.round_off_code),
      bill_amt: num(h.BILL_AMT ?? h.bill_amt),
      labour: num(h.LABOUR ?? h.labour),
      l_d_code: normCode(h.L_D_CODE ?? h.l_d_code),
      l_c_code: normCode(h.L_C_CODE ?? h.l_c_code),
      pu_r_no: Number(h.PU_R_NO ?? h.pu_r_no ?? 0) || 0,
    };
  }

  function mapLineFromRow(r, idx) {
    return {
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      pur_code: normCode(r.PUR_CODE ?? r.pur_code),
      pur_name: String(r.PUR_NAME ?? r.pur_name ?? '').trim(),
      s_code: normCode(r.S_CODE ?? r.s_code),
      s_name: String(r.S_NAME ?? r.s_name ?? '').trim(),
      bard_item_code: Number(r.BARD_ITEM_CODE ?? r.bard_item_code ?? 0) || 0,
      bard_item_name: String(r.BARD_ITEM_NAME ?? r.bard_item_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      qnty: num(r.QNTY ?? r.qnty),
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      d_weight: num(r.D_WEIGHT ?? r.d_weight),
      weight: num(r.WEIGHT ?? r.weight),
      stk_weight: num(r.STK_WEIGHT ?? r.stk_weight),
      usd_rate: num(r.USD_RATE ?? r.usd_rate),
      usd_amount: num(r.USD_AMOUNT ?? r.usd_amount),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      amt_cal: String(r.AMT_CAL ?? r.amt_cal ?? 'W').trim().toUpperCase() || 'W',
      dis_per: num(r.DIS_PER ?? r.dis_per),
      dis_amt: num(r.DIS_AMT ?? r.dis_amt),
      cgst_per: num(r.CGST_PER ?? r.cgst_per),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_per: num(r.SGST_PER ?? r.sgst_per),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_per: num(r.IGST_PER ?? r.igst_per),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
      lab_amt: num(r.LAB_AMT ?? r.lab_amt),
      bard_amt: num(r.BARD_AMT ?? r.bard_amt),
      bard_per: num(r.BARD_PER ?? r.bard_per),
      lab_per: num(r.LAB_PER ?? r.lab_per),
      fgt_amt: num(r.FGT_AMT ?? r.fgt_amt),
      ins_amt: num(r.INS_AMT ?? r.ins_amt),
      oth_amt: num(r.OTH_AMT ?? r.oth_amt),
      dane_rate: num(r.DANE_RATE ?? r.dane_rate),
      dane_amt: num(r.DANE_AMT ?? r.dane_amt),
      pmt_rate: num(r.LAB_RATE ?? r.lab_rate ?? r.PMT_RATE ?? r.pmt_rate),
      lot: Number(r.LOT ?? r.lot ?? 0) || 0,
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      mlot_no: String(r.MLOT_NO ?? r.mlot_no ?? '').trim(),
    };
  }

  async function loadPurexpDet(comp_code, comp_uid, type, r_date, r_no) {
    const d = formatDateBind(r_date);
    if (!d) return [];
    try {
      const rows = await runQuery(
        `SELECT TRN_NO, EXP_NAME, EXP_RATE, CAL_TYPE, AMOUNT, CODE
         FROM PUREXP_DET
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND TRUNC(R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))
           AND R_NO = :r_no
         ORDER BY TRN_NO, EXP_NAME`,
        { comp_code: Number(comp_code) || 0, type, r_date: d, r_no: Number(r_no) || 0 },
        comp_uid
      );
      return (rows || []).map((r) => {
        const rawTrn = Number(r.TRN_NO ?? r.trn_no ?? 0) || 0;
        const trn_no = rawTrn >= 1000 ? Math.floor(rawTrn / 1000) : rawTrn;
        return {
          trn_no,
          exp_name: String(r.EXP_NAME ?? r.exp_name ?? '').trim(),
          exp_rate: num(r.EXP_RATE ?? r.exp_rate),
          cal_type: String(r.CAL_TYPE ?? r.cal_type ?? 'W').trim().toUpperCase().slice(0, 1) || 'W',
          amount: num(r.AMOUNT ?? r.amount),
          code: normCode(r.CODE ?? r.code),
        };
      });
    } catch {
      return [];
    }
  }

  async function loadPurchaseBill(comp_code, comp_uid, type, r_date, r_no) {
    const typ = String(type ?? PU_TYPE).trim();
    const d = formatDateBind(r_date);
    const no = Number(r_no) || 0;
    if (!d || !no) {
      const err = new Error('Voucher date and number are required.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT A.*,
              P.NAME AS PARTY_NAME, P.CITY AS PARTY_CITY, P.GST_NO, P.PAN,
              BK.NAME AS BK_NAME,
              G.GOD_NAME,
              IT.ITEM_NAME,
              PURM.NAME AS PUR_NAME,
              SCM.NAME AS S_NAME,
              BARD.ITEM_NAME AS BARD_ITEM_NAME
       FROM PURCHASE A
       JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.CODE = P.CODE
       LEFT JOIN MASTER BK ON A.COMP_CODE = BK.COMP_CODE AND A.B_CODE = BK.CODE
       LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
       JOIN ITEMMAST IT ON A.COMP_CODE = IT.COMP_CODE AND A.ITEM_CODE = IT.ITEM_CODE
       LEFT JOIN MASTER PURM ON A.COMP_CODE = PURM.COMP_CODE AND A.PUR_CODE = PURM.CODE
       LEFT JOIN MASTER SCM ON A.COMP_CODE = SCM.COMP_CODE AND A.S_CODE = SCM.CODE
       LEFT JOIN ITEMMAST BARD ON A.COMP_CODE = BARD.COMP_CODE AND A.BARD_ITEM_CODE = BARD.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)
         AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))
         AND A.R_NO = :r_no
       ORDER BY A.TRN_NO`,
      { comp_code: Number(comp_code) || 0, type: typ, r_date: d, r_no: no },
      comp_uid
    );
    if (!rows?.length) {
      const err = new Error('Purchase bill not found.');
      err.status = 404;
      throw err;
    }
    const header = mapHeaderFromRow(rows[0]);
    const lines = rows.map((r, idx) => mapLineFromRow(r, idx));
    const line_expenses = await loadPurexpDet(comp_code, comp_uid, typ, d, no);
    return { ok: true, header, lines, line_expenses };
  }

  async function listPurchaseBills(comp_code, comp_uid, filters = {}) {
    const typ = String(filters.type ?? PU_TYPE).trim();
    const binds = { comp_code: Number(comp_code) || 0, type: typ };
    let where = 'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)';
    if (filters.sdt) {
      where += ' AND TRUNC(A.R_DATE) >= TRUNC(TO_DATE(:sdt, \'DD-MM-YYYY\'))';
      binds.sdt = formatDateBind(filters.sdt);
    }
    if (filters.edt) {
      where += ' AND TRUNC(A.R_DATE) <= TRUNC(TO_DATE(:edt, \'DD-MM-YYYY\'))';
      binds.edt = formatDateBind(filters.edt);
    }
    if (filters.party) {
      where += ' AND TRIM(A.CODE) = TRIM(:party)';
      binds.party = normCode(filters.party);
    }
    const rows = await runQuery(
      `SELECT TRUNC(A.R_DATE) AS R_DATE, A.R_NO,
              MAX(A.CODE) AS CODE, MAX(P.NAME) AS PARTY_NAME,
              MAX(A.BILL_NO) AS BILL_NO,
              COUNT(*) AS LINE_COUNT,
              SUM(NVL(A.AMOUNT, 0)) AS TOT_AMT
       FROM PURCHASE A
       JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.CODE = P.CODE
       WHERE ${where}
       GROUP BY TRUNC(A.R_DATE), A.R_NO
       ORDER BY TRUNC(A.R_DATE) DESC, A.R_NO DESC`,
      binds,
      comp_uid
    );
    return (rows || []).map((r) => ({
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      line_count: Number(r.LINE_COUNT ?? r.line_count ?? 0) || 0,
      tot_amt: num(r.TOT_AMT ?? r.tot_amt).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    }));
  }

  /**
   * VFP purchase_gst DN bill help (TEMP): PURCHASE TYPE=PU lines for supplier CODE.
   * Choose fills broker, item, qty/wgt/rate/status, god, lot, b_no, so_no (Po.No).
   */
  async function fetchDnSourceLines(comp_code, comp_uid, partyCode) {
    const cc = Number(comp_code) || 0;
    const code = normCode(partyCode);
    if (!code) {
      const err = new Error('Enter supplier code before bill help.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT TRUNC(A.R_DATE) AS R_DATE,
              A.R_NO,
              NVL(A.BILL_NO, ' ') AS BILL_NO,
              TRUNC(A.BILL_DATE) AS BILL_DATE,
              A.ITEM_CODE,
              NVL(C.ITEM_NAME, ' ') AS ITEM_NAME,
              NVL(A.STATUS, 'B') AS STATUS,
              NVL(A.QNTY, 0) AS QNTY,
              NVL(A.WEIGHT, 0) AS WEIGHT,
              NVL(A.RATE, 0) AS RATE,
              NVL(A.AMOUNT, 0) AS AMOUNT,
              NVL(A.LOT, 0) AS LOT,
              NVL(A.B_NO, 0) AS B_NO,
              NVL(A.B_CODE, ' ') AS B_CODE,
              NVL(A.GOD_CODE, ' ') AS GOD_CODE,
              NVL(A.MLOT_NO, ' ') AS MLOT_NO,
              NVL(A.SO_NO, 0) AS SO_NO,
              NVL(A.TRN_NO, 0) AS TRN_NO,
              NVL(A.PUR_CODE, ' ') AS PUR_CODE,
              NVL(A.S_CODE, ' ') AS S_CODE,
              NVL(A.AMT_CAL, 'W') AS AMT_CAL,
              NVL(A.G_WEIGHT, 0) AS G_WEIGHT,
              NVL(A.D_WEIGHT, 0) AS D_WEIGHT
       FROM PURCHASE A
       LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = 'PU'
         AND TRIM(A.CODE) = TRIM(:code)
       ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`,
      { comp_code: cc, code },
      comp_uid
    );
    return (rows || []).map((r, idx) => ({
      id: `${formatDateOut(r.R_DATE ?? r.r_date)}-${r.R_NO ?? r.r_no}-${r.TRN_NO ?? r.trn_no}-${idx}`,
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: String(r.STATUS ?? r.status ?? 'B').trim() || 'B',
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      lot: Number(r.LOT ?? r.lot ?? 0) || 0,
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
      b_code: normCode(r.B_CODE ?? r.b_code),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      mlot_no: String(r.MLOT_NO ?? r.mlot_no ?? '').trim(),
      so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
      pur_code: normCode(r.PUR_CODE ?? r.pur_code),
      s_code: normCode(r.S_CODE ?? r.s_code),
      amt_cal: String(r.AMT_CAL ?? r.amt_cal ?? 'W').trim().slice(0, 1) || 'W',
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      d_weight: num(r.D_WEIGHT ?? r.d_weight),
    }));
  }

  async function listBillKeys(comp_code, comp_uid, type = PU_TYPE) {
    const rows = await runQuery(
      `SELECT TRUNC(R_DATE) AS R_DATE, R_NO
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
       GROUP BY TRUNC(R_DATE), R_NO
       ORDER BY TRUNC(R_DATE), R_NO`,
      { comp_code: Number(comp_code) || 0, type },
      comp_uid
    );
    return (rows || []).map((r) => ({
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
    }));
  }

  async function navigatePurchaseBill(comp_code, comp_uid, type, r_date, r_no, direction) {
    const keys = await listBillKeys(comp_code, comp_uid, type);
    if (!keys.length) {
      const err = new Error('No purchase bills found.');
      err.status = 404;
      throw err;
    }
    const dir = String(direction || 'next').trim().toLowerCase();
    const curNo = Number(r_no) || 0;
    const curDate = formatDateOut(r_date);
    let idx = keys.findIndex((k) => k.r_no === curNo && (!curDate || k.r_date === curDate));
    if (idx === -1) idx = keys.findIndex((k) => k.r_no === curNo);
    if (dir === 'first' || dir === 'top') return loadPurchaseBill(comp_code, comp_uid, type, keys[0].r_date, keys[0].r_no);
    if (dir === 'last' || dir === 'bottom') {
      const last = keys[keys.length - 1];
      return loadPurchaseBill(comp_code, comp_uid, type, last.r_date, last.r_no);
    }
    if (dir === 'prev' || dir === 'previous') {
      const pick = idx <= 0 ? keys[0] : keys[idx - 1];
      return loadPurchaseBill(comp_code, comp_uid, type, pick.r_date, pick.r_no);
    }
    const pick = idx < 0 || idx >= keys.length - 1 ? keys[keys.length - 1] : keys[idx + 1];
    return loadPurchaseBill(comp_code, comp_uid, type, pick.r_date, pick.r_no);
  }

  /** LEDGER + LOTSTOCK + BILLS for the opened purchase bill (posting verification). */
  async function fetchPurchasePosting(comp_code, comp_uid, type, r_date, r_no) {
    const cc = Number(comp_code) || 0;
    const typ = String(type ?? PU_TYPE).trim() || PU_TYPE;
    const rDateBind = formatDateBind(r_date);
    const vrNo = Number(r_no) || 0;
    if (!rDateBind || !vrNo) {
      const err = new Error('Voucher date and number are required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type: typ, r_date: rDateBind, r_no: vrNo };
    const byVr = `A.COMP_CODE = :comp_code AND TRIM(A.VR_TYPE) = TRIM(:type)
      AND TRUNC(A.VR_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')) AND A.VR_NO = :r_no`;

    let ledger = [];
    try {
      const rows = await runQuery(
        `SELECT A.TRN_NO, A.CODE, M.NAME AS AC_NAME, A.DR_AMT, A.CR_AMT, A.DETAIL, A.DC_CODE,
                A.ITEM_CODE, A.STATUS, A.QNTY, A.WEIGHT, A.RATE, A.LOT, A.B_NO, A.E_TYPE, A.COST_CODE
           FROM LEDGER A
           LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND TRIM(A.CODE) = TRIM(M.CODE)
          WHERE ${byVr}
          ORDER BY NVL(A.TRN_NO, 0), A.CODE`,
        binds,
        comp_uid
      );
      ledger = (rows || []).map((r) => ({
        trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
        code: normCode(r.CODE ?? r.code),
        ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
        dr_amt: num(r.DR_AMT ?? r.dr_amt),
        cr_amt: num(r.CR_AMT ?? r.cr_amt),
        detail: String(r.DETAIL ?? r.detail ?? '').trim(),
        dc_code: normCode(r.DC_CODE ?? r.dc_code),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        status: String(r.STATUS ?? r.status ?? '').trim(),
        qnty: num(r.QNTY ?? r.qnty),
        weight: num(r.WEIGHT ?? r.weight),
        rate: num(r.RATE ?? r.rate),
        lot: Number(r.LOT ?? r.lot ?? 0) || 0,
        b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
        e_type: String(r.E_TYPE ?? r.e_type ?? '').trim(),
        cost_code: normCode(r.COST_CODE ?? r.cost_code),
      }));
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }

    let lotstock = [];
    let bardstock = [];
    const mapStockRow = (r) => ({
      e_type: String(r.E_TYPE ?? r.e_type ?? '').trim(),
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: String(r.STATUS ?? r.status ?? '').trim(),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      lot: Number(r.LOT ?? r.lot ?? 0) || 0,
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      sup_code: normCode(r.SUP_CODE ?? r.sup_code),
      msup_code: normCode(r.MSUP_CODE ?? r.msup_code),
      msup_name: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      a_weight: num(r.A_WEIGHT ?? r.a_weight),
    });
    try {
      if (typ === 'PB') {
        const rows = await runQuery(
          `SELECT A.E_TYPE, A.ITEM_CODE, I.ITEM_NAME, A.STATUS, A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
                  A.LOT, A.B_NO, A.GOD_CODE, A.SUP_CODE, A.MSUP_CODE, A.MSUP_NAME, A.COST_CODE, A.REMARKS
             FROM BARDSTOCK A
             LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
            WHERE ${byVr}
            ORDER BY A.ITEM_CODE, NVL(A.LOT, 0), NVL(A.B_NO, 0)`,
          binds,
          comp_uid
        );
        bardstock = (rows || []).map(mapStockRow);
      } else {
        const rows = await runQuery(
          `SELECT A.E_TYPE, A.ITEM_CODE, I.ITEM_NAME, A.STATUS, A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
                  A.LOT, A.B_NO, A.GOD_CODE, A.SUP_CODE, A.MSUP_CODE, A.MSUP_NAME, A.COST_CODE,
                  A.REMARKS, A.G_WEIGHT, A.A_WEIGHT
             FROM LOTSTOCK A
             LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
            WHERE ${byVr}
            ORDER BY A.ITEM_CODE, NVL(A.LOT, 0), NVL(A.B_NO, 0)`,
          binds,
          comp_uid
        );
        lotstock = (rows || []).map(mapStockRow);
      }
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }

    let bills = [];
    try {
      const rows = await runQuery(
        `SELECT A.TRN_NO, A.CODE, M.NAME AS AC_NAME, A.BILL_DATE, A.BILL_NO, A.DR_AMT, A.CR_AMT,
                A.DETAIL, A.DAYS, A.V_DATE, A.B_TYPE, A.TYPE, A.BK_CODE, A.COST_CODE, A.INT_TYPE, A.TRUCK_NO
           FROM BILLS A
           LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND TRIM(A.CODE) = TRIM(M.CODE)
          WHERE ${byVr}
          ORDER BY NVL(A.TRN_NO, 0), A.CODE`,
        binds,
        comp_uid
      );
      bills = (rows || []).map((r) => ({
        trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
        code: normCode(r.CODE ?? r.code),
        ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
        bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
        bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
        dr_amt: num(r.DR_AMT ?? r.dr_amt),
        cr_amt: num(r.CR_AMT ?? r.cr_amt),
        detail: String(r.DETAIL ?? r.detail ?? '').trim(),
        days: num(r.DAYS ?? r.days),
        v_date: formatDateOut(r.V_DATE ?? r.v_date),
        b_type: String(r.B_TYPE ?? r.b_type ?? '').trim(),
        type: String(r.TYPE ?? r.type ?? '').trim(),
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        cost_code: normCode(r.COST_CODE ?? r.cost_code),
        int_type: String(r.INT_TYPE ?? r.int_type ?? '').trim(),
        truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      }));
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }

    const sumDr = (rows) => rows.reduce((s, r) => s + num(r.dr_amt), 0);
    const sumCr = (rows) => rows.reduce((s, r) => s + num(r.cr_amt), 0);
    return {
      ok: true,
      type: typ,
      r_date: rDateBind,
      r_no: vrNo,
      stock_table: typ === 'PB' ? 'BARDSTOCK' : 'LOTSTOCK',
      counts: {
        ledger: ledger.length,
        lotstock: lotstock.length,
        bardstock: bardstock.length,
        bills: bills.length,
      },
      totals: {
        ledger_dr: Math.round(sumDr(ledger) * 100) / 100,
        ledger_cr: Math.round(sumCr(ledger) * 100) / 100,
        bills_dr: Math.round(sumDr(bills) * 100) / 100,
        bills_cr: Math.round(sumCr(bills) * 100) / 100,
      },
      ledger,
      lotstock,
      bardstock,
      bills,
    };
  }

  function normalizeLine(ln, idx, ctx) {
    const g_weight = num(ln.g_weight);
    const d_weight = num(ln.d_weight);
    let weight = num(ln.weight);
    if (g_weight || d_weight) weight = calcNetWeight(g_weight, d_weight);
    const amt_cal = String(ln.amt_cal ?? ctx.pur_cal ?? 'W').trim().toUpperCase() || 'W';
    const amount = num(ln.amount) || calcLineAmount({ ...ln, weight, amt_cal }, ctx.pur_cal);
    return {
      trn_no: Number(ln.trn_no ?? idx + 1) || idx + 1,
      so_no: Number(ln.so_no ?? 0) || 0,
      item_code: Number(ln.item_code ?? 0) || 0,
      pur_code: normCode(ln.pur_code),
      s_code: normCode(ln.s_code),
      bard_item_code: Number(ln.bard_item_code ?? 0) || 0,
      status: normStatus(ln.status),
      qnty: num(ln.qnty),
      g_weight,
      d_weight,
      weight,
      stk_weight: num(ln.stk_weight),
      usd_rate: num(ln.usd_rate),
      usd_amount: num(ln.usd_amount),
      rate: num(ln.rate),
      amount,
      amt_cal,
      dis_per: num(ln.dis_per),
      dis_amt: num(ln.dis_amt),
      cgst_per: num(ln.cgst_per),
      cgst_amt: num(ln.cgst_amt),
      sgst_per: num(ln.sgst_per),
      sgst_amt: num(ln.sgst_amt),
      igst_per: num(ln.igst_per),
      igst_amt: num(ln.igst_amt),
      lab_amt: num(ln.lab_amt),
      bard_amt: num(ln.bard_amt),
      bard_per: num(ln.bard_per),
      lab_per: num(ln.lab_per),
      fgt_amt: num(ln.fgt_amt),
      ins_amt: num(ln.ins_amt),
      oth_amt: num(ln.oth_amt),
      dane_rate: num(ln.dane_rate),
      dane_amt: num(ln.dane_amt),
      pmt_rate: num(ln.pmt_rate),
      lot: Number(ln.lot ?? 0) || 0,
      b_no: Number(ln.b_no ?? 0) || 0,
      cost_code: normCode(ln.cost_code),
      remarks: String(ln.remarks ?? '').trim().slice(0, 100),
      mlot_no: String(ln.mlot_no ?? '').trim().slice(0, 40),
    };
  }

  async function savePurchaseBill(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    await assertPurchasePermission(user_name, mode === 'edit' ? 'edit' : 'add');

    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    if (!String(comp_uid || '').trim()) {
      const err = new Error('Company schema (comp_uid) is required to save Purchase Bill.');
      err.status = 400;
      throw err;
    }
    const typ = String(body.type ?? body.TYPE ?? PU_TYPE).trim() || PU_TYPE;
    const ctx = await fetchPurchaseDefContext(cc, comp_uid);

    const rDate = parseDateOnly(body.r_date ?? body.R_DATE);
    if (!rDate) {
      const err = new Error('Voucher date is required.');
      err.status = 400;
      throw err;
    }
    const billDate = parseDateOnly(body.bill_date ?? body.BILL_DATE) || rDate;
    const party = normCode(body.code ?? body.CODE);
    if (!party) {
      const err = new Error('Supplier code is required.');
      err.status = 400;
      throw err;
    }

    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn.map((ln, idx) => normalizeLine(ln, idx, ctx)).filter((ln) => ln.item_code);
    if (!lines.length) {
      const err = new Error('Enter at least one item line.');
      err.status = 400;
      throw err;
    }

    let r_no = Number(body.r_no ?? body.R_NO ?? 0) || 0;
    const rDateBind = formatDateBind(rDate);
    if (mode === 'new' || !r_no) {
      r_no = await fetchNextRNo(cc, comp_uid, rDate, typ);
    }

    const footer = body.footer && typeof body.footer === 'object' ? body.footer : body;
    const bill_amt = num(body.bill_amt ?? footer.bill_amt ?? body.mbamt);
    const header = {
      r_date: rDate,
      r_no,
      bill_date: billDate,
      bill_no: String(body.bill_no ?? body.BILL_NO ?? '').trim().slice(0, 20),
      due: num(body.due ?? body.DUE),
      v_date: parseDateOnly(body.v_date ?? body.V_DATE) || billDate,
      bombay_dhara: String(body.bombay_dhara ?? body.BOMBAY_DHARA ?? 'N').trim().toUpperCase().slice(0, 1) === 'Y' ? 'Y' : 'N',
      code: party,
      b_code: normCode(body.b_code ?? body.B_CODE),
      gr_no: String(body.gr_no ?? body.GR_NO ?? '').trim().slice(0, 20),
      tpt: String(body.tpt ?? body.TPT ?? '').trim().slice(0, 50),
      form: String(body.form ?? body.FORM ?? '').trim().slice(0, 10),
      truck: String(body.truck ?? body.TRUCK ?? '').trim().slice(0, 20),
      god_code: normCode(body.god_code ?? body.GOD_CODE),
      cost_code: normCode(body.cost_code ?? body.COST_CODE),
      remarks: String(body.remarks ?? body.REMARKS ?? '').trim().slice(0, 100),
      stk: String(body.stk ?? body.STK ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
      bill_amt,
      comm_per: num(footer.comm_per),
      comm_amt: num(footer.comm_amt),
      comm_code: normCode(footer.comm_code ?? ctx.comm_code),
      comm_cal: String(footer.comm_cal ?? '').trim().slice(0, 1),
      brok_rate: num(footer.brok_rate),
      brok_cal: String(footer.brok_cal ?? '').trim().slice(0, 1),
      brok_amt: num(footer.brok_amt),
      brok_d_cd: normCode(footer.brok_d_cd),
      tds_comm: num(footer.tds_comm),
      tds_no: String(footer.tds_no ?? '').trim().slice(0, 20),
      sur_per: num(footer.sur_per),
      sur_amt: num(footer.sur_amt),
      edu_per: num(footer.edu_per),
      edu_amt: num(footer.edu_amt),
      tot_tds: num(footer.tot_tds),
      freight_hdr: num(footer.freight_hdr),
      f_dr_code: normCode(footer.f_dr_code),
      f_cr_code: normCode(footer.f_cr_code),
      bl_no: String(footer.bl_no ?? '').trim().slice(0, 30),
      file_no: String(footer.file_no ?? '').trim().slice(0, 30),
      bref_no: String(footer.bref_no ?? '').trim().slice(0, 30),
      job_no: String(footer.job_no ?? '').trim().slice(0, 20),
      p_bill_no_file_path: stripDriveLetterPath(footer.p_bill_no_file_path ?? '').slice(0, 200),
      cform_amt: num(footer.cform_amt),
      lab_rate_hdr: num(footer.lab_rate_hdr),
      exp_cat: String(footer.exp_cat ?? '').trim().slice(0, 10),
      dis_per_hdr: num(footer.dis_per_hdr),
      dis_amt_hdr: num(footer.dis_amt_hdr),
      dis_code: normCode(footer.dis_code),
      cgst_code: normCode(footer.cgst_code ?? ctx.cgst_code),
      sgst_code: normCode(footer.sgst_code ?? ctx.sgst_code),
      igst_code: normCode(footer.igst_code ?? ctx.igst_code),
      mud_per: num(footer.mud_per),
      mud_amt: num(footer.mud_amt),
      mud_code: normCode(footer.mud_code),
      tcs_per: num(footer.tcs_per),
      tcs_amt: num(footer.tcs_amt),
      tcs_code: num(footer.tcs_amt) ? normCode(footer.tcs_code ?? ctx.tcs_code) : normCode(footer.tcs_code),
      ntds_per: num(footer.ntds_per),
      ntds_amt: num(footer.ntds_amt),
      ntds_code: num(footer.ntds_amt)
        ? normCode(footer.ntds_code ?? ctx.ntds_code)
        : normCode(footer.ntds_code),
      ntds_on_amt: num(footer.ntds_on_amt),
      tds_per: num(footer.tds_per),
      tds_amt: num(footer.tds_amt),
      tds_code: normCode(footer.tds_code ?? ctx.tds_code),
      oth_exp_1: num(footer.oth_exp_1),
      oth_exp_2: num(footer.oth_exp_2),
      oth_exp_3: num(footer.oth_exp_3),
      oth_exp_4: num(footer.oth_exp_4),
      oth_exp_5: num(footer.oth_exp_5),
      oth_exp_6: num(footer.oth_exp_6),
      oth_exp_7: num(footer.oth_exp_7),
      oth_exp_8: num(footer.oth_exp_8),
      oth_cd_1: normCode(footer.oth_cd_1),
      oth_cd_2: normCode(footer.oth_cd_2),
      oth_cd_3: normCode(footer.oth_cd_3),
      oth_cd_4: normCode(footer.oth_cd_4),
      oth_cd_5: normCode(footer.oth_cd_5),
      oth_cd_6: normCode(footer.oth_cd_6),
      oth_cd_7: normCode(footer.oth_cd_7),
      oth_cd_8: normCode(footer.oth_cd_8),
      brok_paid: num(footer.brok_paid),
      brok_paid_code: normCode(footer.brok_paid_code ?? ctx.brok_paid_code),
      mandi_exp: num(footer.mandi_exp),
      mandi_exp_code: normCode(footer.mandi_exp_code ?? ctx.mandi_exp_code),
      labour_exp: num(footer.labour_exp),
      labour_exp_code: normCode(footer.labour_exp_code ?? ctx.labour_exp_code),
      bardana_exp: num(footer.bardana_exp),
      bardana_exp_code: normCode(footer.bardana_exp_code ?? ctx.bardana_exp_code),
      freight_paid: num(footer.freight_paid),
      freight_paid_code: normCode(footer.freight_paid_code ?? ctx.freight_paid_code),
      cd_amount: num(footer.cd_amount),
      cd_amount_code: normCode(footer.cd_amount_code ?? ctx.cd_amount_code),
      dharam_kanta: num(footer.dharam_kanta),
      dharam_kanta_code: normCode(footer.dharam_kanta_code ?? ctx.dharam_kanta_code),
      tulwai_exp: num(footer.tulwai_exp),
      tulwai_code: normCode(footer.tulwai_code ?? ctx.tulwai_code),
      round_off: num(footer.round_off),
      round_off_code: normCode(footer.round_off_code ?? ctx.round_off_code),
      labour: num(footer.labour),
      l_d_code: normCode(footer.l_d_code),
      l_c_code: normCode(footer.l_c_code),
      pu_r_no: Number(footer.pu_r_no ?? 0) || 0,
    };

    const user = user_name.slice(0, 10) || 'WEB';
    const lineExpenses = Array.isArray(body.line_expenses) ? body.line_expenses : [];
    const expCodeErr = validateLedgerExpenseCodes(header, lines, lineExpenses);
    if (expCodeErr) {
      const err = new Error(expCodeErr);
      err.status = 400;
      throw err;
    }
    await assertPurchaseMasterCodesExist(
      cc,
      comp_uid,
      collectPurchaseMasterCodeChecks(header, lines, lineExpenses)
    );
    const partyName = String(body.party_name ?? body.PARTY_NAME ?? '').trim().slice(0, 50);
    const totQ = lines.reduce((s, ln) => s + num(ln.qnty), 0);
    const totW = lines.reduce((s, ln) => s + num(ln.weight), 0);
    const billDetail = `B.NO.:${header.bill_no} DT.:${formatDateBind(header.bill_date) || rDateBind} ${totQ} ${Number(totW).toFixed(3)}`.slice(
      0,
      80
    );
    const computer = 'WEB';
    const ent_time = entTimeNow();

    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await deletePurchaseRelated(q, { comp_code: cc, type: typ, r_date: rDateBind, r_no });

      for (const ln of lines) {
        let xLot = Number(ln.lot ?? 0) || 0;
        let xBno = Number(ln.b_no ?? 0) || 0;
        if (header.stk !== 'Y') {
          xLot = 0;
          xBno = 0;
        } else {
          const stockTable = typ === 'PB' ? 'BARDSTOCK' : 'LOTSTOCK';
          if (!xLot) xLot = await nextLotNo(q, cc, ln.item_code, { stockTable });
          if (!xBno) xBno = await nextBatchNo(q, cc, { stockTable });
        }

        await q(
          `INSERT INTO PURCHASE (
            COMP_CODE, COMP_YEAR, TYPE, R_DATE, R_NO, BILL_DATE, BILL_NO, DUE, V_DATE, INT_TYPE,
            GOD_CODE, SUP_CODE, B_CODE, GR_NO, TPT, FORM, TRUCK, BILL_AMT,
            OTH_EXP_1, OTH_EXP_2, OTH_EXP_3, OTH_EXP_4, OTH_CD_1, OTH_CD_2, OTH_CD_3, OTH_CD_4,
            BROK_RATE, BROK_CAL, BROK_AMT, BROK_D_CD, TDS_PER, TDS_AMT, TDS_CODE,
            COMM_PER, COMM_AMT, COMM_CODE, COMM_CAL,
            USER_NAME, ENT_DATE, TRN_NO, ITEM_CODE, STATUS, QNTY, WEIGHT, RATE, AMOUNT,
            PUR_CODE, LOT, B_NO, COST_CODE, REMARKS, G_WEIGHT, D_WEIGHT, USD_RATE, USD_AMOUNT,
            S_CODE, CODE, MUD_PER, MUD_AMT, MUD_CODE, STK, STK_WEIGHT, AMT_CAL, SO_NO,
            DIS_PER, DIS_AMT, DIS_CODE, CGST_CODE, SGST_CODE, IGST_CODE,
            CGST_PER, SGST_PER, IGST_PER, CGST_AMT, SGST_AMT, IGST_AMT,
            LAB_AMT, BARD_AMT, FGT_AMT, TAXABLE, PU_R_NO, OTH_AMT, INS_AMT, DANE_RATE, DANE_AMT,
            BARD_PER, LAB_PER, LAB_RATE,
            BARD_ITEM_CODE, MLOT_NO, ENT_TIME,
            OTH_EXP_5, OTH_EXP_6, OTH_EXP_7, OTH_EXP_8, OTH_CD_5, OTH_CD_6, OTH_CD_7, OTH_CD_8,
            BROK_PAID, MANDI_EXP, LABOUR_EXP, BARDANA_EXP, FREIGHT_PAID, CD_AMOUNT, DHARAM_KANTA,
            BROK_PAID_CODE, MANDI_EXP_CODE, LABOUR_EXP_CODE, BARDANA_EXP_CODE, FREIGHT_PAID_CODE,
            CD_AMOUNT_CODE, DHARAM_KANTA_CODE, TULWAI_EXP, TULWAI_CODE, ROUND_OFF, ROUND_OFF_CODE,
            TCS_PER, TCS_AMT, TCS_CODE, NTDS_PER, NTDS_AMT, NTDS_CODE, NTDS_ON_AMT,
            LABOUR, L_D_CODE, L_C_CODE, P_BILL_NO_FILE_PATH
          ) VALUES (
            :comp_code, :comp_year, :type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :r_no,
            TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY')), :bill_no, :due, TRUNC(TO_DATE(:v_date, 'DD-MM-YYYY')), :int_type,
            :god_code, :sup_code, :b_code, :gr_no, :tpt, :form, :truck, :bill_amt,
            :oth_exp_1, :oth_exp_2, :oth_exp_3, :oth_exp_4, :oth_cd_1, :oth_cd_2, :oth_cd_3, :oth_cd_4,
            :brok_rate, :brok_cal, :brok_amt, :brok_d_cd, :tds_per, :tds_amt, :tds_code,
            :comm_per, :comm_amt, :comm_code, :comm_cal,
            :user_name, TRUNC(SYSDATE), :trn_no, :item_code, :status, :qnty, :weight, :rate, :amount,
            :pur_code, :lot, :b_no, :cost_code, :remarks, :g_weight, :d_weight, :usd_rate, :usd_amount,
            :s_code, :code, :mud_per, :mud_amt, :mud_code, :stk, :stk_weight, :amt_cal, :so_no,
            :dis_per, :dis_amt, :dis_code, :cgst_code, :sgst_code, :igst_code,
            :cgst_per, :sgst_per, :igst_per, :cgst_amt, :sgst_amt, :igst_amt,
            :lab_amt, :bard_amt, :fgt_amt, :taxable, :pu_r_no, :oth_amt, :ins_amt, :dane_rate, :dane_amt,
            :bard_per, :lab_per, :lab_rate,
            :bard_item_code, :mlot_no, :ent_time,
            :oth_exp_5, :oth_exp_6, :oth_exp_7, :oth_exp_8, :oth_cd_5, :oth_cd_6, :oth_cd_7, :oth_cd_8,
            :brok_paid, :mandi_exp, :labour_exp, :bardana_exp, :freight_paid, :cd_amount, :dharam_kanta,
            :brok_paid_code, :mandi_exp_code, :labour_exp_code, :bardana_exp_code, :freight_paid_code,
            :cd_amount_code, :dharam_kanta_code, :tulwai_exp, :tulwai_code, :round_off, :round_off_code,
            :tcs_per, :tcs_amt, :tcs_code, :ntds_per, :ntds_amt, :ntds_code, :ntds_on_amt,
            :labour, :l_d_code, :l_c_code, :p_bill_no_file_path
          )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: typ,
            r_date: rDateBind,
            r_no,
            bill_date: formatDateBind(header.bill_date),
            bill_no: header.bill_no,
            due: header.due,
            v_date: formatDateBind(header.v_date),
            int_type: header.bombay_dhara,
            god_code: header.god_code,
            sup_code: party,
            b_code: header.b_code,
            gr_no: header.gr_no,
            tpt: header.tpt,
            form: header.form,
            truck: header.truck,
            bill_amt: header.bill_amt,
            oth_exp_1: header.oth_exp_1,
            oth_exp_2: header.oth_exp_2,
            oth_exp_3: header.oth_exp_3,
            oth_exp_4: header.oth_exp_4,
            oth_cd_1: header.oth_cd_1,
            oth_cd_2: header.oth_cd_2,
            oth_cd_3: header.oth_cd_3,
            oth_cd_4: header.oth_cd_4,
            brok_rate: header.brok_rate,
            brok_cal: header.brok_cal,
            brok_amt: header.brok_amt,
            brok_d_cd: header.brok_d_cd,
            tds_per: header.tds_per,
            tds_amt: header.tds_amt,
            tds_code: header.tds_code,
            comm_per: header.comm_per,
            comm_amt: header.comm_amt,
            comm_code: header.comm_code,
            comm_cal: header.comm_cal,
            user_name: user,
            trn_no: ln.trn_no,
            item_code: ln.item_code,
            status: ln.status,
            qnty: ln.qnty,
            weight: ln.weight,
            rate: ln.rate,
            amount: ln.amount,
            pur_code: ln.pur_code || party, // keep in sync with postLineLedgerAndLotstock fallback
            lot: xLot,
            b_no: xBno,
            cost_code: ln.cost_code || header.cost_code,
            remarks: ln.remarks || header.remarks,
            g_weight: ln.g_weight,
            d_weight: ln.d_weight,
            usd_rate: ln.usd_rate,
            usd_amount: ln.usd_amount,
            s_code: ln.s_code,
            code: party,
            mud_per: header.mud_per,
            mud_amt: header.mud_amt,
            mud_code: header.mud_code,
            stk: header.stk,
            stk_weight: ln.stk_weight,
            amt_cal: ln.amt_cal,
            so_no: ln.so_no,
            dis_per: ln.dis_per,
            dis_amt: ln.dis_amt,
            dis_code: header.dis_code,
            cgst_code: header.cgst_code,
            sgst_code: header.sgst_code,
            igst_code: header.igst_code,
            cgst_per: ln.cgst_per,
            sgst_per: ln.sgst_per,
            igst_per: ln.igst_per,
            cgst_amt: ln.cgst_amt,
            sgst_amt: ln.sgst_amt,
            igst_amt: ln.igst_amt,
            lab_amt: ln.lab_amt,
            bard_amt: ln.bard_amt,
            fgt_amt: ln.fgt_amt,
            taxable: ln.amount - ln.dis_amt,
            pu_r_no: header.pu_r_no,
            oth_amt: ln.oth_amt,
            ins_amt: ln.ins_amt,
            dane_rate: ln.dane_rate,
            dane_amt: ln.dane_amt,
            bard_per: ln.bard_per,
            lab_per: ln.lab_per,
            lab_rate: ln.pmt_rate,
            bard_item_code: ln.bard_item_code,
            mlot_no: ln.mlot_no,
            ent_time,
            oth_exp_5: header.oth_exp_5,
            oth_exp_6: header.oth_exp_6,
            oth_exp_7: header.oth_exp_7,
            oth_exp_8: header.oth_exp_8,
            oth_cd_5: header.oth_cd_5,
            oth_cd_6: header.oth_cd_6,
            oth_cd_7: header.oth_cd_7,
            oth_cd_8: header.oth_cd_8,
            brok_paid: header.brok_paid,
            mandi_exp: header.mandi_exp,
            labour_exp: header.labour_exp,
            bardana_exp: header.bardana_exp,
            freight_paid: header.freight_paid,
            cd_amount: header.cd_amount,
            dharam_kanta: header.dharam_kanta,
            brok_paid_code: header.brok_paid_code,
            mandi_exp_code: header.mandi_exp_code,
            labour_exp_code: header.labour_exp_code,
            bardana_exp_code: header.bardana_exp_code,
            freight_paid_code: header.freight_paid_code,
            cd_amount_code: header.cd_amount_code,
            dharam_kanta_code: header.dharam_kanta_code,
            tulwai_exp: header.tulwai_exp,
            tulwai_code: header.tulwai_code,
            round_off: header.round_off,
            round_off_code: header.round_off_code,
            tcs_per: header.tcs_per,
            tcs_amt: header.tcs_amt,
            tcs_code: header.tcs_code,
            ntds_per: header.ntds_per,
            ntds_amt: header.ntds_amt,
            ntds_code: header.ntds_code,
            ntds_on_amt: header.ntds_on_amt,
            labour: header.labour,
            l_d_code: header.l_d_code,
            l_c_code: header.l_c_code,
            p_bill_no_file_path: header.p_bill_no_file_path || '',
          }
        );

        await postLineLedgerAndLotstock(q, {
          cc,
          cy,
          typ,
          rDateBind,
          r_no,
          header,
          ln,
          xLot,
          xBno,
          partyName,
          detail: billDetail,
          ctx,
          user,
          ent_time,
          computer,
        });
      }

      let expSeq = 0;
      for (const exp of lineExpenses) {
        if (!num(exp.amount)) continue;
        expSeq += 1;
        const detTrn = Number(exp.trn_no ?? 0) * 1000 + expSeq;
        await q(
          `INSERT INTO PUREXP_DET (
            COMP_CODE, COMP_YEAR, TYPE, R_DATE, R_NO, TRN_NO, EXP_NAME, EXP_RATE, CAL_TYPE, AMOUNT, CODE
          ) VALUES (
            :comp_code, :comp_year, :type, TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY')), :r_no,
            :trn_no, :exp_name, :exp_rate, :cal_type, :amount, :code
          )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: typ,
            r_date: rDateBind,
            r_no,
            trn_no: detTrn,
            exp_name: String(exp.exp_name ?? '').trim().slice(0, 40),
            exp_rate: num(exp.exp_rate),
            cal_type: String(exp.cal_type ?? 'W').trim().toUpperCase().slice(0, 1) || 'W',
            amount: num(exp.amount),
            code: normCode(exp.code),
          }
        );
      }

      await postHeaderLedger(q, {
        cc,
        cy,
        typ,
        rDateBind,
        r_no,
        header,
        lines,
        lineExpenses,
        partyName,
        detail: billDetail,
        user,
        ent_time,
        computer,
        ntdsNature: ctx.ntds_nature,
        fySDate: formatDateBind(body.fy_s_date ?? body.FY_S_DATE ?? body.g_sdate) || rDateBind,
        fyEDate: formatDateBind(body.fy_e_date ?? body.FY_E_DATE ?? body.g_edate) || rDateBind,
      });

      await postPurchaseBills(q, {
        cc,
        cy,
        typ,
        rDateBind,
        r_no,
        header,
        lines,
        partyName,
        partyCity: String(body.party_city ?? body.PARTY_CITY ?? body.city ?? '').trim(),
        detail: billDetail,
        ctx,
      });
    });

    const saved = await loadPurchaseBill(cc, comp_uid, typ, rDateBind, r_no);
    return {
      ok: true,
      message: `Purchase Bill No. ${r_no} saved.`,
      r_no,
      r_date: rDateBind,
      ...saved,
    };
  }

  async function deletePurchaseBill(comp_code, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    await assertPurchasePermission(user_name, 'delete');
    const typ = String(body.type ?? body.TYPE ?? PU_TYPE).trim();
    const r_no = Number(body.r_no ?? body.R_NO ?? 0) || 0;
    const rDateBind = formatDateBind(body.r_date ?? body.R_DATE);
    if (!rDateBind || !r_no) {
      const err = new Error('Voucher date and number are required.');
      err.status = 400;
      throw err;
    }
    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await deletePurchaseRelated(q, {
        comp_code: Number(comp_code) || 0,
        type: typ,
        r_date: rDateBind,
        r_no,
      });
    });
    return { ok: true, message: `Purchase Bill No. ${r_no} deleted.` };
  }

  /** VFP SOHLP — PO balance for purchase bill grid. */
  async function fetchPoHelp(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const ctx = await fetchPurchaseDefContext(cc, comp_uid);
    const filterByParty = ctx.pur_order_type === 'C';
    const filterCode = filterByParty ? normCode(opts.code) : normCode(opts.bk_code);
    if (!filterCode) {
      const err = new Error(
        filterByParty ? 'Enter supplier code before PO help.' : 'Enter broker code before PO help.'
      );
      err.status = 400;
      throw err;
    }
    const poField = filterByParty ? 'CODE' : 'BK_CODE';
    const purField = filterByParty ? 'CODE' : 'B_CODE';
    const poRows = await runQuery(
      `SELECT A.SO_NO, TRUNC(A.SO_DATE) AS SO_DATE, A.ITEM_CODE, A.QNTY, A.WEIGHT, A.RATE,
              A.REMARKS, A.BK_CODE, B.ITEM_NAME
       FROM PORDER A
       LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = 'SO'
         AND TRIM(A.${poField}) = TRIM(:filter_code)
         AND NVL(A.CLEAR_YN, 'N') <> 'Y'`,
      { comp_code: cc, filter_code: filterCode },
      comp_uid
    );
    const ordMap = new Map();
    for (const r of poRows || []) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      const itemCode = Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0;
      const rate = num(r.RATE ?? r.rate);
      const key = `${soNo}|${itemCode}|${rate}`;
      if (!ordMap.has(key)) {
        ordMap.set(key, {
          so_no: soNo,
          so_date: formatDateOut(r.SO_DATE ?? r.so_date),
          item_code: itemCode,
          item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
          rate,
          so_qty: 0,
          so_wgt: 0,
          remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
        });
      }
      const o = ordMap.get(key);
      o.so_qty += num(r.QNTY ?? r.qnty);
      o.so_wgt += num(r.WEIGHT ?? r.weight);
    }
    const purRows = await runQuery(
      `SELECT A.SO_NO, A.ITEM_CODE, NVL(A.RATE, 0) AS RATE,
              SUM(NVL(A.QNTY, 0)) AS SL_QTY, SUM(NVL(A.WEIGHT, 0)) AS SL_WGT
       FROM PURCHASE A
       WHERE A.COMP_CODE = :comp_code AND NVL(A.SO_NO, 0) <> 0
         AND TRIM(A.${purField}) = TRIM(:filter_code)
       GROUP BY A.SO_NO, A.ITEM_CODE, NVL(A.RATE, 0)`,
      { comp_code: cc, filter_code: filterCode },
      comp_uid
    );
    const purMap = new Map();
    for (const r of purRows || []) {
      const key = `${Number(r.SO_NO ?? r.so_no ?? 0) || 0}|${Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0}|${num(r.RATE ?? r.rate)}`;
      purMap.set(key, { sl_qty: num(r.SL_QTY ?? r.sl_qty), sl_wgt: num(r.SL_WGT ?? r.sl_wgt) });
    }
    return [...ordMap.values()]
      .map((o) => {
        const key = `${o.so_no}|${o.item_code}|${o.rate}`;
        const pur = purMap.get(key) || { sl_qty: 0, sl_wgt: 0 };
        return {
          ...o,
          b_qty: Math.max(0, Math.round((o.so_qty - pur.sl_qty) * 1000) / 1000),
          b_wgt: Math.max(0, Math.round((o.so_wgt - pur.sl_wgt) * 1000) / 1000),
        };
      })
      .filter((o) => o.b_qty > 0 || o.b_wgt > 0);
  }

  function registerRoutes(app) {
    app.get('/api/purchase-bill/context', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        const [ctx, group_cd, pur_exp_master] = await Promise.all([
          fetchPurchaseDefContext(comp_code, comp_uid),
          fetchGroupCd(comp_code, comp_uid),
          fetchPurExpMaster(comp_code, comp_uid),
        ]);
        res.json({ ...ctx, group_cd, pur_exp_master });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/user-permissions', async (req, res) => {
      try {
        const perms = await fetchPurchaseUserPermissions(req.query.user_name);
        res.json(perms);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_date, type } = req.query;
        const next_no = await fetchNextRNo(comp_code, comp_uid, r_date, type || PU_TYPE);
        res.json({ next_no });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/po-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, bk_code } = req.query;
        const rows = await fetchPoHelp(comp_code, comp_uid, { code, bk_code });
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    /** DN: help list of purchase (PU) bill lines for supplier — choose into debit note. */
    app.get('/api/purchase-bill/dn-source-lines', async (req, res) => {
      try {
        const { comp_code, comp_uid, code } = req.query;
        const rows = await fetchDnSourceLines(comp_code, comp_uid, code);
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, sdt, edt, party } = req.query;
        const rows = await listPurchaseBills(comp_code, comp_uid, { type, sdt, edt, party });
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/nav', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no, direction } = req.query;
        const out = await navigatePurchaseBill(comp_code, comp_uid, type, r_date, r_no, direction);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no } = req.query;
        const out = await loadPurchaseBill(comp_code, comp_uid, type, r_date, r_no);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-bill/posting', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no } = req.query;
        const out = await fetchPurchasePosting(comp_code, comp_uid, type, r_date, r_no);
        res.json(out);
      } catch (err) {
        if ((err.status || 500) >= 500) console.error('❌ purchase-bill posting:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/purchase-bill', async (req, res) => {
      try {
        const { comp_code, comp_year, comp_uid } = req.body || {};
        const out = await savePurchaseBill(comp_code, comp_year, comp_uid, req.body, req);
        res.json(out);
      } catch (err) {
        if ((err.status || 500) >= 500) console.error('❌ purchase-bill save:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.delete('/api/purchase-bill', async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : req.query;
        const { comp_code, comp_uid } = body;
        const out = await deletePurchaseBill(comp_code, comp_uid, body, req);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    /** Save scanned bill from browser file picker → returns absolute path for P_BILL_NO_FILE_PATH. */
    app.post('/api/purchase-bill/scan-upload', express.json({ limit: '35mb' }), async (req, res) => {
      try {
        const { comp_code, file_name, data_base64 } = req.body || {};
        const cc = String(comp_code ?? '').trim() || '0';
        const nameRaw = String(file_name || 'scan.bin').replace(/[<>:"|?*\\/]/g, '_').slice(0, 120);
        const b64 = String(data_base64 || '').replace(/^data:[^;]+;base64,/, '');
        if (!b64) {
          return res.status(400).json({ error: 'No file data.' });
        }
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) {
          return res.status(400).json({ error: 'Empty file.' });
        }
        if (buf.length > 30 * 1024 * 1024) {
          return res.status(400).json({ error: 'File too large (max 30 MB).' });
        }
        const dir = path.join(SCAN_UPLOAD_ROOT, cc);
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const savedName = `${stamp}_${nameRaw}`;
        const fullPath = path.join(dir, savedName);
        fs.writeFileSync(fullPath, buf);
        res.json({ ok: true, path: stripDriveLetterPath(fullPath), file_name: savedName, abs_path: fullPath });
      } catch (err) {
        console.error('❌ purchase-bill scan-upload:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    function resolveAllowedScanPath(rawPath) {
      const raw = String(rawPath || '').trim();
      if (!raw) {
        const err = new Error('Scan path is required.');
        err.status = 400;
        throw err;
      }
      const abs = expandStoredScanPath(raw);
      const uploadRoot = path.resolve(SCAN_UPLOAD_ROOT);
      const gfasRoot = path.resolve(path.join(__dirname, '..'));
      const absLower = abs.toLowerCase();
      const ok =
        absLower.startsWith(uploadRoot.toLowerCase() + path.sep) ||
        absLower === uploadRoot.toLowerCase() ||
        absLower.startsWith(gfasRoot.toLowerCase() + path.sep) ||
        absLower === gfasRoot.toLowerCase();
      if (!ok) {
        const err = new Error('File path is not allowed.');
        err.status = 403;
        throw err;
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        const err = new Error('Scan file not found on disk.');
        err.status = 404;
        throw err;
      }
      return abs;
    }

    /** Stream scanned bill for browser view/download. */
    app.get('/api/purchase-bill/scan-file', async (req, res) => {
      try {
        const abs = resolveAllowedScanPath(req.query.path);
        res.sendFile(abs);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    /** Open scan with Windows default app (local server). */
    app.post('/api/purchase-bill/open-scan', async (req, res) => {
      try {
        const abs = resolveAllowedScanPath(req.body?.path || req.query?.path);
        if (process.platform === 'win32') {
          execFile('cmd', ['/c', 'start', '', abs], { windowsHide: true }, (err) => {
            if (err) {
              console.error('❌ open-scan:', err.message);
              return res.status(500).json({ error: err.message });
            }
            res.json({ ok: true, path: abs, opened: 'os' });
          });
          return;
        }
        execFile('xdg-open', [abs], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ ok: true, path: abs, opened: 'os' });
        });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    loadPurchaseBill,
    savePurchaseBill,
    deletePurchaseBill,
    fetchPurchaseDefContext,
  };
}

module.exports = { createPurchaseBill, PU_TYPE, PB_TYPE: 'PB' };
