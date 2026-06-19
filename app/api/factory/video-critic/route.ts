import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { rubricPrompt, scoreRubric, nicheFromArticle } from "@/lib/factory/rubric";
import type { ContentMode, RubricNiche, AxisScores } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AXIS_KEYS: (keyof AxisScores)[] = ["hook", "retention", "native", "brand", "cta"];

// Ось из ответа модели: значение ЕСТЬ → пропускаем как есть (явный 0/мусор → scoreRubric.clamp опустит до 1 = провал флора),
// genuinely-absent (null/undefined) → нейтральная 3. Прежний `+raw.hook || 3` маскировал явный низкий 0/NaN под проходной флор 3.
const axisOr3 = (v: unknown): number => (v != null ? Number(v) : 3);

// Терпимый парсер: сначала полный JSON, иначе вытаскивает оси/поля из обрезанного ответа (max_tokens).
function num(txt: string, key: string): number | undefined {
  const m = txt.match(new RegExp(`"${key}"\\s*:\\s*(\\d(?:\\.\\d+)?)`));
  return m ? Number(m[1]) : undefined;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLooseJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* обрезан — ниже */ } }
  const arr = (key: string): string[] => {
    const block = txt.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(\\]|$)`));
    if (!block) return [];
    return (block[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/^"|"$/g, ""));
  };
  const axesVals = AXIS_KEYS.map((k) => num(txt, k));
  const hasAxes = axesVals.some((v) => v !== undefined);
  const score = num(txt, "score");
  if (!hasAxes && score === undefined) return null; // совсем нет вердикта
  const axes = hasAxes ? Object.fromEntries(AXIS_KEYS.map((k, i) => [k, axesVals[i]])) : undefined;
  return { axes, score, verdict: txt.match(/"verdict"\s*:\s*"([^"]+)"/)?.[1], issues: arr("issues"), fixes: arr("fixes"), regen_hint: txt.match(/"regen_hint"\s*:\s*"([^"]+)"/)?.[1] || "" };
}

// Сжать сценарий в компактный текст для критика (хук/динамика/CTA читаются из текста, а не угадываются).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scenarioDigest(sc: any): string {
  if (!sc) return "";
  if (typeof sc === "string") return sc.slice(0, 1500);
  if (typeof sc !== "object") return "";
  const shots = Array.isArray(sc.shots)
    ? sc.shots.slice(0, 8).map((s: Record<string, unknown>, i: number) =>
        `${s.t || i}: [кадр] ${s.visual || ""} [озвучка] ${s.voiceover || ""} [на экране] ${s.onscreen || ""}`).join("\n")
    : "";
  return [
    sc.title && `Заголовок: ${sc.title}`,
    shots && `Покадрово:\n${shots}`,
    sc.caption && `Подпись: ${sc.caption}`,
    sc.cta && `CTA: ${sc.cta}`,
    sc.music && `Звук: ${sc.music}`,
  ].filter(Boolean).join("\n").slice(0, 1500);
}

// Видео-критик 2.0: судит ролик по рубрике «лучше конкурентов» (оси A–E), а не только «нет ли брака».
// Кадры подаются по таймлайну (кадр 1 ≈ хук, последний ≈ финал) + хук + сценарий + режим.
// Модель ставит оси 1–5; взвешенный балл, флоры и вердикт считает сервер. Обратная совместимость:
// в ответе остаются score(1-10)/verdict/issues/fixes/regen_hint — на них висит ретрай-петля кокпита.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, 6) : [];
  const context: string = (body.context || "").toString().slice(0, 400);
  const kind: string = body.kind === "avatar" ? "avatar" : "product";
  const mode: ContentMode = body.mode === "sell" ? "sell" : "audience";
  const hook: string = (body.hook || "").toString().slice(0, 300);
  const article: string = (body.article || "").toString().slice(0, 40);
  const name: string = (body.product_name || "").toString().slice(0, 120);
  const niche: RubricNiche = (["clothing", "toys", "cosmetics", "default"].includes(body.niche) ? body.niche : nicheFromArticle(article, name)) as RubricNiche;
  const scenarioText = scenarioDigest(body.scenario);

  // ── ТЕКСТОВЫЙ ПРЕДФИЛЬТР (storyboard): отсев слабого ХУКА по ТЕКСТУ хука+сценария ДО дорогого рендера.
  // Строго за флагом body.storyboard===true + пустые frames + есть hook — иначе путь по кадрам байт-в-байт прежний.
  // Флор только по хуку (basis='text'); native/brand из текста не судятся; regen_hint пуст (не для ретрай-петли).
  if (body.storyboard === true && !frames.length && hook) {
    const tClient = await createClaudeClient();
    if (!tClient) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });
    const tLabel = mode === "sell" ? "ПРОДАЖА (ведём на WB)" : "АУДИТОРИЯ (рост охвата/подписок)";
    const sysT = `Ты отсеиваешь слабый ХУК сценария короткого вертикального видео ДО дорогого рендера. На входе — ТЕКСТ (хук + покадровый сценарий), кадров нет. Режим: ${tLabel}. Ниша: ${niche}.
По тексту честно читаются ось A (ХУК), частично E (CTA) и структура B; оси C (нативность) и D (товар в кадре) из текста НЕ оценить — ставь им 3 (нейтрально), решения по ним не принимаем. Суди СТРОГО ось A: сильный хук = паттерн-брейк/новизна/интрига в первой фразе, за 1 сек ясно «зачем смотреть»; слабый = общая витрина/«здравствуйте».
${rubricPrompt(mode)}
Верни СТРОГО JSON: {"axes":{"hook":1-5,"retention":1-5,"native":3,"brand":3,"cta":1-5},"issues":["что слабо в хуке/структуре",...],"fixes":["как усилить хук",...]}. Только JSON.`;
    try {
      const resT = await tClient.messages.create({ model: MODEL, max_tokens: 700, system: sysT, messages: [{ role: "user", content: `Хук: «${hook}».\nСценарий:\n${scenarioText || "—"}` }] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let txtT = (resT.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
      txtT = txtT.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
      const jT = parseLooseJson(txtT);
      if (!jT) return NextResponse.json({ error: "пустой ответ предфильтра", basis: "text" }, { status: 502 });
      const rawT = (jT.axes && typeof jT.axes === "object") ? jT.axes : {};
      const axesT: AxisScores = { hook: axisOr3(rawT.hook), retention: axisOr3(rawT.retention), native: 3, brand: 3, cta: axisOr3(rawT.cta) };
      const rT = scoreRubric(axesT, mode, niche, "text");
      return NextResponse.json({ score: rT.score, weighted: rT.weighted, verdict: rT.verdict, axes: axesT, floor_fail: rT.floorFail, mode, niche, basis: "text", issues: Array.isArray(jT.issues) ? jT.issues : [], fixes: jT.fixes || [], regen_hint: "" });
    } catch (e) {
      return NextResponse.json({ error: String(e).slice(0, 200), basis: "text" }, { status: 502 });
    }
  }

  if (!frames.length) return NextResponse.json({ error: "Нет кадров" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const modeLabel = mode === "sell" ? "ПРОДАЖА (ведём на WB)" : "АУДИТОРИЯ (рост охвата/подписок, без давления на WB)";
  const sys = `Ты — строгий ОТК коротких вертикальных видео (Reels/Shorts/VK Клипы) бренда-селлера WB/Ozon. Твоя задача — оценить, обойдёт ли этот ролик контент КОНКУРЕНТОВ в ленте, а не просто «нет ли брака».
Режим ролика: ${modeLabel}. Ниша: ${niche}.
Тебе дают КАДРЫ ОДНОГО ролика В ХРОНОЛОГИЧЕСКОМ ПОРЯДКЕ (кадр 1 ≈ первая секунда/хук, последний ≈ финал), а также текст хука и сценария. Суди: ось A (хук) — по первому кадру и тексту хука; ось B (удержание/темп) — по тому, как меняются кадры от первого к последнему и есть ли причина досмотреть; оси C/D/E — по кадрам вместе со сценарием.
${kind === "avatar" ? "Внимание: это AI-аватар — ось НАТИВНОСТЬ занижай при любом «AI-запахе» (восковая кожа, мёртвые/асимметричные глаза, кривой рот, синтетичность). Сомневаешься — снижай. " : ""}${rubricPrompt(mode)}
Не завышай баллы из вежливости — это для конкуренции в ленте. Верни СТРОГО JSON:
{"axes":{"hook":1-5,"retention":1-5,"native":1-5,"brand":1-5,"cta":1-5},"issues":["конкретный изъян, мешающий обойти конкурентов",...],"fixes":["что поправить",...],"regen_hint":"одна короткая англ. фраза-добавка к промпту image-to-video, чтобы убрать главный ВИЗУАЛЬНЫЙ дефект"}. Только JSON, без преамбулы.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: "text", text: `Хук: «${hook || "—"}».\nСценарий:\n${scenarioText || "—"}\nДоп. контекст: ${context || "—"}\n\nНиже ${frames.length} кадр(ов) ролика ПО ПОРЯДКУ (первый = старт/хук, последний = финал). Оцени по рубрике.` }];
  for (const f of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } });

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1536, system: sys, messages: [{ role: "user", content }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    txt = txt.replace(/```json\s*/gi, "").replace(/```/g, "").trim(); // снять markdown-ограждение
    const j = parseLooseJson(txt);
    if (!j) return NextResponse.json({ error: "пустой ответ критика", raw: txt.slice(0, 150) }, { status: 502 });

    // оси: из ответа модели; фолбэк — равномерно из плоского score, если модель не дала оси.
    const raw = (j.axes && typeof j.axes === "object") ? j.axes : null;
    const hasAxes = !!raw && AXIS_KEYS.some((k) => raw[k] != null);
    let axes: AxisScores;
    if (hasAxes) {
      // brand genuinely-absent НЕ должен валить sell-флор brand≥4 (нет сигнала ≠ провал) → дефолт под флор режима
      axes = { hook: axisOr3(raw.hook), retention: axisOr3(raw.retention), native: axisOr3(raw.native), brand: (raw.brand != null ? Number(raw.brand) : (mode === "sell" ? 4 : 3)), cta: axisOr3(raw.cta) };
    } else {
      // плоский score: ЕСТЬ → масштабируем как есть (0 → clamp до 1 = провал), genuinely-absent → нейтральные 5/2≈3.
      const a = Math.max(1, Math.min(5, Math.round((j.score != null ? Number(j.score) : 5) / 2)));
      axes = { hook: a, retention: a, native: a, brand: a, cta: a };
    }

    const { weighted, score, verdict, floorFail } = scoreRubric(axes, mode, niche);
    const issues: string[] = Array.isArray(j.issues) ? j.issues : [];
    if (floorFail.length) issues.unshift(`Провал по флору (${floorFail.join(", ")}) — ниже минимума для режима «${mode}»`);

    return NextResponse.json({ score, weighted, verdict, axes, floor_fail: floorFail, mode, niche, issues, fixes: j.fixes || [], regen_hint: j.regen_hint || "" });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
