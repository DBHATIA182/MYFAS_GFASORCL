/**
 * Purchase Other Items / Expenses Voucher — VFP DO FORM EXPVOU WITH 'EV',...
 */

'use strict';

const EV_TYPE = 'EV';

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

function createExpVoucher({ runQuery, parseDateOnly, withCompTransaction }) {
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

  function stripDrive(raw) {
    let s = String(raw || '')
      .trim()
      .replace(/\//g, '\\');
    if (!s) return '';
    s = s.replace(/^[A-Za-z]:/, '');
    if (s && !s.startsWith('\\')) s = '\\' + s;
    return s.slice(0, 200);
  }

  async function fetchCtx(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(CGST_CODE, '') AS CGST_CODE,
                NVL(SGST_CODE, '') AS SGST_CODE,
                NVL(IGST_CODE, '') AS IGST_CODE,
                NVL(TCS_CODE, '') AS TCS_CODE,
                NVL(NTDS_CODE, '') AS NTDS_CODE,
                NVL(NTDS_NATURE, '') AS NTDS_NATURE,
                NVL(NTDS_PER, 0) AS NTDS_PER
         FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const r = rows?.[0] || {};
      return {
        cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
        sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
        igst_code: normCode(r.IGST_CODE ?? r.igst_code),
        tcs_code: normCode(r.TCS_CODE ?? r.tcs_code),
        ntds_code: normCode(r.NTDS_CODE ?? r.ntds_code),
        ntds_nature: String(r.NTDS_NATURE ?? r.ntds_nature ?? '').trim(),
        ntds_per: num(r.NTDS_PER ?? r.ntds_per),
      };
    } catch {
      return {
        cgst_code: '',
        sgst_code: '',
        igst_code: '',
        tcs_code: '',
        ntds_code: '',
        ntds_nature: '',
        ntds_per: 0,
      };
    }
  }

  async function fetchNextRNo(comp_code, comp_uid, r_date) {
    const d = formatDateBind(r_date);
    const rows = await runQuery(
      `SELECT NVL(MAX(R_NO), 0) + 1 AS NEXT_NO
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date)`,
      { comp_code: Number(comp_code) || 0, type: EV_TYPE, r_date: d },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  async function partyTotPur(comp_code, comp_uid, code) {
    if (!code) return 0;
    try {
      const rows = await runQuery(
        `SELECT NVL(SUM(NVL(CR_AMT, 0) - NVL(DR_AMT, 0)), 0) AS TOT
         FROM LEDGER
         WHERE COMP_CODE = :comp_code
           AND TRIM(CODE) = TRIM(:code)
           AND TRIM(VR_TYPE) IN ('PU', 'EV')`,
        { comp_code: Number(comp_code) || 0, code: normCode(code) },
        comp_uid
      );
      return num(rows?.[0]?.TOT ?? rows?.[0]?.tot);
    } catch {
      return 0;
    }
  }

  function mapHeader(r) {
    return {
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
      code: normCode(r.CODE ?? r.code ?? r.SUP_CODE ?? r.sup_code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      party_city: String(r.CITY ?? r.city ?? '').trim(),
      gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
      pan: String(r.PAN ?? r.pan ?? '').trim(),
      l_c: String(r.L_C ?? r.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L',
      input_yn: yn(r.INPUT_YN ?? r.input_yn, 'Y'),
      show_in_gstr: yn(r.SHOW_IN_GSTR ?? r.show_in_gstr, 'Y'),
      gst_trf: yn(r.GST_TRF ?? r.gst_trf, 'Y'),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      god_name: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      cost_name: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      mod_reason: String(r.MOD_REASON ?? r.mod_reason ?? '').trim(),
      p_bill_no_file_path: stripDrive(r.P_BILL_NO_FILE_PATH ?? r.p_bill_no_file_path),
      bill_amt: num(r.BILL_AMT ?? r.bill_amt),
      cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
      sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
      igst_code: normCode(r.IGST_CODE ?? r.igst_code),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
      oth_cd_1: normCode(r.OTH_CD_1 ?? r.oth_cd_1),
      oth_exp_1: num(r.OTH_EXP_1 ?? r.oth_exp_1),
      tcs_per: num(r.TCS_PER ?? r.tcs_per),
      tcs_amt: num(r.TCS_AMT ?? r.tcs_amt),
      tcs_code: normCode(r.TCS_CODE ?? r.tcs_code),
      ntds_per: num(r.NTDS_PER ?? r.ntds_per),
      ntds_amt: num(r.NTDS_AMT ?? r.ntds_amt),
      ntds_on_amt: num(r.NTDS_ON_AMT ?? r.ntds_on_amt),
      ntds_code: normCode(r.NTDS_CODE ?? r.ntds_code),
      nature: String(r.NATURE ?? r.nature ?? '').trim(),
      freight: num(r.FREIGHT ?? r.freight),
    };
  }

  function mapLine(r, idx) {
    return {
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      pur_code: normCode(r.PUR_CODE ?? r.pur_code),
      pur_name: String(r.PUR_NAME ?? r.pur_name ?? '').trim(),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      freight: num(r.FREIGHT ?? r.freight),
      cgst_per: num(r.CGST_PER ?? r.cgst_per),
      sgst_per: num(r.SGST_PER ?? r.sgst_per),
      igst_per: num(r.IGST_PER ?? r.igst_per),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
    };
  }

  async function loadVoucher(comp_code, comp_uid, r_date, r_no) {
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
              B.NAME AS PARTY_NAME, B.CITY, B.GST_NO, B.PAN,
              C.ITEM_NAME,
              D.NAME AS PUR_NAME,
              G.GOD_NAME,
              CT.COST_NAME
       FROM PURCHASE A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
       LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
       LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.PUR_CODE = D.CODE
       LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
       LEFT JOIN COST CT ON A.COMP_CODE = CT.COMP_CODE AND A.COST_CODE = CT.COST_CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = :type
         AND TRUNC(A.R_DATE) = TRUNC(:r_date)
         AND A.R_NO = :r_no
       ORDER BY A.TRN_NO`,
      { comp_code: cc, type: EV_TYPE, r_date: d, r_no: no },
      comp_uid
    );
    if (!rows?.length) {
      const err = new Error('Expenses voucher not found.');
      err.status = 404;
      throw err;
    }
    const header = mapHeader(rows[0]);
    header.tot_pur = await partyTotPur(cc, comp_uid, header.code);
    const lines = rows.map((r, i) => mapLine(r, i));
    return { ok: true, header, lines };
  }

  async function listVouchers(comp_code, comp_uid, filters = {}) {
    const binds = { comp_code: Number(comp_code) || 0, type: EV_TYPE };
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

  async function deleteExisting(exec, cc, cy, rDateBind, r_no) {
    const key = { comp_code: cc, type: EV_TYPE, r_date: rDateBind, r_no };
    const tables = [
      `DELETE FROM LEDGER WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM BILLS WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM TDS WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
      `DELETE FROM PUREXP_DET WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
      `DELETE FROM PURCHASE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type
         AND TRUNC(R_DATE) = TRUNC(:r_date) AND R_NO = :r_no`,
    ];
    for (const sql of tables) {
      try {
        await exec(sql, key);
      } catch (err) {
        if (!/ORA-00942|ORA-00904/i.test(String(err.message || ''))) throw err;
      }
    }
  }

  async function saveVoucher(comp_code, comp_uid, body, userName) {
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
      r_no = await fetchNextRNo(cc, comp_uid, rDate);
    }

    const ctx = await fetchCtx(cc, comp_uid);
    const footer = body.footer && typeof body.footer === 'object' ? body.footer : body;

    const sumAmt = lines.reduce((s, ln) => s + num(ln.amount), 0);
    const sumWgt = lines.reduce((s, ln) => s + num(ln.weight), 0);
    const sumFgt = lines.reduce((s, ln) => s + num(ln.freight), 0);
    const sumC = lines.reduce((s, ln) => s + num(ln.cgst_amt), 0);
    const sumS = lines.reduce((s, ln) => s + num(ln.sgst_amt), 0);
    const sumI = lines.reduce((s, ln) => s + num(ln.igst_amt), 0);
    const oth1 = num(footer.oth_exp_1);
    const tcsAmt = num(footer.tcs_amt);
    const ntdsAmt = num(footer.ntds_amt);
    const billAmt =
      num(footer.bill_amt ?? footer.mbamt) ||
      Math.round((sumAmt + sumC + sumS + sumI + sumFgt + oth1 + tcsAmt) * 100) / 100;
    const netPayable = Math.round((billAmt - ntdsAmt) * 100) / 100;

    const header = {
      bill_no: String(body.bill_no ?? '').trim().slice(0, 20),
      code: party,
      l_c: String(body.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L',
      input_yn: yn(body.input_yn, 'Y'),
      show_in_gstr: yn(body.show_in_gstr, 'Y'),
      gst_trf: yn(body.gst_trf, 'Y'),
      god_code: normCode(body.god_code),
      cost_code: normCode(body.cost_code),
      remarks: String(body.remarks ?? '').trim().slice(0, 100),
      mod_reason: String(body.mod_reason ?? '').trim().slice(0, 100),
      p_bill_no_file_path: stripDrive(footer.p_bill_no_file_path ?? body.p_bill_no_file_path),
      cgst_code: normCode(footer.cgst_code ?? ctx.cgst_code),
      sgst_code: normCode(footer.sgst_code ?? ctx.sgst_code),
      igst_code: normCode(footer.igst_code ?? ctx.igst_code),
      oth_cd_1: normCode(footer.oth_cd_1),
      oth_exp_1: oth1,
      tcs_per: num(footer.tcs_per),
      tcs_amt: tcsAmt,
      tcs_code: normCode(footer.tcs_code ?? ctx.tcs_code),
      ntds_per: num(footer.ntds_per),
      ntds_amt: ntdsAmt,
      ntds_on_amt: num(footer.ntds_on_amt) || sumAmt,
      ntds_code: normCode(footer.ntds_code ?? ctx.ntds_code),
      nature: String(footer.nature ?? '').trim().slice(0, 50),
      bill_amt: billAmt,
    };

    if (Math.abs(billAmt) < 0.0001) {
      const err = new Error('Bill amount should not be zero.');
      err.status = 400;
      throw err;
    }

    const user = String(userName || body.user_name || 'WEB').trim().slice(0, 30);
    const now = new Date();
    const entTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    await withCompTransaction(comp_uid, async (exec) => {
      await deleteExisting(exec, cc, cy, rDateBind, r_no);

      let trn = 1;
      for (const ln of lines) {
        const isFirst = trn === 1;
        const weight = num(ln.weight);
        const rate = num(ln.rate);
        const amount = num(ln.amount) || Math.round(weight * rate * 100) / 100;
        const taxable = amount + num(ln.freight);
        await exec(
          `INSERT INTO PURCHASE (
             COMP_CODE, COMP_YEAR, TYPE, R_DATE, R_NO, BILL_DATE, BILL_NO,
             SUP_CODE, CODE, BILL_AMT, USER_NAME, ENT_DATE, TRN_NO,
             ITEM_CODE, WEIGHT, RATE, AMOUNT, PUR_CODE, FREIGHT, REMARKS,
             CGST_PER, SGST_PER, IGST_PER, CGST_AMT, SGST_AMT, IGST_AMT,
             CGST_CODE, SGST_CODE, IGST_CODE, TAXABLE, INPUT_YN,
             OTH_CD_1, OTH_EXP_1, GOD_CODE, TCS_PER, TCS_AMT, TCS_CODE,
             MOD_REASON, ENT_TIME, NTDS_PER, NTDS_AMT, NTDS_ON_AMT, NTDS_CODE,
             NATURE, GST_TRF, P_BILL_NO_FILE_PATH, COST_CODE, SHOW_IN_GSTR
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :bill_date, :bill_no,
             :sup_code, :code, :bill_amt, :user_name, :ent_date, :trn_no,
             :item_code, :weight, :rate, :amount, :pur_code, :freight, :remarks,
             :cgst_per, :sgst_per, :igst_per, :cgst_amt, :sgst_amt, :igst_amt,
             :cgst_code, :sgst_code, :igst_code, :taxable, :input_yn,
             :oth_cd_1, :oth_exp_1, :god_code, :tcs_per, :tcs_amt, :tcs_code,
             :mod_reason, :ent_time, :ntds_per, :ntds_amt, :ntds_on_amt, :ntds_code,
             :nature, :gst_trf, :p_bill_no_file_path, :cost_code, :show_in_gstr
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            bill_date: billDateBind,
            bill_no: header.bill_no,
            sup_code: party,
            code: party,
            bill_amt: isFirst ? billAmt : 0,
            user_name: user,
            ent_date: now,
            trn_no: trn,
            item_code: Number(ln.item_code) || 0,
            weight,
            rate,
            amount,
            pur_code: normCode(ln.pur_code),
            freight: num(ln.freight),
            remarks: header.remarks,
            cgst_per: num(ln.cgst_per),
            sgst_per: num(ln.sgst_per),
            igst_per: num(ln.igst_per),
            cgst_amt: num(ln.cgst_amt),
            sgst_amt: num(ln.sgst_amt),
            igst_amt: num(ln.igst_amt),
            cgst_code: header.cgst_code,
            sgst_code: header.sgst_code,
            igst_code: header.igst_code,
            taxable,
            input_yn: header.input_yn,
            oth_cd_1: isFirst ? header.oth_cd_1 : '',
            oth_exp_1: isFirst ? header.oth_exp_1 : 0,
            god_code: header.god_code,
            tcs_per: isFirst ? header.tcs_per : 0,
            tcs_amt: isFirst ? header.tcs_amt : 0,
            tcs_code: isFirst ? header.tcs_code : '',
            mod_reason: header.mod_reason,
            ent_time: entTime,
            ntds_per: isFirst ? header.ntds_per : 0,
            ntds_amt: isFirst ? header.ntds_amt : 0,
            ntds_on_amt: isFirst ? header.ntds_on_amt : 0,
            ntds_code: isFirst ? header.ntds_code : '',
            nature: isFirst ? header.nature : '',
            gst_trf: header.gst_trf,
            p_bill_no_file_path: header.p_bill_no_file_path,
            cost_code: header.cost_code,
            show_in_gstr: header.show_in_gstr,
          }
        );

        // Expense a/c DR
        let drAmt = amount + num(ln.freight);
        if (header.gst_trf === 'N') {
          drAmt += num(ln.cgst_amt) + num(ln.sgst_amt) + num(ln.igst_amt);
        }
        const detail = `B.NO.:${header.bill_no} @ ${rate}`;
        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, DC_CODE, ITEM_CODE, WEIGHT, RATE, TRN_NO,
             USER_NAME, ENT_DATE, ENT_TIME, COST_CODE
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :code,
             :dr_amt, 0, :detail, :dc_code, :item_code, :weight, :rate, :trn_no,
             :user_name, :ent_date, :ent_time, :cost_code
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            code: normCode(ln.pur_code),
            dr_amt: drAmt,
            detail,
            dc_code: party,
            item_code: Number(ln.item_code) || 0,
            weight,
            rate,
            trn_no: trn,
            user_name: user,
            ent_date: now,
            ent_time: entTime,
            cost_code: header.cost_code,
          }
        );
        trn += 1;
      }

      // Party CR
      await exec(
        `INSERT INTO LEDGER (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
           DR_AMT, CR_AMT, DETAIL, TRN_NO, WEIGHT, USER_NAME, ENT_DATE, ENT_TIME,
           TDS_PER, TDS_ON_AMT, TDS_AMT, DC_CODE
         ) VALUES (
           :comp_code, :comp_year, :type, :r_date, :r_no, :code,
           0, :cr_amt, :detail, 101, :weight, :user_name, :ent_date, :ent_time,
           :ntds_per, :ntds_on_amt, :ntds_amt, :dc_code
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          type: EV_TYPE,
          r_date: rDateBind,
          r_no,
          code: party,
          cr_amt: billAmt,
          detail: `B.NO.:${header.bill_no} ${sumWgt}`,
          weight: sumWgt,
          user_name: user,
          ent_date: now,
          ent_time: entTime,
          ntds_per: header.ntds_per,
          ntds_on_amt: header.ntds_on_amt,
          ntds_amt: header.ntds_amt,
          dc_code: normCode(lines[0]?.pur_code),
        }
      );

      async function taxLedger(code, amt, label) {
        if (!code || Math.abs(amt) < 0.0001 || header.gst_trf === 'N') return;
        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, TRN_NO, USER_NAME, ENT_DATE, ENT_TIME, COST_CODE
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :code,
             :dr_amt, 0, :detail, 401, :user_name, :ent_date, :ent_time, :cost_code
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            code,
            dr_amt: amt,
            detail: `${label} ${party}`,
            user_name: user,
            ent_date: now,
            ent_time: entTime,
            cost_code: header.cost_code,
          }
        );
      }
      await taxLedger(header.cgst_code, sumC, 'CGST');
      await taxLedger(header.sgst_code, sumS, 'SGST');
      await taxLedger(header.igst_code, sumI, 'IGST');

      if (header.oth_cd_1 && Math.abs(header.oth_exp_1) > 0.0001) {
        const othDr = header.oth_exp_1 > 0 ? header.oth_exp_1 : 0;
        const othCr = header.oth_exp_1 < 0 ? Math.abs(header.oth_exp_1) : 0;
        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, TRN_NO, USER_NAME, ENT_DATE, ENT_TIME
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :code,
             :dr_amt, :cr_amt, :detail, 501, :user_name, :ent_date, :ent_time
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            code: header.oth_cd_1,
            dr_amt: othDr,
            cr_amt: othCr,
            detail: 'ADD/LESS EXP',
            user_name: user,
            ent_date: now,
            ent_time: entTime,
          }
        );
      }

      if (header.ntds_code && Math.abs(header.ntds_amt) > 0.0001) {
        await exec(
          `INSERT INTO LEDGER (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             DR_AMT, CR_AMT, DETAIL, TRN_NO, USER_NAME, ENT_DATE, ENT_TIME
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :code,
             0, :cr_amt, :detail, 701, :user_name, :ent_date, :ent_time
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            code: header.ntds_code,
            cr_amt: header.ntds_amt,
            detail: `TDS @ ${header.ntds_per}%`,
            user_name: user,
            ent_date: now,
            ent_time: entTime,
          }
        );
      }

      // Party bill CR (bill_no stored as R_NO per VFP)
      await exec(
        `INSERT INTO BILLS (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
           BILL_DATE, BILL_NO, DR_AMT, CR_AMT, V_DATE, DETAIL, COST_CODE, TRN_NO
         ) VALUES (
           :comp_code, :comp_year, :type, :r_date, :r_no, :code,
           :bill_date, :bill_no, 0, :cr_amt, :v_date, :detail, :cost_code, 1
         )`,
        {
          comp_code: cc,
          comp_year: cy,
          type: EV_TYPE,
          r_date: rDateBind,
          r_no,
          code: party,
          bill_date: billDateBind,
          bill_no: String(r_no),
          cr_amt: billAmt,
          v_date: rDateBind,
          detail: `Qty ${sumWgt} Amt ${billAmt}`,
          cost_code: header.cost_code,
        }
      );

      if (Math.abs(header.ntds_amt) > 0.0001) {
        await exec(
          `INSERT INTO BILLS (
             COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
             BILL_DATE, BILL_NO, DR_AMT, CR_AMT, V_DATE, DETAIL, COST_CODE, TRN_NO
           ) VALUES (
             :comp_code, :comp_year, :type, :r_date, :r_no, :code,
             :bill_date, :bill_no, :dr_amt, 0, :v_date, :detail, :cost_code, 2
           )`,
          {
            comp_code: cc,
            comp_year: cy,
            type: EV_TYPE,
            r_date: rDateBind,
            r_no,
            code: party,
            bill_date: billDateBind,
            bill_no: String(r_no),
            dr_amt: header.ntds_amt,
            v_date: rDateBind,
            detail: `TDS ON ${header.ntds_on_amt} @ ${header.ntds_per}`,
            cost_code: header.cost_code,
          }
        );
        try {
          await exec(
            `INSERT INTO TDS (
               COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
               AMOUNT, TDS_PER, TDS_AMT, TOT_TDS, NATURE, T_CODE, TC_CODE, S_DATE, E_DATE
             ) VALUES (
               :comp_code, :comp_year, :type, :r_date, :r_no, :code,
               :amount, :tds_per, :tds_amt, :tot_tds, :nature, :t_code, :tc_code, :s_date, :e_date
             )`,
            {
              comp_code: cc,
              comp_year: cy,
              type: EV_TYPE,
              r_date: rDateBind,
              r_no,
              code: party,
              amount: header.ntds_on_amt,
              tds_per: header.ntds_per,
              tds_amt: header.ntds_amt,
              tot_tds: header.ntds_amt,
              nature: header.nature,
              t_code: party,
              tc_code: header.ntds_code,
              s_date: rDateBind,
              e_date: rDateBind,
            }
          );
        } catch (err) {
          if (!/ORA-00942|ORA-00904/i.test(String(err.message || ''))) throw err;
        }
      }
    });

    const loaded = await loadVoucher(cc, comp_uid, formatDateOut(rDateBind), r_no);
    return {
      ...loaded,
      message: `Expenses Voucher No. ${r_no} saved.`,
      net_payable: netPayable,
    };
  }

  async function deleteVoucher(comp_code, comp_uid, r_date, r_no) {
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!d || !no) {
      const err = new Error('R date and R no are required.');
      err.status = 400;
      throw err;
    }
    await withCompTransaction(comp_uid, async (exec) => {
      await deleteExisting(exec, cc, 0, d, no);
    });
    return { ok: true, message: `Expenses Voucher No. ${no} deleted.` };
  }

  async function fetchPosting(comp_code, comp_uid, r_date, r_no) {
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    const ledger = await runQuery(
      `SELECT A.TRN_NO, A.CODE, B.NAME, A.DR_AMT, A.CR_AMT, A.DETAIL
       FROM LEDGER A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.VR_TYPE) = :type
         AND TRUNC(A.VR_DATE) = TRUNC(:r_date) AND A.VR_NO = :r_no
       ORDER BY A.TRN_NO`,
      { comp_code: cc, type: EV_TYPE, r_date: d, r_no: no },
      comp_uid
    );
    let bills = [];
    try {
      bills = await runQuery(
        `SELECT TRN_NO, CODE, BILL_NO, DR_AMT, CR_AMT, DETAIL
         FROM BILLS
         WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
           AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no
         ORDER BY TRN_NO`,
        { comp_code: cc, type: EV_TYPE, r_date: d, r_no: no },
        comp_uid
      );
    } catch {
      bills = [];
    }
    return { ledger: ledger || [], bills: bills || [] };
  }

  function registerRoutes(app) {
    app.get('/api/exp-voucher/context', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        const ctx = await fetchCtx(comp_code, comp_uid);
        res.json(ctx);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/exp-voucher/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_date } = req.query;
        const next_no = await fetchNextRNo(comp_code, comp_uid, r_date);
        res.json({ next_no });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/exp-voucher/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, sdt, edt, party } = req.query;
        const rows = await listVouchers(comp_code, comp_uid, { sdt, edt, party });
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/exp-voucher', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_date, r_no } = req.query;
        const out = await loadVoucher(comp_code, comp_uid, r_date, r_no);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/exp-voucher/posting', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_date, r_no } = req.query;
        const out = await fetchPosting(comp_code, comp_uid, r_date, r_no);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/exp-voucher/party-tot-pur', async (req, res) => {
      try {
        const { comp_code, comp_uid, code } = req.query;
        const tot_pur = await partyTotPur(comp_code, comp_uid, code);
        res.json({ tot_pur });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    /** VFP NATHLP — SELECT NATURE, AMOUNT, TDS_RATE, SUR_PER, EDU_PER, LEG_CODE FROM NATURE */
    app.get('/api/exp-voucher/nature-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, comp_year } = req.query;
        const cc = Number(comp_code) || 0;
        const cy = Number(comp_year) || 0;
        if (!cc) return res.status(400).json({ error: 'comp_code is required' });

        const mapRows = (rows) =>
          (rows || []).map((r, idx) => ({
            id: `${String(r.NATURE ?? r.nature ?? '').trim()}-${idx}`,
            nature: String(r.NATURE ?? r.nature ?? '').trim(),
            amount: num(r.AMOUNT ?? r.amount),
            tds_rate: num(r.TDS_RATE ?? r.tds_rate),
            sur_per: num(r.SUR_PER ?? r.sur_per),
            edu_per: num(r.EDU_PER ?? r.edu_per),
            leg_code: normCode(r.LEG_CODE ?? r.leg_code),
          }));

        const tries = [
          {
            sql: `SELECT NVL(NATURE, ' ') AS NATURE,
                         NVL(AMOUNT, 0) AS AMOUNT,
                         NVL(TDS_RATE, 0) AS TDS_RATE,
                         NVL(SUR_PER, 0) AS SUR_PER,
                         NVL(EDU_PER, 0) AS EDU_PER,
                         NVL(LEG_CODE, ' ') AS LEG_CODE
                  FROM NATURE
                  WHERE COMP_CODE = :comp_code
                  ORDER BY NATURE`,
            binds: { comp_code: cc },
          },
          {
            sql: `SELECT NVL(NATURE, ' ') AS NATURE,
                         NVL(AMOUNT, 0) AS AMOUNT,
                         NVL(TDS_RATE, 0) AS TDS_RATE,
                         NVL(SUR_PER, 0) AS SUR_PER,
                         NVL(EDU_PER, 0) AS EDU_PER,
                         NVL(LEG_CODE, ' ') AS LEG_CODE
                  FROM NATURE
                  WHERE COMP_CODE = :comp_code
                    AND (COMP_YEAR = :comp_year OR NVL(COMP_YEAR, 0) = 0)
                  ORDER BY NATURE`,
            binds: { comp_code: cc, comp_year: cy },
            skip: !cy,
          },
          {
            sql: `SELECT NVL(NATURE, ' ') AS NATURE,
                         NVL(AMOUNT, 0) AS AMOUNT,
                         NVL(TDS_RATE, 0) AS TDS_RATE,
                         NVL(SUR_PER, 0) AS SUR_PER,
                         NVL(EDU_PER, 0) AS EDU_PER
                  FROM NATURE
                  WHERE COMP_CODE = :comp_code
                  ORDER BY NATURE`,
            binds: { comp_code: cc },
          },
        ];

        let lastErr = null;
        for (const t of tries) {
          if (t.skip) continue;
          try {
            const rows = await runQuery(t.sql, t.binds, comp_uid);
            return res.json(mapRows(rows));
          } catch (err) {
            lastErr = err;
            const msg = String(err?.message || err);
            if (!/ORA-00904|ORA-00942|invalid identifier|table or view/i.test(msg)) throw err;
          }
        }
        throw lastErr || new Error('Nature master lookup failed');
      } catch (err) {
        console.error('❌ exp-voucher nature-help:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    /** VFP EXPVOU_CHK — Expenses Voucher List */
    app.get('/api/exp-voucher/checklist', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          s_date,
          e_date,
          code,
          pur_code,
          god_code,
          cost_code,
          l_c,
          input_yn,
          ru,
        } = req.query;
        const cc = Number(comp_code) || 0;
        if (!cc || !s_date || !e_date) {
          return res.status(400).json({ error: 'comp_code, s_date, and e_date are required' });
        }
        const sdt = formatDateBind(s_date);
        const edt = formatDateBind(e_date);
        if (!sdt || !edt) {
          return res.status(400).json({ error: 'Invalid date. Use DD-MM-YYYY.' });
        }

        const sup = normCode(code);
        const pur = normCode(pur_code);
        const god = normCode(god_code);
        const cost = normCode(cost_code);
        const mlc = String(l_c ?? '').trim().toUpperCase().slice(0, 1);
        const inputYn = String(input_yn ?? '').trim().toUpperCase().slice(0, 1);
        const mRu = String(ru ?? '').trim().toUpperCase().slice(0, 1);

        let sql = `
          SELECT A.TYPE,
                 A.R_DATE,
                 A.R_NO,
                 A.BILL_DATE,
                 A.BILL_NO,
                 A.PUR_CODE,
                 NVL(A.SUP_CODE, A.CODE) AS CODE,
                 NVL(C.NAME, ' ') AS NAME,
                 NVL(C.CITY, ' ') AS CITY,
                 NVL(C.L_C, ' ') AS L_C,
                 NVL(C.GST_NO, ' ') AS GST_NO,
                 A.ITEM_CODE,
                 NVL(B.ITEM_NAME, ' ') AS ITEM_NAME,
                 NVL(B.HSN_CODE, ' ') AS HSN_CODE,
                 NVL(A.WEIGHT, 0) AS WEIGHT,
                 NVL(A.RATE, 0) AS RATE,
                 NVL(A.AMOUNT, 0) AS AMOUNT,
                 NVL(A.FREIGHT, 0) AS FREIGHT,
                 NVL(A.CGST_PER, 0) AS CGST_PER,
                 NVL(A.SGST_PER, 0) AS SGST_PER,
                 NVL(A.IGST_PER, 0) AS IGST_PER,
                 NVL(A.CGST_AMT, 0) AS CGST_AMT,
                 NVL(A.SGST_AMT, 0) AS SGST_AMT,
                 NVL(A.IGST_AMT, 0) AS IGST_AMT,
                 NVL(A.OTH_EXP_1, 0) AS OTH_EXP_1,
                 NVL(A.TCS_PER, 0) AS TCS_PER,
                 NVL(A.TCS_AMT, 0) AS TCS_AMT,
                 NVL(A.BILL_AMT, 0) AS BILL_AMT,
                 NVL(A.NTDS_PER, 0) AS NTDS_PER,
                 NVL(A.NTDS_AMT, 0) AS NTDS_AMT,
                 NVL(A.NTDS_CODE, ' ') AS NTDS_CODE,
                 NVL(A.NATURE, ' ') AS NATURE,
                 NVL(A.INPUT_YN, ' ') AS INPUT_YN,
                 NVL(A.SHOW_IN_GSTR, ' ') AS SHOW_IN_GSTR,
                 NVL(A.GOD_CODE, ' ') AS GOD_CODE,
                 NVL(D.NAME, ' ') AS PUR_NAME,
                 NVL(A.COST_CODE, ' ') AS COST_CODE,
                 A.TRN_NO
          FROM PURCHASE A
          LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
          LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND NVL(A.SUP_CODE, A.CODE) = C.CODE
          LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.PUR_CODE = D.CODE
          WHERE A.COMP_CODE = :comp_code
            AND TRIM(A.TYPE) = :type
            AND TRUNC(A.R_DATE) BETWEEN TRUNC(:s_date) AND TRUNC(:e_date)`;
        const binds = { comp_code: cc, type: EV_TYPE, s_date: sdt, e_date: edt };

        if (sup) {
          sql += ` AND NVL(A.SUP_CODE, A.CODE) = :code`;
          binds.code = sup;
        }
        if (pur) {
          sql += ` AND NVL(A.PUR_CODE, ' ') = :pur_code`;
          binds.pur_code = pur;
        }
        if (god) {
          sql += ` AND NVL(A.GOD_CODE, ' ') = :god_code`;
          binds.god_code = god;
        }
        if (cost) {
          sql += ` AND NVL(A.COST_CODE, ' ') = :cost_code`;
          binds.cost_code = cost;
        }
        if (mlc === 'L' || mlc === 'C') {
          sql += ` AND NVL(C.L_C, ' ') = :l_c`;
          binds.l_c = mlc;
        }
        if (inputYn === 'Y' || inputYn === 'N') {
          sql += ` AND NVL(A.INPUT_YN, ' ') = :input_yn`;
          binds.input_yn = inputYn;
        }
        if (mRu === 'R') {
          sql += ` AND LENGTH(TRIM(NVL(C.GST_NO, ' '))) > 0`;
        } else if (mRu === 'U') {
          sql += ` AND LENGTH(TRIM(NVL(C.GST_NO, ' '))) = 0`;
        }

        sql += ` ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;

        const rows = await runQuery(sql, binds, comp_uid);
        res.json(
          (rows || []).map((r, idx) => ({
            type: EV_TYPE,
            r_date: formatDateOut(r.R_DATE ?? r.r_date),
            r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
            bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
            bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
            pur_code: normCode(r.PUR_CODE ?? r.pur_code),
            code: normCode(r.CODE ?? r.code),
            name: String(r.NAME ?? r.name ?? '').trim(),
            city: String(r.CITY ?? r.city ?? '').trim(),
            l_c: String(r.L_C ?? r.l_c ?? '').trim().toUpperCase().slice(0, 1),
            gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
            item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
            item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
            hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
            weight: num(r.WEIGHT ?? r.weight),
            rate: num(r.RATE ?? r.rate),
            amount: num(r.AMOUNT ?? r.amount),
            freight: num(r.FREIGHT ?? r.freight),
            cgst_per: num(r.CGST_PER ?? r.cgst_per),
            sgst_per: num(r.SGST_PER ?? r.sgst_per),
            igst_per: num(r.IGST_PER ?? r.igst_per),
            cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
            sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
            igst_amt: num(r.IGST_AMT ?? r.igst_amt),
            oth_exp_1: num(r.OTH_EXP_1 ?? r.oth_exp_1),
            tcs_per: num(r.TCS_PER ?? r.tcs_per),
            tcs_amt: num(r.TCS_AMT ?? r.tcs_amt),
            bill_amt: num(r.BILL_AMT ?? r.bill_amt),
            ntds_per: num(r.NTDS_PER ?? r.ntds_per),
            ntds_amt: num(r.NTDS_AMT ?? r.ntds_amt),
            ntds_code: normCode(r.NTDS_CODE ?? r.ntds_code),
            nature: String(r.NATURE ?? r.nature ?? '').trim(),
            input_yn: String(r.INPUT_YN ?? r.input_yn ?? '').trim().toUpperCase().slice(0, 1),
            show_in_gstr: String(r.SHOW_IN_GSTR ?? r.show_in_gstr ?? '').trim().toUpperCase().slice(0, 1),
            god_code: normCode(r.GOD_CODE ?? r.god_code),
            pur_name: String(r.PUR_NAME ?? r.pur_name ?? '').trim(),
            cost_code: normCode(r.COST_CODE ?? r.cost_code),
            trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
          }))
        );
      } catch (err) {
        console.error('❌ exp-voucher checklist:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/exp-voucher', async (req, res) => {
      try {
        const body = req.body || {};
        const { comp_code, comp_uid } = body;
        const user = req.session?.user_name || body.user_name || 'WEB';
        const out = await saveVoucher(comp_code, comp_uid, body, user);
        res.json(out);
      } catch (err) {
        console.error('❌ exp-voucher save:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.delete('/api/exp-voucher', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_date, r_no } = req.query;
        const out = await deleteVoucher(comp_code, comp_uid, r_date, r_no);
        res.json(out);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  }

  return { registerRoutes, loadVoucher, saveVoucher, deleteVoucher, EV_TYPE };
}

module.exports = { createExpVoucher, EV_TYPE };
