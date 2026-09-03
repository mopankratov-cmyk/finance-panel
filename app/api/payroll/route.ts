// Канонический адрес зарплатного модуля. Старый /api/finance/payroll оставлен
// как переходный адаптер для уже открытых клиентов до следующего релиза.
export const dynamic = "force-dynamic";
export { GET, POST } from "@/app/api/finance/payroll/route";
