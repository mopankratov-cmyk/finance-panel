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

// Толерантный парсер JSON-массива из ответа LLM: снимает markdown-ограждение, пробует
// собрать целый массив, а если хвост оборван — вытаскивает все цельные top-level элементы.
export function extractJsonArray(raw: string): any[] | null {
  const text = String(raw || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("[");
  if (start < 0) return null;
  const sliced = text.slice(start);
  const tryParse = (x: string) => {
    try {
      const value = JSON.parse(x);
      return Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(sliced);
  if (direct !== undefined) return direct;
  const balanced = extractBalancedJsonFragment(sliced, "[", "]");
  if (balanced) {
    const parsed = tryParse(balanced.replace(/,(\s*[}\]])/g, "$1"));
    if (parsed !== undefined) return parsed;
  }
  const out: any[] = [];
  let depth = 0;
  let itemStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = 1; i < sliced.length; i++) {
    const c = sliced[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") {
      if (depth === 0) itemStart = i;
      depth++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && itemStart >= 0) {
        try {
          out.push(JSON.parse(sliced.slice(itemStart, i + 1)));
        } catch { /* битый элемент пропускаем */ }
        itemStart = -1;
      }
    }
  }
  return out.length ? out : null;
}

function extractBalancedJsonFragment(text: string, openChar: "{" | "[", closeChar: "}" | "]"): string | null {
  let inStr = false;
  let esc = false;
  let depth = 0;
  let started = false;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    out += c;
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === openChar) { depth++; started = true; }
    else if (c === closeChar) {
      depth--;
      if (started && depth === 0) return out;
    }
  }
  return null;
}
