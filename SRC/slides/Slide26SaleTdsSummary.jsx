import SlidePurchaseTdsReport from './SlidePurchaseTdsReport';

export default function Slide26SaleTdsSummary(props) {
  return (
    <SlidePurchaseTdsReport
      {...props}
      reportMode="saleSummary"
      slideClass="slide-26-sale-tds-summary"
    />
  );
}
