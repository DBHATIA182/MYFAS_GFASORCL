/** Register focusable fields and move focus on Enter (VFP-style grid navigation). */

function scrollFieldIntoView(el) {
  if (!el) return;
  const target = typeof el.closest === 'function' ? el.closest('td') || el : el;

  // Prefer scrolling the table's overflow-x wrapper (Cost / Val.Date sit off-screen to the right).
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const canScrollX =
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      parent.scrollWidth > parent.clientWidth + 1;
    if (canScrollX) {
      const elRect = target.getBoundingClientRect();
      const pRect = parent.getBoundingClientRect();
      const pad = 24;
      if (elRect.right > pRect.right - pad) {
        parent.scrollLeft += elRect.right - pRect.right + pad;
      } else if (elRect.left < pRect.left + pad) {
        parent.scrollLeft -= pRect.left - elRect.left + pad;
      }
      break;
    }
    parent = parent.parentElement;
  }

  if (typeof target.scrollIntoView === 'function') {
    try {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView(false);
    }
  }
}

function focusElement(el) {
  if (!el || el.disabled) return false;
  if (el.readOnly === true) return false;
  if (typeof el.focus !== 'function') return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  scrollFieldIntoView(el);
  if (typeof el.select === 'function' && el.tagName === 'INPUT' && el.type !== 'checkbox') {
    try {
      el.select();
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function createEnterFocusChain() {
  const map = new Map();
  let order = [];

  function register(key, el) {
    if (!key) return;
    if (el) map.set(key, el);
    else map.delete(key);
  }

  function setOrder(keys) {
    order = Array.isArray(keys) ? keys : [];
  }

  function focusKey(key) {
    return focusElement(map.get(key));
  }

  function focusNext(currentKey) {
    const idx = order.indexOf(currentKey);
    if (idx === -1) return false;
    for (let i = idx + 1; i < order.length; i += 1) {
      if (focusElement(map.get(order[i]))) return true;
    }
    return false;
  }

  function focusAfterHelp(currentKey) {
    if (focusNext(currentKey)) return true;
    return focusKey(currentKey);
  }

  function onEnter(currentKey) {
    return (e) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      if (e.shiftKey) return;
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA') return;
      e.preventDefault();
      e.stopPropagation();
      // Defer so React state / disabled updates settle before moving focus
      window.setTimeout(() => focusNext(currentKey), 0);
    };
  }

  return { register, setOrder, focusNext, focusKey, focusAfterHelp, onEnter };
}
