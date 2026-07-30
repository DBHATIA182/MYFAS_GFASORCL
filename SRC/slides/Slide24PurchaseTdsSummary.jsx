import SlidePurchaseTdsReport from './SlidePurchaseTdsReport';

export default function Slide24PurchaseTdsSummary(props) {
  return (
    <SlidePurchaseTdsReport
      {...props}
      reportMode="purchaseSummary"
      slideClass="slide-24-purchase-tds-summary"
    />
  );
}
