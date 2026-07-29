export interface UnitMoneyQuery {
  taxPct: number;
  ff: number;
  targetMargin: number;
}

function singletonNumber(
  searchParams: URLSearchParams,
  name: string,
  defaultValue: number,
  isValid: (value: number) => boolean,
): number {
  const values = searchParams.getAll(name);
  if (values.length === 0) return defaultValue;
  if (values.length !== 1 || values[0].trim() === "") {
    throw new Error(`Некорректный параметр ${name}`);
  }

  const value = Number(values[0]);
  if (!Number.isFinite(value) || !isValid(value)) {
    throw new Error(`Некорректный параметр ${name}`);
  }
  return value;
}

export function parseUnitMoneyQuery(searchParams: URLSearchParams): UnitMoneyQuery {
  return {
    taxPct: singletonNumber(searchParams, "tax", 7, (value) => value >= 0 && value <= 100),
    ff: singletonNumber(searchParams, "ff", 0, (value) => value >= 0 && value <= 1_000_000),
    targetMargin: singletonNumber(searchParams, "margin", 25, (value) => value >= 0 && value < 100),
  };
}
