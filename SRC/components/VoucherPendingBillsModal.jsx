import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toDisplayDate } from '../utils/dateFormat';
import { applyCdCalToBillRow } from '../utils/voucherCdCal';
import { normalizePickedBillRow, pickBillBType } from '../utils/voucherBillRowFields';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v, showZero = false) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n === 0 && !showZero) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function billTotal(r) {
  const n = Number(r.TOTAL ?? r.total ?? 0);
  if (Number.isFinite(n) && n > 0) return n;
  const cur = Number(r.CUR_BAL ?? r.cur_bal ?? 0) || 0;
  const intAmt = Number(r.INT_AMT ?? r.int_amt ?? 0) || 0;
  return cur + intAmt;
}

function adjNum(r) {
  return Number(String(r.ADJ_AMT ?? r.adj_amt ?? '').replace(/,/g, '')) || 0;
}

const PB_MODES = [
  { id: 'manual', label: 'Manual' },
  { id: 'auto', label: 'Auto' },
  { id: 'autoInt', label: 'Auto + Int' },
];

function fmtAdjInput(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

export default function VoucherPendingBillsModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  partyCode,
  partyName,
  schedule,
  indYn = '',
  vDate,
  pndBills,
  vouIntShow,
  pendingZeroYn = 'N',
  gCdCal = 'N',
  initialMode = 'manual',
  autoLoadManual = false,
  lineKey = null,
  onApply,
}) {
  const [mode, setMode] = useState('manual');
  const [recvAmt, setRecvAmt] = useState('');
  const [includeInt, setIncludeInt] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [activeRow, setActiveRow] = useState(0);
  const dialogRef = useRef(null);
  const loadBtnRef = useRef(null);
  const adjRefs = useRef([]);

  const modeIndex = PB_MODES.findIndex((m) => m.id === mode);

  const focusActiveAdj = useCallback(() => {
    if (!rows.length) return;
    window.setTimeout(() => {
      const el = adjRefs.current[activeRow];
      if (!el) return;
      el.focus();
      if (typeof el.select === 'function') {
        try {
          el.select();
        } catch (_) {}
      }
    }, 60);
  }, [activeRow, rows.length]);

  const loadBills = useCallback(
    async (autoAmt = 0, withInt = false) => {
      if (!partyCode) {
        setErr('Select party code on the line first.');
        return;
      }
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(`${apiBase}/api/voucher-entry/pending-bills`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code: partyCode,
            schedule,
            v_date: vDate,
            pnd_bills: pndBills,
            vou_int_show: vouIntShow ?? 'Y',
            pending_zero_yn: pendingZeroYn ?? 'N',
            ind_yn: String(indYn ?? '').trim().toUpperCase(),
          },
          ...reqOpts,
        });
        let list = Array.isArray(data)
          ? data.map((r) => {
              const norm = normalizePickedBillRow(r);
              let row = {
                ...norm,
                ADJ_AMT: '',
                CD_PER: norm.CD_PER ?? norm.cd_per ?? '',
                CD_AMT: norm.CD_AMT ?? norm.cd_amt ?? '',
              };
              if (String(gCdCal).toUpperCase() === 'Y' && String(row.CD_PER ?? '').trim()) {
                row = { ...row, ...applyCdCalToBillRow(row) };
              }
              return row;
            })
          : [];
        let remaining = Number(autoAmt) || 0;
        if (remaining > 0) {
          list = list.map((r) => {
            if (remaining <= 0) return r;
            const base = withInt ? billTotal(r) : Number(r.CUR_BAL ?? r.cur_bal ?? 0) || 0;
            if (base <= 0) return r;
            const adj = remaining > base ? base : remaining;
            remaining -= adj;
            return { ...r, ADJ_AMT: fmtAdjInput(adj) };
          });
        }
        setRows(list);
        setActiveRow(0);
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, compCode, compUid, partyCode, pndBills, schedule, vDate, vouIntShow, pendingZeroYn, gCdCal, indYn]
  );

  useEffect(() => {
    if (!open) return;
    const m = initialMode || 'manual';
    setMode(m);
    setRecvAmt('');
    setIncludeInt(m === 'autoInt');
    setRows([]);
    setErr('');
    setActiveRow(0);
  }, [open, partyCode, initialMode]);

  useEffect(() => {
    if (!open || !autoLoadManual) return;
    if ((initialMode || 'manual') !== 'manual') return;
    void loadBills(0, false);
  }, [open, autoLoadManual, initialMode, loadBills]);

  const handleModeGo = useCallback(() => {
    if (mode === 'manual') {
      void loadBills(0, false);
    } else if (mode === 'auto') {
      void loadBills(Number(recvAmt) || 0, includeInt);
    } else {
      void loadBills(Number(recvAmt) || 0, true);
    }
  }, [mode, recvAmt, includeInt, loadBills]);

  const handleApply = useCallback(() => {
    const picked = rows.filter((r) => adjNum(r) > 0).map((r) => normalizePickedBillRow(r));
    if (!picked.length) {
      alert('Enter adjustment amount on at least one bill.');
      return;
    }
    try {
      onApply?.(picked, lineKey);
      onClose?.();
    } catch (err) {
      console.error('Billhlp apply failed:', err);
      alert(err?.message || 'Could not apply bills to grid.');
    }
  }, [rows, lineKey, onApply, onClose]);

  const handleAdjKeyDown = useCallback(
    (idx, e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (idx + 1 < rows.length) {
        setActiveRow(idx + 1);
        window.setTimeout(() => {
          const el = adjRefs.current[idx + 1];
          el?.focus();
          try {
            el?.select();
          } catch (_) {}
        }, 0);
        return;
      }
      handleApply();
    },
    [rows.length, handleApply]
  );

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKeyCapture = (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const t = e.target;
      if (t?.classList?.contains('voucher-pending-adj')) {
        const idx = adjRefs.current.indexOf(t);
        if (idx < 0) return;
        e.preventDefault();
        e.stopPropagation();
        handleAdjKeyDown(idx, e);
        return;
      }
      if (t?.classList?.contains('voucher-pending-cd-per')) {
        e.preventDefault();
        e.stopPropagation();
        focusActiveAdj();
        return;
      }
      if (t?.classList?.contains('voucher-pending-modal__recv-input')) {
        e.preventDefault();
        e.stopPropagation();
        handleModeGo();
      }
    };
    dialog.addEventListener('keydown', onKeyCapture, true);
    return () => dialog.removeEventListener('keydown', onKeyCapture, true);
  }, [open, handleAdjKeyDown, focusActiveAdj, handleModeGo]);

  useEffect(() => {
    if (!open) return;
    if (rows.length > 0) {
      focusActiveAdj();
    } else {
      window.setTimeout(() => loadBtnRef.current?.focus(), 50);
    }
  }, [open, rows.length, focusActiveAdj]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleApply();
        return;
      }
      const tag = String(e.target?.tagName || '').toLowerCase();
      const inAdj =
        e.target?.classList?.contains('voucher-pending-adj') ||
        e.target?.classList?.contains('voucher-pending-cd-per') ||
        e.target?.classList?.contains('voucher-pending-modal__recv-input');
      if (inAdj) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = PB_MODES[Math.min(PB_MODES.length - 1, (modeIndex < 0 ? 0 : modeIndex) + 1)];
        setMode(next.id);
        if (next.id === 'autoInt') setIncludeInt(true);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = PB_MODES[Math.max(0, (modeIndex < 0 ? 0 : modeIndex) - 1)];
        setMode(prev.id);
        if (prev.id !== 'autoInt') setIncludeInt(false);
        return;
      }
      if (e.key === 'Enter' && tag !== 'button') {
        e.preventDefault();
        handleModeGo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, modeIndex, handleModeGo, handleApply]);

  const showCdCal = String(gCdCal).toUpperCase() === 'Y';
  const colCount = showCdCal ? 17 : 15;

  const displayRows = useMemo(() => {
    let gtot = 0;
    return rows.map((r) => {
      const total = billTotal(r);
      const adj = adjNum(r);
      const balAmt = Math.max(0, total - adj);
      gtot += adj;
      return { ...r, _total: total, _balAmt: balAmt, _gtotAmt: gtot };
    });
  }, [rows]);

  const totals = useMemo(() => {
    let adj = 0;
    for (const r of rows) adj += adjNum(r);
    return { adj };
  }, [rows]);

  const pickedCount = useMemo(() => rows.filter((r) => adjNum(r) > 0).length, [rows]);

  const setAdj = (idx, val) => {
    const s = String(val ?? '').replace(/[^\d.]/g, '');
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ADJ_AMT: s } : r)));
    setActiveRow(idx);
  };

  const setCdPer = (idx, val) => {
    const s = String(val ?? '').replace(/[^\d.]/g, '');
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, CD_PER: s };
        if (showCdCal) {
          return { ...next, ...applyCdCalToBillRow(next) };
        }
        return next;
      })
    );
  };

  const fillAdjFromTotal = (idx) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const total = billTotal(r);
        if (showCdCal && String(r.CD_PER ?? r.cd_per ?? '').trim()) {
          return { ...r, ...applyCdCalToBillRow(r) };
        }
        return { ...r, ADJ_AMT: total > 0 ? total.toFixed(2) : '' };
      })
    );
    setActiveRow(idx);
    window.setTimeout(() => adjRefs.current[idx]?.focus(), 0);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="sale-bill-modal-backdrop voucher-pending-backdrop voucher-pending-backdrop--vfp"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`sale-bill-modal voucher-pending-modal voucher-pending-modal--vfp${showCdCal ? ' voucher-pending-modal--cd-cal' : ''}`}
        role="dialog"
        aria-label="Billhlp"
      >
        <div className="voucher-pending-modal__titlebar">
          <span className="voucher-pending-modal__titlebar-label">Billhlp</span>
          <span className="voucher-pending-modal__titlebar-party">
            [{partyCode}] {partyName || ''}
          </span>
          <button type="button" className="voucher-pending-modal__titlebar-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="voucher-pending-modal__toolbar">
          <div className="voucher-pending-modal__modes" role="radiogroup" aria-label="Adjustment mode">
            {PB_MODES.map((m) => (
              <label
                key={m.id}
                className={mode === m.id ? 'voucher-pending-modal__mode--active' : undefined}
              >
                <input
                  type="radio"
                  name="pbmode"
                  checked={mode === m.id}
                  onChange={() => {
                    setMode(m.id);
                    if (m.id === 'autoInt') setIncludeInt(true);
                    else if (m.id === 'manual') setIncludeInt(false);
                  }}
                />{' '}
                {m.label}
              </label>
            ))}
          </div>
          <span className="voucher-pending-modal__mode-hint">← → mode · Enter load · Esc apply</span>
          {mode !== 'manual' ? (
            <div className="voucher-pending-modal__recv">
              <label>
                Amt received
                <input
                  className="form-input voucher-pending-modal__recv-input"
                  type="number"
                  step="0.01"
                  value={recvAmt}
                  onChange={(e) => setRecvAmt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleModeGo();
                    }
                  }}
                />
              </label>
              <label className="voucher-pending-modal__intyn">
                <input
                  type="checkbox"
                  checked={includeInt}
                  onChange={(e) => setIncludeInt(e.target.checked)}
                  disabled={mode === 'autoInt'}
                />
                + Int
              </label>
            </div>
          ) : null}
          <button
            ref={loadBtnRef}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleModeGo}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load bills'}
          </button>
        </div>

        {err ? <p className="voucher-pending-modal__err deploy-update-msg deploy-update-msg--err">{err}</p> : null}

        <div className="voucher-pending-modal__grid-wrap">
          <table className="voucher-pending-table voucher-pending-table--vfp">
            {!showCdCal ? (
              <colgroup>
                <col className="voucher-pending-col--date" />
                <col className="voucher-pending-col--invno" />
                <col className="voucher-pending-col--type" />
                <col className="voucher-pending-col--date" />
                <col className="voucher-pending-col--days" />
                <col className="voucher-pending-col--bk" />
                <col className="voucher-pending-col--amt" span={5} />
                <col className="voucher-pending-col--days" />
                <col className="voucher-pending-col--adj" />
                <col className="voucher-pending-col--amt" span={2} />
              </colgroup>
            ) : null}
            <thead>
              <tr>
                <th className="voucher-pending-col--date">Inv.Date</th>
                <th className="voucher-pending-col--invno num">Inv.No</th>
                <th className="voucher-pending-col--type">T</th>
                <th className="voucher-pending-col--date">V_date</th>
                <th className="voucher-pending-col--days num">Dys</th>
                <th className="voucher-pending-col--bk voucher-pending-table__bk-code">Bk_code</th>
                <th className="voucher-pending-col--amt num">Dr.Amt.</th>
                <th className="voucher-pending-col--amt num">Cr.Amt.</th>
                <th className="voucher-pending-col--amt num">Bal.Amt.</th>
                <th className="voucher-pending-col--amt num">Interest</th>
                <th className="voucher-pending-col--amt num">Total</th>
                <th className="voucher-pending-col--days num">IDAYS</th>
                {showCdCal ? <th className="voucher-pending-col--cd num">CD %</th> : null}
                {showCdCal ? <th className="voucher-pending-col--amt num">CD amt</th> : null}
                <th className="voucher-pending-col--adj num voucher-pending-table__adj-head">Adj.Amt.</th>
                <th className="voucher-pending-col--amt num">Bal_amt</th>
                <th className="voucher-pending-col--amt num">Gtot_amt</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="voucher-pending-table__empty">
                    {loading ? 'Loading…' : 'No pending bills — click Load bills.'}
                  </td>
                </tr>
              ) : (
                displayRows.map((r, i) => {
                  const invDate = toDisplayDate(toInputDateString(r.BILL_DATE ?? r.bill_date));
                  const valDate = toDisplayDate(toInputDateString(r.V_DATE ?? r.v_date));
                  const totalFmt = fmtAmt(r._total, true);
                  return (
                  <tr
                    key={`${r.BILL_NO}-${r.BILL_DATE}-${i}`}
                    className={activeRow === i ? 'is-active' : undefined}
                    onClick={() => setActiveRow(i)}
                  >
                    <td className="voucher-pending-col--date" title={invDate}>{invDate}</td>
                    <td className="voucher-pending-col--invno num" title={String(r.BILL_NO ?? r.bill_no ?? '')}>
                      {r.BILL_NO ?? r.bill_no}
                    </td>
                    <td className="voucher-pending-col--type voucher-pending-table__type">{pickBillBType(r)}</td>
                    <td className="voucher-pending-col--date" title={valDate}>{valDate}</td>
                    <td className="voucher-pending-col--days num">{r.DAYS ?? r.days ?? ''}</td>
                    <td className="voucher-pending-col--bk voucher-pending-table__bk-code">
                      {String(r.BK_CODE ?? r.bk_code ?? '').trim()}
                    </td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r.DR_AMT ?? r.dr_amt, true)}</td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r.CR_AMT ?? r.cr_amt, true)}</td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r.CUR_BAL ?? r.cur_bal, true)}</td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r.INT_AMT ?? r.int_amt, true)}</td>
                    <td
                      className="num voucher-pending-col--amt voucher-pending-total-pick"
                      title={`Total ${totalFmt} — click or Enter to copy to Adj.Amt.`}
                      onClick={(e) => {
                        e.stopPropagation();
                        fillAdjFromTotal(i);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          fillAdjFromTotal(i);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {totalFmt}
                    </td>
                    <td className="voucher-pending-col--days num">{r.IDAYS ?? r.idays ?? ''}</td>
                    {showCdCal ? (
                      <td className="voucher-pending-col--cd">
                        <input
                          className="form-input voucher-pending-cd-per"
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={r.CD_PER ?? r.cd_per ?? ''}
                          onChange={(e) => setCdPer(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              focusActiveAdj();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    ) : null}
                    {showCdCal ? (
                      <td className="voucher-pending-col--amt num">{fmtAmt(r.CD_AMT ?? r.cd_amt, true)}</td>
                    ) : null}
                    <td className="voucher-pending-col--adj voucher-pending-table__adj-cell">
                      <input
                        ref={(el) => {
                          adjRefs.current[i] = el;
                        }}
                        className="form-input voucher-pending-adj"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.ADJ_AMT ?? r.adj_amt ?? ''}
                        onChange={(e) => setAdj(i, e.target.value)}
                        onKeyDown={(e) => handleAdjKeyDown(i, e)}
                        onFocus={() => setActiveRow(i)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r._balAmt, true)}</td>
                    <td className="voucher-pending-col--amt num">{fmtAmt(r._gtotAmt, true)}</td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="voucher-pending-modal__statusbar">
          <span>Record: {displayRows.length ? `${activeRow + 1}/${displayRows.length}` : '0/0'}</span>
          <span className="voucher-pending-modal__statusbar-adj">
            Total adjustment: <strong>{fmtAmt(totals.adj, true) || '0.00'}</strong>
          </span>
        </div>

        <div className="voucher-pending-modal__foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApply}
            disabled={!rows.length || pickedCount === 0}
          >
            {pickedCount > 1 ? `Apply ${pickedCount} lines` : 'Apply to grid'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
