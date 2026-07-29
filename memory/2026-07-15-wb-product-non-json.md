# 2026-07-15 — WB product page non-JSON error

## Symptom

The WB `Товары / SKU` page showed a technical browser parsing error:
`Unexpected token 'A', "An error o"... is not valid JSON`.

## Root cause

The page used raw `response.json()` for `/api/pim`, product history, and product note saves. If Vercel or an upstream route returned a plain-text platform error, the browser surfaced the JSON parser exception instead of a useful dashboard error.

The WB Content API paginator also parsed upstream `response.json()` directly and had no per-page timeout. A hanging or plain-text upstream response could either bubble up as `Unexpected token` or keep the serverless function busy until the platform returned its own plain-text error.

## Fix

- `components/wb/WbProductPage.tsx` now reads `/api/pim` responses with the shared `readApiResponse()` helper.
- `lib/wb/cardPagination.ts` now bounds every Content API page request to 15 seconds.
- `lib/wb/cardPagination.ts` now converts upstream plain-text/invalid JSON into a readable `WB Content API вернул не JSON...` error.

## Verification

- `npm test -- tests/wb-content-pagination.regression-1.test.mts tests/wb-product-non-json-response.regression-1.test.mts`
- `npx eslint components/wb/WbProductPage.tsx lib/wb/cardPagination.ts tests/wb-content-pagination.regression-1.test.mts tests/wb-product-non-json-response.regression-1.test.mts`
- `npm run build`
