import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const client = readFileSync("lib/factory/remotionRender.ts", "utf8");
const route = readFileSync("app/api/factory/remotion-service/route.ts", "utf8");

ok(/export async function remotionHealth/.test(client), "remotion client exposes health check");
ok(/export async function remotionReload/.test(client), "remotion client exposes reload action");
ok(client.includes("${base}/health"), "health checks render-service /health");
ok(client.includes("${base}/reload"), "reload calls render-service /reload");
ok(/headers: HEADERS\(\)/.test(client), "reload sends configured bearer token");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "remotion ops route is operator/cron authorized");
ok(/export async function GET/.test(route) && /remotionHealth/.test(route), "GET returns health");
ok(/searchParams\.get\("form"\) === "1"/.test(route), "GET can render same-origin operator reload form");
ok(/method="post"/.test(route) && /name="reload" value="true"/.test(route), "reload form submits explicit POST reload");
ok(/formData/.test(route), "POST accepts browser form submissions for session-authenticated reload");
ok(/body\.reload !== true && body\.reload !== "true"/.test(route), "POST defaults to health unless reload is explicit");
ok(/remotionReload/.test(route), "POST can trigger reload");
ok(!/REMOTION_RENDER_TOKEN/.test(route), "route does not expose render token name/value in response code");

console.log("remotionServiceOpsContract: passed");
