const REALITY_FIRST_ROLES = new Set(["problem", "solution", "proof"]);

export function applyRealityFirstRouting<T extends Record<string, any>>(nodes: T[]): T[] {
  return (nodes || []).map((n) => {
    const role = String(n?.role || "").toLowerCase();
    if (!REALITY_FIRST_ROLES.has(role)) return n;
    const nodeType = String(n?.node_type || "").toLowerCase();
    const tool = String(n?.tool_candidate || n?.tool || "").toLowerCase();
    const allowedAiAccent = nodeType === "talking_head" || nodeType === "before_after" || nodeType === "voiceover";
    if (allowedAiAccent || tool === "disk_real") return n;
    return {
      ...n,
      tool_candidate: "disk_real",
      routing_note: `reality_first: ${role} forced from ${tool || "empty"} to disk_real`,
    };
  });
}
