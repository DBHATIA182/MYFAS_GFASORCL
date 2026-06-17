/** Axios opts with gst_profile APW session token (in-memory only — not persisted). */
export function gstProfileRequestOpts(compCode, accessToken, base = { withCredentials: true, timeout: 120000 }) {
  return {
    ...base,
    headers: {
      ...(base.headers || {}),
      'X-Gst-Profile-Access-Token': accessToken || '',
      'X-Comp-Code': String(compCode ?? '1').trim(),
    },
  };
}
