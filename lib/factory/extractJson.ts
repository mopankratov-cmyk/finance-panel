// Толерантный парсер JSON из ответа LLM: снимает markdown-обёртку, авто-закрывает
// обрезанные по токен-лимиту скобки/строки, чистит хвостовые запятые. Возвращает null,
// если совсем не парсится. Раньше produce/scenario делали строгий JSON.parse(m[0]) на
// жадном regex → 502 на любом обрезанном/обёрнутом ответе. Источник логики — decompose.
export function extractJson(raw: string): any | null {
  let t = String(raw || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{");
  if (a < 0) return null;
  t = t.slice(a);
  const tryParse = (x: string) => { try { return JSON.parse(x); } catch { return undefined; } };
  const v = tryParse(t); if (v !== undefined) return v;
  const stack: string[] = []; let inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = t; if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return tryParse(out.replace(/,(\s*[}\]])/g, "$1")) ?? null;
}
