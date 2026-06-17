import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounced list search for master screens — avoids API call on every keystroke.
 * @param {{ enabled: boolean, debounceMs?: number, onSearch: (q: string, ctx: { gen: number, isStale: () => boolean }) => Promise<void> }} opts
 */
export function useDebouncedMasterSearch({ enabled, debounceMs = 350, onSearch }) {
  const appliedRef = useRef('');
  const debounceRef = useRef(null);
  const genRef = useRef(0);

  const executeSearch = useCallback(
    (q, { immediate = false, force = false } = {}) => {
      const trimmed = String(q ?? '').trim();

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      const run = () => {
        if (!force && appliedRef.current === trimmed) return;
        appliedRef.current = trimmed;
        const gen = ++genRef.current;
        void onSearch(trimmed, {
          gen,
          isStale: () => gen !== genRef.current,
        });
      };

      if (immediate) {
        run();
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        run();
      }, debounceMs);
    },
    [debounceMs, onSearch]
  );

  useEffect(() => {
    if (!enabled) return;
    appliedRef.current = '';
    const gen = ++genRef.current;
    void onSearch('', { gen, isStale: () => gen !== genRef.current });
  }, [enabled, onSearch]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const refreshList = useCallback(() => {
    executeSearch(appliedRef.current, { immediate: true, force: true });
  }, [executeSearch]);

  return { executeSearch, refreshList, getAppliedQuery: () => appliedRef.current };
}
