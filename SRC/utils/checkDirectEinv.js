import axios from 'axios';

/** VFP DCNOTE E.Inv / EinvPnt — GST_PROFILE.GST_NO must be non-empty. */
export async function fetchDirectEinvStatus(apiBase, compCode, reqOpts = {}) {
  const { data } = await axios.get(`${apiBase}/api/gst-profile/direct-einv-status`, {
    params: { comp_code: compCode },
    withCredentials: true,
    timeout: 60000,
    ...reqOpts,
  });
  return {
    activated: Boolean(data?.activated),
    gstNo: String(data?.gst_no ?? '').trim(),
  };
}
