export function shouldOpenCompanySettings(search: string): boolean {
  return new URLSearchParams(search).get("companies") === "1";
}
