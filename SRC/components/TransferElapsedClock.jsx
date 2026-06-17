import React from 'react';
import { formatElapsedMs } from '../utils/useTransferElapsedClock';

/** Elapsed timer shown during long transfer / list operations. */
export default function TransferElapsedClock({ elapsedMs, label, visible, running }) {
  if (!visible) return null;
  const text = label || formatElapsedMs(elapsedMs);
  return (
    <span
      className={`inttrf-transfer-clock${running ? ' inttrf-transfer-clock--live' : ''}`}
      aria-live="polite"
    >
      <span className="inttrf-transfer-clock__icon" aria-hidden="true">
        ⏱
      </span>
      Elapsed: <strong>{text}</strong>
    </span>
  );
}
