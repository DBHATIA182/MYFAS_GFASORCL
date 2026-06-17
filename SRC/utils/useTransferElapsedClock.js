import { useCallback, useEffect, useRef, useState } from 'react';

/** Format milliseconds as M:SS or H:MM:SS */
export function formatElapsedMs(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Live clock while `running`; keeps final elapsed after stop until reset. */
export function useTransferElapsedClock(running) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (!running) return undefined;
    startRef.current = Date.now();
    setElapsedMs(0);
    const tick = () => {
      if (startRef.current) setElapsedMs(Date.now() - startRef.current);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      if (startRef.current) setElapsedMs(Date.now() - startRef.current);
    };
  }, [running]);

  const resetElapsed = useCallback(() => {
    startRef.current = null;
    setElapsedMs(0);
  }, []);

  return {
    elapsedMs,
    elapsedLabel: formatElapsedMs(elapsedMs),
    resetElapsed,
  };
}
