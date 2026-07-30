import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function rowSearchText(row, columns) {
  return columns
    .map((col) => {
      const raw = row?.[col.key];
      if (col.format) {
        try {
          return String(col.format(raw, row) ?? '');
        } catch {
          return String(raw ?? '');
        }
      }
      return String(raw ?? '');
    })
    .join(' ')
    .toLowerCase();
}

/**
 * VFP-style F1 browse — type to search · ↑↓ · Enter / click to pick (same pattern as party help).
 */
export default function VoucherGridHelpModal({
  open,
  title,
  hint,
  columns = [],
  rows = [],
  loading = false,
  error = '',
  searchPlaceholder = 'Search code or name…',
  searchable = true,
  toolbar = null,
  panelClassName = '',
  onSelect,
  onClose,
}) {
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef(null);
  const pickingRef = useRef(false);
  const tableRef = useRef(null);

  const filteredRows = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    if (!searchable) return list;
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => rowSearchText(row, columns).includes(q));
  }, [rows, columns, filter, searchable]);

  const pickRow = useCallback(
    (row, e) => {
      if (!row || pickingRef.current) return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      pickingRef.current = true;
      onSelect?.(row);
      onClose?.();
      window.setTimeout(() => {
        pickingRef.current = false;
      }, 0);
    },
    [onClose, onSelect]
  );

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
    setHighlight((i) => Math.min(i, Math.max(0, filteredRows.length - 1)));
  }, [filteredRows.length]);

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
        setHighlight((i) => Math.min(filteredRows.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' && filteredRows.length) {
        e.preventDefault();
        const row = filteredRows[highlight];
        if (row) pickRow(row, e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filteredRows, highlight, onClose, pickRow]);

  useEffect(() => {
    if (!open) return;
    const active = tableRef.current?.querySelector('tr.is-active');
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlight]);

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
        className={`voucher-help-modal__panel voucher-help-modal__panel--account${panelClassName ? ` ${panelClassName}` : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{title}</h3>
          <p className="voucher-help-modal__hint">
            {hint || 'Type to search · ↑↓ move · Enter pick · Esc close'}
          </p>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {searchable ? (
          <div className="voucher-help-modal__search">
            <input
              ref={searchRef}
              type="text"
              className="form-input voucher-help-modal__search-input"
              placeholder={searchPlaceholder}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setHighlight(0);
              }}
            />
          </div>
        ) : null}
        {toolbar ? <div className="voucher-help-modal__toolbar">{toolbar}</div> : null}
        <div className="voucher-help-modal__body voucher-help-modal__body--account">
          {loading && <p className="voucher-help-modal__msg">Loading…</p>}
          {!loading && error && <p className="voucher-help-modal__msg voucher-help-modal__msg--err">{error}</p>}
          {!loading && !error && !filteredRows.length && (
            <p className="voucher-help-modal__msg">{rows.length ? 'No matching records.' : 'No records found.'}</p>
          )}
          {!loading && !error && filteredRows.length > 0 && (
            <table ref={tableRef} className="voucher-help-modal__table voucher-help-modal__table--account">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className={col.align === 'right' ? 'voucher-help-modal__num' : ''}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => (
                  <tr
                    key={row._id ?? idx}
                    tabIndex={0}
                    className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={(e) => pickRow(row, e)}
                    onDoubleClick={(e) => pickRow(row, e)}
                  >
                    {columns.map((col) => (
                      <td key={col.key} className={col.align === 'right' ? 'voucher-help-modal__num' : ''}>
                        {col.format ? col.format(row[col.key], row) : (row[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="voucher-help-modal__foot">
          <span>
            {filteredRows.length} row(s)
            {rows.length !== filteredRows.length ? ` of ${rows.length}` : ''} · Type to search · Enter pick · Esc
            close
          </span>
        </footer>
      </div>
    </div>
  );
}
