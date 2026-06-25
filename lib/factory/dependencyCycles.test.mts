import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const roots = ["lib/factory", "app/api/factory"];
const files: string[] = [];

function walk(dir: string) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|mts)$/.test(ent.name) && !ent.name.endsWith(".test.mts")) files.push(p);
  }
}

for (const root of roots) walk(root);

const byNoExt = new Map<string, string>();
for (const file of files) {
  const abs = path.resolve(file);
  byNoExt.set(abs.replace(/\.(ts|tsx|mjs|mts)$/, ""), file);
  if (path.basename(file).startsWith("route.")) byNoExt.set(path.resolve(path.dirname(file), "route"), file);
}

function resolveImport(from: string, spec: string): string | null {
  let s = spec;
  if (s.startsWith("@/")) s = s.replace("@/", "./");
  if (!s.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), s);
  const direct = byNoExt.get(base);
  if (direct) return direct;
  for (const ext of [".ts", ".tsx", ".mjs", ".mts"]) {
    const candidate = base + ext;
    if (existsSync(candidate)) return path.relative(process.cwd(), candidate);
  }
  for (const ext of [".ts", ".tsx", ".mjs", ".mts"]) {
    const candidate = path.join(base, "index" + ext);
    if (existsSync(candidate)) return path.relative(process.cwd(), candidate);
  }
  return null;
}

const graph = new Map<string, string[]>(files.map((file) => [file, []]));
const importRe = /(?:import|export)\s+(?:[^'"]*?from\s*)?["']([^"']+)["']|await\s+import\(["']([^"']+)["']\)/g;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source))) {
    const dep = resolveImport(file, match[1] || match[2]);
    if (dep && graph.has(dep)) graph.get(file)!.push(dep);
  }
}

const cycles: string[][] = [];
const visiting = new Set<string>();
const visited = new Set<string>();
const stack: string[] = [];

function dfs(node: string) {
  visiting.add(node);
  stack.push(node);
  for (const dep of graph.get(node) || []) {
    if (!visited.has(dep) && !visiting.has(dep)) dfs(dep);
    else if (visiting.has(dep)) {
      const start = stack.indexOf(dep);
      cycles.push([...stack.slice(start), dep]);
    }
  }
  stack.pop();
  visiting.delete(node);
  visited.add(node);
}

for (const file of files) {
  if (!visited.has(file)) dfs(file);
}

ok(cycles.length === 0, `factory import cycles:\n${cycles.map((cycle) => cycle.join(" -> ")).join("\n")}`);

if (failed) process.exit(1);
console.log(`dependencyCycles: ${passed} passed, ${failed} failed`);
