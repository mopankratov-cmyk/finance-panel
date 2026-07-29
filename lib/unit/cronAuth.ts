export function isConfiguredCronBearer(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  return typeof secret === "string"
    && secret.trim().length > 0
    && authorization === `Bearer ${secret}`;
}
