import { FinanceMenuScope } from "@/components/FinanceTabs";
import { PayrollPage } from "@/components/payroll/PayrollPage";

export default function Payroll() {
  return (
    <>
      <FinanceMenuScope />
      <PayrollPage />
    </>
  );
}
