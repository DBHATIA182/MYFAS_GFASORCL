import IncomeTaxReportScreen from '../components/IncomeTaxReportScreen';

/** Slide 99 — Voucher module books (Cash/Bank/Journal/Day Book, etc.). */
export default function Slide99VoucherBooks({ returnSlide, onOpenVoucher, ...props }) {
  return (
    <IncomeTaxReportScreen
      {...props}
      reportModule="voucher-books"
      returnSlide={returnSlide}
      onOpenVoucher={onOpenVoucher}
    />
  );
}
