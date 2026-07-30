import IncomeTaxReportScreen from '../components/IncomeTaxReportScreen';

/** Slide 91 — all Other Reports (BW_MENU popup otherreports). */
export default function Slide91OtherReports(props) {
  return <IncomeTaxReportScreen {...props} reportModule="other-reports" />;
}
