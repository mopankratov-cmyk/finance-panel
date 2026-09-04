import type { FinanceAction, FinanceState } from "./types";

export function financeReducer(
  state: FinanceState,
  action: FinanceAction,
): FinanceState {
  switch (action.type) {
    case "LOAD":
      return action.payload;

    case "ADD_ACCOUNT":
      return { ...state, accounts: [...state.accounts, action.payload] };

    case "UPDATE_ACCOUNT":
      return {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id === action.payload.id ? action.payload : a,
        ),
      };

    case "DELETE_ACCOUNT":
      return {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== action.payload),
      };

    case "ADD_PAYMENT":
      return { ...state, payments: [...state.payments, action.payload] };

    case "UPDATE_PAYMENT":
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === action.payload.id ? action.payload : p,
        ),
      };

    case "DELETE_PAYMENT":
      return {
        ...state,
        payments: state.payments.filter((p) => p.id !== action.payload),
      };

    case "ADD_LOAN":
      return { ...state, loans: [...state.loans, action.payload] };

    case "UPDATE_LOAN":
      return {
        ...state,
        loans: state.loans.map((l) =>
          l.id === action.payload.id ? action.payload : l,
        ),
      };

    case "DELETE_LOAN":
      return {
        ...state,
        loans: state.loans.filter((l) => l.id !== action.payload),
      };

    default:
      return state;
  }
}
