import { FinanceMenuScope } from "@/components/FinanceTabs";
import { PayrollPage } from "@/components/payments/PayrollPage";

export default function Payroll() {
  return (
    <>
      <FinanceMenuScope />
      <PayrollPage />
    </>
  );
}
