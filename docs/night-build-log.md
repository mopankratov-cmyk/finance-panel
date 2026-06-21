# Ночная сборка автопилота — лог (2026-06-21)

Ветка `feat/service-balances-dashboard`. Каждый кусок: код → tsc+eslint+build → адверсариал-ревью → коммит. В прод НЕ пушу (утром ревью). Реальные платные батчи не гоню (тонкий тест ≤2).

Кап $40 · ASR=fal-whisper · заводской бот `FACTORY_TG_*`. Канон качества: docs/openreels-pipeline.md.
⏳ Отложено до ключей владельца: V22 ElevenLabs (`ELEVENLABS_API_KEY`), V23 Remotion-lambda.

## Прогресс
- [x] **V20** история генераций — таблица `generation_history` (lineage/params/otk/attempt/variant) + `lib/factory/genHistory.ts` (logGeneration/getRecipeHistory, best-effort) + врезки в gen-save (финал) и node-preview (sync+async done) + GET `/api/factory/generation-history?recipe_id=`. tsc+eslint 0.
- [x] **V1** одобрение → «✓ Беру» зовёт /winners (хук в viral_hooks=5), «✕ Не то»/чипы → новый POST /api/factory/reject (cf_signals reason_chip + generation_history status=rejected). studio.html sendWinner/sendReject. Раньше — голый toast.
- [x] **V3+V4** ОТК-петля regen-on-fail в graphRun — score<7 & бюджет → pickCulprit (слабая ось→нода) + improve-prompt → реген ТОЛЬКО виновника → банк ЛУЧШЕЙ попытки (bestScore/bestUrl). Жёстко ≤MAX_RENDERS=3. Адверсариал-ревью: петля loop-safe; пофикшен CRITICAL (attempts не сбрасывался → run_fail выбрасывал оплаченный лучший — теперь сброс на успешном шаге в tick).
- [x] **R3** артефакт-гейт — POST /api/factory/artifact-check (Claude vision ТОЛЬКО на сломанный AI-брак: уанкэни/текст-блид/руки/морфинг) в graphRun ПЕРЕД рубрикой → broken → regenCulprit (общий хелпер с V3/V4). Липсинк по статике не судится (отмечено). Мягкая деградация без ключа.
- [ ] R4 3 варианта на ТЗ
- [x] **V11** смета — экран сборки: РЕАЛЬНАЯ смета прогона из нод рецепта × PRICE (была демо $182/250) + рейл «$182/250 демо»→«Балансы экран 07». Бюджет-гард по balances.low перенесён в V21-оркестратор (раз на батч + кап $40, не на каждый рецепт — collectBalances живой ~9с).
- [x] **V8** reality-first дефолты decompose — problem/solution/proof → disk_real (хребет), seedance/creatify только hook-ревил/нет съёмки. Промпт decompose.
- [x] **R6+V7** петля обучения — lib/factory/learningHints.ts (winnersHintFor/corpusHooksFor/rejectAntiFor — ЧИТАЕТ cf_signals reject-агрегаты, раньше write-only) → вшито в decompose (грундинг клона) + video-critic (калибровка под нишу). Одобрение уже писало winners (V1); теперь сигнал ВОЗВРАЩАЕТСЯ в идеацию/критика = компаунд.
- [x] **R5** Telegram голос-ревью — lib/factory/telegram.ts (отдельный бот FACTORY_TG_*, sendReview с кнопками + #r<id> в подписи), lib/factory/asr.ts (fal-whisper), webhook /api/factory/telegram (кнопки win/rej → applyVerdict→/winners|/reject; голос→whisper→Claude-intent→применить к рецепту из reply; /start отдаёт chat_id; секрет-заголовок). Утром: GET /api/factory/telegram?setup=<prod-url> + /start боту → FACTORY_TG_CHAT_ID.
- [x] **V21** (скелет) — Telegram-on-bank: graph-run при ОТК-пройдено + plan.notify → tgSendReview (замыкает петлю end-to-end: прогон→Telegram→голос→обучение). graph-run POST принимает notify. /api/factory/batch: бюджет-гард (collectBalances, блок при balances.low REQUIRED), смета по нодам, отсечка по кап $40, ставит черновики в очередь с notify. ⚠️ R4-варианты ×3 + openreels-ассеты (V2/V9/V22/V23) — финальные видео без них сырые; это скелет автопилота.

## Настройка вебхука Telegram — утром
- После деплоя: открыть `https://<прод>/api/factory/telegram?setup=https://<прод>` (регистрирует вебхук) → написать боту `/start` → положить выданный chat_id в Vercel `FACTORY_TG_CHAT_ID`.

## Миграции к применению (Supabase SQL Editor) — утром
- `supabase/migrations/20260621_factory_generation_history.sql` (V20) — без неё genHistory мягко деградирует (история не пишется).

## Заметки/решения
- V21 батч — СКЕЛЕТ: бюджет-гард + очередь + Telegram-доставка работают; но без V2 (заполнение нод) и openreels-цепочки (V22 ElevenLabs/V23 Remotion) рецепты в батче дадут сырой/падающий результат. Полный автопилот «100 видео» = после ключей владельца (ELEVENLABS_API_KEY + Remotion-lambda).
- V3+V4: известный pre-existing MAJOR (не фикшу сейчас) — submit персистит renderCount/ноды ПОСЛЕ всего цикла; если submitNode КИНЕТ исключение (не вернёт {error}) посреди цикла, ретрай пере-сабмитит уже оплаченные fal-ноды. Низкий риск (submitNode ошибки возвращает, не кидает). Фикс на потом: чекпойнт после каждого submitNode.
- _(append по ходу)_
