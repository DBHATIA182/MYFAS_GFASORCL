import SlidePurchaseTdsReport from './SlidePurchaseTdsReport';

export default function Slide23PurchaseTdsDetail(props) {
  return (
    <SlidePurchaseTdsReport
      {...props}
      reportMode="purchaseDetail"
      slideClass="slide-23-purchase-tds-detail"
    />
  );
}
