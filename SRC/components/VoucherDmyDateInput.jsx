import React, { useEffect, useState } from 'react';
import {
  formatDmyTyping,
  isCompleteDmyDisplay,
  parseDmyDisplay,
  toDisplayDate,
} from '../utils/dateFormat';

function clampYmd(ymd, minYmd, maxYmd) {
  let next = ymd;
  if (minYmd && next < minYmd) next = minYmd;
  if (maxYmd && next > maxYmd) next = maxYmd;
  return next;
}

/** VFP-style date — type dd/mm/yyyy (slashes added as you type). */
export default function VoucherDmyDateInput({
  valueYmd = '',
  onChangeYmd,
  disabled = false,
  minYmd = '',
  maxYmd = '',
  className = 'form-input',
  placeholder = 'dd/mm/yyyy',
  title,
  inputRef,
  onKeyDown,
  onBlurYmd,
}) {
  const [text, setText] = useState(() => toDisplayDate(valueYmd) || '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(toDisplayDate(valueYmd) || '');
    }
  }, [valueYmd, focused]);

  const publishYmd = (rawText) => {
    const trimmed = String(rawText ?? '').trim();
    if (!trimmed) {
      onChangeYmd?.('');
      return true;
    }
    const ymd = parseDmyDisplay(trimmed);
    if (!ymd) return false;
    const next = clampYmd(ymd, minYmd, maxYmd);
    onChangeYmd?.(next);
    setText(toDisplayDate(next));
    return true;
  };

  const commitBlur = () => {
    setFocused(false);
    const trimmed = text.trim();
    if (!trimmed) {
      onChangeYmd?.('');
      onBlurYmd?.('');
      return;
    }
    if (!publishYmd(trimmed)) {
      return;
    }
    const ymd = parseDmyDisplay(trimmed);
    if (ymd) onBlurYmd?.(clampYmd(ymd, minYmd, maxYmd));
  };

  const handleChange = (e) => {
    const next = formatDmyTyping(e.target.value);
    setText(next);
    if (isCompleteDmyDisplay(next)) {
      publishYmd(next);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      maxLength={10}
      autoComplete="off"
      ref={inputRef}
      onFocus={(e) => {
        setFocused(true);
        if (!String(text ?? '').trim() && valueYmd) {
          setText(toDisplayDate(valueYmd));
        }
        window.requestAnimationFrame(() => {
          try {
            e.target.select();
          } catch (_) {}
        });
      }}
      onChange={handleChange}
      onBlur={commitBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitBlur();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
