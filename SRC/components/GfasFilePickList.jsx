import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import {
  gfasorclBrowseRelPath,
  gfasorclParentVfpPath,
  normalizeGfasorclFilePath,
} from '../utils/gfasorclFilePath';
import { apiUrl } from '../utils/resolveApiBase';

const reqOpts = { withCredentials: true, timeout: 60000 };

/**
 * Text path + ? / F1 file browser under \\GFASORCL (server lists folders/images).
 */
export default function GfasFilePickList({
  apiBase,
  value,
  onChange,
  disabled,
  title = 'Select file',
  placeholder = '\\GFASORCL\\LOGO\\file.jpg',
  browseStart = 'LOGO',
  dataField,
  onKeyDown,
}) {
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [browse, setBrowse] = useState(null);

  const displayValue = normalizeGfasorclFilePath(value);

  const loadBrowse = useCallback(
    async (vfpPath) => {
      setLoading(true);
      setErr('');
      try {
        const rel = gfasorclBrowseRelPath(vfpPath, browseStart);
        const { data } = await axios.get(apiUrl(apiBase, '/api/gfas-file-browse'), {
          params: { path: rel || undefined },
          ...reqOpts,
        });
        setBrowse(data);
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Browse failed');
        setBrowse(null);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, browseStart]
  );

  const openBrowser = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    void loadBrowse(displayValue || `\\GFASORCL\\${String(browseStart || 'LOGO').replace(/^\\+/, '')}`);
  }, [disabled, displayValue, browseStart, loadBrowse]);

  const closeBrowser = useCallback(() => {
    setOpen(false);
    setErr('');
  }, []);

  const handleHelpKeyDown = useCallback(
    (e) => {
      if (e.key === 'F1' || e.keyCode === 112) {
        e.preventDefault();
        e.stopPropagation();
        openBrowser();
        return true;
      }
      return false;
    },
    [openBrowser]
  );

  const selectFile = useCallback(
    (vfpPath) => {
      onChange(normalizeGfasorclFilePath(vfpPath));
      closeBrowser();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [onChange, closeBrowser]
  );

  const enterDir = useCallback(
    (dirName) => {
      const base = browse?.current || '\\GFASORCL';
      void loadBrowse(`${base}\\${dirName}`);
    },
    [browse?.current, loadBrowse]
  );

  const goParent = useCallback(() => {
    const parent = browse?.parent ?? gfasorclParentVfpPath(browse?.current);
    if (!parent) return;
    void loadBrowse(parent);
  }, [browse?.parent, browse?.current, loadBrowse]);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (inputRef.current?.contains(t)) return;
      closeBrowser();
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open, closeBrowser]);

  const panel =
    open
      ? createPortal(
          <>
            <button type="button" className="gfas-file-pick__backdrop" aria-label="Close" onClick={closeBrowser} />
            <div ref={panelRef} className="gfas-file-pick__panel" role="dialog" aria-label={title}>
              <div className="gfas-file-pick__head">
                <span className="gfas-file-pick__head-title">{title}</span>
                <button type="button" className="gfas-file-pick__close" onClick={closeBrowser}>
                  ×
                </button>
              </div>
              <p className="gfas-file-pick__path" title={browse?.current}>
                {browse?.current || '\\GFASORCL\\LOGO'}
              </p>
              {err ? <p className="gfas-file-pick__err">{err}</p> : null}
              <div className="gfas-file-pick__nav">
                <button
                  type="button"
                  className="btn btn-secondary gfas-file-pick__up"
                  disabled={loading || !browse?.parent}
                  onClick={goParent}
                >
                  ↑ Up
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={() => void loadBrowse(browse?.current || displayValue)}
                >
                  Refresh
                </button>
              </div>
              <div className="gfas-file-pick__list">
                {loading ? <p className="gfas-file-pick__empty">Loading…</p> : null}
                {!loading && browse?.parent ? (
                  <button type="button" className="gfas-file-pick__row gfas-file-pick__row--dir" onClick={goParent}>
                    <span className="gfas-file-pick__icon">📁</span>
                    <span>..</span>
                  </button>
                ) : null}
                {!loading && browse
                  ? (browse.dirs || []).map((d) => (
                      <button
                        key={`d-${d}`}
                        type="button"
                        className="gfas-file-pick__row gfas-file-pick__row--dir"
                        onClick={() => enterDir(d)}
                      >
                        <span className="gfas-file-pick__icon">📁</span>
                        <span>{d}</span>
                      </button>
                    ))
                  : null}
                {!loading && browse
                  ? (browse.files || []).map((f) => (
                      <button
                        key={`f-${f.path || f.name}`}
                        type="button"
                        className="gfas-file-pick__row gfas-file-pick__row--file"
                        onClick={() => selectFile(f.path)}
                        title={f.path}
                      >
                        <span className="gfas-file-pick__icon">🖼</span>
                        <span>{f.name}</span>
                      </button>
                    ))
                  : null}
                {!loading && browse && !browse.dirs?.length && !browse.files?.length ? (
                  <p className="gfas-file-pick__empty">No folders or image files here.</p>
                ) : null}
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div className="gfas-file-pick" data-gfas-field={dataField}>
      <input
        ref={inputRef}
        type="text"
        className="defset-field__input gfas-file-pick__input"
        disabled={disabled}
        value={displayValue}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normalizeGfasorclFilePath(e.target.value))}
        onKeyDown={(e) => {
          if (handleHelpKeyDown(e)) return;
          onKeyDown?.(e);
        }}
      />
      <button
        type="button"
        className="gfas-file-pick__btn"
        disabled={disabled}
        title="Browse file (F1)"
        aria-label={`Browse ${title} (F1)`}
        onClick={(e) => {
          e.preventDefault();
          openBrowser();
        }}
        onKeyDown={(e) => {
          if (handleHelpKeyDown(e)) return;
        }}
      >
        ?
      </button>
      {panel}
    </div>
  );
}
