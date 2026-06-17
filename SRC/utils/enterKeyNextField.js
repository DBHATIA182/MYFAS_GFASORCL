/**
 * VFP-style Enter: move focus to next field (like Tab). Use onKeyDownCapture on forms.
 * Includes master-party pick triggers; skips Cancel/Save and other buttons.
 */
export function focusNextOnEnter(e, formRef, { submitOnLast = false } = {}) {
  if (e.key !== 'Enter') return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'TEXTAREA') return false;
  if (target.tagName === 'BUTTON') {
    const isPick =
      target.classList.contains('master-party-pick__trigger') ||
      target.classList.contains('master-party-pick__search-btn');
    if (!isPick) return false;
  }

  const formEl = formRef?.current;
  if (!formEl || !formEl.contains(target)) return false;

  const focusables = Array.from(
    formEl.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button.master-party-pick__trigger:not([disabled]), button.master-party-pick__search-btn:not([disabled])'
    )
  ).filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tabIndex < 0) return false;
    if (el instanceof HTMLInputElement && el.readOnly) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  const idx = focusables.indexOf(target);
  if (idx < 0) return false;

  const next = focusables[idx + 1];
  if (!next) {
    if (submitOnLast) {
      e.preventDefault();
      e.stopPropagation();
      formEl.requestSubmit();
      return true;
    }
    return false;
  }

  e.preventDefault();
  e.stopPropagation();
  next.focus();
  if (next instanceof HTMLInputElement && !next.readOnly) {
    try {
      next.select();
    } catch (_) {
      /* ignore */
    }
  }
  return true;
}
