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
- [ ] V11 смета + бюджет-кап
- [x] **V8** reality-first дефолты decompose — problem/solution/proof → disk_real (хребет), seedance/creatify только hook-ревил/нет съёмки. Промпт decompose.
- [ ] R6 skills-updater (обратка → дельты)
- [ ] R5 Telegram-бот + fal-whisper
- [ ] V21 планировщик батча

## Миграции к применению (Supabase SQL Editor) — утром
- `supabase/migrations/20260621_factory_generation_history.sql` (V20) — без неё genHistory мягко деградирует (история не пишется).

## Заметки/решения
- V3+V4: известный pre-existing MAJOR (не фикшу сейчас) — submit персистит renderCount/ноды ПОСЛЕ всего цикла; если submitNode КИНЕТ исключение (не вернёт {error}) посреди цикла, ретрай пере-сабмитит уже оплаченные fal-ноды. Низкий риск (submitNode ошибки возвращает, не кидает). Фикс на потом: чекпойнт после каждого submitNode.
- _(append по ходу)_
