import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();

const removedPaths = [
  "app/inferno",
  "app/carousel",
  "app/video-overlay",
  "app/api/factory",
  "lib/factory",
  "public/inferno",
  "remotion",
  "render-service",
  "railway.json",
  "tools/account-runner",
];

const runtimeRoots = ["app", "components", "lib", "scripts"];
const runtimeFiles = ["next.config.ts", "proxy.ts", "vercel.json", "package.json"];
const textExtensions = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".json"]);
const forbiddenReferences = ["@/lib/factory", "/api/factory", "/inferno/", "@remotion/"];

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

test("removed content runtime cannot return through directories or references", () => {
  for (const path of removedPaths) {
    assert.equal(existsSync(join(root, path)), false, `${path} must stay removed`);
  }

  const files = [
    ...runtimeRoots.flatMap((path) => walk(join(root, path))),
    ...runtimeFiles.map((path) => join(root, path)),
  ].filter((path) => textExtensions.has(extname(path)));

  const violations: string[] = [];
  for (const path of files) {
    const contents = readFileSync(path, "utf8");
    for (const reference of forbiddenReferences) {
      if (contents.includes(reference)) violations.push(`${relative(root, path)} -> ${reference}`);
    }
  }

  assert.deepEqual(violations, []);

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.remotion, undefined);
  assert.equal(pkg.dependencies?.["@remotion/cli"], undefined);
  assert.equal(pkg.dependencies?.["@remotion/lambda"], undefined);
});
