import { buildKatyaAnchorExpansion } from "./bloggerAnchorExpansion";

export function buildKatyaAnchorExpansionSafer(generation = 15) {
  const base = buildKatyaAnchorExpansion(generation);
  return {
    ...base,
    mode: "katya-anchor-expansion-safer" as const,
    planned_runs: [
      base.planned_runs[0],
      base.planned_runs[1],
      {
        ...base.planned_runs[2],
        run_id: `katya_expand_safe__g${String(generation).padStart(2, "0")}__03__entryway_jacket__friend_advice`,
        camera_angle_id: "upper_body" as const,
        pose_id: "standing_relaxed" as const,
        expression_id: "skeptical_soft" as const,
        expressiveness: "low" as const,
        heygen_motion_prompt: [
          "speaks like giving advice to a friend, tiny lean toward camera, conversational pause",
          "upper body crop, more torso visible, slightly imperfect phone framing",
          "standing relaxed, shoulders uneven in a natural way",
          "soft skepticism in the first second, then relax",
          "avoid repetitive left-right head loop, avoid presenter smile, keep movement subtle and non-cyclic, no malformed props or object glitches",
        ].join("; "),
        heygen_visual_prompt: [
          "same Russian UGC creator Katya, preserve face identity and hair",
          "entryway with jacket or bag in background, casual before-going-out feeling",
          "casual outer layer with very ordinary hallway styling, not polished",
          "upper body crop, more torso visible, slightly imperfect phone framing",
          "standing relaxed, shoulders uneven in a natural way",
          "soft skepticism in the first second, then relax",
          "small imperfections, ordinary skin texture, rough everyday light, no glossy ad styling, no beauty-shoot feel, no product, no b-roll, no broken mug or malformed props",
        ].join("; "),
        hypothesis: "Safer entryway version: keep body-visible hallway realism but remove the riskier slightly-below framing.",
      },
      {
        ...base.planned_runs[4],
        run_id: `katya_expand_safe__g${String(generation).padStart(2, "0")}__04__window_room__friend_advice`,
        pose_id: "sitting_close" as const,
        expression_id: "thinking" as const,
        expressiveness: "low" as const,
        heygen_motion_prompt: [
          "speaks like giving advice to a friend, tiny lean toward camera, conversational pause",
          "upper body standing frame, more torso visible, phone shot feels ordinary",
          "sitting close to phone, casual posture",
          "thinking-out-loud expression, normal blink, no acting",
          "avoid repetitive left-right head loop, avoid presenter smile, keep movement subtle and non-cyclic, no malformed props or object glitches",
        ].join("; "),
        heygen_visual_prompt: [
          "same Russian UGC creator Katya, preserve face identity and hair",
          "room near a window, pale wall, casual domestic light, slight background clutter, not pretty",
          "soft cardigan in window light, slightly unstyled apartment look",
          "upper body standing frame, more torso visible, phone shot feels ordinary",
          "sitting close to phone, casual posture",
          "thinking-out-loud expression, normal blink, no acting",
          "small imperfections, ordinary skin texture, rough everyday light, no glossy ad styling, no beauty-shoot feel, no product, no b-roll, no broken mug or malformed props",
        ].join("; "),
        hypothesis: "Safer window-room version: keep atmosphere but reduce standing-frame fragility.",
      },
      {
        ...base.planned_runs[5],
        run_id: `katya_expand_safe__g${String(generation).padStart(2, "0")}__05__plain_wall__friend_advice`,
        pose_id: "standing_relaxed" as const,
        expression_id: "neutral_curious" as const,
        expressiveness: "low" as const,
        heygen_motion_prompt: [
          "speaks like giving advice to a friend, tiny lean toward camera, conversational pause",
          "upper body crop with more body visible, rough phone framing",
          "standing relaxed, shoulders uneven in a natural way",
          "neutral curious face, no early smile",
          "avoid repetitive left-right head loop, avoid presenter smile, keep movement subtle and non-cyclic, no malformed props or object glitches",
        ].join("; "),
        heygen_visual_prompt: [
          "same Russian UGC creator Katya, preserve face identity and hair",
          "plain apartment wall, flat simple light, intentionally boring and believable",
          "simple home casual top, no styling effort, believable everyday appearance",
          "upper body crop with more body visible, rough phone framing",
          "standing relaxed, shoulders uneven in a natural way",
          "neutral curious face, no early smile",
          "small imperfections, ordinary skin texture, rough everyday light, no glossy ad styling, no beauty-shoot feel, no product, no b-roll, no broken mug or malformed props",
        ].join("; "),
        hypothesis: "Safer plain-wall version: keep upper-body realism but simplify handheld instability.",
      },
    ],
  };
}
