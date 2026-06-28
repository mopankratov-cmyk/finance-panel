import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const route = readFileSync("app/api/factory/batch/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/const requestedNiche = String\(b\.niche \|\| ""\)\.trim\(\) \|\| null;/.test(route), "batch route normalizes requested niche");
ok(/const batchRunId = `batch_\$\{Date\.now\(\)\}_\$\{randomUUID\(\)\.slice\(0, 8\)\}`;/.test(route), "batch route creates a batch run id");
ok(/import \{ buildRunPlan, makeRunId \} from "@\/lib\/factory\/graphRun";/.test(route), "batch route can enqueue run plans directly");
ok(/const requireFullBatch = b\.require_full_batch === true;/.test(route), "batch route supports full-batch requirement");
ok(/const requireLearningGate = b\.require_learning_gate === true;/.test(route), "batch route supports learning-gate requirement");
ok(/const requireStrongSource = b\.require_strong_source === true;/.test(route), "batch route supports quality-first strong source requirement");
ok(/const seriesAfter = String\(b\.series_after \|\| ""\)\.trim\(\) \|\| null;/.test(route), "batch route supports active series window");
ok(/loadImprovementSnapshot\(db, \{ niche: requestedNiche, target_runs: 50/.test(route), "batch route reads learning gate snapshot");
ok(/series_after: seriesAfter/.test(route), "batch route applies active series window to learning gate");
ok(/select\("id,niche,article"\)/.test(route), "batch route selects recipe metadata");
ok(/selectedRecipes/.test(route), "batch route tracks selected recipe metadata");
ok(/limit\(Math\.max\(count \* 5, DRAFT_LOOKUP_LIMIT\)\)/.test(route), "batch route scans a wider draft window than one batch");
ok(/const availableDrafts = selectedRecipes\.length;/.test(route), "batch route counts available drafts");
ok(/const missingDrafts = Math\.max\(0, count - availableDrafts\);/.test(route), "batch route reports missing drafts");
ok(/const sourceReadiness = await loadSourceReadiness\(db, selectedRecipes\.map/.test(route), "batch route resolves source-ready detail before launch");
ok(/const sourceReadyDrafts = sourceReadyRecipeIds\.length;/.test(route), "batch route counts source-ready drafts");
ok(/missing_source_drafts: missingSourceDrafts/.test(route), "batch route reports missing source-ready drafts in preflight");
ok(/source_tiers: sourceTierCounts/.test(route), "batch route reports source tiers in preflight");
ok(/strong_source_drafts: strongSourceDrafts/.test(route), "batch route reports prepared/real source draft count");
ok(/requireStrongSource && strongSourceDrafts < count/.test(route), "batch route blocks quality-first launch when strong sources are missing");
ok(/wb_only_drafts: wbOnlyDrafts/.test(route), "batch route reports WB-only source draft count");
ok(/next_action: providerReady \? \{ type: "prepare_drafts", route: "\/api\/factory\/prepare-drafts", count, niche: requestedNiche \} : null/.test(route), "batch route suggests draft preparation when queue is empty and providers are ready");
ok(/sourcePrepNextAction/.test(route), "batch route suggests source-prep when only weak WB sources are available");
ok(/next_action: requireStrongSource && strongSourceDrafts < count && sourcePrepNextAction[\s\S]*\? sourcePrepNextAction[\s\S]*: preflight\.missing_drafts > 0 \|\| preflight\.missing_source_drafts > 0 \? \{ type: "prepare_drafts", route: "\/api\/factory\/prepare-drafts", count, niche: requestedNiche \} : sourcePrepNextAction/.test(route), "batch route can suggest source-prep for quality-first strong-source gaps");
ok(/requested: \{ niche: requestedNiche, count, budget_usd: cap, series_after: seriesAfter \}/.test(route), "batch route returns requested batch shape");
ok(/const preflight = \{[\s\S]*ready: plannedRecipeIds\.length >= count && !cappedByBudget && sourceReadyDrafts >= count && \(!requireStrongSource \|\| strongSourceDrafts >= count\) && providerReady && \(!requireLearningGate \|\| learningGate\.ready\)/.test(route), "batch route returns quality-first launch readiness before enqueue");
ok(/if \(requireLearningGate && !dryRun && !learningGate\.ready\)/.test(route), "batch route blocks learning-gated launches before enqueue");
ok(/if \(requireFullBatch && !dryRun && !preflight\.ready\)/.test(route), "batch route blocks incomplete required batches before launch");
ok(/batch_run_id: batchRunId/.test(route), "batch route returns batch run id");
ok(/learning_gate: learningGate/.test(route), "batch route returns learning gate state");
ok(/const batchMetaFor = \(rid: number, idx: number\)/.test(route), "batch route assigns control/experiment metadata per recipe");
ok(/const selectedById = new Map\(selectedRecipes\.map/.test(route), "batch route indexes selected recipes by id");
ok(/const selectedWithBatchMeta = \(ids: number\[\]\) => ids[\s\S]*batchMetaFor\(id, idx\)/.test(route), "batch route preserves planned id order when assigning batch metadata");
ok(/batch_role: batchMeta\.batch_role/.test(route), "batch route forwards batch role to graph-run");
ok(/change_axis: batchMeta\.change_axis/.test(route), "batch route forwards change axis to graph-run");
ok(/batch_plan: batchPlan/.test(route), "batch route returns batch plan with response");
ok(/selected_recipes: selectedWithBatchMeta\(enqueued\)/.test(route), "batch route returns selected recipes with batch metadata");
ok(/selected_recipes: selectedWithBatchMeta\(plannedRecipeIds\)/.test(route), "batch route returns metadata even on guarded preflight failures");
ok(/async function enqueueGraphRun/.test(route), "batch route has a fast enqueue helper");
ok(/plan\.batch_run_id = meta\.batch_run_id;/.test(route), "batch route writes batch id into direct run plan");
ok(/plan\.batch_role = meta\.batch_role === "control" \|\| meta\.batch_role === "experiment" \? meta\.batch_role : "none";/.test(route), "batch route writes batch role into direct run plan");
ok(/plan\.change_axis = \["none", "hook_angle", "proof_density", "cta_shape", "format"\]\.includes\(meta\.change_axis\)/.test(route), "batch route writes change axis into direct run plan");
ok(/plan\.step = "autofill";/.test(route), "batch enqueue starts recipes at autofill step");
ok(/status: "running"/.test(route), "batch enqueue marks recipes running");
ok(!/\/api\/factory\/graph-run", \{ method: "POST"/.test(route), "batch route does not synchronously POST graph-run per recipe");
ok(/const requested=r\.requested\|\|\{\};/.test(studio), "Studio reads batch requested metadata");
ok(/const preflight=r\.preflight\|\|\{\};/.test(studio), "Studio reads batch preflight metadata");
ok(/payload\.require_full_batch=true/.test(studio), "Studio can request full-batch launch guard");
ok(/payload\.require_learning_gate=true/.test(studio), "Studio can request server-side learning gate");
ok(/payload\.series_after=opts\.series_after/.test(studio), "Studio can request a new active series window");
ok(/const learningGate=r\.learning_gate\|\|null;/.test(studio), "Studio reads server-side learning gate result");
ok(/const selected=r\.selected_recipes\|\|\[\];/.test(studio), "Studio reads selected recipes metadata");
ok(/const renderBatchProgress=async\(ids,target\)=>/.test(studio), "Studio can poll launched batch progress");
ok(/\/graph-run\?recipe_id=/.test(studio), "Studio checks each graph-run status for batch progress");
ok(/серия: /.test(studio), "Studio renders selected series size");
ok(/готово к полной пятёрке/.test(studio), "Studio renders full-batch readiness");
ok(/пятёрка неполная/.test(studio), "Studio warns on incomplete next five");
ok(/source-ready/.test(studio), "Studio renders source-ready draft count");
ok(/без исходников/.test(studio), "Studio renders missing-source count");
ok(/learning gate ready/.test(studio) && /learning gate hold/.test(studio), "Studio renders server learning gate state");
ok(/x\.batch_role\|\|"role\?"/.test(studio), "Studio renders selected recipe batch role");
ok(/x\.change_axis\|\|"none"/.test(studio), "Studio renders selected recipe change axis");
ok(/x\.batch_role\|\|"role\?"[\s\S]*x\.step\|\|x\.status/.test(studio), "Studio renders batch role in progress rows");
ok(/x\.change_axis\|\|"none"[\s\S]*x\.step\|\|x\.status/.test(studio), "Studio renders change axis in progress rows");
ok(/r\.batch_run_id/.test(studio), "Studio renders batch run id");
ok(/r\.next_action&&r\.next_action\.type==="prepare_drafts"/.test(studio), "Studio can recover from empty draft queue");
ok(/api\("\/prepare-drafts"/.test(studio), "Studio can prepare draft recipes before batch launch");
ok(/dry&&\(preflight\.missing_drafts>0\|\|preflight\.missing_source_drafts>0\)/.test(studio), "Studio offers draft preparation on incomplete or source-starved dry preflight");
ok(/подготовить недостающие черновики/.test(studio), "Studio labels incomplete preflight draft recovery");
ok(/Проверить прогресс batch/.test(studio), "Studio renders batch progress action");

if (failed) process.exit(1);
console.log(`batchTransparencyContract: ${passed} passed, ${failed} failed`);
