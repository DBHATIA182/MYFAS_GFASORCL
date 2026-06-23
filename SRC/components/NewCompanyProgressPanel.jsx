import React, { useEffect, useRef } from 'react';

/** Live command / table log for New Company save and delete. */
export default function NewCompanyProgressPanel({
  title,
  busy,
  currentLabel,
  lines = [],
  className = '',
}) {
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, currentLabel]);

  if (!busy && lines.length === 0) return null;

  return (
    <div className={`newcomp-progress ${className}`.trim()} role="status" aria-live="polite">
      <div className="newcomp-progress__head">
        {busy ? <div className="newcomp-delete-picker__spinner" aria-hidden="true" /> : null}
        <div>
          <p className="newcomp-progress__title">{title || 'Working…'}</p>
          {currentLabel ? <p className="newcomp-progress__current">{currentLabel}</p> : null}
        </div>
      </div>
      {lines.length > 0 ? (
        <div className="newcomp-progress__log" ref={logRef}>
          {lines.map((line, idx) => (
            <div
              key={`${idx}-${line.table ?? line.command ?? idx}`}
              className={`newcomp-progress__line${line.error ? ' newcomp-progress__line--error' : ''}${line.skipped ? ' newcomp-progress__line--skip' : ''}`}
            >
              <span className="newcomp-progress__line-no">{idx + 1}.</span>
              <span className="newcomp-progress__line-text">
                {line.schema ? `[${line.schema}] ` : ''}
                {line.command || line.table || line.message || '—'}
                {line.rows != null && line.rows > 0 ? ` (${line.rows} rows)` : ''}
                {line.skipped && !line.error ? ' — skipped' : ''}
                {line.error ? ` — ${line.error}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
