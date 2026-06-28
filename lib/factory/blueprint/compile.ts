import { routeNode } from "../renderRouter";
import type { Blueprint } from "./schema";

export interface NodeRecipeRow {
  ordinal: number;
  slot: string;
  node_type: string;
  tool: string;
  prompt: string;
  params: Record<string, unknown>;
  asset_url: string | null;
  duration_sec: number | null;
}

export interface CompiledBlueprint {
  nodes: NodeRecipeRow[];
  graph_doc: {
    source: "blueprint";
    sku_id: string;
    lane: Blueprint["lane"];
    hook_locked: true;
    beats: number;
  };
}

function beatDuration(blueprint: Blueprint): number {
  return Math.max(2, Math.round(blueprint.duration_s / Math.max(1, blueprint.beats.length)));
}

export function compileBlueprint(blueprint: Blueprint): CompiledBlueprint {
  const dur = beatDuration(blueprint);
  const nodes = blueprint.beats.map((beat, idx) => {
    const routed = routeNode({
      node_type: "product_motion",
      tool_candidate: blueprint.lane === "ugc" ? "creatify" : "seedance",
      render_role: "кадр-вставка",
      footage: beat.ref.kind === "asset" ? "real" : "photo",
    });
    const prompt = [
      `Shot: ${beat.shot}`,
      `Motion: ${beat.motion}`,
      `Hook stays locked: ${blueprint.hook.text}`,
    ].join("\n");
    return {
      ordinal: idx,
      slot: idx === 0 ? "hook" : idx === blueprint.beats.length - 1 ? "cta" : `beat_${idx + 1}`,
      node_type: "product_motion",
      tool: routed.tool,
      prompt,
      params: {
        role: idx === 0 ? "hook" : idx === blueprint.beats.length - 1 ? "cta" : "proof",
        article: blueprint.sku_id,
        lane: blueprint.lane,
        blueprint_ref_kind: beat.ref.kind,
        image_url: beat.ref.url || null,
        onscreen_text: idx === 0 ? blueprint.hook.text : blueprint.captions?.find((c) => Math.round(c.t) === Math.round(beat.t))?.text || "",
        motion: beat.motion,
        __router_reason: routed.reason,
      },
      asset_url: beat.ref.url || null,
      duration_sec: dur,
    };
  });
  return {
    nodes,
    graph_doc: {
      source: "blueprint",
      sku_id: blueprint.sku_id,
      lane: blueprint.lane,
      hook_locked: true,
      beats: blueprint.beats.length,
    },
  };
}
