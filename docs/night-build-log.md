# Ночная сборка автопилота — лог (2026-06-21)

Ветка `feat/service-balances-dashboard`. Каждый кусок: код → tsc+eslint+build → адверсариал-ревью → коммит. В прод НЕ пушу (утром ревью). Реальные платные батчи не гоню (тонкий тест ≤2).

Кап $40 · ASR=fal-whisper · заводской бот `FACTORY_TG_*`. Канон качества: docs/openreels-pipeline.md.
⏳ Отложено до ключей владельца: V22 ElevenLabs (`ELEVENLABS_API_KEY`), V23 Remotion-lambda.

## Прогресс
- [x] **V20** история генераций — таблица `generation_history` (lineage/params/otk/attempt/variant) + `lib/factory/genHistory.ts` (logGeneration/getRecipeHistory, best-effort) + врезки в gen-save (финал) и node-preview (sync+async done) + GET `/api/factory/generation-history?recipe_id=`. tsc+eslint 0.
- [x] **V1** одобрение → «✓ Беру» зовёт /winners (хук в viral_hooks=5), «✕ Не то»/чипы → новый POST /api/factory/reject (cf_signals reason_chip + generation_history status=rejected). studio.html sendWinner/sendReject. Раньше — голый toast.
- [ ] V3+V4 ОТК-петля regen-on-fail + improve-prompt
- [ ] R3 артефакт-гейт (vision-чек → авто-реген)
- [ ] R4 3 варианта на ТЗ
- [ ] V11 смета + бюджет-кап
- [ ] V8 reality-first дефолты decompose
- [ ] R6 skills-updater (обратка → дельты)
- [ ] R5 Telegram-бот + fal-whisper
- [ ] V21 планировщик батча

## Миграции к применению (Supabase SQL Editor) — утром
- `supabase/migrations/20260621_factory_generation_history.sql` (V20) — без неё genHistory мягко деградирует (история не пишется).

## Заметки/решения
- _(append по ходу)_
