import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import ReportHelpButton from '../components/ReportHelpButton';
import ReportToolbarActions from '../components/ReportToolbarActions';
import FasReportHeader from '../components/FasReportHeader';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import {
  filterCodeNameCityRows,
  filterItemCodeNameRows,
  SEARCH_NO_MATCH,
} from '../utils/masterSearchFilter';
import '../styles/saleListScreen.css';

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

const SL_FIELD_FOCUS_ORDER = ['sl-start', 'sl-end', 'sl-party-search', 'sl-broker-search', 'sl-item-search'];

function focusNextSlField(currentId) {
  const idx = SL_FIELD_FOCUS_ORDER.indexOf(currentId);
  if (idx === -1 || idx >= SL_FIELD_FOCUS_ORDER.length - 1) return;
  document.getElementById(SL_FIELD_FOCUS_ORDER[idx + 1])?.focus();
}

function SaleListFormShell({ className = '', header, footer = null, children }) {
  return (
    <div className={`slide slide-8 fas-tb-host${className ? ` ${className}` : ''}`}>
      <div className="fas-flow fas-tb-flow fas-tb-flow--form-app">
        <div className="fas-ledger-sticky-top">{header}</div>
        <div className="fas-flow-body fas-tb-body fas-tb-body--form-scroll">{children}</div>
        {footer ? <div className="fas-tb-form-footer-bar">{footer}</div> : null}
      </div>
    </div>
  );
}

export default function Slide8({ apiBase, formData, onPrev, onReset, viewMode = 'desktop' }) {
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
  const [saleSortMode, setSaleSortMode] = useState('date');

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const lookupRequestSeqRef = useRef(0);
  const saleChartDrillRanRef = useRef(null);

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

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );

  const filteredBrokers = useMemo(
    () => filterCodeNameCityRows(brokers, brokerSearch, 50),
    [brokers, brokerSearch]
  );

  const filteredItems = useMemo(
    () => filterItemCodeNameRows(items, itemSearch, 50),
    [items, itemSearch]
  );

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

  useEffect(() => {
    const d = formData.saleChartDrilldown;
    if (!d?.autoRun || !d.startDate || !d.endDate) return;
    const runKey = String(d.at ?? `${d.startDate}-${d.endDate}-${d.itemCode || ''}`);
    if (saleChartDrillRanRef.current === runKey) return;
    saleChartDrillRanRef.current = runKey;

    setStartDate(d.startDate);
    setEndDate(d.endDate);
    if (d.itemCode) {
      setSelectedItem(String(d.itemCode).trim());
      if (d.itemName) setItemSearch(String(d.itemName).trim());
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(d.startDate),
          e_date: toOracleDate(d.endDate),
        };
        if (d.itemCode) params.item_code = String(d.itemCode).trim();
        const { data } = await axios.get(`${apiBase}/api/sale-list`, {
          params,
          withCredentials: true,
          timeout: 120000,
        });
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          alert('No rows returned for this chart selection.');
        } else {
          setReportData(rows);
          setSaleSortMode('date');
          setShowReport(true);
        }
      } catch (error) {
        if (!cancelled) alert('Error: ' + (error.response?.data?.error || error.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formData.saleChartDrilldown, apiBase, compCode, compUid]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
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
        setSaleSortMode('date');
        setShowReport(true);
      }
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFormKeyDown = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (
      target.id === 'sl-party-search' ||
      target.id === 'sl-broker-search' ||
      target.id === 'sl-item-search'
    ) {
      return;
    }
    e.preventDefault();
    focusNextSlField(target.id);
  };

  const isDesktopView = viewMode === 'desktop';

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
    const saleSortLabel =
      saleSortMode === 'party' ? 'Party-wise' : saleSortMode === 'item' ? 'Item-wise' : saleSortMode === 'broker' ? 'Broker-wise' : 'Date-wise';
    return (
      <div className="slide slide-report sale-list-screen sale-list-screen--report">
        <div className="sale-list-screen__scroll">
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
          <ReportToolbarActions
            reportId="sale-list"
            helpProps={{ includeSalesEntry: false, includeStockLot: true, appName: 'GRAINFAS' }}
            onBack={() => setShowReport(false)}
            onPdf={() => downloadPDF().catch((err) => alert(err?.message || String(err)))}
            onExcel={() => {
              try {
                downloadExcelRows(reportData, 'SaleList', `${compName}_SaleList`);
              } catch (e) {
                alert(String(e?.message || e));
              }
            }}
            onWhatsApp={() => shareWhatsApp().catch((err) => alert(err?.message || String(err)))}
          />
        </div>

        <div className="report-sort-switch" role="group" aria-label="Sale list sort">
          <span className="report-sort-switch__label">Sort:</span>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'date' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('date')}
          >
            Date
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'party' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('party')}
          >
            Party
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'item' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('item')}
          >
            Item
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'broker' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('broker')}
          >
            Broker
          </button>
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
            Types SL, SE, CN — click a detail row to open the printable sale bill (tax invoice / bill of supply). Current view:{' '}
            <strong>{saleSortLabel}</strong>
            {saleSortMode === 'date'
              ? ' with day totals, item-wise summary, and grand total.'
              : saleSortMode === 'party' || saleSortMode === 'broker'
                ? ' with bill-wise totals and grand total.'
                : ' with grand total at the end.'}
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={reportData} type="sale-list" onSaleBillClick={openSaleBill} saleListSortMode={saleSortMode} />
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>
        </div>
      </div>
    );
  }

  return (
    <SaleListFormShell
      className="fas-tb-host--form"
      footer={
        isDesktopView ? (
          <button
            type="button"
            className="fas-btn fas-btn-primary fas-tb-run-bottom"
            disabled={loading}
            onClick={() => void handleSubmit()}
          >
            {loading ? 'Loading…' : '▶ Run'}
          </button>
        ) : null
      }
      header={
        <FasReportHeader
          title="Sale Bill List"
          onBack={onPrev}
          rightSlot={
            isDesktopView ? (
              <ReportHelpButton
                reportId="sale-list"
                includeSalesEntry={false}
                includeStockLot={true}
                appName="GFASORCL Accounting"
              />
            ) : (
              <button
                type="button"
                className="fas-report-header__run"
                disabled={loading}
                onClick={() => void handleSubmit()}
              >
                {loading ? 'Loading…' : '▶ Run'}
              </button>
            )
          }
        />
      }
    >
      <form
        id="sl-params-form"
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        className="fas-tb-form-shell fas-slb-form-shell"
      >
        <TrialBalanceSessionCard compact formData={formData} helpReportId="sale-list" />

        {lookupError ? (
          <div className="form-api-error fas-slb-form__lookup-error" role="alert">
            <strong>Lookups:</strong> {lookupError}
          </div>
        ) : null}

        <div className="fas-slb-form__grid">
          <div className="fas-field-group">
            <div className="fas-field-label">From date</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="sl-start"
                type="date"
                lang="en-GB"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="fas-field-group">
            <div className="fas-field-label">To date</div>
            <div className="fas-field-input fas-tb-date-field">
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <input
                id="sl-end"
                type="date"
                lang="en-GB"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="fas-field-group fas-slb-form__search">
            <div className="fas-field-label">Party (MCODE)</div>
            <div className="fas-field-input">
              <input
                id="sl-party-search"
                type="search"
                autoComplete="off"
                placeholder="Code, name, city…"
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
                    e.preventDefault();
                    const r = filteredParties[safePartyHi];
                    if (r) {
                      setSelectedMcode(String(r.CODE ?? r.code ?? '').trim());
                      setPartySearch('');
                    }
                    focusNextSlField('sl-party-search');
                  }
                }}
              />
            </div>
            {selectedMcode ? (
              <p className="account-selected-hint">
                <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedMcode}</code>)
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
            ) : partySearch.trim() ? (
              <div className="account-search-results party-search-results" role="listbox">
                {filteredParties.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
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
            ) : null}
          </div>

          <div className="fas-field-group fas-slb-form__search">
            <div className="fas-field-label">Broker (BK_CODE)</div>
            <div className="fas-field-input">
              <input
                id="sl-broker-search"
                type="search"
                autoComplete="off"
                placeholder="Code, name, city…"
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
                    e.preventDefault();
                    const r = filteredBrokers[safeBrokerHi];
                    if (r) {
                      setSelectedBk(String(r.CODE ?? r.code ?? '').trim());
                      setBrokerSearch('');
                    }
                    focusNextSlField('sl-broker-search');
                  }
                }}
              />
            </div>
            {selectedBk ? (
              <p className="account-selected-hint">
                <strong>{selectedBrokerRow?.NAME ?? '—'}</strong> (<code>{selectedBk}</code>)
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
            ) : brokerSearch.trim() ? (
              <div className="account-search-results party-search-results" role="listbox">
                {filteredBrokers.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredBrokers.map((row, index) => {
                    const code = row.CODE ?? row.code;
                    const rowHi = safeBrokerHi === index;
                    return (
                      <button
                        key={String(code)}
                        type="button"
                        role="option"
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
            ) : null}
          </div>

          <div className="fas-field-group fas-slb-form__span-full fas-slb-form__search">
            <div className="fas-field-label">Item (ITEM_CODE)</div>
            <div className="fas-field-input">
              <input
                id="sl-item-search"
                type="search"
                autoComplete="off"
                placeholder="Item code or name…"
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
                    e.preventDefault();
                    const r = filteredItems[safeItemHi];
                    if (r) {
                      setSelectedItem(String(r.ITEM_CODE ?? r.item_code ?? '').trim());
                      setItemSearch('');
                    }
                  }
                }}
              />
            </div>
            {selectedItem ? (
              <p className="account-selected-hint">
                <strong>{selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? '—'}</strong> (
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
            ) : itemSearch.trim() ? (
              <div className="account-search-results broker-search-results" role="listbox">
                {filteredItems.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredItems.map((row, index) => {
                    const code = row.ITEM_CODE ?? row.item_code;
                    const rowHi = safeItemHi === index;
                    return (
                      <button
                        key={String(code)}
                        type="button"
                        role="option"
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
            ) : null}
          </div>
        </div>

        {!isDesktopView ? (
          <div className="button-group">
            <button type="button" className="btn btn-secondary" onClick={onPrev}>
              ← Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Loading…' : 'Run'}
            </button>
          </div>
        ) : null}
      </form>
    </SaleListFormShell>
  );
}
