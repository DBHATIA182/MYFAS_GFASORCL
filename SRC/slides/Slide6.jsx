import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';

const DEFAULT_HISTORY_START_DATE = '2001-04-01';

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

export default function Slide6({ apiBase, onPrev, onReset, formData }) {
  const [parties, setParties] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [mco, setMco] = useState('A');
  const [billStart, setBillStart] = useState('');
  const [billEnd, setBillEnd] = useState('');
  const [payEndDate, setPayEndDate] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const partySearchInputRef = useRef(null);
  const billStartInputRef = useRef(null);
  const [listHighlight, setListHighlight] = useState(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const e = toInputDateString(eRaw);
    setBillStart(DEFAULT_HISTORY_START_DATE);
    if (e) {
      setBillEnd(e);
      setPayEndDate(e);
    }
  }, [
    formData.comp_s_dt,
    formData.comp_e_dt,
    formData.COMP_S_DT,
    formData.COMP_E_DT,
  ]);

  useEffect(() => {
    const load = async () => {
      if (!compCode || !compUid) return;
      try {
        const { data } = await axios.get(`${apiBase}/api/bill-ledger-parties`, {
          params: { comp_code: compCode, comp_uid: compUid },
        });
        setParties(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Bill ledger parties:', err);
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

  useEffect(() => {
    setListHighlight(0);
  }, [partySearch]);

  const accountListMaxIdx = Math.max(0, filteredParties.length - 1);
  const safeHighlight = Math.min(listHighlight, accountListMaxIdx);

  const focusBillStart = () => {
    setTimeout(() => {
      const el = billStartInputRef.current;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const selectParty = (row) => {
    setSelectedCode(String(row.CODE ?? row.code ?? '').trim());
    setPartySearch('');
    focusBillStart();
  };

  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code) === String(selectedCode));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCode) {
      alert('Please select a party (search and pick from the list).');
      return;
    }
    if (!billStart || !billEnd || !payEndDate) {
      alert('Please set bill date range and payment ending date.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/bill-ledger`, {
        params: {
          comp_code: compCode,
          code: selectedCode,
          s_date: toOracleDate(billStart),
          e_date: toOracleDate(billEnd),
          p_edt: toOracleDate(payEndDate),
          mco,
          comp_uid: compUid,
        },
        withCredentials: true,
        timeout: 60000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert(
          'No rows returned from BILLS for this party and dates.\n\n' +
            'The desktop “Ledger” report usually reads the LEDGER table; this report reads BILLS (bill-wise). ' +
            'If vouchers exist only in LEDGER, widen dates or check that sales/purchase lines are in BILLS with expected VR_TYPE (e.g. SL, BV, JV).'
        );
      } else {
        setReportData(rows);
        setShowReport(true);
      }
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const pdfMeta = {
    companyName: compName,
    year: compYear,
    partyName: selectedPartyRow?.NAME ?? selectedPartyRow?.name ?? '',
    partyCode: String(selectedCode),
    endDate: `${toDisplayDate(billStart)} – ${toDisplayDate(billEnd)}`,
    payEndDate: toDisplayDate(payEndDate),
    filterLabel: mco === 'O' ? 'Outstanding bills only' : 'All bills',
  };

  const downloadPDF = () =>
    generatePDF('bill-ledger', reportData, pdfMeta);

  const shareWhatsApp = () => {
    const shareText = [
      `Bill-wise ledger — ${compName}`,
      `${compYear} | ${selectedPartyRow?.NAME ?? selectedCode} (${selectedCode})`,
      `Bills: ${toDisplayDate(billStart)} – ${toDisplayDate(billEnd)} | Pay to: ${toDisplayDate(payEndDate)}`,
      mco === 'O' ? 'Filter: Outstanding' : 'Filter: All',
    ].join('\n');
    return sharePdfWithWhatsApp('bill-ledger', reportData, pdfMeta, shareText);
  };

  if (showReport && reportData.length > 0) {
    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>Bill-wise ledger</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => downloadPDF().catch((err) => alert(err?.message || String(err)))}
            >
              📥 Download PDF
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(reportData, 'BillLedger', `${compName}_BillLedger_${selectedCode}`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              onClick={() => shareWhatsApp().catch((err) => alert(err?.message || String(err)))}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>{selectedPartyRow?.NAME ?? 'Party'}</strong> ({selectedCode})
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Bills {toDisplayDate(billStart)} – {toDisplayDate(billEnd)} · Payment cut-off {toDisplayDate(payEndDate)}
            <br />
            {mco === 'O' ? 'Outstanding only' : 'All bills'}
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={reportData} type="bill-ledger" />
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Modify
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Start Over
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-6">
      <h2>Bill-wise ledger — parameters</h2>

      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Search party (customers / suppliers per schedule 8–9 and 11.10). Bill dates and payment ending date match
          your legacy report prompts.
        </span>
      </p>

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Show Report'}
          </button>
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="party-search">Search party</label>
          <input
            id="party-search"
            ref={partySearchInputRef}
            type="search"
            autoComplete="off"
            placeholder="Code, name, or city… (↑↓ Enter)"
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedCode) return;
              const max = Math.max(0, filteredParties.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredParties.length === 0) return;
                setListHighlight((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setListHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const row = filteredParties[safeHighlight];
                if (row) {
                  e.preventDefault();
                  selectParty(row);
                }
              }
            }}
            className="form-input"
          />
          {selectedCode ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedCode}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedCode('');
                  setPartySearch('');
                  setListHighlight(0);
                  setTimeout(() => partySearchInputRef.current?.focus(), 0);
                }}
              >
                Clear
              </button>
            </p>
          ) : null}
          {!selectedCode ? (
            <div className="account-search-results party-search-results" role="listbox" aria-label="Matching parties">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">No parties match your search.</div>
              ) : (
                filteredParties.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safeHighlight === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      aria-selected={rowHi}
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setListHighlight(index)}
                      onClick={() => selectParty(row)}
                    >
                      <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                      <span className="account-search-name" title={row.NAME ?? row.name}>
                        {highlightMatch(row.NAME ?? row.name, partySearch)}
                      </span>
                      <span className="account-search-city" title={row.CITY ?? row.city ?? ''}>
                        {row.CITY ?? row.city ?? '—'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>

        <div className="form-group">
          <span className="form-label-block">Transactions</span>
          <div className="radio-row">
            <label className="radio-inline">
              <input type="radio" name="mco" value="A" checked={mco === 'A'} onChange={() => setMco('A')} />
              All (A)
            </label>
            <label className="radio-inline">
              <input type="radio" name="mco" value="O" checked={mco === 'O'} onChange={() => setMco('O')} />
              Outstanding only (O)
            </label>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="bill-start">Bill start date (DD-MM-YYYY via calendar)</label>
          <input
            id="bill-start"
            ref={billStartInputRef}
            type="date"
            lang="en-GB"
            className="form-input"
            value={billStart}
            onChange={(e) => setBillStart(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="bill-end">Bill end date</label>
          <input
            id="bill-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={billEnd}
            onChange={(e) => setBillEnd(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="pay-end">Payment ending date (voucher cut-off for CV/BV/JV)</label>
          <input
            id="pay-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={payEndDate}
            onChange={(e) => setPayEndDate(e.target.value)}
          />
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : '📊 Generate report'}
          </button>
        </div>
      </form>
    </div>
  );
}
