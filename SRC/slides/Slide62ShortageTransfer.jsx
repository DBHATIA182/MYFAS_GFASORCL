import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toDisplayDate, toInputDateString } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 300000 };

function num(row, upper, lower) {
  const v = row?.[upper] ?? row?.[lower];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function fmtQty(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function buildRunningRows(raw) {
  let runQ = 0;
  let runW = 0;
  let runG = 0;
  return (raw || []).map((r) => {
    const rq = num(r, 'R_QNTY', 'r_qnty');
    const sq = num(r, 'S_QNTY', 's_qnty');
    const rw = num(r, 'R_WEIGHT', 'r_weight');
    const sw = num(r, 'S_WEIGHT', 's_weight');
    const rg = num(r, 'R_G_WEIGHT', 'r_g_weight');
    const sg = num(r, 'SG_WEIGHT', 'sg_weight');
    runQ += rq - sq;
    runW += rw - sw;
    runG += rg - sg;
    return { row: r, runQ, runW, runG };
  });
}

function fmt2(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

function fmt3(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : String(v);
}

function mapGridRow(r, idx) {
  const item = Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0;
  const lot = Number(r.LOT ?? r.lot ?? 0) || 0;
  const sup = String(r.SUP_CODE ?? r.sup_code ?? '').trim();
  return {
    _id: `${item}-${lot}-${sup}-${idx}`,
    TRN_NO: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
    VR_DATE: toInputDateString(r.VR_DATE ?? r.vr_date) || '',
    ITEM_CODE: item,
    ITEM_NAME: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    LOT: lot,
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
    SUP_CODE: sup,
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    QNTY: Number(r.QNTY ?? r.qnty ?? 0) || 0,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
    RATE: Number(r.RATE ?? r.rate ?? 0) || 0,
    B_QTY: Number(r.B_QTY ?? r.b_qty ?? r.BQTY ?? 0) || 0,
    B_WEIGHT: Number(r.B_WEIGHT ?? r.b_weight ?? r.OWEIGHT ?? 0) || 0,
    CL_AMT: Number(r.CL_AMT ?? r.cl_amt ?? 0) || 0,
    SLCT: String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y',
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    GOD_CODE: String(r.GOD_CODE ?? r.god_code ?? '').trim(),
    MSUP_CODE: String(r.MSUP_CODE ?? r.msup_code ?? '').trim(),
    MSUP_NAME: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
  };
}

/** VFP DO FORM shortage — transfer lot shortages to SHORTAGE / LOTSTOCK (optional LEDGER). */
export default function Slide62ShortageTransfer({ apiBase, formData, userName, onPrev }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();

  const [loading, setLoading] = useState(true);
  const [proceeding, setProceeding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [perms, setPerms] = useState(null);

  const [svno, setSvno] = useState('1');
  const [evno, setEvno] = useState('0');
  const [legtrf, setLegtrf] = useState('N');
  const [gridRows, setGridRows] = useState([]);
  const [activeRowId, setActiveRowId] = useState(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const runningDetail = useMemo(() => buildRunningRows(detailRows), [detailRows]);

  const applyInitContext = useCallback((ctx) => {
    if (!ctx) return;
    setSvno(String(ctx.svno ?? 1));
    setEvno(String(ctx.evno ?? 0));
    setLegtrf(String(ctx.legtrf ?? 'N').trim().toUpperCase().slice(0, 1) || 'N');
    setGridRows([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [permRes, initRes] = await Promise.all([
          axios.get(apiUrl(apiBase, '/api/shortage-transfer-user-permissions'), {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(apiUrl(apiBase, '/api/shortage-transfer-init'), {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              comp_year: compYear,
              user_name: userName || '',
            },
            ...reqOpts,
          }),
        ]);
        if (cancelled) return;
        setPerms(permRes.data?.permissions ?? null);
        applyInitContext(initRes.data?.context);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, compYear, userName, applyInitContext]);

  const buildPayload = () => ({
    comp_code: compCode,
    comp_uid: compUid,
    user_name: userName,
    comp_year: compYear,
    svno: Number(svno) || 0,
    evno: Number(evno) || 0,
    legtrf,
  });

  const handleProceed = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    setProceeding(true);
    setErr('');
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/shortage-transfer-proceed'), buildPayload(), reqOpts);
      const rows = (Array.isArray(data?.rows) ? data.rows : []).map(mapGridRow);
      setGridRows(rows);
      if (!rows.length) alert('No shortage lots found (balance qty = 0, weight ≠ 0).');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Proceed failed';
      setErr(msg);
      alert(msg);
    } finally {
      setProceeding(false);
    }
  };

  const toggleRowSelect = (id, e) => {
    e?.stopPropagation();
    setGridRows((prev) => prev.map((r) => (r._id === id ? { ...r, SLCT: !r.SLCT } : r)));
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailItem(null);
    setDetailRows([]);
    setDetailError('');
    setActiveRowId(null);
  };

  const openDetail = useCallback(
    async (row) => {
      if (!row?.ITEM_CODE && row?.ITEM_CODE !== 0) return;
      setActiveRowId(row._id);
      setDetailItem({
        itemCode: row.ITEM_CODE,
        itemName: row.ITEM_NAME,
        lot: row.LOT,
        supCode: row.SUP_CODE,
        supName: row.NAME,
        godCode: row.GOD_CODE,
        bNo: row.B_NO,
      });
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailError('');
      setDetailRows([]);
      try {
        const { data } = await axios.get(apiUrl(apiBase, '/api/shortage-transfer-lot-detail'), {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            user_name: userName || '',
            item_code: row.ITEM_CODE,
            lot: row.LOT,
            sup_code: row.SUP_CODE,
            god_code: row.GOD_CODE || '',
          },
          ...reqOpts,
        });
        setDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e) {
        setDetailError(e?.response?.data?.error || e.message || 'Failed to load transactions');
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase, compCode, compUid, userName]
  );

  const handleDetailExcel = () => {
    if (!detailRows.length || !detailItem) return;
    downloadExcelRows(
      runningDetail.map(({ row: r, runQ, runW, runG }) => ({
        'Vr.Date': formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date),
        'Vr.No': r.VR_NO ?? r.vr_no,
        'Vr.Type': r.VR_TYPE ?? r.vr_type,
        Type: r.TYPE ?? r.type,
        Lot: r.LOT ?? r.lot,
        Status: r.STATUS ?? r.status,
        'B.No': r.B_NO ?? r.b_no,
        God: r.GOD_CODE ?? r.god_code,
        'E.Type': r.E_TYPE ?? r.e_type,
        'R Qty': num(r, 'R_QNTY', 'r_qnty'),
        'S Qty': num(r, 'S_QNTY', 's_qnty'),
        'R Wt': num(r, 'R_WEIGHT', 'r_weight'),
        'S Wt': num(r, 'S_WEIGHT', 's_weight'),
        Rate: num(r, 'RATE', 'rate'),
        Amount: num(r, 'AMOUNT', 'amount'),
        'Run Qty': runQ,
        'Run Wt': runW,
        'Run G Wt': runG,
      })),
      'ShortageLotDetail',
      `${compName || 'Company'}_Shortage_${detailItem.itemCode}_Lot${detailItem.lot}`
    );
  };

  const selectAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: true })));
  const clearAllRows = () => setGridRows((prev) => prev.map((r) => ({ ...r, SLCT: false })));

  const handleSave = async () => {
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    const selected = gridRows.filter((r) => r.SLCT);
    if (!selected.length) {
      alert('Select at least one row to save.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.post(
        apiUrl(apiBase, '/api/shortage-transfer-save'),
        {
          ...buildPayload(),
          rows: selected.map((r) => ({
            TRN_NO: r.TRN_NO,
            VR_DATE: r.VR_DATE,
            ITEM_CODE: r.ITEM_CODE,
            ITEM_NAME: r.ITEM_NAME,
            LOT: r.LOT,
            B_NO: r.B_NO,
            SUP_CODE: r.SUP_CODE,
            NAME: r.NAME,
            B_QTY: r.B_QTY,
            B_WEIGHT: r.B_WEIGHT,
            RATE: r.RATE,
            CL_AMT: r.CL_AMT,
            STATUS: r.STATUS,
            GOD_CODE: r.GOD_CODE,
            MSUP_CODE: r.MSUP_CODE,
            MSUP_NAME: r.MSUP_NAME,
            SLCT: 'Y',
          })),
        },
        reqOpts
      );
      alert(data?.message || 'DONE');
      if (data?.next_svno) setSvno(String(data.next_svno));
      setGridRows([]);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleList = async () => {
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    setListing(true);
    try {
      const { data } = await axios.get(apiUrl(apiBase, '/api/shortage-transfer-list'), {
        params: { comp_code: compCode, comp_uid: compUid, user_name: userName || '' },
        ...reqOpts,
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (!rows.length) {
        alert('No saved shortage vouchers found.');
        return;
      }
      downloadExcelRows(
        rows.map((r) => ({
          'Vr.Type': r.VR_TYPE,
          'Vr.Date': toDisplayDate(toInputDateString(r.VR_DATE)),
          'Vr.No': r.VR_NO,
          'Trn.No': r.TRN_NO,
          Item: r.ITEM_CODE,
          Lot: r.LOT,
          'B.No': r.B_NO,
          Code: r.SUP_CODE,
          Name: r.SUP_NAME,
          Qty: r.QNTY,
          Wgt: fmt3(r.WEIGHT),
          Rate: fmt2(r.RATE),
          Amount: fmt2(r.AMOUNT),
        })),
        'ShortageSaved',
        `${compName || 'Company'}_ShortageSaved`
      );
    } catch (e) {
      alert(e?.response?.data?.error || e.message || 'List failed');
    } finally {
      setListing(false);
    }
  };

  const handleExcel = () => {
    if (!gridRows.length) {
      alert('No data to export. Click Proceed first.');
      return;
    }
    downloadExcelRows(
      gridRows.map((r, i) => ({
        'S.No.': i + 1,
        'Vr.Date': toDisplayDate(r.VR_DATE),
        Item: r.ITEM_CODE,
        'Item Name': r.ITEM_NAME,
        Lot: r.LOT,
        'B.No.': r.B_NO,
        Code: r.SUP_CODE,
        Name: r.NAME,
        Qty: r.QNTY,
        Wgt: fmt3(r.WEIGHT),
        Rate: fmt2(r.RATE),
        'B.Qty': r.B_QTY,
        'B.Wgt': fmt3(r.B_WEIGHT),
        Amount: fmt2(r.CL_AMT),
        Select: r.SLCT ? 'Y' : '',
      })),
      'ShortageTransfer',
      `${compName || 'Company'}_ShortageTransfer`
    );
  };

  const handleDelete = async () => {
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const s = Number(svno) || 0;
    const e = Number(evno) || 0;
    if (!s || !e) {
      alert('Can Not Delete');
      return;
    }
    if (!window.confirm(`Delete shortage vouchers ${s}–${e} (SHORTAGE, LOTSTOCK, LEDGER)?`)) return;
    setDeleting(true);
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/shortage-transfer-delete'), buildPayload(), reqOpts);
      alert(data?.message || 'Deleted');
      onPrev?.();
    } catch (ex) {
      alert(ex?.response?.data?.error || ex.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="slide slide-62-shortage shortage-screen inttrf-screen">
        <p className="loading-msg">Loading Shortage Transfer…</p>
      </div>
    );
  }

  return (
    <div className="slide slide-62-shortage shortage-screen inttrf-screen detail-mast-screen account-master-screen">
      <div className="account-master-screen__head inttrf-screen__head">
        <h2 className="sale-bill-page__title inttrf-screen__title">Shortage Transfer</h2>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="shortage-transfer" />
      </div>

      {err ? <p className="form-error inttrf-screen__error">{err}</p> : null}

      <div className="inttrf-screen__body">
        <div className="inttrf-screen__grid-wrap shortage-screen__grid-wrap">
          <table className="inttrf-screen__grid shortage-screen__grid">
            <thead>
              <tr>
                <th>S.No.</th>
                <th>Vr.Date</th>
                <th>Item</th>
                <th>Item Name</th>
                <th>Lot</th>
                <th>B.No.</th>
                <th>Code</th>
                <th>Name</th>
                <th className="amount">Qty.</th>
                <th className="amount">Wgt.</th>
                <th className="amount">Rate</th>
                <th className="amount">B.Qty</th>
                <th className="amount">B.Wgt</th>
                <th className="amount">Amount</th>
                <th>SLCT</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="inttrf-screen__grid-empty">
                    Click Proceed to load lots with zero balance qty and non-zero weight (VFP shortage).
                  </td>
                </tr>
              ) : (
                gridRows.map((r, i) => (
                  <tr
                    key={r._id}
                    className={[
                      'shortage-row-clickable',
                      r.SLCT ? 'inttrf-screen__row--selected' : '',
                      activeRowId === r._id ? 'shortage-row-clickable--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => void openDetail(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openDetail(r);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    title="Click to view all LOTSTOCK transactions for this lot"
                  >
                    <td>{i + 1}</td>
                    <td>{toDisplayDate(r.VR_DATE)}</td>
                    <td>{r.ITEM_CODE}</td>
                    <td>{r.ITEM_NAME}</td>
                    <td>{r.LOT}</td>
                    <td>{r.B_NO}</td>
                    <td>{r.SUP_CODE}</td>
                    <td>{r.NAME}</td>
                    <td className="amount">{r.QNTY}</td>
                    <td className="amount">{fmt3(r.WEIGHT)}</td>
                    <td className="amount">{fmt2(r.RATE)}</td>
                    <td className="amount">{r.B_QTY}</td>
                    <td className="amount">{fmt3(r.B_WEIGHT)}</td>
                    <td className="amount">{fmt2(r.CL_AMT)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={r.SLCT}
                        onChange={(e) => toggleRowSelect(r._id, e)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inttrf-screen__footer-panel shortage-screen__footer">
          <div className="inttrf-screen__footer-toolbar">
            <div className="inttrf-screen__footer-left">
              <button type="button" className="btn btn-primary inttrf-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={onPrev}>
                Quit
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleList} disabled={listing}>
                {listing ? '…' : 'List'}
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={selectAllRows}>
                Select All
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={clearAllRows}>
                Clear All
              </button>
              <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleExcel}>
                Excel
              </button>
            </div>

            <div className="inttrf-screen__footer-delete shortage-screen__footer-mid">
              <span className="inttrf-screen__footer-label">Delete Prev.Starting Vr.No.</span>
              <div className="inttrf-screen__footer-delete-row">
                <input
                  type="number"
                  className="inttrf-input inttrf-input--vno"
                  value={svno}
                  onChange={(e) => setSvno(e.target.value)}
                />
                <input
                  type="number"
                  className="inttrf-input inttrf-input--vno"
                  value={evno}
                  onChange={(e) => setEvno(e.target.value)}
                />
                <button type="button" className="btn btn-secondary inttrf-btn" onClick={handleDelete} disabled={deleting}>
                  Delete
                </button>
              </div>
            </div>

            <div className="shortage-screen__legtrf">
              <span className="inttrf-screen__footer-label">Trf.To Ledger (Y/N)</span>
              <input
                type="text"
                className="inttrf-input inttrf-input--xs"
                maxLength={1}
                value={legtrf}
                onChange={(e) => setLegtrf(e.target.value.toUpperCase().slice(0, 1))}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary inttrf-btn shortage-screen__proceed"
              onClick={handleProceed}
              disabled={proceeding}
            >
              {proceeding ? 'Loading…' : 'Proceed'}
            </button>
          </div>
        </div>
      </div>

      {detailOpen ? (
        <div
          className="sale-bill-modal-backdrop sale-bill-print-backdrop stock-sum-detail-backdrop"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            className="sale-bill-modal sale-bill-print-modal stock-sum-detail-modal shortage-lot-detail-modal"
            role="dialog"
            aria-labelledby="shortage-lot-detail-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="sale-bill-modal-head no-print stock-sum-detail-modal-head">
              <h3 id="shortage-lot-detail-title">
                Lot transactions — Item {detailItem?.itemCode}
                {detailItem?.itemName ? ` — ${detailItem.itemName}` : ''} · Lot {detailItem?.lot} ·{' '}
                {detailItem?.supCode}
                {detailItem?.supName ? ` — ${detailItem.supName}` : ''}
              </h3>
              <button type="button" className="sale-bill-modal-close" onClick={closeDetail} aria-label="Close">
                ×
              </button>
              <div className="sale-bill-print-actions">
                <button type="button" className="btn btn-excel" onClick={handleDetailExcel} disabled={!detailRows.length}>
                  Excel
                </button>
              </div>
            </div>
            <div className="sale-bill-modal-body stock-sum-detail-body">
              {detailLoading ? <p>Loading transactions…</p> : null}
              {detailError ? (
                <p className="form-api-error" role="alert">
                  {detailError}
                </p>
              ) : null}
              {!detailLoading && !detailError ? (
                <div className="table-responsive">
                  <table className="report-table stock-sum-detail-table">
                    <thead>
                      <tr>
                        <th>Vr date</th>
                        <th>Vr no</th>
                        <th>Vr type</th>
                        <th>Type</th>
                        <th>St</th>
                        <th>B no</th>
                        <th>God</th>
                        <th>E</th>
                        <th className="text-right">R qty</th>
                        <th className="text-right">S qty</th>
                        <th className="text-right">R wt</th>
                        <th className="text-right">S wt</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Run qty</th>
                        <th className="text-right">Run wt</th>
                        <th className="text-right">Run g wt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runningDetail.map(({ row: r, runQ, runW, runG }, idx) => (
                        <tr key={`${idx}-${r.VR_NO ?? r.vr_no}-${r.E_TYPE ?? r.e_type}`}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date)}</td>
                          <td>{r.VR_NO ?? r.vr_no ?? '—'}</td>
                          <td>{r.VR_TYPE ?? r.vr_type ?? '—'}</td>
                          <td>{r.TYPE ?? r.type ?? '—'}</td>
                          <td>{r.STATUS ?? r.status ?? '—'}</td>
                          <td>{r.B_NO ?? r.b_no ?? '—'}</td>
                          <td>{r.GOD_CODE ?? r.god_code ?? '—'}</td>
                          <td>{r.E_TYPE ?? r.e_type ?? '—'}</td>
                          <td className="text-right">{fmtQty(num(r, 'R_QNTY', 'r_qnty'))}</td>
                          <td className="text-right">{fmtQty(num(r, 'S_QNTY', 's_qnty'))}</td>
                          <td className="text-right">{fmt3(num(r, 'R_WEIGHT', 'r_weight'))}</td>
                          <td className="text-right">{fmt3(num(r, 'S_WEIGHT', 's_weight'))}</td>
                          <td className="text-right">{fmt2(num(r, 'RATE', 'rate'))}</td>
                          <td className="text-right">{fmt2(num(r, 'AMOUNT', 'amount'))}</td>
                          <td className="text-right stock-sum-run">{fmtQty(runQ)}</td>
                          <td className="text-right stock-sum-run">{fmt3(runW)}</td>
                          <td className="text-right stock-sum-run">{fmt3(runG)}</td>
                        </tr>
                      ))}
                      {runningDetail.length > 0 ? (
                        <tr className="stock-sum-grand">
                          <td colSpan={14}>
                            <strong>Closing balance</strong>
                          </td>
                          <td className="text-right">
                            <strong>{fmtQty(runningDetail[runningDetail.length - 1].runQ)}</strong>
                          </td>
                          <td className="text-right">
                            <strong>{fmt3(runningDetail[runningDetail.length - 1].runW)}</strong>
                          </td>
                          <td className="text-right">
                            <strong>{fmt3(runningDetail[runningDetail.length - 1].runG)}</strong>
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td colSpan={17} className="inttrf-screen__grid-empty">
                            No LOTSTOCK transactions for this lot.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
