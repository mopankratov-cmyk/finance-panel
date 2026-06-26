export type WinnerPresetNode = {
  ordinal: number;
  node_type: unknown;
  tool: unknown;
  role: string;
  prompt: string;
  onscreen_text: string | null;
  emotion: string | null;
  visual_desc: string | null;
  params: Record<string, unknown>;
  duration_sec: number | null;
};

const VOLATILE_PARAMS = new Set(["preview_url", "preview_hash"]);

export function sanitizeWinnerPresetNodes(rawNodes: Record<string, unknown>[]): WinnerPresetNode[] {
  return (rawNodes || [])
    .filter((n) => String(n.status || "") !== "skip" && (n.tool || n.node_type))
    .map((n, i) => {
      const params = { ...((n.params as Record<string, unknown>) || {}) };
      for (const k of VOLATILE_PARAMS) delete params[k];
      const role = String((params.role as string) || (n.slot as string) || "").toLowerCase();
      return {
        ordinal: typeof n.ordinal === "number" ? n.ordinal : i + 1,
        node_type: n.node_type || null,
        tool: n.tool || null,
        role,
        prompt: String(n.prompt || "").slice(0, 1500),
        onscreen_text: String((n.onscreen_text as string) || (params.onscreen_text as string) || "").slice(0, 300) || null,
        emotion: (params.emotion as string) || null,
        visual_desc: String((params.visual_desc as string) || "").slice(0, 300) || null,
        params,
        duration_sec: typeof n.duration_sec === "number" ? n.duration_sec : null,
      };
    });
}
