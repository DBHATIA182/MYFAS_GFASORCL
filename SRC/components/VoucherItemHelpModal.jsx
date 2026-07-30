import React, { useEffect, useMemo, useRef, useState } from 'react';

const SEARCH_FIELDS = [
  { key: 'item_name', label: 'Item Name' },
  { key: 'item_code', label: 'Item Code' },
];

function itemMatchesQuery(row, q, searchIn, unifiedSearch) {
  if (!q) return true;
  const name = row.item_name.toLowerCase();
  const code = String(row.item_code);
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const matchToken = (t) => {
    if (unifiedSearch) {
      return name.includes(t) || code.startsWith(t) || code.includes(t);
    }
    if (searchIn === 'item_name') {
      if (t.length <= 3) return name.startsWith(t) || name.includes(t);
      return name.includes(t);
    }
    return code.startsWith(t) || code.includes(t);
  };
  return tokens.every(matchToken);
}

/** F1 item browse — VFP listBoxDisplay / ITMHLP with Search In column picker. */
export default function VoucherItemHelpModal({
  open,
  title = 'Item help',
  items = [],
  defaultSearchIn = 'item_name',
  unifiedSearch = false,
  loading = false,
  loadError = '',
  initialFilter = '',
  onSelect,
  onClose,
}) {
  const [filter, setFilter] = useState('');
  const [searchIn, setSearchIn] = useState('item_name');
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef(null);

  const normalized = useMemo(
    () =>
      (items || [])
        .map((it) => ({
          item_code: Number(it.ITEM_CODE ?? it.item_code ?? 0) || 0,
          item_name: String(it.ITEM_NAME ?? it.item_name ?? it.NAME ?? it.name ?? '').trim(),
          hsn_code: String(it.HSN_CODE ?? it.hsn_code ?? it.ITEM_HEAD ?? it.item_head ?? '').trim(),
        }))
        .filter((it) => it.item_code > 0 || it.item_name),
    [items]
  );

  const rows = useMemo(() => {
    const sorted = [...normalized].sort((a, b) => {
      if (!unifiedSearch && searchIn === 'item_code') {
        return a.item_code - b.item_code;
      }
      return a.item_name.localeCompare(b.item_name, undefined, { sensitivity: 'base' });
    });
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => itemMatchesQuery(r, q, searchIn, unifiedSearch));
  }, [normalized, filter, searchIn, unifiedSearch]);

  useEffect(() => {
    if (!open) return;
    setFilter(String(initialFilter ?? '').trim());
    setSearchIn(defaultSearchIn === 'item_code' ? 'item_code' : 'item_name');
    setHighlight(0);
    window.setTimeout(() => searchRef.current?.focus(), 40);
  }, [open, defaultSearchIn, initialFilter]);

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
        onSelect?.(rows[highlight]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rows, highlight, onSelect, onClose]);

  useEffect(() => {
    setHighlight((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  if (!open) return null;

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="voucher-help-modal__panel voucher-help-modal__panel--account">
        <header className="voucher-help-modal__head">
          <h3 className="voucher-help-modal__title">{title}</h3>
          <p className="voucher-help-modal__hint">
            {unifiedSearch
              ? 'Type item code or name · ↑↓ move · Enter pick · Esc close'
              : 'Search in Item Code or Item Name · ↑↓ move · Enter pick · Esc close'}
          </p>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="voucher-help-modal__search voucher-help-modal__search--item">
          <label className="voucher-help-modal__search-label">
            <span>Find</span>
            <input
              ref={searchRef}
              type="text"
              className="form-input voucher-help-modal__search-input"
              placeholder={unifiedSearch ? 'Type item code or name…' : searchIn === 'item_name' ? 'Type item name…' : 'Type item code…'}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setHighlight(0);
              }}
            />
          </label>
          {!unifiedSearch ? (
            <label className="voucher-help-modal__search-label">
              <span>Search in</span>
              <select
                className="form-input voucher-help-modal__search-col"
                value={searchIn}
                onChange={(e) => {
                  setSearchIn(e.target.value);
                  setFilter('');
                  setHighlight(0);
                  window.setTimeout(() => searchRef.current?.focus(), 0);
                }}
              >
                {SEARCH_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="voucher-help-modal__body voucher-help-modal__body--account">
          {loading ? (
            <p className="voucher-help-modal__msg">Loading items…</p>
          ) : loadError ? (
            <p className="voucher-help-modal__msg">{loadError}</p>
          ) : !normalized.length ? (
            <p className="voucher-help-modal__msg">Item list not loaded. Close and retry, or restart the API server.</p>
          ) : !rows.length ? (
            <p className="voucher-help-modal__msg">No matching items.</p>
          ) : (
            <table className="voucher-help-modal__table voucher-help-modal__table--account">
              <thead>
                <tr>
                  <th className="num">Item</th>
                  <th>Name</th>
                  {normalized.some((r) => r.hsn_code) ? <th>HSN</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.item_code}-${i}`}
                    className={`voucher-help-modal__row${i === highlight ? ' is-active' : ''}`}
                    tabIndex={0}
                    onMouseEnter={() => setHighlight(i)}
                    onDoubleClick={() => onSelect?.(r)}
                    onClick={() => onSelect?.(r)}
                  >
                    <td className="num voucher-help-modal__code">{r.item_code}</td>
                    <td>{r.item_name}</td>
                    {normalized.some((x) => x.hsn_code) ? <td>{r.hsn_code || '—'}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="voucher-help-modal__foot">
          <span>
            {loading ? 'Loading…' : `${rows.length} item(s) · Total ${normalized.length}`}
          </span>
        </footer>
      </div>
    </div>
  );
}
