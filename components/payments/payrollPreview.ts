import type { PayrollEmployee } from "./payroll";


// Предпросмотр без таблиц в базе — пустой: раньше здесь лежали семь реальных
// сотрудников с окладами, а это персональные данные в git. Справочник грузится
// из Excel через интерфейс (действие import_staff).
export const PAYROLL_PREVIEW_EMPLOYEES: PayrollEmployee[] = [];
