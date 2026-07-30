/**
 * Debit / Credit Note Others — VFP DO FORM DCNOTE WITH 'DX'|'CX',...
 * Shared form; TYPE is DX (debit) or CX (credit).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function yn(v, def = 'N') {
  const s = String(v ?? def).trim().toUpperCase();
  return s === 'Y' ? 'Y' : 'N';
}

function spFlag(v, def = 'P') {
  const s = String(v ?? def).trim().toUpperCase().slice(0, 1);
  return s === 'S' ? 'S' : 'P';
}

function tcsOthers(v, def = 'O') {
  const s = String(v ?? def).trim().toUpperCase().slice(0, 1);
  return s === 'T' ? 'T' : 'O';
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

function assertType(type) {
  const t = String(type ?? '').trim().toUpperCase();
  if (t !== 'DX' && t !== 'CX') {
    const err = new Error("type must be 'DX' or 'CX'");
    err.status = 400;
    throw err;
  }
  return t;
}

function createDcNote({ runQuery, parseDateOnly, withCompTransaction }) {
  function formatDateBind(raw) {
    if (typeof parseDateOnly === 'function') {
      const d = parseDateOnly(raw);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    }
    const s = String(raw || '').trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return null;
  }

  async function fetchCtx(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(CGST_CODE, '') AS CGST_CODE,
                NVL(SGST_CODE, '') AS SGST_CODE,
                NVL(IGST_CODE, '') AS IGST_CODE
         FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const r = rows?.[0] || {};
      return {
        cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
        sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
        igst_code: normCode(r.IGST_CODE ?? r.igst_code),
      };
    } catch {
      return { cgst_code: '', sgst_code: '', igst_code: '' };
    }
  }

  async function fetchNextRNo(comp_code, comp_uid, noteType, r_date) {
    const d = formatDateBind(r_date);
    const rows = await runQuery(
      `SELECT NVL(MAX(R_NO), 0) + 1 AS NEXT_NO
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date)`,
      { comp_code: Number(comp_code) || 0, type: noteType, r_date: d },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  function mapHeader(r) {
    return {
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      dc_bill_no: Number(r.DC_BILL_NO ?? r.dc_bill_no ?? 0) || 0,
      dc_b_type: String(r.DC_B_TYPE ?? r.dc_b_type ?? '').trim().toUpperCase(),
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
      l_c: String(r.L_C ?? r.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L',
      input_yn: yn(r.INPUT_YN ?? r.input_yn, 'Y'),
      s_p: spFlag(r.S_P ?? r.s_p, 'P'),
      tcs_others: tcsOthers(r.TCS_OTHERS ?? r.tcs_others, 'O'),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      mod_reason: String(r.MOD_REASON ?? r.mod_reason ?? '').trim(),
      irn_no: String(r.IRN_NO ?? r.irn_no ?? '').trim(),
      ack_no: String(r.ACK_NO ?? r.ack_no ?? '').trim(),
      signed_qr_code: String(r.SIGNED_QR_CODE ?? r.signed_qr_code ?? '').trim(),
      bill_amt: num(r.BILL_AMT ?? r.bill_amt),
      addexp: num(r.ADDEXP ?? r.addexp),
      tax_code: normCode(r.TAX_CODE ?? r.tax_code),
      cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
      sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
      igst_code: normCode(r.IGST_CODE ?? r.igst_code),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
    };
  }

  function mapLine(r, idx) {
    return {
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      pur_code: normCode(r.PUR_CODE ?? r.pur_code),
      pur_name: String(r.PUR_NAME ?? r.pur_name ?? r.P_NAME ?? r.p_name ?? '').trim(),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      amt_cal: String(r.AMT_CAL ?? r.amt_cal ?? 'W').trim().toUpperCase().slice(0, 1) || 'W',
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      cgst_per: num(r.CGST_PER ?? r.cgst_per),
      sgst_per: num(r.SGST_PER ?? r.sgst_per),
      igst_per: num(r.IGST_PER ?? r.igst_per),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
    };
  }

  async function loadVoucher(comp_code, comp_uid, noteType, r_date, r_no) {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!d || !no) {
      const err = new Error('R date and R no are required.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT A.*,
              B.NAME AS PARTY_NAME, B.CITY, B.GST_NO, B.PAN, B.L_C,
              C.ITEM_NAME,
              D.NAME AS PUR_NAME
       FROM PURCHASE A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
       LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
       LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.PUR_CODE = D.CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = :type
         AND TRUNC(A.R_DATE) = TRUNC(:r_date)
         AND A.R_NO = :r_no
       ORDER BY A.TRN_NO`,
      { comp_code: cc, type, r_date: d, r_no: no },
      comp_uid
    );
    if (!rows?.length) {
      const err = new Error(type === 'DX' ? 'Debit note not found.' : 'Credit note not found.');
      err.status = 404;
      throw err;
    }
    const header = mapHeader(rows[0]);
    const lines = rows.map((r, i) => mapLine(r, i));
    return { ok: true, type, header, lines };
  }

  async function listVouchers(comp_code, comp_uid, noteType, filters = {}) {
    const type = assertType(noteType);
    const binds = { comp_code: Number(comp_code) || 0, type };
    let where = 'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = :type';
    if (filters.sdt) {
      where += ' AND TRUNC(A.R_DATE) >= TRUNC(:sdt)';
      binds.sdt = formatDateBind(filters.sdt);
    }
    if (filters.edt) {
      where += ' AND TRUNC(A.R_DATE) <= TRUNC(:edt)';
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
              MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT
       FROM PURCHASE A
       LEFT JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.CODE = P.CODE
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
      bill_amt: num(r.BILL_AMT ?? r.bill_amt),
    }));
  }

  async function deleteExisting(exec, cc, noteType, rDateBind, r_no) {
    const key = { comp_code: cc, type: noteType, r_date: rDateBind, r_no };
    try {
      await exec(
        `INSERT INTO HI_PUR SELECT * FROM PURCHASE
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
           AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
        key
      );
      try {
        await exec(
          `UPDATE HI_PUR SET MOD_TYPE = 'E'
           WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
             AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
          key
        );
      } catch {
        /* optional MOD_TYPE */
      }
    } catch (err) {
      if (!/ORA-00942|ORA-00904/i.test(String(err.message || ''))) throw err;
    }
    for (const sql of [
      `DELETE FROM LEDGER WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM BILLS WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM PURCHASE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
    ]) {
      await exec(sql, key);
    }
  }

  function lineLedgerSigns(noteType, tcsMode, amount) {
    const amt = num(amount);
    const isDx = noteType === 'DX';
    if (tcsMode !== 'T') {
      return isDx ? { dr: amt * -1, cr: 0 } : { dr: 0, cr: amt * -1 };
    }
    return isDx ? { dr: 0, cr: amt } : { dr: amt, cr: 0 };
  }

  function partyTaxSigns(noteType, amount, partySide) {
    const amt = num(amount);
    const isDx = noteType === 'DX';
    if (partySide) {
      return isDx ? { dr: amt, cr: 0 } : { dr: 0, cr: amt };
    }
    return isDx ? { dr: 0, cr: amt } : { dr: amt, cr: 0 };
  }

  async function saveVoucher(comp_code, comp_uid, body, userName) {
    const type = assertType(body.type ?? body.TYPE ?? body.noteType);
    const cc = Number(comp_code) || 0;
    const cy = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const mode = String(body.mode || 'new').trim().toLowerCase();
    const rDate = body.r_date ?? body.R_DATE;
    const billDate = body.bill_date ?? body.BILL_DATE ?? rDate;
    const rDateBind = formatDateBind(rDate);
    const billDateBind = formatDateBind(billDate) || rDateBind;
    if (!rDateBind) {
      const err = new Error('Vr.Date is required.');
      err.status = 400;
      throw err;
    }
    const party = normCode(body.code ?? body.CODE);
    if (!party) {
      const err = new Error('Party code is required.');
      err.status = 400;
      throw err;
    }
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn.filter((ln) => Number(ln.item_code) > 0);
    if (!lines.length) {
      const err = new Error('Enter at least one item line.');
      err.status = 400;
      throw err;
    }

    let r_no = Number(body.r_no ?? body.R_NO ?? 0) || 0;
    if (mode === 'new' || !r_no) {
      r_no = await fetchNextRNo(cc, comp_uid, type, rDate);
    }

    const ctx = await fetchCtx(cc, comp_uid);
    const footer = body.footer && typeof body.footer === 'object' ? body.footer : body;

    const sumAmt = lines.reduce((s, ln) => s + num(ln.amount), 0);
    const sumC = lines.reduce((s, ln) => s + num(ln.cgst_amt), 0);
    const sumS = lines.reduce((s, ln) => s + num(ln.sgst_amt), 0);
    const sumI = lines.reduce((s, ln) => s + num(ln.igst_amt), 0);
    const addexp = num(footer.addexp ?? body.addexp);
    const billAmt =
      num(footer.bill_amt ?? footer.mbamt ?? body.bill_amt) ||
      Math.round((sumAmt + sumC + sumS + sumI + addexp) * 100) / 100;

    if (Math.abs(billAmt) < 0.0001) {
      const err = new Error('Bill amount should not be zero.');
      err.status = 400;
      throw err;
    }

    const header = {
      bill_no: String(body.bill_no ?? '').trim().slice(0, 30),
      dc_bill_no: Number(body.dc_bill_no ?? 0) || 0,
      dc_b_type: String(body.dc_b_type ?? '').trim().toUpperCase().slice(0, 5),
      code: party,
      input_yn: yn(body.input_yn ?? body.gstr_yn, 'Y'),
      s_p: spFlag(body.s_p, 'P'),
      tcs_others: tcsOthers(body.tcs_others, 'O'),
      remarks: String(body.remarks ?? '').trim().slice(0, 200),
      mod_reason: String(body.mod_reason ?? '').trim().slice(0, 100),
      irn_no: String(body.irn_no ?? '').trim().slice(0, 100),
      ack_no: String(body.ack_no ?? '').trim().slice(0, 50),
      signed_qr_code: String(body.signed_qr_code ?? '').trim().slice(0, 500),
      cgst_code: normCode(footer.cgst_code ?? ctx.cgst_code),
      sgst_code: normCode(footer.sgst_code ?? ctx.sgst_code),
      igst_code: normCode(footer.igst_code ?? ctx.igst_code),
      tax_code: normCode(footer.tax_code ?? footer.add_code ?? body.tax_code),
      addexp,
      bill_amt: billAmt,
    };

    const user = String(userName || body.user_name || 'WEB').trim().slice(0, 30);
    const now = new Date();
    const entTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let detail;
    if (!header.dc_bill_no) {
      detail =
        type === 'DX'
          ? `DEBIT NOTE BILL DATE ${formatDateOut(billDateBind)} ${header.bill_no} ${header.remarks}`.trim()
          : `CREDIT NOTE BILL DATE ${header.remarks}`.trim();
    } else {
      detail = `BILL NO.:${header.dc_bill_no} DT.:${formatDateOut(billDateBind)} ${header.bill_no}  ${header.remarks}`.trim();
    }

    await withCompTransaction(comp_uid, async (exec) => {
      await deleteExisting(exec, cc, type, rDateBind, r_no);

      let trn = 1;
      let firstPurCode = '';
      for (const ln of lines) {
        const isFirst = trn === 1;
        const qnty = num(ln.qnty);
        const weight = num(ln.weight);
        const rate = num(ln.rate);
        const amtCal = String(ln.amt_cal ?? 'W').trim().toUpperCase().slice(0, 1) || 'W';
        const amount =
          num(ln.amount) ||
          Math.round((amtCal === 'Q' ? qnty * rate : weight * rate) * 100) / 100;
        const purCode = normCode(ln.pur_code);
        if (trn === 1) firstPurCode = purCode;

        await exec(
          `INSERT INTO PURCHASE (
             COMP_CODE, COMP_YEAR, R_DATE, R_NO, TYPE, BILL_DATE,
             DC_BILL_NO, DC_B_TYPE, CODE, BILL_AMT, ADDEXP, USER_NAME, ENT_DATE, REMARKS,
             CGST_CODE, SGST_CODE, IGST_CODE, TAX_CODE,
             TRN_NO, ITEM_CODE, QNTY, WEIGHT, AMT_CAL, RATE, AMOUNT, PUR_CODE,
             CGST_PER, SGST_PER, IGST_PER, CGST_AMT, SGST_AMT, IGST_AMT,
             INPUT_YN, ENT_TIME, MOD_REASON, S_P, BILL_NO,
             IRN_NO, ACK_NO, SIGNED_QR_CODE, TCS_OTHERS
           ) VALUES (
             :comp_code, :comp_year, :r_date, :r_no, :type, :bill_date,
             :dc_bill_no, :dc_b_type, :code, :bill_amt, :addexp, :user_name, :ent_date, :remarks,
             :cgst_code, :sgst_code, :igst_code, :tax_code,
             :trn_no, :item_code, :qnty, :weight, :amt_cal, :rate, :amount, :pur_code,
             :cgst_per, :sgst_per, :igst_per, :cgst_amt, :sgst_amt, :igst_amt,
             :input_yn, :ent_time, :mod_reason, :s_p, :bill_no,
             :irn_no, :ack_no, :signed_qr_code, :tcs_others
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            r_date: rDateBind,
            r_no,
            type,
            bill_date: billDateBind,
            dc_bill_no: header.dc_bill_no,
            dc_b_type: header.dc_b_type || null,
            code: header.code,
            bill_amt: isFirst ? header.bill_amt : 0,
            addexp: isFirst ? header.addexp : 0,
            user_name: user,
            ent_date: now,
            remarks: header.remarks || null,
            cgst_code: header.cgst_code || null,
            sgst_code: header.sgst_code || null,
            igst_code: header.igst_code || null,
            tax_code: header.tax_code || null,
            trn_no: trn,
            item_code: Number(ln.item_code) || 0,
            qnty,
            weight,
            amt_cal: amtCal,
            rate,
            amount,
            pur_code: purCode || null,
            cgst_per: num(ln.cgst_per),
            sgst_per: num(ln.sgst_per),
            igst_per: num(ln.igst_per),
            cgst_amt: num(ln.cgst_amt),
            sgst_amt: num(ln.sgst_amt),
            igst_amt: num(ln.igst_amt),
            input_yn: header.input_yn,
            ent_time: entTime,
            mod_reason: header.mod_reason || null,
            s_p: header.s_p,
            bill_no: header.bill_no || null,
            irn_no: header.irn_no || null,
            ack_no: header.ack_no || null,
            signed_qr_code: header.signed_qr_code || null,
            tcs_others: header.tcs_others,
          }
        );

        const signs = lineLedgerSigns(type, header.tcs_others, amount);
        let tcsPer = 0;
        let tcsOnAmt = 0;
        if (qnty !== 0 && weight !== 0 && rate === 0) {
          tcsPer = qnty;
          tcsOnAmt = weight;
        }
        const invNo = header.dc_bill_no ? String(header.dc_bill_no) : '';

        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, DC_CODE, TRN_NO, V_DATE,
             TCS_PER, TCS_ON_AMT, INV_NO, INV_DATE, USER_NAME, ENT_DATE, ENT_TIME
           ) VALUES (
             :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
             :dr_amt, :cr_amt, :detail, :dc_code, :trn_no, :v_date,
             :tcs_per, :tcs_on_amt, :inv_no, :inv_date, :user_name, :ent_date, :ent_time
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            vr_type: type,
            vr_date: rDateBind,
            vr_no: r_no,
            code: purCode,
            dr_amt: signs.dr,
            cr_amt: signs.cr,
            detail: detail.slice(0, 200),
            dc_code: header.code,
            trn_no: trn,
            v_date: rDateBind,
            tcs_per: tcsPer,
            tcs_on_amt: tcsOnAmt,
            inv_no: invNo || null,
            inv_date: billDateBind,
            user_name: user,
            ent_date: now,
            ent_time: entTime,
          }
        );
        trn += 1;
      }

      const partySigns = partyTaxSigns(type, header.bill_amt, true);
      await exec(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
           DR_AMT, CR_AMT, DETAIL, DC_CODE, BILL_DATE, BILL_NO, V_DATE, TRN_NO,
           USER_NAME, ENT_DATE, ENT_TIME
         ) VALUES (
           :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
           :dr_amt, :cr_amt, :detail, :dc_code, :bill_date, :bill_no, :v_date, :trn_no,
           :user_name, :ent_date, :ent_time
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: type,
          vr_date: rDateBind,
          vr_no: r_no,
          code: header.code,
          dr_amt: partySigns.dr,
          cr_amt: partySigns.cr,
          detail: detail.slice(0, 200),
          dc_code: firstPurCode || null,
          bill_date: billDateBind,
          bill_no: String(r_no),
          v_date: rDateBind,
          trn_no: 101,
          user_name: user,
          ent_date: now,
          ent_time: entTime,
        }
      );

      async function taxLedger(trnNo, code, amt) {
        if (!code || Math.abs(num(amt)) < 0.0001) return;
        const signs = partyTaxSigns(type, amt, false);
        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, DC_CODE, TRN_NO, V_DATE,
             USER_NAME, ENT_DATE, ENT_TIME
           ) VALUES (
             :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
             :dr_amt, :cr_amt, :detail, :dc_code, :trn_no, :v_date,
             :user_name, :ent_date, :ent_time
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            vr_type: type,
            vr_date: rDateBind,
            vr_no: r_no,
            code,
            dr_amt: signs.dr,
            cr_amt: signs.cr,
            detail: detail.slice(0, 200),
            dc_code: header.code,
            trn_no: trnNo,
            v_date: rDateBind,
            user_name: user,
            ent_date: now,
            ent_time: entTime,
          }
        );
      }

      await taxLedger(102, header.cgst_code, sumC);
      await taxLedger(103, header.sgst_code, sumS);
      await taxLedger(104, header.igst_code, sumI);
      await taxLedger(105, header.tax_code, header.addexp);

      const billSigns = partyTaxSigns(type, header.bill_amt, true);
      await exec(
        `INSERT INTO BILLS (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
           BILL_DATE, BILL_NO, B_TYPE, DR_AMT, CR_AMT, V_DATE, DETAIL, TRN_NO
         ) VALUES (
           :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
           :bill_date, :bill_no, :b_type, :dr_amt, :cr_amt, :v_date, :detail, 1
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: type,
          vr_date: rDateBind,
          vr_no: r_no,
          code: header.code,
          bill_date: billDateBind,
          bill_no: header.dc_bill_no || r_no,
          b_type: header.dc_b_type || type,
          dr_amt: billSigns.dr,
          cr_amt: billSigns.cr,
          v_date: rDateBind,
          detail: detail.slice(0, 200),
        }
      );
    });

    return { ok: true, type, r_no, r_date: formatDateOut(rDateBind), bill_amt: billAmt };
  }

  async function deleteVoucher(comp_code, comp_uid, noteType, r_date, r_no, mod_reason = '') {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!d || !no) {
      const err = new Error('R date and R no are required.');
      err.status = 400;
      throw err;
    }
    await withCompTransaction(comp_uid, async (exec) => {
      const key = { comp_code: cc, type, r_date: d, r_no: no };
      try {
        await exec(
          `INSERT INTO HI_PUR SELECT * FROM PURCHASE
           WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
             AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
          key
        );
        try {
          await exec(
            `UPDATE HI_PUR SET MOD_TYPE = 'D', MOD_REASON = :mod_reason
             WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
               AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
            { ...key, mod_reason: String(mod_reason || '').slice(0, 100) }
          );
        } catch {
          /* optional */
        }
      } catch (err) {
        if (!/ORA-00942|ORA-00904/i.test(String(err.message || ''))) throw err;
      }
      await exec(
        `DELETE FROM LEDGER WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
           AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
        key
      );
      await exec(
        `DELETE FROM BILLS WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
           AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
        key
      );
      await exec(
        `DELETE FROM PURCHASE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
           AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
        key
      );
    });
    return { ok: true, type, r_no: no, r_date: formatDateOut(d) };
  }

  async function posting(comp_code, comp_uid, noteType, r_date, r_no) {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    const ledger = await runQuery(
      `SELECT L.TRN_NO, L.CODE, M.NAME, L.DR_AMT, L.CR_AMT, L.DETAIL
       FROM LEDGER L
       LEFT JOIN MASTER M ON L.COMP_CODE = M.COMP_CODE AND L.CODE = M.CODE
       WHERE L.COMP_CODE = :comp_code AND TRIM(L.VR_TYPE) = :type
         AND TRUNC(L.VR_DATE) = TRUNC(:r_date) AND L.VR_NO = :r_no
       ORDER BY L.TRN_NO`,
      { comp_code: cc, type, r_date: d, r_no: no },
      comp_uid
    );
    const bills = await runQuery(
      `SELECT B.TRN_NO, B.CODE, B.BILL_NO, B.DR_AMT, B.CR_AMT, B.DETAIL
       FROM BILLS B
       WHERE B.COMP_CODE = :comp_code AND TRIM(B.VR_TYPE) = :type
         AND TRUNC(B.VR_DATE) = TRUNC(:r_date) AND B.VR_NO = :r_no
       ORDER BY B.TRN_NO`,
      { comp_code: cc, type, r_date: d, r_no: no },
      comp_uid
    );
    return { ledger: ledger || [], bills: bills || [] };
  }

  function round2(v) {
    return Math.round(num(v) * 100) / 100;
  }

  function formatEinvDate(raw) {
    const d = formatDateOut(raw);
    if (!d) return '';
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return d.replace(/-/g, '/');
  }

  function stateFromGstin(gstin) {
    const g = String(gstin ?? '').trim().toUpperCase();
    return g.length >= 2 ? g.slice(0, 2) : '';
  }

  /** MASTER has no PIN column — try 6-digit PIN from address lines. */
  function extractPinFromAddress(line = {}) {
    const blob = [line.party_add1, line.party_add2, line.party_add3, line.party_city].join(' ');
    const m = /\b(\d{6})\b/.exec(blob);
    return m ? Number(m[1]) : 0;
  }

  function textField(row, ...keys) {
    for (const k of keys) {
      const v = row?.[k] ?? row?.[String(k).toLowerCase()];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  async function fetchGstProfileEinv(comp_code) {
    const cc = String(comp_code ?? '').trim();
    const rows = await runQuery(
      `SELECT *
       FROM GST_PROFILE
       WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
      { comp_code: cc },
      null,
      { suppressDbErrorLog: true }
    );
    const row = rows?.[0] || {};
    return {
      gst_no: textField(row, 'GST_NO'),
      comp_name: textField(row, 'COMP_NAME'),
      trade_name: textField(row, 'TRADE_NAME'),
      pos_state_code: textField(row, 'POS_STATE_CODE'),
      state_code: textField(row, 'STATE_CODE'),
      add1: textField(row, 'ADD1'),
      add2: textField(row, 'ADD2'),
      city: textField(row, 'CITY'),
      pin_code: textField(row, 'PIN_CODE'),
      phone: textField(row, 'PHONE'),
      email: textField(row, 'EMAIL'),
      api_link: textField(row, 'API_LINK'),
      api_link_canc: textField(row, 'API_LINK_CANC'),
      user_name: textField(row, 'USER_NAME'),
      password: textField(row, 'PASSWORD'),
      customer_id: textField(row, 'CUSTOMER_ID'),
      appid: textField(row, 'APPID'),
      apisecret: textField(row, 'APISECRET'),
    };
  }

  async function fetchCompdetBrief(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const cu = String(comp_uid ?? '').trim();
    const sqlExact = `
      SELECT COMP_NAME, COMP_ADD1, COMP_ADD2, GST_NO, COMP_PAN, PIN_CODE, STATE, STATE_CODE, EMAIL, COMP_TEL1, COMP_YEAR
      FROM compdet
      WHERE comp_code = :comp_code AND TRIM(TO_CHAR(comp_uid)) = :comp_uid AND ROWNUM = 1`;
    const sqlLatest = `
      SELECT COMP_NAME, COMP_ADD1, COMP_ADD2, GST_NO, COMP_PAN, PIN_CODE, STATE, STATE_CODE, EMAIL, COMP_TEL1, COMP_YEAR
      FROM (
        SELECT COMP_NAME, COMP_ADD1, COMP_ADD2, GST_NO, COMP_PAN, PIN_CODE, STATE, STATE_CODE, EMAIL, COMP_TEL1, COMP_YEAR
        FROM compdet WHERE comp_code = :comp_code ORDER BY comp_year DESC NULLS LAST
      ) WHERE ROWNUM = 1`;
    for (const schema of [comp_uid, null]) {
      try {
        const rows = await runQuery(sqlExact, { comp_code: cc, comp_uid: cu }, schema);
        if (rows?.[0]) return rows[0];
      } catch {
        /* optional */
      }
      try {
        const rows = await runQuery(sqlLatest, { comp_code: cc }, schema);
        if (rows?.[0]) return rows[0];
      } catch {
        /* optional */
      }
    }
    return {};
  }

  async function loadEinvVoucherRows(comp_code, comp_uid, noteType, r_date, r_no) {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!d || !no) {
      const err = new Error('R date and R no are required.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT A.*,
              B.NAME AS PARTY_NAME, B.CITY, B.GST_NO AS PARTY_GST, B.PAN AS PARTY_PAN,
              B.ADD1 AS PARTY_ADD1, B.ADD2 AS PARTY_ADD2, B.ADD3 AS PARTY_ADD3,
              B.PIN_CODE AS PARTY_PIN, B.L_C,
              C.ITEM_NAME, C.HSN_CODE,
              D.NAME AS PUR_NAME
       FROM PURCHASE A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
       LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
       LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.PUR_CODE = D.CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = :type
         AND TRUNC(A.R_DATE) = TRUNC(:r_date)
         AND A.R_NO = :r_no
       ORDER BY A.TRN_NO`,
      { comp_code: cc, type, r_date: d, r_no: no },
      comp_uid
    );
    if (!rows?.length) {
      const err = new Error(type === 'DX' ? 'Debit note not found.' : 'Credit note not found.');
      err.status = 404;
      throw err;
    }
    const header = mapHeader(rows[0]);
    const lines = rows.map((r, i) => ({
      ...mapLine(r, i),
      hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
      party_add1: String(r.PARTY_ADD1 ?? r.party_add1 ?? '').trim(),
      party_add2: String(r.PARTY_ADD2 ?? r.party_add2 ?? '').trim(),
      party_add3: String(r.PARTY_ADD3 ?? r.party_add3 ?? '').trim(),
      party_city: String(r.CITY ?? r.city ?? '').trim(),
      party_pin: String(r.PARTY_PIN ?? r.party_pin ?? '').trim(),
      party_gst: String(r.PARTY_GST ?? r.party_gst ?? header.gst_no ?? '').trim(),
      party_pan: String(r.PARTY_PAN ?? r.party_pan ?? header.pan ?? '').trim(),
    }));
    return { type, header, lines };
  }

  function normalizeEinvForm(form, voucher, r_date, r_no) {
    return {
      sdt: formatDateOut(form.sdt || r_date),
      edt: formatDateOut(form.edt || r_date),
      sbno: String(form.sbno ?? r_no ?? '').trim(),
      ebno: String(form.ebno ?? r_no ?? '').trim(),
      b_type: String(form.b_type ?? voucher.header?.dc_b_type ?? '').trim().toUpperCase(),
      tpt_detail: String(form.tpt_detail ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
      mnc: String(form.mnc ?? 'N').trim().toUpperCase().slice(0, 1) || 'N',
      m_v_p: String(form.m_v_p ?? 'P').trim().toUpperCase().slice(0, 1) || 'P',
      irn_no: String(form.irn_no ?? voucher.header?.irn_no ?? '').trim(),
    };
  }

  function nullIfEmpty(v) {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
  }

  function buildNicEinvJson({ noteType, header, lines, company, profile, opts }) {
    const docTyp = noteType === 'CX' ? 'CRN' : 'DBN';

    if (opts.mnc === 'C') {
      return {
        Irn: opts.irn_no,
        CnlRsn: '1',
        CnlRem: String(header.remarks || 'Cancelled from GFASORCL web').trim().slice(0, 100),
      };
    }

    const ln0 = lines[0] || {};

    // Seller = GST_PROFILE (falls back to compdet only if profile empty)
    const sellerGst = profile.gst_no || textField(company, 'GST_NO');
    const sellerStcd = profile.state_code || stateFromGstin(sellerGst);
    const sellerName = profile.comp_name || textField(company, 'COMP_NAME');

    // Buyer = party (MASTER)
    const buyerGst = String(header.gst_no || ln0.party_gst || '').trim();
    const buyerHasGst = buyerGst.length >= 15;
    const buyerStcd = profile.pos_state_code || stateFromGstin(buyerGst) || sellerStcd;
    const buyerName = String(header.party_name || header.code || '').trim();
    const buyerAddr1 = String(ln0.party_add1 || ln0.party_city || '').slice(0, 100);
    const buyerAddr2 = nullIfEmpty(String(ln0.party_add2 || ln0.party_add3 || '').slice(0, 100));
    const buyerLoc = String(ln0.party_city || ln0.party_add3 || ln0.party_add1 || '').trim();
    const buyerPin = Number(ln0.party_pin) || extractPinFromAddress(ln0);

    const itemList = lines.map((ln, idx) => {
      const amtCal = String(ln.amt_cal ?? 'W').toUpperCase() === 'Q' ? 'Q' : 'W';
      const qty = round2(amtCal === 'Q' ? ln.qnty : ln.weight);
      const unit = amtCal === 'Q' ? 'NOS' : 'KGS';
      const taxable = round2(ln.amount);
      const cgst = round2(ln.cgst_amt);
      const sgst = round2(ln.sgst_amt);
      const igst = round2(ln.igst_amt);
      const totItem = round2(taxable + cgst + sgst + igst);
      const gstRt = round2(ln.cgst_per + ln.sgst_per + ln.igst_per);
      return {
        SlNo: String(idx + 1),
        PrdDesc: String(ln.item_name || `Item ${ln.item_code || idx + 1}`).trim().slice(0, 300),
        IsServc: 'N',
        HsnCd: String(ln.hsn_code || '0').trim() || '0',
        Barcde: null,
        Qty: qty,
        FreeQty: 0,
        Unit: unit,
        UnitPrice: round2(ln.rate),
        TotAmt: taxable,
        Discount: 0,
        PreTaxVal: 0,
        AssAmt: taxable,
        GstRt: gstRt,
        IgstAmt: igst,
        CgstAmt: cgst,
        SgstAmt: sgst,
        CesRt: 0,
        CesAmt: 0,
        CesNonAdvlAmt: 0,
        StateCesRt: 0,
        StateCesAmt: 0,
        StateCesNonAdvlAmt: 0,
        OthChrg: 0,
        TotItemVal: totItem,
        BchDtls: null,
      };
    });

    let assVal = 0;
    let cgstVal = 0;
    let sgstVal = 0;
    let igstVal = 0;
    let totInvVal = 0;
    for (const it of itemList) {
      assVal = round2(assVal + num(it.AssAmt));
      cgstVal = round2(cgstVal + num(it.CgstAmt));
      sgstVal = round2(sgstVal + num(it.SgstAmt));
      igstVal = round2(igstVal + num(it.IgstAmt));
      totInvVal = round2(totInvVal + num(it.TotItemVal));
    }
    const othChrg = round2(header.addexp);
    totInvVal = round2(totInvVal + othChrg);

    const payload = {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: buyerHasGst ? 'B2B' : 'B2C',
        RegRev: 'N',
        EcmGstin: null,
        IgstOnIntra: 'N',
      },
      DocDtls: {
        Typ: docTyp,
        No: String(header.r_no ?? opts.sbno ?? '').trim(),
        Dt: formatEinvDate(header.r_date),
      },
      BuyerDtls: {
        Gstin: buyerHasGst ? buyerGst : 'URP',
        LglNm: buyerName,
        TrdNm: null,
        Pos: buyerStcd,
        Addr1: buyerAddr1,
        Addr2: buyerAddr2,
        Loc: buyerLoc,
        Pin: buyerPin,
        Stcd: buyerStcd,
        Ph: null,
        Em: null,
      },
      SellerDtls: {
        Gstin: sellerGst,
        LglNm: sellerName,
        TrdNm: nullIfEmpty(profile.trade_name),
        Addr1: String(profile.add1 || textField(company, 'COMP_ADD1')).slice(0, 100),
        Addr2: nullIfEmpty(String(profile.add2 || textField(company, 'COMP_ADD2')).slice(0, 100)),
        Loc: profile.city || textField(company, 'STATE') || String(profile.add2 || '').trim(),
        Pin: Number(profile.pin_code || textField(company, 'PIN_CODE')) || 0,
        Stcd: sellerStcd,
        Ph: nullIfEmpty(profile.phone || textField(company, 'COMP_TEL1')),
        Em: nullIfEmpty(profile.email || textField(company, 'EMAIL')),
      },
      DispDtls: {
        Nm: buyerName,
        Addr1: buyerAddr1,
        Addr2: buyerAddr2 || '',
        Loc: buyerLoc,
        Pin: buyerPin,
        Stcd: buyerStcd,
      },
      ShipDtls: {
        Gstin: buyerHasGst ? buyerGst : 'URP',
        LglNm: buyerName,
        TrdNm: null,
        Addr1: buyerAddr1,
        Addr2: buyerAddr2,
        Loc: buyerLoc,
        Pin: buyerPin,
        Stcd: buyerStcd,
      },
      ItemList: itemList,
      ValDtls: {
        AssVal: assVal,
        IgstVal: igstVal,
        CgstVal: cgstVal,
        SgstVal: sgstVal,
        CesVal: 0,
        StCesVal: 0,
        Discount: 0,
        OthChrg: othChrg,
        RndOffAmt: 0,
        TotInvVal: totInvVal,
      },
      ExpDtls: {
        ShipBNo: null,
        ShipBDt: null,
        Port: null,
        RefClm: null,
        ForCur: null,
        CntCode: null,
        ExpDuty: 0,
      },
    };

    return payload;
  }

  function pickPortalField(obj, keys) {
    if (!obj || typeof obj !== 'object') return '';
    for (const k of keys) {
      if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const nested = pickPortalField(v, keys);
        if (nested) return nested;
      }
    }
    return '';
  }

  async function postEinvToPortal(profile, opts, json) {
    const isCancel = opts.mnc === 'C';
    const apiUrl = isCancel ? profile.api_link_canc || profile.api_link : profile.api_link;
    if (!apiUrl) {
      const err = new Error('E-Invoice API Link is not configured in GST Profile (Utilities → Gst Profile Setting).');
      err.status = 400;
      throw err;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (profile.user_name) headers.username = profile.user_name;
    if (profile.password) headers.password = profile.password;
    if (profile.customer_id) headers.customerid = profile.customer_id;
    if (profile.appid) headers.appid = profile.appid;
    if (profile.apisecret) headers.apisecret = profile.apisecret;

    const { data, status } = await axios.post(apiUrl, json, {
      headers,
      timeout: 120000,
      validateStatus: () => true,
    });
    const irn = pickPortalField(data, ['Irn', 'IRN', 'irn', 'IrnNo', 'irn_no']);
    const ackNo = pickPortalField(data, ['AckNo', 'ACK_NO', 'ack_no', 'AckDt']);
    const signedQr = pickPortalField(data, ['SignedQRCode', 'SIGNED_QR_CODE', 'signed_qr_code', 'SignedQrCode']);
    const portalErr = pickPortalField(data, ['ErrorMessage', 'error', 'message', 'Status']);
    if (!irn && status >= 400) {
      const err = new Error(portalErr || `E-Invoice portal returned HTTP ${status}.`);
      err.status = 502;
      err.portal = data;
      throw err;
    }
    if (!irn && portalErr && /error|fail|invalid/i.test(portalErr)) {
      const err = new Error(portalErr);
      err.status = 502;
      err.portal = data;
      throw err;
    }
    return { data, irn, ackNo, signedQr, apiUrl };
  }

  async function saveVoucherIrn(comp_code, comp_uid, noteType, r_date, r_no, irn, ackNo, signedQr) {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    const binds = {
      comp_code: cc,
      type,
      r_date: d,
      r_no: no,
      irn_no: String(irn || '').trim(),
      ack_no: String(ackNo || '').trim(),
      signed_qr_code: String(signedQr || '').trim(),
    };
    await runQuery(
      `UPDATE PURCHASE
       SET IRN_NO = :irn_no, ACK_NO = :ack_no, SIGNED_QR_CODE = :signed_qr_code
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
      binds,
      comp_uid,
      { autoCommit: true }
    );
  }

  /** VFP yearsel: G_M_YEAR = LTRIM(STR(G_COMPYEAR,4))+'C'+LTRIM(STR(G_COMPCODE,4)) */
  function buildGmYear(comp_year, comp_code) {
    const yy = String(Number(comp_year) || String(comp_year ?? '').trim() || '0');
    const cc = String(Number(comp_code) || String(comp_code ?? '').trim() || '0');
    return `${yy}C${cc}`;
  }

  /**
   * VFP sale_gst_einv_direct Proceed:
   *   lcBasePath = ADDBS(SYS(5)) + ALLTRIM(DIRPATH) + "\EINV\"
   *   lcYearPath = lcBasePath + ALLTRIM(G_M_YEAR) + "\"
   *   X_DOC_NO   = RTRIM(RTYPE) + LTRIM(STR(M_BILL_NO,6)) + RTRIM(M_B_TYPE)
   *   MYFILE     = lcYearPath + "JSON_"+X_DOC_NO+".JSON"
   */
  function resolveEinvPaths(comp_code, comp_year, noteType, form = {}) {
    const root = String(process.env.GFASORCL_ROOT || 'E:\\GFASORCL').trim();
    const gMYear = buildGmYear(comp_year, comp_code);
    const yearPath = path.join(root, 'EINV', gMYear);
    const qrPath = path.join(yearPath, 'QRCODE');
    const cancPath = path.join(yearPath, 'CANC');
    const rtype = String(noteType || '').trim().toUpperCase();
    const billNoRaw = String(form.sbno ?? form.r_no ?? '').trim();
    const billNo = String(Number(billNoRaw) || billNoRaw || '0');
    const bType = String(form.b_type ?? '').trim().toUpperCase();
    const xDocNo = `${rtype}${billNo}${bType}`;
    return {
      root,
      gMYear,
      yearPath,
      qrPath,
      cancPath,
      xDocNo,
      jsonFile: path.join(yearPath, `JSON_${xDocNo}.JSON`),
      txtFile: path.join(yearPath, `JSON_${xDocNo}.TXT`),
      imageFile: path.join(qrPath, `I${xDocNo}.JPG`),
    };
  }

  function ensureEinvDirs(paths) {
    for (const dir of [paths.yearPath, paths.qrPath, paths.cancPath]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Save JSON like VFP DO CREATE_JSON WITH MYFILE — overwrite existing. */
  function saveEinvJsonFile(paths, json) {
    ensureEinvDirs(paths);
    if (fs.existsSync(paths.jsonFile)) {
      try {
        fs.unlinkSync(paths.jsonFile);
      } catch {
        /* overwrite below */
      }
    }
    fs.writeFileSync(paths.jsonFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    return {
      saved: true,
      jsonFile: paths.jsonFile,
      txtFile: paths.txtFile,
      imageFile: paths.imageFile,
      xDocNo: paths.xDocNo,
      gMYear: paths.gMYear,
      yearPath: paths.yearPath,
    };
  }

  async function resolveCompYear(comp_code, comp_uid, bodyYear) {
    const fromBody = Number(bodyYear) || 0;
    if (fromBody) return fromBody;
    try {
      const company = await fetchCompdetBrief(comp_code, comp_uid);
      return Number(textField(company, 'COMP_YEAR')) || 0;
    } catch {
      return 0;
    }
  }

  /** Build NIC e-invoice JSON for preview (VFP sale_gst_einv_DIRECT — show JSON first). */
  async function buildDirectEinvJson(comp_code, comp_uid, type, r_date, r_no, form = {}, comp_year = 0) {
    const noteType = assertType(type);
    const profile = await fetchGstProfileEinv(comp_code);
    if (!profile.gst_no) {
      const err = new Error('!!! Direct E.Inv. Not Activated !!!');
      err.status = 400;
      throw err;
    }
    const voucher = await loadEinvVoucherRows(comp_code, comp_uid, noteType, r_date, r_no);
    const company = await fetchCompdetBrief(comp_code, comp_uid);
    const opts = normalizeEinvForm(form, voucher, r_date, r_no);
    const json = buildNicEinvJson({
      noteType,
      header: voucher.header,
      lines: voucher.lines,
      company,
      profile,
      opts,
    });

    const year = (Number(comp_year) || 0) || Number(textField(company, 'COMP_YEAR')) || 0;
    let fileInfo = null;
    try {
      const paths = resolveEinvPaths(comp_code, year, noteType, opts);
      fileInfo = saveEinvJsonFile(paths, json);
    } catch (err) {
      console.error('❌ dc-note einv save JSON file:', err.message);
      fileInfo = { saved: false, error: err.message };
    }

    return {
      ok: true,
      phase: 'preview',
      form: opts,
      header: voucher.header,
      json,
      jsonText: JSON.stringify(json, null, 2),
      docType: noteType === 'CX' ? 'CRN' : 'DBN',
      apiConfigured: Boolean(profile.api_link || profile.api_link_canc),
      file: fileInfo,
    };
  }

  /** VFP sale_gst_einv_DIRECT — preview JSON, then POST to portal on confirm. */
  async function submitDirectEinv(comp_code, comp_uid, type, r_date, r_no, form = {}, { confirm = false, comp_year = 0 } = {}) {
    const preview = await buildDirectEinvJson(comp_code, comp_uid, type, r_date, r_no, form, comp_year);
    if (!confirm) return preview;

    const profile = await fetchGstProfileEinv(comp_code);
    const opts = preview.form;
    const portal = await postEinvToPortal(profile, opts, preview.json);
    if (portal.irn) {
      await saveVoucherIrn(comp_code, comp_uid, type, r_date, r_no, portal.irn, portal.ackNo, portal.signedQr);
      preview.header = {
        ...preview.header,
        irn_no: portal.irn,
        ack_no: portal.ackNo,
        signed_qr_code: portal.signedQr,
      };
    }
    return {
      ...preview,
      ok: Boolean(portal.irn),
      phase: 'submitted',
      message: portal.irn
        ? `E-Invoice created. IRN ${portal.irn}`
        : 'Portal responded without IRN — check portal logs.',
      portalResponse: portal.data,
      irn_no: portal.irn,
      ack_no: portal.ackNo,
      signed_qr_code: portal.signedQr,
    };
  }

  /** VFP DCNOTE bill-date help — SALE (S_P=S) or PURCHASE PU/EV (S_P=P). */
  async function fetchBillHelp(comp_code, comp_uid, partyCode, s_p, fy_s_date) {
    const cc = Number(comp_code) || 0;
    const code = normCode(partyCode);
    if (!code) {
      const err = new Error('Enter party code before bill help.');
      err.status = 400;
      throw err;
    }
    const sp = spFlag(s_p, 'P');

    if (sp === 'S') {
      const saleRows = await runQuery(
        `SELECT A.BILL_NO,
                TRUNC(A.BILL_DATE) AS BILL_DATE,
                NVL(A.B_TYPE, ' ') AS B_TYPE,
                NVL(A.BK_CODE, ' ') AS BK_CODE,
                NVL(A.ITEM_CODE, 0) AS ITEM_CODE,
                NVL(A.LOT, 0) AS LOT,
                NVL(A.STATUS, ' ') AS STATUS,
                NVL(A.B_NO, 0) AS B_NO,
                NVL(A.GOD_CODE, ' ') AS GOD_CODE,
                NVL(A.SUP_CODE, ' ') AS SUP_CODE,
                NVL(A.QNTY, 0) AS QNTY,
                NVL(A.WEIGHT, 0) AS WEIGHT,
                NVL(A.RATE, 0) AS RATE,
                NVL(A.AMOUNT, 0) AS AMOUNT,
                NVL(A.COST_CODE, ' ') AS COST_CODE,
                TRUNC(NVL(A.SUP_DATE, A.BILL_DATE)) AS SUP_DATE
         FROM SALE A
         WHERE A.COMP_CODE = :comp_code
           AND TRIM(A.TYPE) = 'SL'
           AND TRIM(A.CODE) = TRIM(:code)
         ORDER BY A.BILL_NO`,
        { comp_code: cc, code },
        comp_uid
      );

      let openingRows = [];
      const sdt = formatDateBind(fy_s_date);
      if (sdt) {
        try {
          openingRows = await runQuery(
            `SELECT BILL_NO,
                    TRUNC(BILL_DATE) AS BILL_DATE,
                    NVL(B_TYPE, ' ') AS B_TYPE,
                    SUM(NVL(DR_AMT, 0) - NVL(CR_AMT, 0)) AS AMOUNT
             FROM BILLS
             WHERE COMP_CODE = :comp_code
               AND TRIM(CODE) = TRIM(:code)
               AND TRUNC(BILL_DATE) < TRUNC(:s_date)
             GROUP BY BILL_NO, BILL_DATE, B_TYPE
             HAVING SUM(NVL(DR_AMT, 0) - NVL(CR_AMT, 0)) > 0
             ORDER BY BILL_DATE, BILL_NO`,
            { comp_code: cc, code, s_date: sdt },
            comp_uid
          );
        } catch (err) {
          if (!/ORA-00942|ORA-00904/i.test(String(err.message || ''))) throw err;
        }
      }

      const out = [];
      let idx = 0;
      for (const r of openingRows || []) {
        idx += 1;
        out.push({
          id: `open-${idx}`,
          source: 'BILLS',
          bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
          bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
          b_type: String(r.B_TYPE ?? r.b_type ?? '').trim().toUpperCase(),
          amount: num(r.AMOUNT ?? r.amount),
          item_code: 0,
          qnty: 0,
          weight: 0,
          rate: 0,
        });
      }
      for (const r of saleRows || []) {
        idx += 1;
        out.push({
          id: `sl-${idx}`,
          source: 'SALE',
          bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
          bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
          b_type: String(r.B_TYPE ?? r.b_type ?? '').trim().toUpperCase(),
          bk_code: normCode(r.BK_CODE ?? r.bk_code),
          item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
          qnty: num(r.QNTY ?? r.qnty),
          weight: num(r.WEIGHT ?? r.weight),
          rate: num(r.RATE ?? r.rate),
          amount: num(r.AMOUNT ?? r.amount),
          lot: Number(r.LOT ?? r.lot ?? 0) || 0,
          status: String(r.STATUS ?? r.status ?? '').trim(),
          b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
          god_code: normCode(r.GOD_CODE ?? r.god_code),
          sup_code: normCode(r.SUP_CODE ?? r.sup_code),
          cost_code: normCode(r.COST_CODE ?? r.cost_code),
          sup_date: formatDateOut(r.SUP_DATE ?? r.sup_date),
        });
      }
      return out;
    }

    const purRows = await runQuery(
      `SELECT TRUNC(A.R_DATE) AS R_DATE,
              A.R_NO,
              NVL(A.BILL_NO, ' ') AS BILL_NO,
              TRUNC(A.BILL_DATE) AS BILL_DATE,
              A.ITEM_CODE,
              NVL(C.ITEM_NAME, ' ') AS ITEM_NAME,
              NVL(A.STATUS, ' ') AS STATUS,
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
              NVL(A.TRN_NO, 0) AS TRN_NO
       FROM PURCHASE A
       LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) IN ('PU', 'EV')
         AND TRIM(A.CODE) = TRIM(:code)
       ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`,
      { comp_code: cc, code },
      comp_uid
    );
    return (purRows || []).map((r, idx) => ({
      id: `pu-${formatDateOut(r.R_DATE ?? r.r_date)}-${r.R_NO ?? r.r_no}-${r.TRN_NO ?? r.trn_no}-${idx}`,
      source: 'PURCHASE',
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: String(r.STATUS ?? r.status ?? '').trim(),
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
    }));
  }

  async function checklist(comp_code, comp_uid, noteType, filters = {}) {
    const type = assertType(noteType);
    const cc = Number(comp_code) || 0;
    const sdt = formatDateBind(filters.s_date);
    const edt = formatDateBind(filters.e_date);
    if (!sdt || !edt) {
      const err = new Error('s_date and e_date are required');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type, s_date: sdt, e_date: edt };
    let sql = `
      SELECT A.R_DATE, A.R_NO, A.BILL_DATE, A.BILL_NO, A.CODE,
             NVL(C.NAME, ' ') AS NAME, NVL(C.GST_NO, ' ') AS GST_NO,
             A.ITEM_CODE, NVL(B.ITEM_NAME, ' ') AS ITEM_NAME,
             NVL(A.QNTY, 0) AS QNTY, NVL(A.WEIGHT, 0) AS WEIGHT,
             NVL(A.RATE, 0) AS RATE, NVL(A.AMOUNT, 0) AS AMOUNT,
             NVL(A.CGST_AMT, 0) AS CGST_AMT, NVL(A.SGST_AMT, 0) AS SGST_AMT,
             NVL(A.IGST_AMT, 0) AS IGST_AMT, NVL(A.ADDEXP, 0) AS ADDEXP,
             NVL(A.BILL_AMT, 0) AS BILL_AMT, A.TRN_NO, A.TYPE
      FROM PURCHASE A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = :type
        AND TRUNC(A.R_DATE) BETWEEN TRUNC(:s_date) AND TRUNC(:e_date)`;
    if (filters.code) {
      sql += ` AND A.CODE = :code`;
      binds.code = normCode(filters.code);
    }
    if (filters.item_code) {
      sql += ` AND A.ITEM_CODE = :item_code`;
      binds.item_code = Number(filters.item_code) || 0;
    }
    sql += ` ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r, idx) => ({
      type,
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      code: normCode(r.CODE ?? r.code),
      name: String(r.NAME ?? r.name ?? '').trim(),
      gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
      addexp: num(r.ADDEXP ?? r.addexp),
      bill_amt: num(r.BILL_AMT ?? r.bill_amt),
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
    }));
  }

  function registerRoutes(app) {
    app.get('/api/dc-note/context', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        res.json(await fetchCtx(comp_code, comp_uid));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dc-note/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date } = req.query;
        const noteType = assertType(type);
        const next_no = await fetchNextRNo(comp_code, comp_uid, noteType, r_date);
        res.json({ next_no, type: noteType });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dc-note/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, sdt, edt, party } = req.query;
        const rows = await listVouchers(comp_code, comp_uid, type, { sdt, edt, party });
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dc-note', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no } = req.query;
        res.json(await loadVoucher(comp_code, comp_uid, type, r_date, r_no));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dc-note/posting', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no } = req.query;
        res.json(await posting(comp_code, comp_uid, type, r_date, r_no));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dc-note/bill-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, s_p, fy_s_date } = req.query;
        const rows = await fetchBillHelp(comp_code, comp_uid, code, s_p, fy_s_date);
        res.json({ ok: true, rows });
      } catch (err) {
        console.error('❌ dc-note bill-help:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/dc-note/einv-json', async (req, res) => {
      try {
        const body = req.body || {};
        const { comp_code, comp_uid, type, r_date, r_no, form, comp_year } = body;
        const year = await resolveCompYear(comp_code, comp_uid, comp_year);
        res.json(await buildDirectEinvJson(comp_code, comp_uid, type, r_date, r_no, form, year));
      } catch (err) {
        console.error('❌ dc-note einv-json:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/dc-note/einv-direct', async (req, res) => {
      try {
        const body = req.body || {};
        const { comp_code, comp_uid, type, r_date, r_no, form, confirm, comp_year } = body;
        const year = await resolveCompYear(comp_code, comp_uid, comp_year);
        const out = await submitDirectEinv(comp_code, comp_uid, type, r_date, r_no, form, {
          confirm: confirm === true || confirm === 'true' || confirm === 1 || confirm === '1',
          comp_year: year,
        });
        res.json(out);
      } catch (err) {
        console.error('❌ dc-note einv-direct:', err.message);
        res.status(err.status || 500).json({
          error: err.message,
          portal: err.portal || undefined,
        });
      }
    });

    app.get('/api/dc-note/checklist', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, s_date, e_date, code, item_code } = req.query;
        const rows = await checklist(comp_code, comp_uid, type, { s_date, e_date, code, item_code });
        res.json(rows);
      } catch (err) {
        console.error('❌ dc-note checklist:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/dc-note', async (req, res) => {
      try {
        const body = req.body || {};
        const user = req.session?.user_name || body.user_name || 'WEB';
        res.json(await saveVoucher(body.comp_code, body.comp_uid, body, user));
      } catch (err) {
        console.error('❌ dc-note save:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.delete('/api/dc-note', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, r_date, r_no, mod_reason } = req.query;
        res.json(await deleteVoucher(comp_code, comp_uid, type, r_date, r_no, mod_reason));
      } catch (err) {
        console.error('❌ dc-note delete:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  }

  return { registerRoutes, loadVoucher, saveVoucher, deleteVoucher };
}

module.exports = { createDcNote };
