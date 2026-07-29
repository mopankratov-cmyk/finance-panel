# DEBUG REPORT: Ozon себестоимость по названию товара

- **Symptom:** на Ozon Performance часть SKU показывалась как без полной себестоимости, хотя такой же товар уже есть в базе себестоимостей под другим артикулом/кабинетом.
- **Root cause:** Ozon-реклама, Ozon-экономика и старый `/api/ozon/unit` искали себестоимость только по точному `offer_id`. При разных Ozon/WB артикулах одинаковый товар не получал себес и рекомендации отключались.
- **Fix:** добавлен общий Ozon cost resolver: сначала точный `offer_id` без учёта регистра, затем безопасное совпадение по нормализованному названию товара. Нулевые себесы не считаются валидным совпадением, чтобы не блокировать fallback по названию. Для Ozon добавлен fallback `sku → offer_id` через остатки, когда каталог/изображения не дают маппинг.
- **Evidence:** `node --import tsx --test tests/ozon-costs.test.mts`, `npm run lint`, `npx tsc --noEmit`, `git diff --check`, `npm test`, `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build`, `npm run dev -- --webpack --port 3046` + `curl -I /ozon/adverts`.
- **Regression test:** `tests/ozon-costs.test.mts`.
- **Status:** DONE.
