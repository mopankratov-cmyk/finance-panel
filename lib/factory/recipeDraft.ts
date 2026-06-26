export function draftPromptFromTemplateNode(node: Record<string, any>, article: string, productName?: string): string {
  if (node?.prompt) return String(node.prompt).slice(0, 1500);

  const role = String(node?.role || node?.node_type || "scene").toLowerCase();
  const visual = String(node?.visual_desc || "").trim();
  const onscreen = String(node?.onscreen_text || "").trim();
  const voiceover = String(node?.voiceover || "").trim();
  const product = [productName, article].map((s) => String(s || "").trim()).filter(Boolean).join(" / ") || "свой товар";
  const semanticRef = onscreen || voiceover;
  const parts = [
    `Черновик сцены ${role} под ${product}.`,
    visual ? `Кадр по смыслу: ${visual}.` : "",
    semanticRef ? `Референс смысла конкурента: ${semanticRef.slice(0, 220)}. Переписать под свой товар, не копировать дословно.` : "Текст и озвучку написать заново под свой товар.",
  ].filter(Boolean);
  return parts.join(" ").slice(0, 1500);
}
