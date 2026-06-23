import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** Choose company to delete (New Company Addition). */
export default function NewCompanyDeletePicker({
  companies,
  currentCompCode,
  loading,
  deleting,
  deleteStatus,
  progressLines = [],
  error,
  onSelect,
  onClose,
}) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setFilter('');
  }, [companies]);

  const rows = useMemo(() => {
    const list = Array.isArray(companies) ? companies : [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => {
      const code = String(row.comp_code ?? row.COMP_CODE ?? '');
      const name = String(row.comp_name ?? row.COMP_NAME ?? '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [companies, filter]);

  const busy = Boolean(loading || deleting);

  const modal = (
    <div
      className="sale-bill-modal-backdrop newcomp-delete-picker-backdrop"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="sale-bill-modal newcomp-delete-picker"
        role="dialog"
        aria-labelledby="newcomp-delete-picker-title"
        aria-busy={busy}
        onClick={(e) => e.stopPropagation()}
      >
        {deleting ? (
          <div className="newcomp-delete-picker__busy" role="status" aria-live="polite">
            <div className="newcomp-delete-picker__spinner" aria-hidden="true" />
            <p className="newcomp-delete-picker__busy-title">Deleting records…</p>
            <p className="newcomp-delete-picker__busy-msg">
              {deleteStatus || 'Removing company from all tables. Please wait — do not close.'}
            </p>
            {progressLines.length > 0 ? (
              <div className="newcomp-delete-picker__progress-log">
                {progressLines.slice(-6).map((line, idx) => (
                  <div key={`${idx}-${line.table ?? line.command}`} className="newcomp-delete-picker__progress-line">
                    {line.schema ? `[${line.schema}] ` : ''}
                    {line.command || line.table}
                    {line.rows > 0 ? ` (${line.rows})` : ''}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="sale-bill-modal-head">
          <div>
            <h3 id="newcomp-delete-picker-title" className="sale-bill-page__title">
              Delete Company
            </h3>
            <p className="newcomp-delete-picker__sub">Select a company to remove from all tables.</p>
          </div>
          <button
            type="button"
            className="sale-bill-modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="newcomp-delete-picker__body">
          <label className="newcomp-delete-picker__filter">
            <span className="inttrf-field__lbl">Search</span>
            <input
              type="search"
              className="inttrf-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Code or name…"
              autoFocus={!busy}
              disabled={busy}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}
          {loading ? <p className="loading-msg">Loading companies…</p> : null}

          {!loading ? (
            <div className="newcomp-delete-picker__table-wrap">
              <table className="report-table newcomp-delete-picker__table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Company name</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="newcomp-delete-picker__empty">
                        No companies found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const code = Number(row.comp_code ?? row.COMP_CODE ?? 0) || 0;
                      const name = String(row.comp_name ?? row.COMP_NAME ?? '').trim();
                      const isCurrent =
                        row.isCurrent === true ||
                        Number(row.is_current ?? row.IS_CURRENT ?? 0) === 1 ||
                        code === Number(currentCompCode);
                      return (
                        <tr key={code} className={isCurrent ? 'newcomp-delete-picker__row--current' : ''}>
                          <td>{code}</td>
                          <td>{name || '—'}</td>
                          <td className="newcomp-delete-picker__action">
                            {isCurrent ? (
                              <span className="newcomp-delete-picker__hint">Logged-in company</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-danger"
                                disabled={busy}
                                onClick={() => onSelect(code, name)}
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="newcomp-delete-picker__foot">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
