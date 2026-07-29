import { LoansPage } from "@/components/loans/LoansPage";
import { FinanceMenuScope } from "@/components/FinanceTabs";

export default function Loans() {
  return (
    <>
      <FinanceMenuScope />
      <LoansPage />
    </>
  );
}
