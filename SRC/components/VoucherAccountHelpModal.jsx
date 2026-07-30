import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function fmtBal(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isTypingTarget(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function accountMatchesQuery(row, q) {
  if (!q) return true;
  const code = row.code.toLowerCase();
  const name = row.name.toLowerCase();
  const city = String(row.city || '').toLowerCase();
  // Short keys jump by prefix (VFP listbox); longer text matches anywhere in code/name/city.
  if (q.length <= 3) {
    return code.startsWith(q) || name.startsWith(q) || code.includes(q) || name.includes(q);
  }
  return (
    code.includes(q) ||
    name.includes(q) ||
    name.startsWith(q) ||
    city.includes(q) ||
    `${code} ${name} ${city} ${row.gst} ${row.pan} ${row.tel}`.toLowerCase().includes(q)
  );
}

/** Prefer name/code prefix hits so "RICE" surfaces "RICE A/C" above "... RICE ..." names. */
function accountMatchRank(row, q) {
  if (!q) return 9;
  const code = row.code.toLowerCase();
  const name = row.name.toLowerCase();
  if (name === q || code === q) return 0;
  if (name.startsWith(q)) return 1;
  if (code.startsWith(q)) return 2;
  if (name.includes(` ${q}`) || name.includes(`/${q}`) || name.includes(`-${q}`)) return 3;
  if (name.includes(q)) return 4;
  if (code.includes(q)) return 5;
  return 6;
}

/** F1 account browse — centered modal with search (no floating side panel). */
export default function VoucherAccountHelpModal({
  open,
  title = 'Account help',
  accounts = [],
  onSelect,
  onClose,
  onRefresh = null,
}) {
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const searchRef = useRef(null);
  const tableRef = useRef(null);
  const pickingRef = useRef(false);

  const normalized = useMemo(() => {
    const list = (accounts || []).map((a) => ({
      code: String(a.CODE ?? a.code ?? '').trim(),
      name: String(a.NAME ?? a.name ?? '').trim(),
      city: String(a.CITY ?? a.city ?? '').trim(),
      gst: String(a.GST_NO ?? a.gst_no ?? '').trim(),
      pan: String(a.PAN ?? a.pan ?? '').trim(),
      tel: String(a.TEL_NO_O ?? a.tel_no_o ?? '').trim(),
      cur_bal: Number(a.CUR_BAL ?? a.cur_bal ?? 0) || 0,
    }));
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [accounts, refreshTick]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return normalized;
    const matched = normalized.filter((r) => accountMatchesQuery(r, q));
    return matched.sort((a, b) => {
      const ra = accountMatchRank(a, q);
      const rb = accountMatchRank(b, q);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }, [normalized, filter, refreshTick]);

  const refreshList = useCallback(() => {
    setHighlight(0);
    setRefreshTick((n) => n + 1);
    onRefresh?.();
    window.setTimeout(() => {
      searchRef.current?.focus?.();
      tableRef.current?.querySelector('tr.is-active')?.scrollIntoView?.({ block: 'nearest' });
    }, 0);
  }, [onRefresh]);

  const pickCode = useCallback(
    (code, e) => {
      if (!code || pickingRef.current) return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      pickingRef.current = true;
      onSelect?.(code);
      onClose?.();
      window.setTimeout(() => {
        pickingRef.current = false;
      }, 0);
    },
    [onClose, onSelect]
  );

  const appendFilter = useCallback((ch) => {
    if (!ch) return;
    setFilter((prev) => prev + ch);
    setHighlight(0);
    window.setTimeout(() => {
      const el = searchRef.current;
      if (el && typeof el.focus === 'function') {
        el.focus();
        const len = el.value.length;
        if (typeof el.setSelectionRange === 'function') el.setSelectionRange(len, len);
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) {
      pickingRef.current = false;
      return;
    }
    setFilter('');
    setHighlight(0);
    window.setTimeout(() => searchRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    setHighlight((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const active = tableRef.current?.querySelector('tr.is-active');
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlight, filter, rows]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((i) => Math.min(rows.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' && rows.length) {
        e.preventDefault();
        const row = rows[highlight];
        if (row?.code) pickCode(row.code, e);
        return;
      }
      if (e.key === 'Backspace' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setFilter((prev) => prev.slice(0, -1));
        setHighlight(0);
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.defaultPrevented &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        appendFilter(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, highlight, onClose, pickCode, appendFilter]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="voucher-help-modal__backdrop"
        aria-label="Close"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
      />
      <div
        className="voucher-help-modal__panel voucher-help-modal__panel--account"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{title}</h3>
          <p className="voucher-help-modal__hint">
            Type to search code or name · ↑↓ move · Enter pick · Refresh re-applies filter · Esc close
          </p>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="voucher-help-modal__search" style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
          <input
            ref={searchRef}
            type="text"
            className="form-input voucher-help-modal__search-input"
            placeholder="Search code or name…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                e.preventDefault();
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={refreshList}
            title="Re-apply filter and jump to best match"
            style={{ flexShrink: 0, minHeight: '2rem', whiteSpace: 'nowrap' }}
          >
            Refresh
          </button>
        </div>
        <div className="voucher-help-modal__body voucher-help-modal__body--account">
          {!rows.length ? (
            <p className="voucher-help-modal__msg">
              {normalized.length ? 'No matching accounts.' : 'No accounts found.'}
            </p>
          ) : (
            <table ref={tableRef} className="voucher-help-modal__table voucher-help-modal__table--account">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City</th>
                  <th>GST</th>
                  <th>PAN</th>
                  <th className="num">Ledger Bal.</th>
                  <th>Tel</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.code || `${r.name}-${i}`}
                    className={`voucher-help-modal__row${i === highlight ? ' is-active' : ''}`}
                    tabIndex={-1}
                    onMouseEnter={() => setHighlight(i)}
                    onDoubleClick={(e) => pickCode(r.code, e)}
                    onClick={(e) => pickCode(r.code, e)}
                  >
                    <td className="voucher-help-modal__code">{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.city || '—'}</td>
                    <td>{r.gst || '—'}</td>
                    <td>{r.pan || '—'}</td>
                    <td className="num voucher-help-modal__bal">{fmtBal(r.cur_bal)}</td>
                    <td>{r.tel || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="voucher-help-modal__foot">
          <span>
            {rows.length} account(s)
            {rows.length !== normalized.length ? ` of ${normalized.length}` : ''} · Type name prefix to jump · Enter
            pick · Esc close
          </span>
        </footer>
      </div>
    </div>
  );
}
