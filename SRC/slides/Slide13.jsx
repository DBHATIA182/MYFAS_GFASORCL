import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = q.trim();
  if (!query) return s;
  const lower = s.toLowerCase();
  const qi = lower.indexOf(query.toLowerCase());
  if (qi === -1) return s;
  return (
    <>
      {s.slice(0, qi)}
      <mark className="search-highlight">{s.slice(qi, qi + query.length)}</mark>
      {s.slice(qi + query.length)}
    </>
  );
}

export default function Slide13({ apiBase, formData, onPrev, onReset }) {
  const [type, setType] = useState('SL');
  const [billNoStart, setBillNoStart] = useState('');
  const [billNoEnd, setBillNoEnd] = useState('');
  const [bType, setBType] = useState('');
  const [billDateStart, setBillDateStart] = useState('');
  const [billDateEnd, setBillDateEnd] = useState('');
  const [printGrossDane, setPrintGrossDane] = useState('N');
  const [printPacking, setPrintPacking] = useState('N');

  const [parties, setParties] = useState([]);
  const [lookupError, setLookupError] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [selectedMcode, setSelectedMcode] = useState('');

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const { data } = await axios.get(`${apiBase}/api/salelist-parties`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
          timeout: 120000,
        });
        setParties(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Sale bill printing parties lookup:', err);
        const st = err.response?.status;
        setLookupError(
          st === 404
            ? `No /api/salelist-parties route on ${formatApiOrigin(apiBase)}. Run \`npm run server\` with latest server.cjs and refresh.`
            : err.response?.data?.error || err.message || 'Request failed'
        );
      }
    };
    load();
  }, [apiBase, compCode, compUid]);

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return parties.slice(0, 150);
    return parties.filter((p) => {
      const code = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [parties, partySearch]);

  /** Bill date then bill no (then b_type, code) — same order on desktop and mobile. */
  const printingListSorted = useMemo(() => {
    if (!rows.length) return rows;
    return [...rows].sort((a, b) => {
      const da = toInputDateString(a.BILL_DATE ?? a.bill_date);
      const db = toInputDateString(b.BILL_DATE ?? b.bill_date);
      const cmpDate = da.localeCompare(db);
      if (cmpDate !== 0) return cmpDate;
      const na = Number(a.BILL_NO ?? a.bill_no);
      const nb = Number(b.BILL_NO ?? b.bill_no);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      const sa = String(a.BILL_NO ?? a.bill_no ?? '');
      const sb = String(b.BILL_NO ?? b.bill_no ?? '');
      if (sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true });
      const ba = String(a.B_TYPE ?? a.b_type ?? '');
      const bb = String(b.B_TYPE ?? b.b_type ?? '');
      if (ba !== bb) return ba.localeCompare(bb);
      return String(a.CODE ?? a.code ?? '').localeCompare(String(b.CODE ?? b.code ?? ''));
    });
  }, [rows]);

  useEffect(() => {
    setPartyHi(0);
  }, [partySearch]);

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code ?? '') === String(selectedMcode));

  const openSaleBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const billNoFromRow = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bTypeFromRow = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || billNoFromRow == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    let askGrossDane = printGrossDane;
    let askPacking = printPacking;
    // Explicit ask at open-time so user never misses these options.
    const qGross = window.confirm('Print Gross Weight & Dane Weight? Click OK for Yes, Cancel for No.');
    askGrossDane = qGross ? 'Y' : 'N';
    const qPacking = window.confirm('Print Packing? Click OK for Yes, Cancel for No.');
    askPacking = qPacking ? 'Y' : 'N';
    setPrintGrossDane(askGrossDane);
    setPrintPacking(askPacking);

    setBillPrintParams({
      type: String(typ).trim(),
      billNo: String(billNoFromRow).trim(),
      bType: String(bTypeFromRow).trim(),
      oracleDt,
      printGrossDane: askGrossDane,
      printPacking: askPacking,
      label: `Sale bill — ${typ} / ${billNoFromRow} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!type) {
      alert('Please select type.');
      return;
    }

    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        type: String(type).trim().toUpperCase(),
      };
      if (bType.trim()) params.b_type = bType.trim();
      let bnS = billNoStart.trim();
      let bnE = billNoEnd.trim();
      if (bnS && !bnE) bnE = bnS;
      if (bnE && !bnS) bnS = bnE;
      if (bnS && bnE) {
        params.bill_no_from = bnS;
        params.bill_no_to = bnE;
      }
      let dS = billDateStart.trim();
      let dE = billDateEnd.trim();
      if (dS && !dE) dE = dS;
      if (dE && !dS) dS = dE;
      if (dS && dE) {
        params.bill_date_from = toOracleDate(dS);
        params.bill_date_to = toOracleDate(dE);
      }
      if (selectedMcode.trim()) params.mcode = selectedMcode.trim();

      const { data } = await axios.get(`${apiBase}/api/sale-bill-printing-list`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) {
        alert('No matching sale bills found. Change filters and try again.');
        return;
      }
      setRows(list);
      setShowReport(true);
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Request failed';
      alert('Error: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  if (showReport && rows.length > 0) {
    return (
      <div className="slide slide-report">
        <SaleBillPrintModal
          open={billPrintOpen}
          onClose={() => {
            setBillPrintOpen(false);
            setBillPrintParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={billPrintParams}
          companyName={compName}
        />
        <div className="report-toolbar">
          <h2>Sale Bill Printing</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Type</strong> {type}
            {(() => {
              let bnS = billNoStart.trim();
              let bnE = billNoEnd.trim();
              if (bnS && !bnE) bnE = bnS;
              if (bnE && !bnS) bnS = bnE;
              if (!bnS || !bnE) return null;
              return (
                <>
                  {' · '}
                  <strong>Bill no</strong> {bnS === bnE ? bnS : `${bnS}–${bnE}`}
                </>
              );
            })()}
            {bType.trim() ? (
              <>
                {' · '}
                <strong>B type</strong> {bType.trim()}
              </>
            ) : null}
            {(() => {
              let dS = billDateStart.trim();
              let dE = billDateEnd.trim();
              if (dS && !dE) dE = dS;
              if (dE && !dS) dS = dE;
              if (!dS || !dE) return null;
              const ds = toDisplayDate(dS);
              const de = toDisplayDate(dE);
              return (
                <>
                  {' · '}
                  <strong>Bill date</strong> {ds === de ? ds : `${ds}–${de}`}
                </>
              );
            })()}
            {' · '}
            <strong>Print Gross/Dane</strong> {printGrossDane}
            {' · '}
            <strong>Print Packing</strong> {printPacking}
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Click a row to open full printable sale bill.
          </p>
        </div>

        <div className="report-display">
          <div className="table-responsive table-responsive--bill-ledger">
            <table className="report-table report-table--bill-ledger report-table--sale-bill-printing-list">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>B type</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City</th>
                  <th className="text-right">Total tax</th>
                  <th className="text-right">Bill amt</th>
                </tr>
              </thead>
              <tbody>
                {printingListSorted.map((row) => (
                  <tr
                    key={`${row.TYPE ?? row.type}-${toInputDateString(row.BILL_DATE ?? row.bill_date)}-${row.BILL_NO ?? row.bill_no}-${row.B_TYPE ?? row.b_type}-${row.CODE ?? row.code}`}
                    className="clickable-row"
                    onClick={() => openSaleBill(row)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openSaleBill(row);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td>{row.TYPE ?? row.type ?? '—'}</td>
                    <td>{toDisplayDate(toInputDateString(row.BILL_DATE ?? row.bill_date))}</td>
                    <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                    <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                    <td>{row.CODE ?? row.code ?? '—'}</td>
                    <td>{row.NAME ?? row.name ?? '—'}</td>
                    <td>{row.CITY ?? row.city ?? '—'}</td>
                    <td className="text-right">
                      {(parseFloat(row.TOTAL_TAX ?? row.total_tax ?? 0) || 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="text-right">
                      {(parseFloat(row.BILL_AMT ?? row.bill_amt ?? 0) || 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-8">
      <h2>Sale Bill Printing</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Choose <strong>TYPE</strong> and optional filters: bill no / bill date ranges (enter only the starting value to use a single bill no or single day). You can
          also select a specific party by code, name, or city.
        </span>
      </p>

      {lookupError ? (
        <div className="form-api-error" role="alert">
          <strong>Could not load party list.</strong> {lookupError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>
        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-type">TYPE</label>
            <select id="sbp-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="SL">SL</option>
              <option value="SE">SE</option>
              <option value="CN">CN</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sbp-b-type">B type</label>
            <input
              id="sbp-b-type"
              type="text"
              className="form-input"
              value={bType}
              onChange={(e) => setBType(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-bill-no-start">Starting bill no</label>
            <input
              id="sbp-bill-no-start"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={billNoStart}
              onChange={(e) => {
                const v = e.target.value;
                setBillNoStart(v);
                setBillNoEnd((end) => (String(end).trim() ? end : v));
              }}
              placeholder="Optional"
              title="If ending bill no is empty, it is set the same as starting"
            />
          </div>
          <div className="form-group">
            <label htmlFor="sbp-bill-no-end">Ending bill no</label>
            <input
              id="sbp-bill-no-end"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={billNoEnd}
              onChange={(e) => setBillNoEnd(e.target.value)}
              placeholder="Optional"
              title="Leave blank to use the same as starting bill no"
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-bill-date-start">Starting bill date</label>
            <input
              id="sbp-bill-date-start"
              type="date"
              lang="en-GB"
              className="form-input"
              value={billDateStart}
              onChange={(e) => {
                const v = e.target.value;
                setBillDateStart(v);
                setBillDateEnd((end) => (String(end).trim() ? end : v));
              }}
              title="If ending bill date is empty, it is set the same as starting"
            />
          </div>
          <div className="form-group">
            <label htmlFor="sbp-bill-date-end">Ending bill date</label>
            <input
              id="sbp-bill-date-end"
              type="date"
              lang="en-GB"
              className="form-input"
              value={billDateEnd}
              onChange={(e) => setBillDateEnd(e.target.value)}
              title="Leave blank to use the same as starting bill date"
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-print-gross-dane">Print Gross Weight &amp; Dane Weight</label>
            <select id="sbp-print-gross-dane" value={printGrossDane} onChange={(e) => setPrintGrossDane(e.target.value)}>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sbp-print-packing">Print Packing</label>
            <select id="sbp-print-packing" value={printPacking} onChange={(e) => setPrintPacking(e.target.value)}>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </div>
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="sbp-party-search">Specific party (optional) — search by code, name, city</label>
          <input
            id="sbp-party-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search code, name, city..."
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedMcode) return;
              const max = Math.max(0, filteredParties.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredParties.length === 0) return;
                setPartyHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPartyHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredParties[safePartyHi];
                if (r) {
                  e.preventDefault();
                  setSelectedMcode(String(r.CODE ?? r.code ?? '').trim());
                  setPartySearch('');
                }
              }
            }}
          />
          {selectedMcode ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedMcode}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedMcode('');
                  setPartySearch('');
                }}
              >
                Clear
              </button>
            </p>
          ) : (
            <div className="account-search-results party-search-results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">
                  {partySearch.trim() ? 'No matches found.' : 'Type to search or leave empty for all parties.'}
                </div>
              ) : (
                filteredParties.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safePartyHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setPartyHi(index)}
                      onClick={() => {
                        setSelectedMcode(String(code).trim());
                        setPartySearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                      <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, partySearch)}</span>
                      <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : '📄 Show Bills'}
          </button>
        </div>
      </form>
    </div>
  );
}
