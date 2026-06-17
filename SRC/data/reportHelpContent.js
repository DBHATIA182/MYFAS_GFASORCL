/** In-app and PDF user help for reports and modules. */

import { getDefaultAppName } from '../utils/gfasBrand';

export const APP_HELP_NAMES = {
  gfasorcl: getDefaultAppName(),
  grainfas: getDefaultAppName(),
};

function section(title, bullets) {
  return { title, bullets: bullets.filter(Boolean) };
}

export const REPORT_HELP = {
  'reports-menu': {
    title: 'Reports & Modules',
    summary: 'Main menu after you select company and financial year.',
    sections: [
      section('How to open a report', [
        'All modules start collapsed.',
        'Climage.png name to open it immediately (Next is optional).',
        'Use ↑ / ↓ to highlight a report, then Enter to open it.',
      ]),
      section('Modules', [
        '1 Final Accounts — Trial Balance, Trading A/C, P&L, Balance Sheet',
        '2 Ledger — Account ledger, interest, customer/supplier, overdue, broker, ageing',
        '3 Stock — Stock sum, stock lot wise, HSN sales/purchase',
        '4 Sales — Bill printing, sale list, sale chart, GSTR-1',
        '5 Purchase — Purchase list',
        '6 Voucher — Voucher list',
        '7 Master — Schedules, accounts, items, users, godown & more',
        '8 Utilities — Change year/company/user, transfers, installation (from VFP UTILITIES menu)',
      ]),
    ],
  },

  'trial-balance': {
    title: 'Trial Balance',
    summary: 'Account balances as of a date, with optional schedule filter.',
    sections: [
      section('Parameters', [
        'Set As-of (ending) date — required.',
        'Schedule: 0 = all schedules; or enter a schedule number to filter.',
        'Run Report to load balances.',
      ]),
      section('On the report', [
        'Each row is an account with opening, debit, credit, and closing balances.',
        'Export: Pdf, Excel, or WhatsApp from the toolbar.',
      ]),
      section('Drill-down (important)', [
        'Click any account row → opens Ledger for that account (full financial year from company dates).',
        'On Ledger: click a transaction row → opens full Voucher (all ledger lines for that voucher).',
        'On some ledger lines: Sale Bill print may open when the voucher is mapped to a sale bill.',
        'Use ← Back to return: Voucher → Ledger → Trial Balance.',
      ]),
    ],
    views: {
      ledger: {
        title: 'Ledger (from Trial Balance)',
        bullets: [
          'Opened from a trial row; period is company FY start to end.',
          'Click a line to see voucher detail; sale bill icon/click where available.',
          '← Back to Trial Balance returns to the trial list.',
        ],
      },
      voucher: {
        title: 'Voucher detail',
        bullets: [
          'Shows all ledger lines for one voucher (type, date, number).',
          '← Back returns to the ledger you came from.',
        ],
      },
    },
  },

  'complete-ledger': {
    title: 'Complete Ledger',
    summary: 'Ledger for every account in a code range, with optional schedule filter.',
    sections: [
      section('Parameters', [
        'Starting and ending dates, optional specific schedule no. (help list from SCHEDULE), starting and ending account codes.',
        'Voucher wise total works like the single-account ledger report.',
      ]),
      section('On screen', [
        'One ledger section per account in the selected range.',
        'Click a row → Voucher detail; sale bill print on supported lines.',
        'Pdf / Excel / WhatsApp export the full multi-account report.',
      ]),
    ],
    views: {
      voucher: {
        title: 'Voucher (from Complete Ledger)',
        bullets: ['Full voucher lines. ← Back returns to complete ledger.'],
      },
    },
  },

  ledger: {
    title: 'Ledger Report',
    summary: 'Detailed transactions for one account over a date range.',
    sections: [
      section('Parameters', [
        'Pick account (code/name search), start and end dates, then Run.',
      ]),
      section('On screen', [
        'Running balance after each line; Dr/Cr amounts and voucher references.',
        'Click a row → Voucher detail for that voucher.',
        'Sale bill print on supported lines.',
        'Pdf / Excel / WhatsApp from toolbar.',
      ]),
    ],
    views: {
      voucher: {
        title: 'Voucher (from Ledger)',
        bullets: ['Full voucher lines. ← Back returns to ledger.'],
      },
    },
  },

  'ledger-interest': {
    title: 'Ledger With Interest',
    summary: 'Same as ledger plus interest columns (rate, grace days, interest date).',
    sections: [
      section('Use', [
        'Set interest rate, grace days, and interest calculation date on the form.',
        'Dr/Cr interest columns appear on the ledger grid.',
        'Click rows for voucher detail like standard ledger.',
      ]),
    ],
  },

  'customer-ledger': {
    title: 'Customer Ledger',
    summary: 'Customer bills with balance per bill (DR − CR).',
    sections: [
      section('Use', [
        'Filter by customer, dates, and options on the form.',
        'Click a bill row where enabled → bill ledger / voucher / sale bill flows.',
        'Export from toolbar when the report is shown.',
      ]),
    ],
  },

  'sale-chart': {
    title: 'Sale Chart',
    summary: 'Month-wise sale weight and amount for the financial year (optional item filter).',
    sections: [
      section('Use', [
        'View bar chart by month; switch between weight and amount.',
        'Filter by item or browse top items when viewing all items.',
        'Click a month bar to open Sale List for that month (and item if selected).',
      ]),
    ],
  },

  'overdue-customers': {
    title: 'Overdue Customers',
    summary: 'Customers with sale bills still pending more than 30 days (bill-wise DR − CR).',
    sections: [
      section('Use', [
        'Lists customers (schedule 8.x) where at least one bill is overdue beyond the minimum days.',
        'Change as-of date, minimum days, or minimum overdue amount, then Refresh.',
        'Tap a customer row to open Customer Ledger; use Back to return to this list.',
      ]),
    ],
  },

  'supplier-ledger': {
    title: 'Supplier Ledger',
    summary: 'Supplier bills with balance per bill (CR − DR).',
    sections: [
      section('Use', [
        'Similar to customer ledger for suppliers.',
        'Drill to detail rows where the screen allows clicks.',
      ]),
    ],
  },

  'broker-os': {
    title: 'Broker OS (Outstanding)',
    summary: 'Broker-wise outstanding from linked sale/purchase bills.',
    sections: [
      section('Use', [
        'Set broker range and as-on date.',
        'Review outstanding per broker; export Pdf/Excel/WhatsApp.',
      ]),
    ],
  },

  ageing: {
    title: 'Ageing Report',
    summary: 'Outstanding in ageing buckets by schedule and day ranges.',
    sections: [
      section('Use', [
        'Choose Ledger or Bills basis, schedules, and bucket days.',
        'Expand rows for party/detail where the grid allows.',
      ]),
    ],
  },

  'stock-sum': {
    title: 'Stock Sum',
    summary: 'Item-wise stock movement and totals.',
    sections: [
      section('Drill-down', [
        'Run with date, godown, and filters.',
        'Click an item row → item detail / lot movement (where implemented).',
        'Further clicks may open stock ledger or entry detail screens.',
      ]),
    ],
  },

  'stock-lot': {
    title: 'Stock Lot Wise',
    summary: 'LOTSTOCK lot-wise position with filters.',
    sections: [
      section('Use', [
        'Filter godown, item, supplier, lot, cost, Complete/Outstanding.',
        'Click rows for lot detail when available.',
      ]),
    ],
  },

  'hsn-sales': {
    title: 'HSN Sales',
    summary: 'HSN-wise GST sales in tabs (date wise, monthly, etc.).',
    sections: [
      section('Use', [
        'Set date range and run.',
        'Switch tabs for different HSN layouts; export from toolbar.',
      ]),
    ],
  },

  'hsn-purchase': {
    title: 'HSN Purchase',
    summary: 'HSN-wise purchase — same tab idea as HSN sales.',
    sections: [
      section('Use', ['Set dates, run report, use tabs and exports.']),
    ],
  },

  'state-wise-sales': {
    title: 'State Wise Sales',
    summary: 'Sales totals grouped by party state (MASTER) and combined GST%.',
    sections: [
      section('Parameters', [
        'Starting date and ending date (defaults from financial year).',
        'Specific state — optional; leave as All states for every state.',
      ]),
      section('Summary', [
        'Grouped by State Code, State, Gst% (CGST% + SGST% + IGST%).',
        'Totals: Qty, Weight, Taxable, CGST, SGST, IGST with GRAND TOTAL row.',
        'Click any state row to open all sale bills for that state and rate.',
      ]),
      section('Detail', [
        'Bill date, bill no, type, party code/name, city, state, qty, weight, taxable, GST amounts.',
        'Click any bill row to open the printable sale bill.',
      ]),
    ],
  },

  'state-wise-purchase': {
    title: 'State Wise Purchase',
    summary: 'Purchase totals grouped by supplier state (MASTER) and combined GST%.',
    sections: [
      section('Parameters', [
        'Starting date and ending date (defaults from financial year).',
        'Specific state — optional; leave as All states for every state.',
      ]),
      section('Summary', [
        'Grouped by State Code, State, Gst% (CGST% + SGST% + IGST%).',
        'Totals: Qty, Weight, Taxable, CGST, SGST, IGST with GRAND TOTAL row.',
        'Click any state row to open all purchase bills for that state and rate.',
      ]),
      section('Detail', [
        'R date, R no, bill date, bill no, type, party code/name, city, state, qty, weight, taxable, GST amounts.',
        'Click any row to open the printable purchase bill.',
      ]),
    ],
  },

  'sale-bill-printing': {
    title: 'Sale Bill Printing',
    summary: 'Find sale bills and open print layout.',
    sections: [
      section('Use', [
        'Search by bill no, party, type, or filters on the form.',
        'Click a row in the list → printable sale bill opens.',
      ]),
    ],
  },

  'sale-list': {
    title: 'Sale Bill List',
    summary: 'Filtered list of sale bills (VFP-style filters).',
    sections: [
      section('Use', [
        'Set TYPE, dates, party, broker, item, plant, etc.',
        'Run list; export Pdf/Excel/WhatsApp.',
        'Click rows only where drill-down is enabled on that screen.',
      ]),
    ],
  },

  gstr1: {
    title: 'GSTR-1',
    summary: 'GST return sheets B2B, B2CL, B2CS, CDNR, exports, HSN, DOCS.',
    sections: [
      section('Use', [
        'Enter period and generate.',
        'Use sheet tabs; export PDF and Excel from toolbar.',
      ]),
    ],
  },

  'sales-order-entry': {
    title: 'Sales Order Entry',
    summary: 'Add, edit, delete sales orders (SORDER type SO).',
    sections: [
      section('Use', [
        'F12 permissions: open/add/edit/delete from your user rights.',
        'Enter party, lines, manual SO number on add; Prev/Next/List/Print on toolbar.',
        'List screen: Pdf, Excel, WhatsApp.',
      ]),
    ],
  },

  'dispatch-challan-entry': {
    title: 'Dispatch Challan Entry',
    summary: 'Dispatch challans (ISSUE type S).',
    sections: [
      section('Use', [
        'Party schedule 11.20; pick pending SO on lines where shown.',
        'Manual challan number on add; save posts issue stock.',
        'List and print screens from action bar.',
      ]),
    ],
  },

  'sale-bill-entry': {
    title: 'Sale Bill Entry',
    summary: 'Sale bills posting SALE, LEDGER, STOCK, BILLS.',
    sections: [
      section('Use', [
        'Add/edit/delete per permissions.',
        'Manual bill no on add; print after save from entry or list.',
      ]),
    ],
  },

  'purchase-list': {
    title: 'Purchase List',
    summary: 'PU/DN purchase lines with filters.',
    sections: [
      section('Use', [
        'DN values show negative.',
        'Filter supplier, item, codes; export from report toolbar.',
        'Click purchase bill print where row action exists.',
      ]),
    ],
  },

  'voucher-list': {
    title: 'Voucher List',
    summary: 'Cash, bank, and journal vouchers in a date range.',
    sections: [
      section('Use', [
        'Set dates, party, cash/bank code, Dr/Cr filter.',
        'Click a row → voucher detail lines.',
        '← Back returns to list.',
      ]),
    ],
    views: {
      voucher: {
        title: 'Voucher detail (from list)',
        bullets: ['All lines for selected voucher. ← Back to list.'],
      },
    },
  },

  'trading-ac': {
    title: 'Trading A/C',
    summary: 'Trading account with sales, purchases, shortages, closing stock.',
    sections: [
      section('Drill-down', [
        'Run with schedule, account, ending date, shortage/closing options.',
        'Click amounts or account rows where highlighted → ledger or detail.',
        'Use ← Back on each nested screen.',
      ]),
    ],
  },

  'pl-profit-loss': {
    title: 'Profit & Loss',
    summary: 'P&L from trading gross plus schedule ≥ 16 balances.',
    sections: [
      section('Use', [
        'Set as-on date and run.',
        'Click ledger-linked rows where enabled → account ledger.',
      ]),
    ],
  },

  'balance-sheet': {
    title: 'Balance Sheet',
    summary: 'Assets vs liabilities with P&L and stock adjustments.',
    sections: [
      section('Drill-down', [
        'Tree of schedules and accounts as on date.',
        'Click account rows → ledger for that account.',
        'From ledger → voucher on line click (same as trial flow).',
      ]),
    ],
  },

  'utilities-module': {
    title: 'Utilities',
    summary: 'System utilities from the legacy VFP Utilities menu (VFP-IMPORT/UTILITIES.txt).',
    sections: [
      section('Live now', [
        'Change Year — opens year selection (Slide 2).',
        'Change Company — opens company selection (Slide 1).',
        'Change User — signs out and returns to login.',
        'New Year Books — prepare a new financial year (VFP DO FORM prepare).',
      ]),
      section('Coming next', [
        'Primary key, set function, multi utilities, transfer utilities, user reports, and installation tools.',
        'Each tile shows the original VFP DO FORM / DO command until the web screen is built.',
      ]),
    ],
  },

  'interest-transfer': {
    title: 'Interest Transfer',
    summary: 'Transfer bill interest balances into JV vouchers (VFP DO FORM INTTRF).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Master Party (F4) rights — Add and Delete as per your user profile.',
        'Opens from Utilities → Multi Utilities → Interest Transfer.',
      ]),
      section('Header', [
        'Schedule 8.10 (customers) or 11.10 (suppliers), ending date, and voucher starting number (≥ 10000).',
        'Transfer debit/credit codes, minimum amount, code range, broker, L/C, and bill type filters.',
        '(D)ebit / (C)redit controls which side is transferred; minimum amount updates when D/C changes.',
      ]),
      section('Proceed & grid', [
        'Click Proceed to load bill balances from BILLS grouped by party and bill.',
        'Select rows with the checkbox column; Select All / Clear All match VFP.',
        'Filter Amount (Refresh) limits rows by absolute closing balance.',
      ]),
      section('Save & delete', [
        'Save writes JV vouchers to VOUCHER, LEDGER, and BILLS for selected rows, with party summary lines to transfer codes.',
        'Delete Prev.Vouchers removes JV rows for the ending date and voucher number range.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'square-up-accounts': {
    title: 'SquareUp Accounts',
    summary: 'Square up small ledger balances into JV vouchers (VFP DO FORM SQUARE).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) rights — Add and Delete as per your user profile.',
        'Opens from Utilities → Multi Utilities → SquareUp Accounts.',
      ]),
      section('Header', [
        'Schedule, ending date, minimum debit/credit amounts, and account code range.',
        'Transfer debit and credit codes (default round-off account).',
        '(D) / (C) / (B) is shown for VFP parity; proceed uses ledger balances and min amounts.',
      ]),
      section('Proceed & grid', [
        'Click Proceed to load ledger closing balances (excluding bikri lines).',
        'Dr_trf and Cr_trf are computed for balances within minimum amounts.',
        'Select rows with checkboxes; Select All / Clear All match VFP.',
      ]),
      section('Save & delete', [
        'Save creates one JV per selected account (two lines: transfer + party) in VOUCHER and LEDGER.',
        'Delete Prev.Starting Vr.No. removes JV vouchers for the ending date and voucher range.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'trial-difference': {
    title: 'Trial Difference',
    summary: 'Ledger integrity checks (VFP DO trldif).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) Open right.',
        'Opens from Utilities → Multi Utilities → Trial Difference.',
      ]),
      section('Checks', [
        'Missing Schedule — MASTER schedule not in SCHEDULE.',
        'Missing Code In Master — LEDGER codes without MASTER row.',
        'Double Code In Master — duplicate MASTER codes.',
        'Opening Diff — OP voucher Dr minus Cr (shown only when non-zero in VFP).',
        'Diff. In Vouchers — non-OP/SV vouchers where Dr minus Cr ≠ 0.',
        'Bikri Diff — bikri vs sale amount mismatch by B_NO.',
        'Trading Bikri — schedule 12.10 ledger lines with BIKRI = Y.',
      ]),
      section('Usage', [
        'Click Run to execute all checks (same as DO trldif).',
        'Use tabs to view each section; counts show issue rows.',
        'Missing Schedule — click row to open A/c Master and edit schedule.',
        'Missing Code / Missing Ledger Detail — click row to open Ledger.',
        'Double Code — click row to delete duplicate MASTER rows (keeps minimum ROWID).',
        'Excel exports the active tab.',
      ]),
    ],
  },

  'merging-of-accounts': {
    title: 'Merging Of Accounts',
    summary: 'Replace an old account code with a new one across transactions (VFP DO FORM amerge).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) Open and Edit rights.',
        'Opens from Utilities → Multi Utilities → Merging Of Accounts.',
      ]),
      section('Fields', [
        'Old Ledger A/c — source code (must exist in MASTER).',
        'New Ledger A/c — target code (must exist in MASTER).',
        'Credit date range — for Cr. lines in LEDGER, VOUCHER, BILLS, BANKSTMT.',
        'Debit date range — for Dr. lines, SALE, PURCHASE, LOTSTOCK, and related tables.',
        'Specific Vr.Type — optional filter (blank = all types).',
      ]),
      section('Proceed', [
        'Click Proceed to run all UPDATE statements (same tables as VFP amerge).',
        'Updates SALE, LOTSTOCK, VOUCHER, LEDGER, BILLS, BANKSTMT, BIKRI, PURCHASE, TDS, etc.',
        'Does not delete the old MASTER row — only rewrites transaction references.',
        'Confirm before merge; operation cannot be undone from this screen.',
      ]),
    ],
  },

  'bikri-no-merging': {
    title: 'Bikri No. Merging',
    summary: 'Replace old bikri number (B.No.) and supplier with new values (VFP DO FORM bnotrf).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) Open and Edit rights.',
        'Opens from Utilities → Multi Utilities → Bikri No. Merging.',
      ]),
      section('Fields', [
        'Old Supplier A/c — optional; code must start with S or T (SUBSTR(CODE,1,1)).',
        'New Supplier A/c — required; code must start with S or T.',
        'Old Bikri No. — source B_NO (must exist in LOTSTOCK).',
        'New Bikri No. — target B_NO after merge.',
      ]),
      section('Proceed', [
        'With old supplier: updates rows matching SUP_CODE/CODE and B_NO.',
        'Without old supplier: updates all rows for that B_NO (LEDGER/BIKRI limited to S/T codes per VFP).',
        'Tables updated: SALE, LOTSTOCK, VOUCHER, LEDGER, BIKRI, PRODUCT, PURCHASE, CPUR.',
        'Confirm before merge; operation cannot be undone from this screen.',
      ]),
    ],
  },

  'bikri-no-trf-to-lot': {
    title: 'Bikri No Trf To Lot',
    summary: 'Change bikri number and supplier for a specific item+lot (VFP DO FORM bnotrf_lot).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) Open and Edit rights.',
        'Opens from Utilities → Multi Utilities → Bikri No Trf To Lot.',
      ]),
      section('Fields', [
        'Item Code — LOTSTOCK item (required).',
        'Lot — LOTSTOCK lot number (required).',
        'Load Lot — reads B_NO, supplier (S/T code), and name from LOTSTOCK.',
        'Supplier — target supplier (S or T code); defaults from lot.',
        'New Bikri No. — target B_NO after merge.',
      ]),
      section('Proceed', [
        'Updates SALE, LOTSTOCK, VOUCHER, LEDGER, PRODUCT, PURCHASE, CPUR for matching item+lot.',
        'LOTSTOCK/LEDGER/PRODUCT/CPUR filter by original supplier from lot; SALE/VOUCHER/PURCHASE by item+lot only.',
        'Confirm before merge; closes screen on success (same as VFP).',
      ]),
    ],
  },

  'shortage-transfer': {
    title: 'Shortage Transfer',
    summary: 'Transfer lot shortages to SHORTAGE vouchers (VFP DO FORM shortage).',
    sections: [
      section('Access', [
        'Uses Master Party (F4) rights — Add for Save, Delete for voucher removal.',
        'Opens from Utilities → Multi Utilities → Shortage Transfer.',
      ]),
      section('Proceed & grid', [
        'Proceed loads LOTSTOCK lots where balance qty = 0 and outstanding weight ≠ 0.',
        'Columns match VFP: item, lot, supplier, qty/weight/rate, balance qty/weight, amount.',
        'Click any row to open all LOTSTOCK transactions for that item+lot+supplier (running balances).',
        'Select rows with checkboxes; Select All / Clear All on the toolbar.',
      ]),
      section('Save', [
        'Save writes selected rows to SHORTAGE and LOTSTOCK (VR_TYPE SH), one voucher no. per row.',
        'Starting Vr.No. defaults to MAX(SHORTAGE)+1; increments after each saved line.',
        'Trf.To Ledger (Y/N) = Y posts matching LEDGER entries (supplier ↔ E00000).',
      ]),
      section('List & delete', [
        'List exports saved SHORTAGE vouchers to Excel.',
        'Delete removes SHORTAGE, LOTSTOCK, and LEDGER for VR_TYPE SH in the voucher range.',
      ]),
    ],
  },

  'unused-account-list': {
    title: 'Unused Account List',
    summary: 'List and delete MASTER accounts with no LEDGER rows (VFP DO FORM master_delete).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Master Party (F4) Open and Delete rights.',
        'Administrator password required (VFP APW = GRAINFAS).',
      ]),
      section('Proceed', [
        'Schedule No. 0.00 = all schedules; otherwise filters MASTER by schedule.',
        'Lists accounts in MASTER that have no matching CODE in LEDGER.',
        'Columns: Schedule, Code, Name, City, Tel, PAN, GST.',
      ]),
      section('Delete Master', [
        'Select rows with checkboxes; Delete Master removes selected codes from MASTER.',
        'Confirm before delete — accounts must have no ledger transactions.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'unused-cost-centre-codes': {
    title: 'Unused Cost Centre Codes',
    summary: 'List and delete COST codes unused in LEDGER, LOTSTOCK, and BILLS (VFP DO FORM cost_delete).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Cost Centre Master (F5) Open and Delete rights.',
        'Administrator password required (VFP APW = GRAINFAS).',
      ]),
      section('Proceed', [
        'Lists cost centres in COST that do not appear in LEDGER, LOTSTOCK, or BILLS.',
        'Columns: Cost Code, Cost Name, linked A/c Code and A/c Name.',
      ]),
      section('Delete Cost', [
        'Select rows with checkboxes; Delete Cost removes selected codes from COST.',
        'Confirm before delete — codes must have no ledger, lot, or bill usage.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'unused-godown-codes': {
    title: 'Unused Godown Codes',
    summary: 'List and delete GODOWN codes unused in LOTSTOCK (VFP DO FORM godown_delete).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Godown Master (F4) Open and Delete rights.',
        'Administrator password required (VFP APW = GRAINFAS).',
      ]),
      section('Proceed', [
        'Lists godowns in GODOWN that do not appear in LOTSTOCK.',
        'Columns: Godown Code, Godown Name, Location.',
      ]),
      section('Delete Godown', [
        'Select rows with checkboxes; Delete Godown removes selected codes from GODOWN.',
        'Confirm before delete — codes must have no lot stock usage.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'missing-codes': {
    title: 'Missing Codes',
    summary: 'Find and create missing MASTER account codes in a numeric range (VFP DO FORM master_missing_numbers).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Schedule & range', [
        'Select Schedule No. — Starting Code and Ending Code load from MIN/MAX CODE in MASTER for that schedule.',
        'Edit the range if needed; codes must be 1 letter + 5 digits with the same prefix.',
      ]),
      section('Proceed & create', [
        'Proceed lists account codes in the range that do not exist in MASTER.',
        'Create Missing inserts placeholder MASTER rows for selected codes (VFP SHELL_EXECUTE MISSING_CODE).',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'brok-find': {
    title: 'Brok.Find',
    summary: 'Find sale bills with brokerage % but zero brokerage amount (VFP DO FORM brokchk WITH 1).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open rights.',
      ]),
      section('Date range', [
        'Starting Date and Ending Date default to the financial year; same as VFP G_SDATE / G_EDATE.',
        'Proceed lists TYPE SL sale lines where BROK_PER ≠ 0 and BROKERAGE = 0.',
      ]),
      section('Grid & export', [
        'Columns: Bill No, Bill Date, B.Type, party, qty, weight, rate, amount, dane, brok %, brokerage.',
        'Click any row to open the sale bill print view.',
        'Excel exports the current grid (VFP BROK.XLS).',
      ]),
      section('VFP note', [
        'VFP also offered Brokerage Trf. to open each bill in the SALE form for editing — use sale bill entry in VFP if brokerage must be posted from this list.',
      ]),
    ],
  },

  'dane-find': {
    title: 'Dane Find',
    summary: 'Find sale bills with DANE = D and non-zero dane amount (VFP DO FORM brokchk WITH 2).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open rights.',
      ]),
      section('Date range', [
        'Starting Date and Ending Date default to the financial year.',
        'Proceed lists TYPE SL sale lines where DANE = D and DANE_AMT ≠ 0.',
      ]),
      section('Grid & export', [
        'Columns include Bill No, party, qty, weight, dane weight/amount, brokerage fields.',
        'Click any row to open the sale bill print view (gross dane on print).',
        'Excel exports the current grid (VFP DANE.XLS).',
      ]),
    ],
  },

  'stock-transfer': {
    title: 'Stock Transfer',
    summary: 'Rebuild LOTSTOCK from source transaction tables (VFP DO FORM stktrf).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Item Master (F5) Open and Add rights.',
      ]),
      section('Modules (Y/N)', [
        'Purchase (PU): deletes LOTSTOCK VR_TYPE PU, reloads from PURCHASE where STK = Y.',
        'Sale: deletes SL / .H / .C / CN rows, reloads from SALE with company weight preferences.',
        'Consignment Purchase (PC): deletes PC rows, reloads from CPUR (bags/katta/hkatta lines).',
        'Production: deletes R/I/JR/JI/D rows, reloads from PRODUCT with VFP type mapping.',
      ]),
      section('Warning', [
        'Proceed deletes existing LOTSTOCK rows for the selected VR types before inserting.',
        'Run only when stock figures need a full rebuild — same as VFP stktrf.',
      ]),
      section('Grid', [
        'Proceed loads all entries into the grid first (Date, No, Item Code, Qty, Weight, Lot, Status, B_No).',
        'After you confirm, transfer runs with Total and Completed counters and a progress bar.',
        'Completed rows are highlighted green as each LOTSTOCK line is written.',
      ]),
    ],
  },

  'sale-transfer': {
    title: 'Sale Transfer',
    summary: 'Re-post sale bills to LOTSTOCK for a date range (VFP DO FORM saletrf → SALE_GST transfer).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Filters', [
        'Starting Date and Ending Date default to the financial year.',
        'Optional Specific B.Type, Specific Bill No., and Bikri / Lot No. (B_NO) narrow the list.',
        'Lists TYPE SL sale lines in the selected period.',
      ]),
      section('Transfer', [
        'Proceed loads all sale lines in the grid first, then transfers bill by bill.',
        'Each bill: deletes existing LOTSTOCK rows for that sale voucher and re-inserts from SALE.',
        'Progress shows bills and lines completed; use VFP SALE_GST for full ledger repost if needed.',
      ]),
    ],
  },

  'voucher-transfer': {
    title: 'Voucher Transfer',
    summary: 'Re-post cash/bank/journal vouchers to LEDGER (VFP DO FORM voutrf → VOUCHER transfer mode).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Filters', [
        'Starting Date and Ending Date default to the financial year.',
        'Optional Specific Voucher Type (VR_TYPE) — e.g. CV, BV, BI, JV — narrows the list.',
        'Lists all VOUCHER lines in the selected VR_DATE range.',
      ]),
      section('Transfer', [
        'Proceed lists all voucher lines in the grid (no posting yet).',
        'Post asks whether to write to LEDGER — confirm Yes to start, No to cancel.',
        'Each voucher: deletes existing LEDGER rows and re-inserts from VOUCHER.',
        'Use VFP VOUCHER for full BILLS / bank / interest side-effects if needed.',
      ]),
    ],
  },

  'purchase-transfer': {
    title: 'Purchase Transfer',
    summary: 'Re-post PU purchase bills to LOTSTOCK for a date range (VFP DO FORM purtrf → PURCHASE_GST transfer).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Filters', [
        'Starting Date and Ending Date default to the financial year.',
        'Lists TYPE PU purchase lines where R_DATE falls in the selected period.',
      ]),
      section('Transfer', [
        'Proceed lists all purchase lines in the grid (no posting yet).',
        'Post asks whether to write to LOTSTOCK — confirm Yes to start, No to cancel.',
        'Each bill: deletes existing LOTSTOCK rows for that purchase voucher and re-inserts from PURCHASE.',
        'Use VFP PURCHASE_GST for full ledger repost if needed.',
      ]),
    ],
  },

  'update-sale-inv-no': {
    title: 'Update SaleInvNo',
    summary: 'Rebuild SALE_INV_NO on sale bills for a date range (VFP DO FORM update_sale_inv_no).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Filters', [
        'Starting Date and Ending Date default to the financial year.',
        'Lists distinct sale bills in the period with old and computed new invoice numbers.',
      ]),
      section('Update', [
        'Proceed lists bills with Old Inv No and New Inv No (from LOC_B_TYPE bill init + company DEFVALUE rules).',
        'Post asks to confirm before updating SALE and LEDGER SALE_INV_NO.',
        'Uses zero-padding, B.Type suffix, and /FY suffix per VFP G_ZERO_BEFORE_PRINTING, G_BTYPE_YN, and FIN_YEAR flags.',
      ]),
    ],
  },

  'update-pan-with-gstin': {
    title: 'Update Pan With GstIn',
    summary: 'Copy PAN from GSTIN on account master where PAN is blank (VFP DO pan_with_gstin).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses A/c Master (F4) Open and Add rights.',
      ]),
      section('Selection', [
        'Lists MASTER accounts for the current company where PAN is null and GST_NO is not null.',
        'New PAN is SUBSTR(GST_NO, 3, 10) — the 10-character PAN embedded in the 15-character GSTIN.',
      ]),
      section('Update', [
        'Proceed lists Code, Name, GSTIN, and computed New PAN.',
        'Post asks to confirm before updating MASTER.PAN for all listed accounts.',
      ]),
    ],
  },

  'user-report': {
    title: 'User Report',
    summary: 'User activity audit for add, edit, or delete operations (VFP DO FORM userrpt).',
    sections: [
      section('Report type', [
        'Add — records the user created (VFP DO FORM userrpt WITH 2 / USERRPT1).',
        'Edit — edit audit from HI_* history tables (VFP WITH 1 / USERRPT mode E).',
        'Delete — delete audit from HI_* history tables (VFP WITH 3 / USERRPT mode D).',
      ]),
      section('Filters', [
        'Starting Date and Ending Date default to the financial year.',
        'User Name — pick from GRAINFAS.USERS (F1 help in VFP).',
      ]),
      section('Output', [
        'Proceed loads a grid by module with entry date, reference, and detail.',
        'Excel exports the current grid.',
      ]),
    ],
  },

  'audit-trail-reports': {
    title: 'Audit Trail Reports',
    summary: 'Ledger audit trail from AUDIT_LEDGER (VFP DO FORM audit_report).',
    sections: [
      section('Filters', [
        'Entry date range — MOD_DEL_ENT_DATE (Starting / Ending Entry Date).',
        'Voucher date range and voucher number band (defaults 0–999999).',
        'Optional A/c code, voucher type, specific user, and entry type N/E/D/O.',
      ]),
      section('Entry type', [
        'N — new entries; E — edits; D — deletes.',
        'O — MOD_DEL_TYPE N where voucher date differs from mod/del entry date (VFP opening filter).',
      ]),
      section('Output', [
        'Proceed lists AUDIT_LEDGER rows with account, amounts, item/lot, and mod/del reason.',
        'Excel exports the grid.',
      ]),
    ],
  },

  'company-detail-edit': {
    title: 'Company Detail Edit',
    summary: 'Edit COMPDET for the logged-in company and financial year (VFP DO FORM compdet).',
    sections: [
      section('Access', [
        'Opens from Utilities → Installation → Company Detail Edit.',
        'Password required first — same as VFP compdet gate.',
        'NEWFAS — limited: cannot change company name or financial year start/end dates.',
        'VANYA99 — full access including company name and year dates.',
        'Wrong password does not open the screen.',
      ]),
      section('Tabs', [
        'Company — name, address, phones, GST, PAN/TAN, financial year dates, and print flags.',
        'Bank & IDs — bank accounts, CIN, Udyam, UPI, and IBL payment fields.',
        'Email / SMS / APIs — sale email, SMS, e-invoice file, FasInvoyz, and Dovesoft/WhatsApp settings.',
      ]),
      section('Save', [
        'Edit enables fields; Save updates COMPDET and COMPANY.COMP_NAME for the current year.',
        'Administrator password (COMP_P_D) and integration keys are stored in COMPDET as in VFP.',
      ]),
    ],
  },

  'gst-profile-setting': {
    title: 'Gst Profile Setting',
    summary: 'GST e-invoice / e-way profile in GST_PROFILE for the company (VFP DO FORM gst_profile).',
    sections: [
      section('Access', [
        'Opens from Utilities → Installation → Gst Profile Setting.',
        'Password required every time you open this screen: NEWFAS_EINV (same as VFP gst_profile APW field).',
        'Wrong password does not open the screen.',
      ]),
      section('Tabs', [
        'Company & GST — GSTIN, legal/trade name, address, state codes, contact, renewal date.',
        'E-Invoice API — API links, user, password, customer id, app id, and API secret.',
        'E-Way & Print Links — e-way credentials, environment, IRN/print URLs.',
      ]),
      section('Save', [
        'New creates a GST_PROFILE row for the current company code.',
        'Edit updates the existing row; one profile per COMP_CODE as in desktop VFP.',
      ]),
    ],
  },

  updation: {
    title: 'Updation',
    summary:
      'Transfer stock/account opening balances from current year schema to next year (VFP DO FORM update).',
    sections: [
      section('Access', [
        'Desktop only — open on a computer or switch to Desktop View in Settings.',
        'Not available on mobile phones or Mobile View.',
        'Opens from Utilities → Installation → Updation.',
      ]),
      section('Fields', [
        'Current Year Directory — logged-in comp_uid (read-only).',
        'Next Year Directory — target year schema from COMPDET (auto-filled when found).',
        'Ending Date — financial year end date for opening vouchers.',
        'Minimum Amount Ignore — skip bills at or below this balance (default 10).',
        'Bills Trf Supplier / Customer — Y/N to copy supplier/customer bills (default Y).',
      ]),
      section('Proceed', [
        'Rebuilds OP ledger and MASTER.OP_BALANCE in the next-year schema from current-year ledger balances.',
        'Optionally transfers matching BILLS rows above the minimum amount.',
        'Cannot run when next year is the same as ending date year.',
      ]),
    ],
  },

  'opening-bills-detail': {
    title: 'Opening Bills Detail',
    summary: 'Enter opening bill headers and payment schedule lines (VFP DO FORM OPDET).',
    sections: [
      section('Access', [
        'Desktop only — not available on mobile phones or Mobile View.',
        'Uses Master Party (F4) rights — Add, Edit, Delete as per your user profile.',
        'Opens from Utilities → Multi Utilities → Opening Bills Detail.',
      ]),
      section('Header', [
        'Sr.No — auto on New; party from account master; broker from schedule 11.20 only.',
        'Bill Date, Bill No, Value Date, Days, and Bill Amount.',
        'Bill Date must be before financial year start (opening balance).',
        'Days auto-calculates from Bill Date and Value Date when both are set.',
      ]),
      section('Payment grid', [
        'Each line: S.No (Trn_No), Payment Date, Amount.',
        'Payment Date must be before financial year start.',
        'At least one payment line is required to save.',
        'New / Edit: Add row or Delete row; Enter moves to next line.',
      ]),
      section('BILLS table', [
        'On Save, entries are written to OPDET and BILLS (VR_TYPE = OP, VR_NO = Sr.No), same as VFP OPDET.',
        'Bill header and each payment line create BILLS rows; customer (schedule 8.x) uses CR for payments, supplier uses DR.',
      ]),
    ],
  },

  'takaja-query': {
    title: 'Takaja Query',
    summary: 'Rebuild TAKAJA view and run TAKAJAFUN.TXT (VFP DO TAKAJA_QUERY).',
    sections: [
      section('Access', [
        'Supervisor users only (USERS.SUPERVISOR = Y).',
        'Desktop only — not available on mobile phones or Mobile View.',
        'Opens from Utilities → New Year Creation → Takaja Query.',
      ]),
      section('Steps', [
        'Drop and recreate TAKAJA view on hub schema.',
        'Run TAKAJAFUN.TXT on current session comp_uid via SQL*Plus.',
        'TAKAJAFUN.TXT must be in oracle_scripts, VFP-IMPORT, or app root.',
      ]),
    ],
  },

  'set-function': {
    title: 'Set Function',
    summary: 'Run Oracle function scripts and rebuild TAKAJA view/indexes (VFP DO setFUNC).',
    sections: [
      section('Access', [
        'Supervisor users only (USERS.SUPERVISOR = Y).',
        'Desktop only — not available on mobile phones or Mobile View.',
        'Opens from Utilities → New Year Creation → Set Function.',
      ]),
      section('Steps', [
        'ORAFUN.TXT and TAKAJAFUN.TXT on each comp_uid from compdet.',
        'Drop and recreate TAKAJA view on hub schema.',
        'Drop and recreate standard indexes (BILLS, LEDGER, AUDIT_*, LOTSTOCK).',
        'SORAFUN.TXT on each comp_uid.',
        'SQL script files must be in oracle_scripts, VFP-IMPORT, or app root — skipped if missing.',
      ]),
    ],
  },

  'primary-key': {
    title: 'Primary Key',
    summary: 'Rebuild primary key constraints on the current company schema (VFP DO primary_key).',
    sections: [
      section('Access', [
        'Supervisor users only (USERS.SUPERVISOR = Y).',
        'Desktop only — same maintenance category as New Year Books.',
        'Opens from Utilities → New Year Creation → Primary Key.',
      ]),
      section('Action', [
        'Rebuild drops and recreates PK constraints on master and transaction tables.',
        'Matches VFP primary_key.prg which runs SQL*Plus with PRIMARY_KEY.TXT.',
        'Tables missing in the schema or with duplicate data may be skipped.',
      ]),
    ],
  },

  'new-year-books': {
    title: 'New Year Books',
    summary: 'Prepare books for the next financial year (VFP DO FORM prepare).',
    sections: [
      section('Access', [
        'Supervisor users only (USERS.SUPERVISOR = Y).',
        'Desktop only — not available on mobile phones or Mobile View.',
        'Opens from Utilities → New Year Books.',
      ]),
      section('Fields', [
        'Starting / ending date — next FY defaults from current compdet end date.',
        'Press Enter to move between fields (same as other reports).',
        'After ending date: directory = GRAIN + year of ending date; new year = year of ending date; focus moves to directory.',
        'Current year — read-only from session.',
        'Directory name — required Oracle user / comp_uid (e.g. GRAIN2027).',
      ]),
      section('Proceed', [
        'Validates year not already in compdet, inserts compdet row, creates Oracle user, clones tables, clears transactional data, sets primary keys, TAKAJA view and indexes (VFP prepare.prg).',
        'After success you can switch to the new year or use Change Year later.',
      ]),
    ],
  },
};

const PDF_ORDER = [
  'reports-menu',
  'trial-balance',
  'ledger',
  'ledger-interest',
  'customer-ledger',
  'sale-chart',
  'overdue-customers',
  'supplier-ledger',
  'broker-os',
  'ageing',
  'stock-sum',
  'stock-lot',
  'hsn-sales',
  'hsn-purchase',
  'state-wise-sales',
  'state-wise-purchase',
  'sale-bill-printing',
  'sale-list',
  'gstr1',
  'sales-order-entry',
  'dispatch-challan-entry',
  'sale-bill-entry',
  'purchase-list',
  'voucher-list',
  'trading-ac',
  'pl-profit-loss',
  'balance-sheet',
];

export function getReportHelp(reportId, viewKey) {
  const base = REPORT_HELP[reportId] || {
    title: 'Report',
    summary: 'Use the form to set filters, then run the report.',
    sections: [section('Tips', ['Use toolbar ← Back to return.', 'Use 🏠 Home to return to the menu.'])],
  };
  const extra = viewKey && base.views?.[viewKey];
  if (!extra) return base;
  return {
    ...base,
    sections: [...base.sections, section(extra.title, extra.bullets)],
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSectionsHtml(sections) {
  return (sections || [])
    .map(
      (sec) => `
      <div class="ug-section">
        <h3>${escapeHtml(sec.title)}</h3>
        <ul>${(sec.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      </div>`
    )
    .join('');
}

export function buildUserGuideHtml({ companyName = '', appName = getDefaultAppName(), includeReportIds } = {}) {
  const ids = includeReportIds || PDF_ORDER;
  const blocks = ids
    .filter((id) => REPORT_HELP[id])
    .map((id) => {
      const h = REPORT_HELP[id];
      return `
        <div class="ug-report">
          <h2>${escapeHtml(h.title)}</h2>
          <p class="ug-summary">${escapeHtml(h.summary)}</p>
          ${renderSectionsHtml(h.sections)}
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(appName)} — User Guide</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; margin: 0; padding: 16px 20px; }
    h1 { font-size: 18pt; color: #1e3a8a; margin: 0 0 8px; }
    .ug-meta { font-size: 9.5pt; color: #64748b; margin-bottom: 20px; }
    .ug-intro { background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 14px; border-radius: 8px; margin-bottom: 22px; }
    .ug-report { page-break-inside: avoid; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
    .ug-report h2 { font-size: 13pt; color: #3349d1; margin: 0 0 6px; }
    .ug-summary { margin: 0 0 8px; font-size: 10pt; color: #475569; }
    .ug-section h3 { font-size: 10.5pt; margin: 10px 0 4px; color: #0f172a; }
    .ug-section ul { margin: 0 0 8px; padding-left: 18px; }
    .ug-section li { margin-bottom: 4px; line-height: 1.35; }
    .ug-flow { font-weight: 600; color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>${escapeHtml(appName)} — Reports User Guide</h1>
  <p class="ug-meta">${companyName ? escapeHtml(companyName) + ' · ' : ''}Generated ${escapeHtml(new Date().toLocaleString())}</p>
  <div class="ug-intro">
    <p><span class="ug-flow">Common navigation:</span> Trial Balance → click account → <strong>Ledger</strong> → click line → <strong>Voucher</strong>. Use ← Back on each screen. Many other reports use similar click-through where rows are highlighted.</p>
    <p>On each screen, tap the <strong>?</strong> help button for a short guide. This PDF lists all modules in depth.</p>
  </div>
  ${blocks}
</body>
</html>`;
}

export function getPdfReportIdsForApp({ includeSalesEntry = true, includeStockLot = false } = {}) {
  return PDF_ORDER.filter((id) => {
    if (!includeSalesEntry && (id === 'sales-order-entry' || id === 'dispatch-challan-entry' || id === 'sale-bill-entry')) {
      return false;
    }
    if (!includeStockLot && id === 'stock-lot') return false;
    return Boolean(REPORT_HELP[id]);
  });
}
