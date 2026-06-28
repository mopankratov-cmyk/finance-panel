export type RunStep = "autofill" | "submit" | "gen-poll" | "assemble" | "render-submit" | "render-poll" | "otk" | "bank" | "done" | "failed";

export interface RunNode {
  ordinal: number; slot: string | null; node_type: string | null; tool: string | null;
  prompt: string; params: Record<string, unknown>; image_url: string | null; asset_url: string | null;
  duration_sec: number | null; onscreen_text: string | null;
  status: "pending" | "submitted" | "done" | "error" | "skip";
  token?: string; url?: string; error?: string; engine?: string;
}

export interface RunOtkVerdict {
  score: number | null;
  verdict?: string;
  axes?: unknown;
  issues?: string[];
  basis?: string | null;
  basis_reason?: string | null;
  artifact_ok?: boolean | null;
  artifact_defects?: string[];
}

export interface RunPlan {
  run_id?: string | null;
  batch_run_id?: string | null;
  batch_role?: "control" | "experiment" | "none" | null;
  change_axis?: "none" | "hook_angle" | "proof_density" | "cta_shape" | "format" | null;
  reels_brain_pattern?: {
    pattern_id: string;
    hook_type: string;
    structure_type: string;
    retention_mechanism: string;
    emotion?: string | null;
    viral_logic?: string | null;
    example_hooks?: string[];
  } | null;
  step: RunStep;
  nodes: RunNode[];
  render_id?: string | null;
  output_url?: string | null;
  step_started_at?: string | null;
  pollCount?: number;
  renderCount?: number;
  otk?: RunOtkVerdict | null;
  attempts?: number;
  lease_until?: string | null;
  error?: string | null;
  bestScore?: number | null;
  bestUrl?: string | null;
  bestOtk?: RunOtkVerdict | null;
  notify?: boolean;
  render_engine?: string | null;
  reel_props?: Record<string, unknown> | null;
  duration_frames?: number | null;
  catalog_url?: string | null;
  catalog_error?: string | null;
  backup_url?: string | null;
  warnings?: string[] | null;
  execution_log?: ExecutionLogEntry[] | null;
}

export interface ExecutionLogEntry {
  run_id: string;
  step: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "warning" | "error";
  input_artifact: string | null;
  output_artifact: string | null;
  error: string | null;
  note?: string | null;
}
