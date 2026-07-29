import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { FinanceMenuScope } from "@/components/FinanceTabs";

export default function Payments() {
  return (
    <>
      <FinanceMenuScope />
      <PaymentsPage />
    </>
  );
}
