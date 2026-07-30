import SlidePurchaseTdsReport from './SlidePurchaseTdsReport';

export default function Slide25SaleTdsDetail(props) {
  return (
    <SlidePurchaseTdsReport
      {...props}
      reportMode="saleDetail"
      slideClass="slide-25-sale-tds-detail"
    />
  );
}
