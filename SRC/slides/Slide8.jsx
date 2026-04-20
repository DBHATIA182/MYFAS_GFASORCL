import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
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

export default function Slide8({ apiBase, formData, onPrev, onReset }) {
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [lookupError, setLookupError] = useState('');

  const [partySearch, setPartySearch] = useState('');
  const [brokerSearch, setBrokerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [brokerHi, setBrokerHi] = useState(0);
  const [itemHi, setItemHi] = useState(0);

  const [selectedMcode, setSelectedMcode] = useState('');
  const [selectedBk, setSelectedBk] = useState('');
  const [selectedItem, setSelectedItem] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const lookupRequestSeqRef = useRef(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const sRaw = formData.comp_s_dt ?? formData.COMP_S_DT;
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const s = toInputDateString(sRaw);
    const e = toInputDateString(eRaw);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    const requestSeq = ++lookupRequestSeqRef.current;

    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        if (startDate && endDate) {
          params.s_date = toOracleDate(startDate);
          params.e_date = toOracleDate(endDate);
        }
        const [pr, br, it] = await Promise.all([
          axios.get(`${apiBase}/api/salelist-parties`, { params }),
          axios.get(`${apiBase}/api/salelist-brokers`, { params }),
          axios.get(`${apiBase}/api/salelist-items`, { params }),
        ]);

        // Ignore stale responses from older requests (prevents full-list overwrite).
        if (requestSeq !== lookupRequestSeqRef.current) return;

        const pList = Array.isArray(pr.data) ? pr.data : [];
        const bList = Array.isArray(br.data) ? br.data : [];
        const iList = Array.isArray(it.data) ? it.data : [];
        setParties(pList);
        setBrokers(bList);
        setItems(iList);

        setSelectedMcode((prev) => {
          if (!prev) return prev;
          const ok = pList.some((p) => String(p.CODE ?? p.code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
        setSelectedBk((prev) => {
          if (!prev) return prev;
          const ok = bList.some((b) => String(b.CODE ?? b.code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
        setSelectedItem((prev) => {
          if (!prev) return prev;
          const ok = iList.some((r) => String(r.ITEM_CODE ?? r.item_code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
      } catch (err) {
        // Ignore stale errors from older requests.
        if (requestSeq !== lookupRequestSeqRef.current) return;

        console.error('Sale list lookups:', err);
        const st = err.response?.status;
        setLookupError(
          st === 404
            ? `No /api/salelist-* routes on ${formatApiOrigin(apiBase)}. Run \`npm run server\` (port 5001) with the latest server.cjs, then refresh.`
            : err.response?.data?.error || err.message || 'Request failed'
        );
      }
    };
    load();
  }, [apiBase, compCode, compUid, startDate, endDate]);

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

  const filteredBrokers = useMemo(() => {
    const q = brokerSearch.trim().toLowerCase();
    if (!q) return brokers.slice(0, 150);
    return brokers.filter((b) => {
      const code = String(b.CODE ?? b.code ?? '').toLowerCase();
      const name = String(b.NAME ?? b.name ?? '').toLowerCase();
      const city = String(b.CITY ?? b.city ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [brokers, brokerSearch]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 150);
    return items.filter((row) => {
      const code = String(row.ITEM_CODE ?? row.item_code ?? '').toLowerCase();
      const name = String(row.ITEM_NAME ?? row.item_name ?? '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [items, itemSearch]);

  useEffect(() => {
    setPartyHi(0);
  }, [partySearch]);
  useEffect(() => {
    setBrokerHi(0);
  }, [brokerSearch]);
  useEffect(() => {
    setItemHi(0);
  }, [itemSearch]);

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const safeBrokerHi = Math.min(brokerHi, Math.max(0, filteredBrokers.length - 1));
  const safeItemHi = Math.min(itemHi, Math.max(0, filteredItems.length - 1));

  const partyListEmptyHint = partySearch.trim()
    ? 'No matches — try different letters.'
    : 'Type to search or leave empty for all parties.';

  const brokerListEmptyHint = brokerSearch.trim()
    ? 'No matches — try different letters.'
    : 'Type to search or leave empty for all brokers.';

  const itemListEmptyHint = itemSearch.trim()
    ? 'No matches — try different letters.'
    : 'Type to search or leave empty for all items.';

  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code) === String(selectedMcode));
  const selectedBrokerRow = brokers.find((b) => String(b.CODE ?? b.code) === String(selectedBk));
  const selectedItemRow = items.find((r) => String(r.ITEM_CODE ?? r.item_code) === String(selectedItem));

  const openSaleBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const billNo = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bType = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || billNo == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    setBillPrintParams({
      type: String(typ).trim(),
      billNo: String(billNo).trim(),
      bType: String(bType).trim(),
      oracleDt,
      label: `Sale bill — ${typ} / ${billNo} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('Please set starting and ending dates.');
      return;
    }
    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(startDate),
        e_date: toOracleDate(endDate),
      };
      if (selectedMcode.trim()) params.mcode = selectedMcode.trim();
      if (selectedBk.trim()) params.bk_code = selectedBk.trim();
      if (selectedItem.trim()) params.item_code = selectedItem.trim();

      const { data } = await axios.get(`${apiBase}/api/sale-list`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert('No rows returned. Widen the date range or clear filters.');
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
    endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    partyLabel: selectedMcode
      ? `${selectedMcode} — ${selectedPartyRow?.NAME ?? ''}`
      : 'All parties',
    brokerLabel: selectedBk ? `${selectedBk} — ${selectedBrokerRow?.NAME ?? ''}` : 'All brokers',
    itemLabel: selectedItem
      ? `${selectedItem} — ${selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? ''}`
      : 'All items',
  };

  const downloadPDF = () => generatePDF('sale-list', reportData, pdfMeta);

  const shareWhatsApp = () => {
    const shareText = [
      `Sale list — ${compName}`,
      `${compYear} | ${pdfMeta.endDate}`,
      pdfMeta.partyLabel,
      pdfMeta.brokerLabel,
      pdfMeta.itemLabel,
    ].join('\n');
    return sharePdfWithWhatsApp('sale-list', reportData, pdfMeta, shareText);
  };

  if (showReport && reportData.length > 0) {
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
          <h2>Sale list</h2>
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
                  downloadExcelRows(reportData, 'SaleList', `${compName}_SaleList`);
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
            <strong>Dates</strong> {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
            {' · '}
            <strong>Party</strong> {pdfMeta.partyLabel}
            {' · '}
            <strong>Broker</strong> {pdfMeta.brokerLabel}
            {' · '}
            <strong>Item</strong> {pdfMeta.itemLabel}
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Types SL, SE, CN — click a detail row to open the printable sale bill (tax invoice / bill of supply). Day totals, then item-wise QNTY / WEIGHT / AMOUNT, then grand total (all measures).
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={reportData} type="sale-list" onSaleBillClick={openSaleBill} />
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
    <div className="slide slide-8">
      <h2>Sale list</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Report uses types <strong>SL, SE, CN</strong>. Help lists now show full master/item lists (not date-filtered): parties from
          <code>MASTER</code>, brokers from <code>MASTER</code> (codes starting with B), and items from <code>ITEMMAST</code>.
          Click a report row to open the printable sale bill.
        </span>
      </p>

      {lookupError ? (
        <div className="form-api-error" role="alert">
          <strong>Could not load help lists.</strong> {lookupError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : '📊 Run report'}
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="sl-start">Starting date</label>
          <input
            id="sl-start"
            type="date"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="sl-end">Ending date</label>
          <input
            id="sl-end"
            type="date"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        {/* Party MCODE */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-party-search">Specific party (MCODE) — optional</label>
          <input
            id="sl-party-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search party name, city, or code…"
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
                <div className="account-search-empty">{partyListEmptyHint}</div>
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

        {/* Broker */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-broker-search">Specific broker (BK_CODE) — optional</label>
          <input
            id="sl-broker-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search broker…"
            value={brokerSearch}
            onChange={(e) => setBrokerSearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedBk) return;
              const max = Math.max(0, filteredBrokers.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredBrokers.length === 0) return;
                setBrokerHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setBrokerHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredBrokers[safeBrokerHi];
                if (r) {
                  e.preventDefault();
                  setSelectedBk(String(r.CODE ?? r.code ?? '').trim());
                  setBrokerSearch('');
                }
              }
            }}
          />
          {selectedBk ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedBrokerRow?.NAME ?? '—'}</strong> (<code>{selectedBk}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedBk('');
                  setBrokerSearch('');
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
              {filteredBrokers.length === 0 ? (
                <div className="account-search-empty">{brokerListEmptyHint}</div>
              ) : (
                filteredBrokers.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safeBrokerHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setBrokerHi(index)}
                      onClick={() => {
                        setSelectedBk(String(code).trim());
                        setBrokerSearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, brokerSearch)}</span>
                      <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, brokerSearch)}</span>
                      <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Item */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-item-search">Specific item (ITEM_CODE) — optional</label>
          <input
            id="sl-item-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search item name or code…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedItem) return;
              const max = Math.max(0, filteredItems.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredItems.length === 0) return;
                setItemHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setItemHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredItems[safeItemHi];
                if (r) {
                  e.preventDefault();
                  setSelectedItem(String(r.ITEM_CODE ?? r.item_code ?? '').trim());
                  setItemSearch('');
                }
              }
            }}
          />
          {selectedItem ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? '—'}</strong> (
              <code>{selectedItem}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedItem('');
                  setItemSearch('');
                }}
              >
                Clear
              </button>
            </p>
          ) : (
            <div className="account-search-results broker-search-results" role="listbox">
              <div className="account-search-header broker-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
              </div>
              {filteredItems.length === 0 ? (
                <div className="account-search-empty">{itemListEmptyHint}</div>
              ) : (
                filteredItems.map((row, index) => {
                  const code = row.ITEM_CODE ?? row.item_code;
                  const rowHi = safeItemHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      className={`account-search-row broker-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setItemHi(index)}
                      onClick={() => {
                        setSelectedItem(String(code).trim());
                        setItemSearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, itemSearch)}</span>
                      <span className="account-search-name">
                        {highlightMatch(row.ITEM_NAME ?? row.item_name, itemSearch)}
                      </span>
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
            {loading ? '⏳ Loading…' : '📊 Run report'}
          </button>
        </div>
      </form>
    </div>
  );
}
