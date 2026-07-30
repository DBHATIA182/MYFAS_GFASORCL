import IncomeTaxReportScreen from '../components/IncomeTaxReportScreen';

/** Slide 96 — Ledger module reports (Dr/Cr date ledger, etc.). */
export default function Slide96LedgerReports(props) {
  return <IncomeTaxReportScreen {...props} reportModule="ledger-reports" />;
}
